#include "v0_native.hpp"
#include "v0_execution.hpp"
namespace groove::v0 {
namespace {
SessionState state;
Backend backend{};
unsigned char busy=0;
unsigned faults=0;
unsigned char suppressProgress=0;
constexpr uintptr_t Manager=0x10A75F0;
const int emptyCell[2]={0,13},hostCell[2]={1,67};
struct Lease {
    bool held;
    Lease():held(!__atomic_test_and_set(&busy,__ATOMIC_ACQUIRE)){}
    ~Lease(){if(held)__atomic_clear(&busy,__ATOMIC_RELEASE);}
};
template<class T> bool read(uintptr_t p,T& out) { return p && backend.memory.read && backend.memory.read(p,&out,sizeof(out)); }
template<class T> bool write(uintptr_t p,const T& in) { return p && backend.memory.write && backend.memory.write(p,&in,sizeof(in)); }
uint64_t call(Hook h,const Frame& f) {
    auto orig=backend.original[unsigned(h)];
    if(!orig) { __atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED); return 0; }
    return orig(f.x[0],f.x[1],f.x[2],f.x[3],f.x[4],f.x[5],f.x[6],f.x[7]);
}
bool coord(uintptr_t p,Coord& c,bool cursor=false) {
    return read(p+(cursor?0x5274:8),c.world) && read(p+(cursor?0x5298:12),c.col) && read(p+(cursor?0x529C:16),c.row);
}
bool mapMode(uintptr_t m,int& mode){ return m && read(m+0x2A38,mode); }
uint64_t fail(){ __atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED); return 0; }
}
#define V0_EXPORT __attribute__((used,retain,visibility("default")))
extern "C" V0_EXPORT bool groove_v0_bind(const Backend* b) {
    Lease lock; if(!lock.held || !b || !b->mainBase || !b->memory.read || !b->memory.write || state.session.active) return false;
    backend=*b; state={}; faults=0; __atomic_store_n(&suppressProgress,0,__ATOMIC_RELEASE); return true;
}
extern "C" V0_EXPORT bool groove_v0_configure(const Slot* slots) {
    Lease lock; if(!lock.held || !slots) return false;
    Slot s[2]; std::memcpy(s,slots,sizeof(s)); return state.setSlots(s);
}
extern "C" V0_EXPORT bool groove_v0_configure_loaded(){
    if(!backend.levels||!backend.saves||!backend.levels->ready)return false;
    Slot slots[2]{};
    for(unsigned i=0;i<2;++i){std::strcpy(slots[i].id,backend.levels->registry.ids[i]);
        if(!slots[i].id[0]||!backend.levels->package[i].valid)continue;
        gsv::Record r;auto s=gsv::load(*backend.saves,slots[i].id,r);
        if(s==gsv::Status::Initial||s==gsv::Status::Loaded){slots[i].enabled=slots[i].saveValid=true;slots[i].state=r.state;}
    }
    return groove_v0_configure(slots);
}
extern "C" V0_EXPORT bool groove_v0_finish(uintptr_t stage) {
    Lease lock; return lock.held && !backend.execution && state.confirmFinish(stage);
}
extern "C" V0_EXPORT bool groove_v0_quiesced(uintptr_t stage,bool aborted) {
    // This notification is NOT a native join. Only the owner of a demonstrated
    // teardown boundary may call it. No live call site exists until that proof.
    Lease lock; return lock.held && !backend.execution && state.quiesced(stage,aborted);
}
extern "C" V0_EXPORT unsigned groove_v0_prepare_save(SaveIntent* out) {
    Lease lock; if(!lock.held||!out||backend.execution) return unsigned(Close::Busy); return unsigned(state.prepareSave(*out));
}
extern "C" V0_EXPORT bool groove_v0_ack_save(const SaveIntent* ack,bool committed) {
    Lease lock; return lock.held && !backend.execution && ack && state.saved(*ack,committed);
}
extern "C" V0_EXPORT bool groove_v0_session_active(){Lease lock;return !lock.held||state.session.active;}
extern "C" V0_EXPORT unsigned groove_v0_fault(){return __atomic_load_n(&faults,__ATOMIC_RELAXED);}
extern "C" V0_EXPORT uint64_t groove_v0_dispatch(uint64_t number,Frame* frame) {
    if(!frame || number>=unsigned(Hook::Count)) return fail();
    Hook h=Hook(number); Frame f=*frame;
    uintptr_t m=backend.mainBase+Manager;
    uintptr_t lr=f.lr>=backend.mainBase?f.lr-backend.mainBase:0;
    // The short lease never spans an original call: originals can reenter hooks.
    bool armed=false,restore=false;int selected=-1;uint64_t sessionToken=0;char selectedId[97]{};
    uint32_t before=0; uintptr_t bits=0; Cursor cursor{};
    {
        Lease lock; if(!lock.held) {
            // Never fabricate a null pointer or suppress a global/native save.
            __atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);
            if(h==Hook::WriteSave)return call(h,f);
            Coord c{};
            if(h==Hook::Launch && coord(f.x[0],c,true) && slotAt(c)>=0)return 0;
            if(h==Hook::CellState && coord(f.x[0],c) && slotAt(c)>=0)return 1;
            if(h==Hook::MapCell && coord(f.x[0],c) && slotAt(c)>=0)return reinterpret_cast<uintptr_t>(emptyCell);
            if((h==Hook::BeginPlay||h==Hook::CampaignA||h==Hook::CampaignB||h==Hook::CommitResult) &&
                __atomic_load_n(&suppressProgress,__ATOMIC_ACQUIRE))return 0;
            return call(h,f);
        }
        switch(h) {
        case Hook::MapInit: state.mapInit(f.x[0]); if(!state.session.active)__atomic_store_n(&suppressProgress,0,__ATOMIC_RELEASE); break;
        case Hook::MapDtor: state.mapDtor(f.x[0]); break;
        case Hook::Confirm: if(!state.beginConfirm(f.x[0])) return fail(); break;
        case Hook::Reverse: ++state.reverseDepth; break;
        case Hook::MapCell: {
            Coord c; if(!coord(f.x[0],c)) return fail(); int i=slotAt(c);
            if(i>=0) return reinterpret_cast<uintptr_t>((state.reverseDepth || !state.slots[i].id[0])?emptyCell:hostCell);
            // Preserve native table lookup for ALL other coordinates.
            break;
        }
        case Hook::CellState: {
            Coord c; int mode=-1; if(!coord(f.x[0],c))return fail();
            if(slotAt(c)>=0) { mapMode(state.map,mode); int s=state.stateAt(c,state.map,mode); if(s>=0)return s; }
            break;
        }
        case Hook::SaveState: {
            if(lr!=0x1D2D68 || !state.confirm)break;
            Coord c; int mode=-1; if(!coord(state.confirm,c,true))return fail();
            if(slotAt(c)>=0){mapMode(state.confirm,mode); int s=state.stateAt(c,state.confirm,mode); return s<0?1:s;}
            break;
        }
        case Hook::Launch: {
            Coord c; if(!coord(f.x[0],c,true))return fail(); if(slotAt(c)<0)break;
            int mode=-1,managerMode=0; int16_t p0=0,p1=0;
            if(!mapMode(f.x[0],mode)||!read(m+0xBA0,p0)||!read(m+0xBA2,p1)||!read(m+0x2904,managerMode))return fail();
            if(!read(m+0x3AA0,bits)||!read(bits,before))return fail();
            // Use static scratch owned by this lease, never 4.5 KiB on callback stack.
            static uint8_t snapshot[BlobSize];
            if(!backend.memory.read(m+0x548,snapshot,BlobSize))return fail();
            auto decision=state.launch(f.x[0],c,mode,p0,p1,managerMode,snapshot);
            if(decision==Launch::Rejected)return 0;
            armed=decision==Launch::Armed; if(armed){selected=state.session.slot;sessionToken=state.session.token;std::memcpy(selectedId,state.session.id,sizeof(selectedId));__atomic_store_n(&suppressProgress,1,__ATOMIC_RELEASE);f.x[2]=0;f.x[3]=0;} break;
        }
        case Hook::BeginPlay: case Hook::CampaignA: case Hook::CampaignB: case Hook::CommitResult:
            if(state.session.active && !state.session.returned)return 0; break;
        case Hook::SetSel: {
            Coord c{int(f.x[2]),int(f.x[3]),int(f.x[4])};
            if(state.suppressSelection(state.confirm,lr,int(f.x[1]),c,int(f.x[5])))return 0; break;
        }
        case Hook::GetSel: restore=state.restoreCursor(lr,int(f.x[1]),cursor); break;
        case Hook::InitGameplay:
            if(state.session.active && !state.session.returned){
                if(!state.session.stage && !state.stageStarted(f.x[0]))return fail();
                if(state.session.stage!=f.x[0])return fail();
                // Original setPending is still reached by native initGameplay;
                // rev2 relies on its verified negative-index guard. Recheck it.
                int16_t p0=0,p1=0; int managerMode=0;
                if(!read(m+0xBA0,p0)||!read(m+0xBA2,p1)||!read(m+0x2904,managerMode)||p0!=-1||p1!=-1||managerMode!=-1)return fail();
            } break;
        case Hook::PerfectSite:
            if(state.session.active && !state.session.returned && lr==0x206A58){__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);if(int32_t(f.x[1])<0)f.x[1]=67;} break;
        case Hook::PerfectCtor:
            if(state.session.active && !state.session.returned)__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED); break;
        case Hook::WriteSave:
            if(state.snapshotValid){
                static uint8_t actual[BlobSize];
                if(!backend.memory.read(m+0x548,actual,BlobSize)||!state.unchanged(actual))__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);
            } break; // detector ONLY; never suppress global persistence
        default: break;
        }
    }
    if(armed && backend.execution){
        bool accepted=backend.levels&&backend.saves&&backend.factory&&backend.newTransaction&&
            selected>=0&&!std::strcmp(backend.levels->package[selected].id,selectedId)&&
            backend.execution->arm(*backend.levels,unsigned(selected),*backend.saves,sessionToken,backend.newTransaction());
        if(!accepted){Lease lock;if(lock.held&&state.session.token==sessionToken&&!state.session.stage){state.session={};state.snapshotValid=false;state.cursor={};__atomic_store_n(&suppressProgress,0,__ATOMIC_RELEASE);}return 0;}
    }
    uint64_t result=call(h,f);
    {
        Lease lock; if(!lock.held){__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);return result;}
        if(h==Hook::Confirm)state.endConfirm();
        if(h==Hook::Reverse){if(state.reverseDepth)--state.reverseDepth;else return fail();}
        if(armed){uint32_t after=0;if(!read(bits,after)||!write(bits,(after&~0xEu)|(before&0xEu)))__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);}
        if(restore){
            uintptr_t dest[4]={f.x[2],f.x[3],f.x[4],f.x[5]};
            int values[4]={cursor.coord.world,cursor.coord.col,cursor.coord.row,cursor.x};
            if(backend.writeCursor && backend.writeCursor(dest,values))state.cursor.pending=false;
            else __atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED); // retain cursor for retry, no partial writes
        }
        if(h==Hook::MapReturn){state.mapReturned();__atomic_store_n(&suppressProgress,0,__ATOMIC_RELEASE);}
    }
    if(h==Hook::MapReturn && backend.execution)backend.execution->mapReturned(backend.execution->token());
    return result;
}
extern "C" V0_EXPORT bool groove_v0_construct_bound_multi(uintptr_t self,uintptr_t seq,const int* args){
    if(!backend.execution||!backend.factory||!args)return false;
    int copy[5];for(unsigned i=0;i<5;++i)copy[i]=args[i];
    if(!backend.execution->construct(*backend.factory,self,seq,copy))return false;
    Lease lock;return lock.held&&state.stageStarted(backend.execution->token().stage);
}
extern "C" V0_EXPORT bool groove_v0_finish_token(StageToken token){
    if(!backend.execution||!backend.execution->confirmFinish(token))return false;
    Lease lock;return lock.held&&state.confirmFinish(token.stage);
}
extern "C" V0_EXPORT bool groove_v0_quiet_token(StageToken token,bool aborted){
    if(!backend.execution)return false;
    if(aborted&&!backend.execution->confirmAbort(token))return false;
    if(!backend.execution->quiesced(token))return false;
    Lease lock;return lock.held&&state.quiesced(token.stage,aborted);
}
extern "C" V0_EXPORT unsigned groove_v0_persist_bound(){
    if(!backend.execution||!backend.saves)return unsigned(gsv::Status::Blocked);
    auto result=backend.execution->persist(*backend.saves);
    if(result==gsv::Status::Committed){Lease lock;if(lock.held){SaveIntent ack;if(state.prepareSave(ack)==Close::Persist)state.saved(ack,true);}}
    return unsigned(result);
}
}

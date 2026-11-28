#include "v0_native.hpp"
namespace groove::v0 {
namespace {
SessionState state;
Backend backend{};
unsigned char busy=0;
unsigned faults=0;
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
    backend=*b; state={}; faults=0; return true;
}
extern "C" V0_EXPORT bool groove_v0_configure(const Slot* slots) {
    Lease lock; if(!lock.held || !slots) return false;
    Slot s[2]; std::memcpy(s,slots,sizeof(s)); return state.setSlots(s);
}
extern "C" V0_EXPORT bool groove_v0_finish(uintptr_t stage) {
    Lease lock; return lock.held && state.confirmFinish(stage);
}
extern "C" V0_EXPORT bool groove_v0_quiesced(uintptr_t stage,bool aborted) {
    // This notification is NOT a native join. Only the owner of a demonstrated
    // teardown boundary may call it. No live call site exists until that proof.
    Lease lock; return lock.held && state.quiesced(stage,aborted);
}
extern "C" V0_EXPORT unsigned groove_v0_prepare_save(SaveIntent* out) {
    Lease lock; if(!lock.held||!out) return unsigned(Close::Busy); return unsigned(state.prepareSave(*out));
}
extern "C" V0_EXPORT bool groove_v0_ack_save(const SaveIntent* ack,bool committed) {
    Lease lock; return lock.held && ack && state.saved(*ack,committed);
}
extern "C" V0_EXPORT unsigned groove_v0_fault(){return __atomic_load_n(&faults,__ATOMIC_RELAXED);}
extern "C" V0_EXPORT uint64_t groove_v0_dispatch(uint64_t number,Frame* frame) {
    if(!frame || number>=unsigned(Hook::Count)) return fail();
    Hook h=Hook(number); Frame f=*frame;
    uintptr_t m=backend.mainBase+Manager;
    uintptr_t lr=f.lr>=backend.mainBase?f.lr-backend.mainBase:0;
    // The short lease never spans an original call: originals can reenter hooks.
    bool armed=false,restore=false;
    uint32_t before=0; uintptr_t bits=0; Cursor cursor{};
    {
        Lease lock; if(!lock.held) return fail();
        switch(h) {
        case Hook::MapInit: state.mapInit(f.x[0]); break;
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
            armed=decision==Launch::Armed; if(armed){f.x[2]=0;f.x[3]=0;} break;
        }
        case Hook::BeginPlay: case Hook::CampaignA: case Hook::CampaignB: case Hook::CommitResult:
            if(state.session.active)return 0; break;
        case Hook::SetSel: {
            Coord c{int(f.x[2]),int(f.x[3]),int(f.x[4])};
            if(state.suppressSelection(state.confirm,lr,int(f.x[1]),c,int(f.x[5])))return 0; break;
        }
        case Hook::GetSel: restore=state.restoreCursor(lr,int(f.x[1]),cursor); break;
        case Hook::InitGameplay:
            if(state.session.active){
                if(!state.session.stage && !state.stageStarted(f.x[0]))return fail();
                if(state.session.stage!=f.x[0])return fail();
                // Original setPending is still reached by native initGameplay;
                // rev2 relies on its verified negative-index guard. Recheck it.
                int16_t p0=0,p1=0; int managerMode=0;
                if(!read(m+0xBA0,p0)||!read(m+0xBA2,p1)||!read(m+0x2904,managerMode)||p0!=-1||p1!=-1||managerMode!=-1)return fail();
            } break;
        case Hook::PerfectSite:
            if(state.session.active && lr==0x206A58){__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);if(int32_t(f.x[1])<0)f.x[1]=67;} break;
        case Hook::PerfectCtor:
            if(state.session.active)__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED); break;
        case Hook::WriteSave:
            if(state.snapshotValid){
                static uint8_t actual[BlobSize];
                if(!backend.memory.read(m+0x548,actual,BlobSize)||!state.unchanged(actual))__atomic_add_fetch(&faults,1u,__ATOMIC_RELAXED);
            } break; // detector ONLY; never suppress global persistence
        default: break;
        }
    }
    uint64_t result=call(h,f);
    {
        Lease lock; if(!lock.held)return fail();
        if(h==Hook::Confirm)state.endConfirm();
        if(h==Hook::Reverse){if(state.reverseDepth)--state.reverseDepth;else return fail();}
        if(armed){uint32_t after=0;if(!read(bits,after)||!write(bits,(after&~0xEu)|(before&0xEu)))return fail();}
        if(restore){
            if(!write(f.x[2],cursor.coord.world)||!write(f.x[3],cursor.coord.col)||!write(f.x[4],cursor.coord.row)||!write(f.x[5],cursor.x))return fail();
        }
        if(h==Hook::MapReturn)state.mapReturned();
    }
    return result;
}
}

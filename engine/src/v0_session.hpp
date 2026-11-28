#pragma once
#include <cstddef>
#include <cstdint>
#include <cstring>

// GE-151 internal V0 ABI. Not slots.json/.gsv, nor a frozen package contract.
namespace groove::v0 {
constexpr unsigned SlotCount=2, IdCapacity=97, BlobSize=0x1188;
struct Coord { int world, col, row; };
inline int slotAt(Coord c) { return c.world==0 && c.col==9 && c.row>=0 && c.row<2 ? c.row : -1; }
inline bool equal(Coord a,Coord b) { return a.world==b.world && a.col==b.col && a.row==b.row; }
inline bool validId(const char* s) {
    if (!s) return false;
    unsigned n=0; bool dot=false, label=false;
    for (; n<IdCapacity && s[n]; ++n) {
        char c=s[n];
        if (c=='.') { if(!label || s[n-1]=='-') return false; dot=true; label=false; }
        else { if(!((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-') || (!label&&c=='-')) return false; label=true; }
    }
    return n>=3 && n<IdCapacity && dot && label && s[n-1]!='-';
}
struct Slot { char id[IdCapacity]{}; bool enabled=false, saveValid=false; unsigned state=0; };
struct Cursor { int mode=0; Coord coord{}; int x=0; bool pending=false; };
struct Session {
    char id[IdCapacity]{}; Coord coord{}; uint64_t token=0, generation=0;
    uintptr_t stage=0; int slot=-1; bool active=false, returned=false, quiescent=false;
    bool finishConfirmed=false, abortConfirmed=false, persistBusy=false;
};
struct SaveIntent { char id[IdCapacity]{}; uint64_t token=0; bool cleared=false; };
enum class Launch { Native, Rejected, Armed };
enum class Close { Nothing, Waiting, Persist, Busy };

// All methods are called under the adapter's short state lease; no callbacks/IO
// under that lease. Registry updates are rejected for the entire session lifetime.
class SessionState {
public:
    Slot slots[SlotCount]{};
    uintptr_t map=0, confirm=0, rejectMap=0;
    uint64_t generation=0,rejectGeneration=0,nextToken=0;
    unsigned reverseDepth=0;
    Cursor cursor{}; Session session{};
    bool snapshotValid=false, fault=false;
    uint8_t snapshot[BlobSize]{};

    bool setSlots(const Slot (&s)[SlotCount]) {
        if(session.active || confirm || reverseDepth) return false;
        for(unsigned i=0;i<SlotCount;++i) {
            if(s[i].id[0] && (!validId(s[i].id) || s[i].state>255)) return false;
            if(s[i].enabled && (!s[i].id[0] || !s[i].saveValid)) return false;
        }
        if(s[0].id[0] && s[1].id[0] && !std::strcmp(s[0].id,s[1].id)) return false;
        std::memcpy(slots,s,sizeof(slots)); return true;
    }
    void clearReject() { rejectMap=0; rejectGeneration=0; }
    void mapInit(uintptr_t m) {
        map=m; ++generation; clearReject(); confirm=0;
        // A session which never acquired a Stage cannot own a worker/result.
        if(session.active && !session.stage) { session={}; cursor={}; snapshotValid=false; }
    }
    void mapDtor(uintptr_t m) {
        if(m!=map) return;
        map=0; ++generation; confirm=0; clearReject();
    }
    bool beginConfirm(uintptr_t m) {
        if(confirm) return false;
        confirm=m; clearReject(); return true;
    }
    void endConfirm() { confirm=0; clearReject(); }
    bool usable(int i,uintptr_t m,int mode) const {
        return i>=0 && i<int(SlotCount) && m && m==map && mode==0 && slots[i].id[0] &&
            slots[i].enabled && slots[i].saveValid && validId(slots[i].id) && slots[i].state<=255;
    }
    int stateAt(Coord c,uintptr_t m,int mode) const {
        int i=slotAt(c); if(i<0 || !slots[i].id[0]) return -1; // delegate empty/native
        if(!usable(i,m,mode)) return 1;
        return slots[i].state<2 ? 2 : slots[i].state>6 ? 6 : int(slots[i].state);
    }
    Launch launch(uintptr_t m,Coord c,int mode,int pending0,int pending1,int managerMode,const uint8_t* blob) {
        int i=slotAt(c); if(i<0) return Launch::Native;
        if(!usable(i,m,mode) || session.active || pending0!=-1 || pending1!=-1 || managerMode!=-1 || !blob) {
            rejectMap=m; rejectGeneration=generation; return Launch::Rejected;
        }
        session={}; session.active=true; session.slot=i; session.coord=c;
        session.generation=generation; session.token=++nextToken;
        std::memcpy(session.id,slots[i].id,IdCapacity);
        std::memcpy(snapshot,blob,BlobSize); snapshotValid=true; cursor={};
        return Launch::Armed;
    }
    bool suppressSelection(uintptr_t m,uintptr_t lr,int mode,Coord c,int x) {
        if(lr!=0x1D2ED4 || !m || m!=map) return false;
        if(session.active && !session.returned && session.generation==generation) {
            if(mode==0 && equal(c,session.coord)) cursor={mode,c,x,true};
            return true;
        }
        if(rejectMap==m && rejectGeneration==generation) { clearReject(); return true; }
        return false;
    }
    bool restoreCursor(uintptr_t lr,int mode,Cursor& out) {
        if(lr!=0x1CE040 || !cursor.pending || cursor.mode!=mode) return false;
        out=cursor; return true;
    }
    bool stageStarted(uintptr_t s) {
        if(!session.active || !s || session.stage) return false;
        session.stage=s; return true;
    }
    bool confirmFinish(uintptr_t s) {
        if(!session.active || session.stage!=s || session.returned || session.abortConfirmed || session.quiescent) return false;
        session.finishConfirmed=true; return true;
    }
    bool quiesced(uintptr_t s,bool aborted) {
        if(!session.active || session.stage!=s) return false;
        session.quiescent=true; session.abortConfirmed=aborted || !session.finishConfirmed; return true;
    }
    void mapReturned() { if(session.active) { session.returned=true; snapshotValid=false; } }
    Close prepareSave(SaveIntent& out) {
        if(!session.active) return Close::Nothing;
        if(session.persistBusy) return Close::Busy;
        if(!session.stage || !session.returned || !session.quiescent ||
           !(session.finishConfirmed || session.abortConfirmed)) return Close::Waiting;
        std::memcpy(out.id,session.id,IdCapacity); out.token=session.token;
        out.cleared=session.finishConfirmed && !session.abortConfirmed;
        session.persistBusy=true; return Close::Persist;
    }
    bool saved(const SaveIntent& ack,bool committed) {
        if(!session.active || !session.persistBusy || ack.token!=session.token ||
           !validId(ack.id) || std::strcmp(ack.id,session.id)) return false;
        session.persistBusy=false;
        if(committed) { session={}; snapshotValid=false; clearReject(); }
        return true;
    }
    bool unchanged(const uint8_t* blob) const {
        if(!snapshotValid || !blob) return true;
        for(unsigned i=0;i<BlobSize;++i) if((i<0x18||i>=0x1C) && blob[i]!=snapshot[i]) return false;
        return true;
    }
};
}

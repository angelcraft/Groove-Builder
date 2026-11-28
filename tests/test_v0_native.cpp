#include "v0_native.hpp"
#include <cassert>
#include <cstdio>
#include <cstring>
#include <vector>
#include <utility>
using namespace groove::v0;
namespace {
constexpr uintptr_t Base=0x10000000,Mgr=Base+0x10A75F0;
alignas(16) unsigned char mgr[0x4000],mapA[0x7000],mapB[0x7000];
unsigned char blobCopy[BlobSize];
uint32_t bits=0;
int out[4]{}; int descriptor[2]{}; int coordData[5]{};
std::vector<std::pair<uintptr_t,size_t>> ranges;
unsigned calls[unsigned(Hook::Count)]{};
bool injectRead=false,rejectCursor=false;
Frame last{}; Hook active=Hook::MapInit;
uint64_t dispatch(Hook h,Frame f={}) { return groove_v0_dispatch(unsigned(h),&f); }
uintptr_t actual(uintptr_t p) { return p>=Mgr && p<Mgr+sizeof(mgr)?reinterpret_cast<uintptr_t>(mgr)+(p-Mgr):p; }
bool allowed(uintptr_t p,size_t n){for(auto r:ranges)if(p>=r.first && p-r.first<=r.second && n<=r.second-(p-r.first))return true;return false;}
bool rd(uintptr_t p,void* b,size_t n){
 if(injectRead){injectRead=false;auto before=calls[unsigned(Hook::WriteSave)];assert(dispatch(Hook::WriteSave,{{Mgr}})==0x87654321);assert(calls[unsigned(Hook::WriteSave)]==before+1);}
 p=actual(p);if(!allowed(p,n))return false;std::memcpy(b,reinterpret_cast<void*>(p),n);return true;}
bool wr(uintptr_t p,const void* b,size_t n){p=actual(p);if(!allowed(p,n))return false;std::memcpy(reinterpret_cast<void*>(p),b,n);return true;}
template<class T> void set(unsigned char* p,size_t off,T v){std::memcpy(p+off,&v,sizeof(v));}
void cursor(unsigned char* p,int w,int c,int r){set(p,0x5274,w);set(p,0x5298,c);set(p,0x529C,r);}
uint64_t original(uint64_t a,uint64_t b,uint64_t c,uint64_t d,uint64_t e,uint64_t f,uint64_t g,uint64_t h){
 ++calls[unsigned(active)]; last={{a,b,c,d,e,f,g,h},0};
 if(active==Hook::Launch){
   // Model only documented effects needed to exercise the C++ hook transaction;
   // these synthetic callbacks are NOT evidence of native game save isolation.
   bits=0x20;
   Frame nested{{Mgr,1,67},Base+0x999}; dispatch(Hook::BeginPlay,nested);
   dispatch(Hook::CampaignA,nested); dispatch(Hook::CampaignB,nested);
 }
 if(active==Hook::GetSel) {for(unsigned i=0;i<4;++i){int v=-9;wr(last.x[2+i],&v,sizeof(v));}}
 if(active==Hook::Confirm){
   Frame selection{{Mgr,0,0,9,0,3},Base+0x1D2ED4};
   dispatch(Hook::SetSel,selection);
 }
 return 0x87654321;
}
uint64_t run(Hook h,Frame f={}){active=h;return dispatch(h,f);}
void reset(){
 std::memset(mgr,0,sizeof(mgr));std::memset(mapA,0,sizeof(mapA));std::memset(mapB,0,sizeof(mapB));std::memset(calls,0,sizeof(calls));
 ranges={{reinterpret_cast<uintptr_t>(mgr),sizeof(mgr)},{reinterpret_cast<uintptr_t>(mapA),sizeof(mapA)},
  {reinterpret_cast<uintptr_t>(mapB),sizeof(mapB)},{reinterpret_cast<uintptr_t>(&bits),sizeof(bits)},
  {reinterpret_cast<uintptr_t>(coordData),sizeof(coordData)},{reinterpret_cast<uintptr_t>(out),sizeof(out)}};
 set(mgr,0xBA0,int16_t(-1));set(mgr,0xBA2,int16_t(-1));set(mgr,0x2904,int(-1));
 set(mgr,0x3AA0,reinterpret_cast<uintptr_t>(&bits)); bits=0x4A;
 Backend backend{Base,{rd,wr},{}};
 backend.writeCursor=[](const uintptr_t* dest,const int* values){if(rejectCursor)return false;for(unsigned i=0;i<4;++i)if(!allowed(actual(dest[i]),sizeof(int)))return false;for(unsigned i=0;i<4;++i)wr(dest[i],values+i,sizeof(int));return true;};for(auto& fn:backend.original)fn=original;
 backend.original[unsigned(Hook::WriteSave)]=[](uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t)->uint64_t{++calls[unsigned(Hook::WriteSave)];return 0x87654321;};
 assert(groove_v0_bind(&backend));
 Slot slots[2]{};std::strcpy(slots[0].id,"org.example.alpha");std::strcpy(slots[1].id,"org.example.beta");
 for(auto& s:slots){s.enabled=s.saveValid=true;s.state=9;}assert(groove_v0_configure(slots));
 cursor(mapA,0,9,0);set(mapA,0x2A38,int(0));
 run(Hook::MapInit,{{reinterpret_cast<uintptr_t>(mapA)}});
}
void launch(){assert(run(Hook::Launch,{{reinterpret_cast<uintptr_t>(mapA),0,1,1}})==0x87654321);assert(last.x[2]==0&&last.x[3]==0);assert(bits==0x2A);}
}
int main(){
 reset();
 // MapCell maps only exact A/B, never 180 entries by shared id.
 for(int w=0;w<3;++w)for(int c=0;c<12;++c)for(int r=0;r<5;++r){
  coordData[2]=w;coordData[3]=c;coordData[4]=r;
  unsigned before=calls[unsigned(Hook::MapCell)];auto v=run(Hook::MapCell,{{reinterpret_cast<uintptr_t>(coordData)}});
  if(slotAt({w,c,r})<0)assert(calls[unsigned(Hook::MapCell)]==before+1 && v==0x87654321);
  else {auto cell=reinterpret_cast<const int*>(v);assert(cell[0]==1&&cell[1]==67);}
 }
 // Reentry while the pre-hook owns its short lease must still forward a global save.
 injectRead=true;coordData[2]=1;coordData[3]=1;coordData[4]=1;
 assert(run(Hook::MapCell,{{reinterpret_cast<uintptr_t>(coordData)}})==0x87654321);
 coordData[2]=0;coordData[3]=9;coordData[4]=0;
 assert(run(Hook::CellState,{{reinterpret_cast<uintptr_t>(coordData)}})==6);
 set(mapA,0x2A38,int(1));assert(run(Hook::CellState,{{reinterpret_cast<uintptr_t>(coordData)}})==1);set(mapA,0x2A38,int(0));
 std::memcpy(blobCopy,mgr+0x548,BlobSize);launch();
 assert(!std::memcmp(blobCopy,mgr+0x548,BlobSize));
 assert(calls[unsigned(Hook::BeginPlay)]==0&&calls[unsigned(Hook::CampaignA)]==0&&calls[unsigned(Hook::CampaignB)]==0);
 assert(run(Hook::Launch,{{reinterpret_cast<uintptr_t>(mapA)}})==0); // no reentry
 Slot replacement[2]{};assert(!groove_v0_configure(replacement));
 // Original confirm may reenter SetSel: state lease must not span original.
 run(Hook::Confirm,{{reinterpret_cast<uintptr_t>(mapA)}});assert(calls[unsigned(Hook::SetSel)]==0);
 uintptr_t stage=0x999999;
 run(Hook::InitGameplay,{{stage,0}});assert(calls[unsigned(Hook::InitGameplay)]==1);
 assert(!groove_v0_finish(stage+1));assert(groove_v0_finish(stage));
 SaveIntent intent{};assert(groove_v0_prepare_save(&intent)==unsigned(Close::Waiting));
 run(Hook::MapDtor,{{reinterpret_cast<uintptr_t>(mapA)}});run(Hook::MapInit,{{reinterpret_cast<uintptr_t>(mapA)}});
 rejectCursor=true;run(Hook::GetSel,{{Mgr,0,reinterpret_cast<uintptr_t>(&out[0]),reinterpret_cast<uintptr_t>(&out[1]),reinterpret_cast<uintptr_t>(&out[2]),reinterpret_cast<uintptr_t>(&out[3])},Base+0x1CE040});
 assert(out[0]==-9&&out[1]==-9&&out[2]==-9&&out[3]==-9);rejectCursor=false;
 run(Hook::GetSel,{{Mgr,0,reinterpret_cast<uintptr_t>(&out[0]),reinterpret_cast<uintptr_t>(&out[1]),reinterpret_cast<uintptr_t>(&out[2]),reinterpret_cast<uintptr_t>(&out[3])},Base+0x1CE040});
 assert(out[0]==0&&out[1]==9&&out[2]==0&&out[3]==3);
 run(Hook::MapReturn,{{reinterpret_cast<uintptr_t>(mapA)}});
 assert(groove_v0_prepare_save(&intent)==unsigned(Close::Waiting));
 // IO is pending, but native gameplay on return must no longer be suppressed.
 unsigned nativeBefore=calls[unsigned(Hook::BeginPlay)];
 run(Hook::BeginPlay,{{Mgr,1,67}});assert(calls[unsigned(Hook::BeginPlay)]==nativeBefore+1);
 unsigned initBefore=calls[unsigned(Hook::InitGameplay)];run(Hook::InitGameplay,{{stage+100,0}});assert(calls[unsigned(Hook::InitGameplay)]==initBefore+1);
 assert(groove_v0_quiesced(stage,false));assert(groove_v0_prepare_save(&intent)==unsigned(Close::Persist));
 assert(!std::strcmp(intent.id,"org.example.alpha")&&intent.cleared);
 assert(groove_v0_prepare_save(&intent)==unsigned(Close::Busy));
 SaveIntent wrong=intent;std::strcpy(wrong.id,"org.example.beta");assert(!groove_v0_ack_save(&wrong,true));
 assert(groove_v0_ack_save(&intent,false));assert(groove_v0_prepare_save(&intent)==unsigned(Close::Persist));assert(groove_v0_ack_save(&intent,true));
 assert(groove_v0_prepare_save(&intent)==unsigned(Close::Nothing));
 // Next session in SAME BSS must identify B and persist an explicit abort.
 cursor(mapA,0,9,1);launch();run(Hook::InitGameplay,{{stage+8,0}});
 assert(groove_v0_quiesced(stage+8,true));run(Hook::MapReturn,{{reinterpret_cast<uintptr_t>(mapA)}});
 assert(groove_v0_prepare_save(&intent)==unsigned(Close::Persist));assert(!std::strcmp(intent.id,"org.example.beta")&&!intent.cleared);
 assert(groove_v0_ack_save(&intent,true));
 // Rejection has one-confirmation lifetime, orphan sessions are bounded by H0.
 set(mgr,0xBA0,int16_t(2));assert(run(Hook::Launch,{{reinterpret_cast<uintptr_t>(mapA)}})==0);
 run(Hook::MapDtor,{{reinterpret_cast<uintptr_t>(mapA)}});run(Hook::MapInit,{{reinterpret_cast<uintptr_t>(mapB)}});
 assert(run(Hook::Launch,{{reinterpret_cast<uintptr_t>(mapA)}})==0);
 // No installation can be granted by a subset of prerequisites.
 Acceptance a{};assert(!installationAllowed(a));a.instructionsAndBuild=true;assert(!installationAllowed(a));
 puts("PASS: V0 compiled dispatcher: 180-cell passthrough, A/B, original once, nested confirm, generation, cursor, identity, IO retry, result/quiescence boundary");
}

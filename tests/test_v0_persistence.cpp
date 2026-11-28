#include "v0_execution.hpp"
#include "v0_native.hpp"
#include "v0_file_io.hpp"
#include <map>
#include <string>
#include <vector>
#include <cassert>
#include <cstdio>
using namespace groove::v0;
struct FS:gsv::IO {
 std::map<std::string,std::vector<uint8_t>> files;
 int fail=-1,step=0;bool held=false;
 bool op(){return step++!=fail;}
 bool lock(const char*)override{if(held)return false;held=true;return true;}
 void unlock()override{held=false;}
 gsv::Read read(const char* p,uint8_t* out,unsigned cap,unsigned& n)override{if(!op())return gsv::Read::Error;auto it=files.find(p);if(it==files.end())return gsv::Read::Missing;n=it->second.size();if(n>cap)return gsv::Read::Oversized;std::memcpy(out,it->second.data(),n);return gsv::Read::Present;}
 bool create(const char* p,const uint8_t* b,unsigned n)override{if(!op()||files.count(p))return false;files[p]={b,b+n};return true;}
 bool flush(const char*)override{return op();}bool sync()override{return op();}
 bool rename(const char* a,const char* b)override{if(!op()||!files.count(a)||files.count(b))return false;files[b]=files[a];files.erase(a);return true;}
 bool remove(const char* p)override{if(!op()||!files.count(p))return false;files.erase(p);return true;}
};
struct FileApi {
 FS store;bool sentinel=false,journal=false,syncSupported=true;
 bool ready(){return true;}int probe(const char* p){assert(std::strcmp(p,".installer.mutex"));return !std::strcmp(p,".installer/lock")?int(sentinel):int(journal);}
 gsv::Read read(const char* p,uint8_t* b,unsigned cap,unsigned& n){return store.read(p,b,cap,n);}
 bool createNew(const char* p,const uint8_t* b,unsigned n){return store.create(p,b,n);}
 bool flush(const char* p){return store.flush(p);}bool syncDirectory(){return syncSupported&&store.sync();}
 bool renameNoReplace(const char* a,const char* b){return store.rename(a,b);}bool remove(const char* p){return store.remove(p);}
};
namespace binding {
constexpr uintptr_t base=0x10000000,manager=base+0x10A75F0;
static uint8_t mgr[0x4000],map[0x6000];static uint32_t bits;
uintptr_t ptr(uintptr_t p){return p>=manager&&p<manager+sizeof(mgr)?reinterpret_cast<uintptr_t>(mgr)+p-manager:p;}
bool range(uintptr_t p,size_t n){for(auto r:{std::pair<uintptr_t,size_t>{reinterpret_cast<uintptr_t>(mgr),sizeof(mgr)},{reinterpret_cast<uintptr_t>(map),sizeof(map)},{reinterpret_cast<uintptr_t>(&bits),sizeof(bits)}})if(p>=r.first&&p-r.first<=r.second&&n<=r.second-(p-r.first))return true;return false;}
bool read(uintptr_t p,void* out,size_t n){p=ptr(p);if(!range(p,n))return false;std::memcpy(out,reinterpret_cast<void*>(p),n);return true;}
bool write(uintptr_t p,const void* in,size_t n){p=ptr(p);if(!range(p,n))return false;std::memcpy(reinterpret_cast<void*>(p),in,n);return true;}
uint64_t original(uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t){return 77;}
uint64_t nonce(){static uint64_t n=900000;return ++n;}
template<class T>void set(uint8_t* b,unsigned off,T v){std::memcpy(b+off,&v,sizeof(v));}
uint64_t dispatch(Hook h,Frame f){return groove_v0_dispatch(unsigned(h),&f);}
}
static Loader loader;static Execution execution;
struct Resources {
 std::map<std::string,std::string> files;
 Source source(){return {this,[](void* ctx,const char* path,char* dst,unsigned cap,unsigned* size){auto& files=static_cast<Resources*>(ctx)->files;auto it=files.find(path);if(it==files.end()||it->second.size()>cap)return false;*size=it->second.size();std::memcpy(dst,it->second.data(),*size);return true;},[](void* ctx,const char* p){return static_cast<Resources*>(ctx)->files.count(p)?1:0;}};}
 void package(const char* id,const char* cue){std::string root=std::string("levels/")+id+"/";
 files[root+"manifest.json"]=std::string("{\"format\":\"groove-package/1\",\"profile\":\"runtime\",\"id\":\"")+id+"\",\"version\":\"1.0.0\",\"title\":\"Synthetic\",\"engine_min\":\"0.6.0\",\"engine_contract\":1,\"adapter\":\"multi\",\"timeline\":{\"format\":\"gtf\",\"path\":\"timeline.gtf\"},\"required_capabilities\":[\"timeline.gtf\"],\"results\":\"custom\"}";
 files[root+"timeline.gtf"]=std::string("start 0\nresults exit\n")+cue+"\n";
 }
};
int main(){
 assert(gsv::crc(reinterpret_cast<const uint8_t*>("123456789"),9)==0xCBF43926u);
 const char* A="org.example.alpha";const char* B="org.example.beta";
 gsv::Record r;std::strcpy(r.id,A);uint8_t bytes[160];assert(gsv::encode(r,bytes));assert(gsv::get(bytes+8)==gsv::crc(bytes+12,148));
 gsv::Record decoded;assert(gsv::decode(bytes,160,A,decoded));assert(!gsv::decode(bytes,160,B,decoded));
 for(unsigned i=0;i<160;++i){uint8_t broken[160];std::memcpy(broken,bytes,160);broken[i]^=1;assert(!gsv::decode(broken,160,A,decoded));}
 uint8_t reserved[160];std::memcpy(reserved,bytes,160);reserved[140]=1;gsv::put(reserved+8,gsv::crc(reserved+12,148));assert(!gsv::decode(reserved,160,A,decoded));
 gsv::Intent first;assert(gsv::intent(r,1,true,first));
 FS control;assert(gsv::commit(control,A,first)==gsv::Status::Committed);int operations=control.step;
 assert(gsv::commit(control,A,first)==gsv::Status::Committed);
 gsv::Intent collision=first;collision.token=999;assert(gsv::commit(control,A,collision)==gsv::Status::Conflict);
 assert(gsv::load(control,A,decoded)==gsv::Status::Loaded&&decoded.plays==1&&decoded.clears==1);
 // Every IO operation can fail once. Retry/recovery must converge without counting twice.
 for(int fault=0;fault<operations;++fault){FS fs;fs.fail=fault;auto status=gsv::commit(fs,A,first);fs.fail=-1;status=gsv::commit(fs,A,first);assert(status==gsv::Status::Committed);assert(gsv::load(fs,A,decoded)==gsv::Status::Loaded&&decoded.plays==1);}
 // Persisted pending journal survives a process restart and a lost acknowledgement.
 FS crash;crash.fail=8;gsv::commit(crash,A,first);crash.fail=-1;
 gsv::Paths paths(A);if(crash.files.count(paths.pending)){gsv::Intent restored;assert(gsv::recover(crash,A,restored)==gsv::Status::Committed);assert(restored.token==1);}
 assert(gsv::decode(first.after,160,A,r));gsv::Intent second;assert(gsv::intent(r,2,false,second));assert(gsv::commit(control,A,second)==gsv::Status::Committed);
 // Exercise both replacement renames and archival with an existing backup.
 FS seed;assert(gsv::commit(seed,A,first)==gsv::Status::Committed);
 FS measure=seed;measure.step=0;assert(gsv::commit(measure,A,second)==gsv::Status::Committed);
 for(int fault=0;fault<measure.step;++fault){FS fs=seed;fs.step=0;fs.fail=fault;gsv::commit(fs,A,second);fs.fail=-1;assert(gsv::commit(fs,A,second)==gsv::Status::Committed);assert(gsv::load(fs,A,decoded)==gsv::Status::Loaded&&decoded.plays==2);}
 gsv::Record next;assert(gsv::decode(second.after,160,A,next));gsv::Intent third;assert(gsv::intent(next,3,true,third));
 seed=measure;seed.step=0;FS three=seed;assert(gsv::commit(three,A,third)==gsv::Status::Committed);
 for(int fault=0;fault<three.step;++fault){FS fs=seed;fs.fail=fault;gsv::commit(fs,A,third);fs.fail=-1;assert(gsv::commit(fs,A,third)==gsv::Status::Committed);assert(gsv::load(fs,A,decoded)==gsv::Status::Loaded&&decoded.plays==3);}
 // Partial/corrupt journal is retained; no silent repair and no effect on B.
 FS orphan;orphan.files[paths.temp]={1,2,3};assert(gsv::load(orphan,A,decoded)==gsv::Status::Blocked);
 FS bad;bad.files[paths.pending]={1,2,3};auto kept=bad.files[paths.pending];assert(gsv::commit(bad,A,first)==gsv::Status::Conflict);assert(bad.files[paths.pending]==kept);assert(gsv::load(bad,B,decoded)==gsv::Status::Initial);
 // Corrupt current is preserved, backup available explicitly, B remains independent.
 control.files[paths.main][0]^=1;auto evidence=control.files[paths.main];assert(gsv::load(control,A,decoded)==gsv::Status::RecoveryAvailable);assert(control.files[paths.main]==evidence);
 FS oversized=control;oversized.files[paths.main].resize(161);auto bigEvidence=oversized.files[paths.main];assert(gsv::load(oversized,A,decoded)==gsv::Status::RecoveryAvailable);assert(gsv::restoreBackup(oversized,A,79)==gsv::Status::Committed);assert(oversized.files[std::string(paths.main)+".corrupt-79"]==bigEvidence);
 FS restore=control;assert(gsv::restoreBackup(restore,A,77)==gsv::Status::Committed);assert(restore.files[std::string(paths.main)+".corrupt-77"]==evidence);
 assert(gsv::load(restore,A,decoded)==gsv::Status::Loaded&&decoded.seq==1);
 int restoreOps=restore.step-control.step;
 for(int fault=0;fault<restoreOps;++fault){FS f=control;f.step=0;f.fail=fault;gsv::restoreBackup(f,A,88);f.fail=-1;assert(gsv::restoreBackup(f,A,88)==gsv::Status::Committed);assert(f.files[std::string(paths.main)+".corrupt-88"]==evidence);}
 assert(gsv::load(control,B,decoded)==gsv::Status::Initial);
 control.files[paths.backup][0]^=1;assert(gsv::load(control,A,decoded)==gsv::Status::Blocked);assert(control.files[paths.main]==evidence);
 r.seq=UINT32_MAX;assert(!gsv::intent(r,3,false,second));
 // Shared nn::fs policy: permanent mutex ignored, sentinel gates, no invented sync.
 FileApi api;FileIO<FileApi> policy(api);api.sentinel=true;assert(!policy.lock(A));api.sentinel=false;
 assert(policy.lock(A));assert(!policy.lock(A));uint8_t one=1;assert(!policy.create("custom-saves/org.example.beta.gsv",&one,1));policy.unlock();
 api.syncSupported=false;assert(gsv::commit(policy,A,first)==gsv::Status::Pending);assert(!api.store.files.count(paths.main));api.syncSupported=true;assert(gsv::commit(policy,A,first)==gsv::Status::Committed);
 // Same session snapshot -> constructor -> confirmed finish -> H9, all in one harness.
 FS fs;Resources resources;resources.package(A,"RING.hoop");resources.package(B,"RING.hoop 2 0");
 resources.files["slots.json"]="{\"format\":\"groove-slots/1\",\"capacity\":2,\"generation\":0,\"slots\":[{\"index\":0,\"coord\":[0,9,0],\"id\":\"org.example.alpha\"},{\"index\":1,\"coord\":[0,9,1],\"id\":\"org.example.beta\"}]}";
 assert(loader.load(resources.source(),false));
 static Execution blocked,unaffected;assert(!blocked.arm(loader,0,control,1,10001));assert(unaffected.arm(loader,1,control,1,10001));
 assert(execution.arm(loader,0,fs,100,10100));assert(!loader.load(resources.source(),true));
 loader.package[0].timeline[0]='!'; // must not alter the armed snapshot
 struct Context{unsigned original=0,adopt=0;}ctx;
 MultiFactory factory{&ctx,[](void* c,uintptr_t self,uintptr_t seq,const int* args)->uintptr_t{auto& s=*static_cast<Context*>(c);++s.original;assert(seq==0x1234);for(unsigned i=0;i<5;++i)assert(args[i]==int(7+i));return self;},
 [](void* c,uintptr_t stage,const groove::MultiTimeline& tl,const Package& p){auto& s=*static_cast<Context*>(c);++s.adopt;return stage&&tl.valid&&!std::strcmp(p.id,"org.example.alpha");}};
 int args[5]={7,8,9,10,11};assert(execution.construct(factory,0x5000,0x1234,args));assert(ctx.original==1&&ctx.adopt==1);
 StageToken token=execution.token();assert(!execution.confirmFinish({token.stage,token.session-1}));assert(execution.confirmFinish(token));
 assert(execution.persist(fs)==gsv::Status::Pending);assert(execution.mapReturned(token));assert(!execution.suppressNativeProgress());assert(execution.persist(fs)==gsv::Status::Pending);
 assert(execution.quiesced(token));fs.fail=fs.step+3;execution.persist(fs);fs.fail=-1;assert(execution.persist(fs)==gsv::Status::Committed);assert(execution.persist(fs)==gsv::Status::Committed);
 assert(gsv::load(fs,A,decoded)==gsv::Status::Loaded&&decoded.plays==1&&decoded.clears==1);
 // Reuse same Stage address for B; old callback token cannot affect it.
 assert(execution.arm(loader,1,fs,101,10101));factory.adopt=[](void*,uintptr_t,const groove::MultiTimeline& tl,const Package& p){return tl.valid&&!std::strcmp(p.id,"org.example.beta");};
 assert(execution.construct(factory,0x5000,0x1234,args));assert(!execution.confirmAbort(token));token=execution.token();assert(execution.confirmAbort(token));assert(execution.quiesced(token));assert(execution.mapReturned(token));assert(execution.persist(fs)==gsv::Status::Committed);
 assert(gsv::load(fs,B,decoded)==gsv::Status::Loaded&&decoded.plays==1&&decoded.clears==0);
 assert(!execution.arm(loader,1,fs,101,10101));assert(!execution.arm(loader,1,fs,0,10000));
 // Failed adoption retains ownership information instead of pretending dtor/free ran.
 static Execution faulted;assert(faulted.arm(loader,1,fs,200,10200));MultiFactory rejected=factory;
 rejected.adopt=[](void*,uintptr_t,const groove::MultiTimeline&,const Package&){return false;};
 unsigned originalBefore=ctx.original;assert(!faulted.construct(rejected,0x6000,0x1234,args));
 assert(ctx.original==originalBefore+1&&faulted.phase==ExecutionPhase::OwnershipFault&&faulted.token().stage==0x6000);
 assert(faulted.persist(fs)==gsv::Status::Blocked);
 // Dispatcher -> SessionState -> Execution -> constructor -> H9, no live binding.
 assert(loader.load(resources.source(),false));static Execution bound;FS boundIo;
 Backend backend{binding::base,{binding::read,binding::write},{}};
 for(auto& fn:backend.original)fn=binding::original;
 MultiFactory boundFactory{nullptr,[](void*,uintptr_t self,uintptr_t,const int*){return self;},[](void*,uintptr_t,const groove::MultiTimeline& tl,const Package&){return tl.valid;}};
 backend.execution=&bound;backend.levels=&loader;backend.saves=&boundIo;backend.factory=&boundFactory;backend.newTransaction=binding::nonce;
 assert(groove_v0_bind(&backend));assert(groove_v0_configure_loaded());
 binding::set(binding::mgr,0xBA0,int16_t(-1));binding::set(binding::mgr,0xBA2,int16_t(-1));binding::set(binding::mgr,0x2904,int(-1));binding::set(binding::mgr,0x3AA0,reinterpret_cast<uintptr_t>(&binding::bits));
 binding::set(binding::map,0x5274,int(0));binding::set(binding::map,0x5298,int(9));binding::set(binding::map,0x529C,int(0));
 Frame mapFrame{{reinterpret_cast<uintptr_t>(binding::map)}};binding::dispatch(Hook::MapInit,mapFrame);
 assert(binding::dispatch(Hook::Launch,mapFrame)==77);assert(groove_v0_construct_bound_multi(0x9900,0x1234,args));
 StageToken bt=bound.token();assert(!groove_v0_finish(bt.stage));SaveIntent legacy;assert(groove_v0_prepare_save(&legacy)==unsigned(Close::Busy));assert(groove_v0_finish_token(bt));assert(groove_v0_quiet_token(bt,false));binding::dispatch(Hook::MapReturn,mapFrame);
 assert(groove_v0_persist_bound()==unsigned(gsv::Status::Committed));assert(!groove_v0_session_active());assert(gsv::load(boundIo,A,decoded)==gsv::Status::Loaded&&decoded.plays==1);
 assert(bound.intent()->token!=bt.session); // durable transaction ID != callback token
 binding::set(binding::map,0x529C,int(1));assert(binding::dispatch(Hook::Launch,mapFrame)==77);assert(groove_v0_construct_bound_multi(0x9900,0x1234,args));
 assert(!groove_v0_finish_token(bt));bt=bound.token();assert(groove_v0_quiet_token(bt,true));binding::dispatch(Hook::MapReturn,mapFrame);
 assert(groove_v0_persist_bound()==unsigned(gsv::Status::Committed));assert(gsv::load(boundIo,B,decoded)==gsv::Status::Loaded&&decoded.plays==1&&decoded.clears==0);
 puts("PASS: GSV1/H9 codec, CRC, ID, failures/retry/recovery, lost ack, A/B snapshots, constructor once, tokens and quiescence gating");
}

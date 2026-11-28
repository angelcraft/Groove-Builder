#pragma once
#include "v0_loader.hpp"
#include "v0_gsv.hpp"
namespace groove::v0 {
struct StageToken {uintptr_t stage=0;uint64_t session=0;};
// Explicit constructor/adoption boundary. Current providers are test harnesses,
// not live menu hooks. Original native constructor arguments remain unchanged.
struct MultiFactory {
 void* context=nullptr;
 uintptr_t (*construct)(void*,uintptr_t,uintptr_t,const int*)=nullptr;
 bool (*adopt)(void*,uintptr_t,const MultiTimeline&,const Package&)=nullptr;
};
enum class ExecutionPhase {Idle,Armed,Running,OwnershipFault,Pending,Saved};
class Execution {
 Package snapshot{};MultiTimeline timeline{};gsv::Record previous{};
 gsv::Intent pending{};bool intentReady=false,finished=false,aborted=false,quiet=false,returned=false;
 uint64_t transaction=0,serial=0;StageToken owner{};
public:
 Execution()=default;
 Execution(const Execution&)=delete;Execution& operator=(const Execution&)=delete;
 ExecutionPhase phase=ExecutionPhase::Idle;
 const Package& package()const{return snapshot;}
 const gsv::Intent* intent()const{return intentReady?&pending:nullptr;}
 StageToken token()const{return owner;}
 bool arm(const Loader& loader,unsigned slot,gsv::IO& io,uint64_t session,uint64_t durableTransaction){
  if((phase!=ExecutionPhase::Idle&&phase!=ExecutionPhase::Saved)||!durableTransaction||!session||session<=serial||!loader.ready||slot>=2||!loader.package[slot].valid)return false;
  gsv::Record record;auto result=gsv::load(io,loader.package[slot].id,record);
  if(result!=gsv::Status::Initial&&result!=gsv::Status::Loaded)return false;
  snapshot=loader.package[slot];previous=record;serial=session;transaction=durableTransaction;owner={0,session};
  intentReady=finished=aborted=quiet=returned=false;phase=ExecutionPhase::Armed;return true;
 }
 bool construct(const MultiFactory& factory,uintptr_t self,uintptr_t sequence,const int (&args)[5]){
  if(phase!=ExecutionPhase::Armed||!self||!factory.construct||!factory.adopt||!runtimeTimeline(snapshot,timeline))return false;
  uintptr_t stage=factory.construct(factory.context,self,sequence,args); // exactly once
  if(!stage){phase=ExecutionPhase::OwnershipFault;return false;}
  owner.stage=stage;
  if(!factory.adopt(factory.context,stage,timeline,snapshot)){
   // Constructor ran: caller STILL owns the live Stage. Never pretend it was freed.
   phase=ExecutionPhase::OwnershipFault;return false;
  }
  phase=ExecutionPhase::Running;return true;
 }
 bool matches(StageToken t)const{return owner.stage&&t.stage==owner.stage&&t.session==owner.session;}
 bool confirmFinish(StageToken t){if(!matches(t)||phase!=ExecutionPhase::Running||quiet||returned||aborted)return false;finished=true;return true;}
 bool confirmAbort(StageToken t){if(!matches(t)||phase!=ExecutionPhase::Running||quiet)return false;aborted=true;return true;}
 bool quiesced(StageToken t){
  // Notification from a proven owner boundary, NOT an implementation of native join.
  if(!matches(t)||phase!=ExecutionPhase::Running||(!finished&&!aborted))return false;quiet=true;return true;
 }
 bool mapReturned(StageToken t){if(!matches(t)||phase!=ExecutionPhase::Running)return false;returned=true;return true;}
 bool suppressNativeProgress()const{return phase==ExecutionPhase::Running&&!returned;}
 gsv::Status persist(gsv::IO& io){
  if(phase==ExecutionPhase::Saved)return gsv::Status::Committed;
  if(phase!=ExecutionPhase::Running&&phase!=ExecutionPhase::Pending)return gsv::Status::Blocked;
  if(!quiet||!returned||(!finished&&!aborted))return gsv::Status::Pending;
  if(!intentReady){if(!gsv::intent(previous,transaction,finished&&!aborted,pending))return gsv::Status::Blocked;intentReady=true;phase=ExecutionPhase::Pending;}
  auto status=gsv::commit(io,snapshot.id,pending);if(status==gsv::Status::Committed)phase=ExecutionPhase::Saved;return status;
 }
};
}

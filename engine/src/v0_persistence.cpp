// Retained, dormant ABI for own-code ARM64 validation. No live hook binds IO.
#include "v0_execution.hpp"
#define GE_EXPORT __attribute__((used,retain,visibility("default")))
extern "C" GE_EXPORT bool groove_v0_gsv_validate(const uint8_t* data,unsigned size,const char* id){
 groove::v0::gsv::Record record;return data&&id&&groove::v0::gsv::decode(data,size,id,record);
}
extern "C" GE_EXPORT bool groove_v0_gsv_plan(const groove::v0::gsv::Record* record,uint64_t token,bool cleared,groove::v0::gsv::Intent* out){
 return record&&out&&groove::v0::gsv::intent(*record,token,cleared,*out);
}
extern "C" GE_EXPORT unsigned groove_v0_gsv_commit(groove::v0::gsv::IO* io,const char* id,const groove::v0::gsv::Intent* intent){
 if(!io||!id||!intent)return unsigned(groove::v0::gsv::Status::Blocked);
 return unsigned(groove::v0::gsv::commit(*io,id,*intent));
}
extern "C" GE_EXPORT bool groove_v0_multi_construct(groove::v0::Execution* session,const groove::v0::MultiFactory* factory,uintptr_t self,uintptr_t sequence,const int* args){
 if(!session||!factory||!args)return false;int copy[5];for(unsigned i=0;i<5;++i)copy[i]=args[i];return session->construct(*factory,self,sequence,copy);
}

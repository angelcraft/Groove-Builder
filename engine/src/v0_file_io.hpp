#pragma once
#include "v0_gsv.hpp"
namespace groove::v0 {
// Adapter policy shared by nn::fs and injected tests. API owns actual operations;
// syncDirectory must report unsupported as FALSE, never a fabricated success.
template<class Api> class FileIO final:public gsv::IO {
 Api& api;unsigned char busy=0;char id[97]{};
 bool gate(){return api.probe(".installer/lock")==0&&api.probe(".installer/journal.json")==0;}
 bool scoped(const char* path){
  if(!__atomic_load_n(&busy,__ATOMIC_ACQUIRE)||!path)return false;
  char prefix[160];std::snprintf(prefix,sizeof(prefix),"custom-saves/%s.gsv",id);unsigned n=std::strlen(prefix);
  if(std::strncmp(prefix,path,n)||(path[n]&&path[n]!='.'))return false;
  for(const char* c=path+n;*c;++c)if(!((*c>='a'&&*c<='z')||(*c>='0'&&*c<='9')||*c=='.'||*c=='-'))return false;
  return !std::strstr(path,"..");
 }
public:
 explicit FileIO(Api& a):api(a){}
 FileIO(const FileIO&)=delete;FileIO& operator=(const FileIO&)=delete;
 bool lock(const char* wanted)override{
  if(!gsv::safeId(wanted)||__atomic_test_and_set(&busy,__ATOMIC_ACQUIRE))return false;
  if(!api.ready()||!gate()){__atomic_clear(&busy,__ATOMIC_RELEASE);return false;}
  std::strcpy(id,wanted);return true;
 }
 void unlock()override{id[0]=0;__atomic_clear(&busy,__ATOMIC_RELEASE);}
 gsv::Read read(const char* p,uint8_t* b,unsigned cap,unsigned& n)override{return scoped(p)&&gate()?api.read(p,b,cap,n):gsv::Read::Error;}
 bool create(const char* p,const uint8_t* b,unsigned n)override{return scoped(p)&&gate()&&api.createNew(p,b,n);}
 bool flush(const char* p)override{return scoped(p)&&gate()&&api.flush(p);}
 bool sync()override{return __atomic_load_n(&busy,__ATOMIC_ACQUIRE)&&gate()&&api.syncDirectory();}
 bool rename(const char* a,const char* b)override{return scoped(a)&&scoped(b)&&gate()&&api.renameNoReplace(a,b);}
 bool remove(const char* p)override{char pending[168];std::snprintf(pending,sizeof(pending),"custom-saves/%s.gsv.pending",id);return scoped(p)&&!std::strcmp(p,pending)&&gate()&&api.remove(p);}
};
}

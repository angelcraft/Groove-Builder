#include "v0_loader.hpp"
#include <cstdio>
#include <cstring>
using namespace groove::v0;
static Package p;static groove::MultiTimeline tl;static Loader loader;
extern "C" int registry(const char* t,unsigned n){Registry r;return parseRegistry(t,n,r);}
extern "C" int manifest(const char* t,unsigned n){p={};if(n>16384)return 0;p.manifestSize=n;std::memcpy(p.manifest,t,n);return parseManifest(p);}
extern "C" int timeline(const char* t,unsigned n,int gtf){p={};if(n>61440)return 0;p.gtf=gtf;p.timelineSize=n;std::memcpy(p.timeline,t,n);return runtimeTimeline(p,tl);}
static bool read(void*,const char* path,char* out,unsigned cap,unsigned* size){
 FILE* f=std::fopen(path,"rb");if(!f)return false;size_t n=std::fread(out,1,cap,f);int extra=std::fgetc(f);bool ok=!std::ferror(f)&&extra==EOF;std::fclose(f);*size=n;return ok;}
static int probe(void*,const char* path){FILE* f=std::fopen(path,"rb");if(!f)return 0;std::fclose(f);return 1;}
// Test-only filesystem backend. Production needs native IO/type validation.
extern "C" int load(){return loader.load({nullptr,read,probe},false);}
extern "C" int compile(unsigned i){return loader.compile(i,tl);}

#include "v0_loader.hpp"
#include "gtf.hpp"
#include "parser_support.hpp"
#include <cstdio>
#include <cstring>
#include <cstdint>
namespace groove::v0 {
namespace {
// Schema-directed reader: no heap, unknown fields rejected without recursing.
// Every object has a field bitset, so escaped spellings cannot hide duplicates.
struct Json {
 const char* p; const char* end; bool ok=true;
 Json(const char* s,unsigned n):p(s),end(s+n){}
 void ws(){while(p<end&&(*p==' '||*p=='\n'||*p=='\r'||*p=='\t'))++p;}
 bool eat(char c){ws();if(p==end||*p!=c)return ok=false;++p;return true;}
 bool done(){ws();return ok&&p==end;}
 bool null(){ws();if(end-p<4||std::memcmp(p,"null",4))return false;p+=4;return true;}
 bool integer(unsigned& n){ws();n=0;if(p==end||*p<'0'||*p>'9')return ok=false;
  const char* first=p;bool zero=*p=='0';do{unsigned d=*p++-'0';if(n>(2147483647u-d)/10)return ok=false;n=n*10+d;}while(p<end&&*p>='0'&&*p<='9');
  if(zero&&p-first!=1)return ok=false;return true;}
 int hex(){if(p==end)return -1;char c=*p++;return c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:c>='A'&&c<='F'?c-'A'+10:-1;}
 bool string(char* out,unsigned cap){
  if(!eat('"'))return false;unsigned n=0;
  auto emit=[&](unsigned c){if(n+1>=cap)return false;out[n++]=char(c);return true;};
  while(p<end&&*p!='"'){
   unsigned c=static_cast<unsigned char>(*p++);if(c<32)return ok=false;
   if(c=='\\'){
    if(p==end)return ok=false;char e=*p++;
    if(e=='"'||e=='\\'||e=='/')c=e;
    else if(e=='b')c=8;else if(e=='f')c=12;else if(e=='n')c=10;else if(e=='r')c=13;else if(e=='t')c=9;
    else if(e=='u'){
     unsigned u=0;for(int i=0;i<4;++i){int v=hex();if(v<0)return ok=false;u=u*16+v;}
     if(u>=0xD800&&u<=0xDBFF){if(end-p<6||p[0]!='\\'||p[1]!='u')return ok=false;p+=2;
      unsigned lo=0;for(int i=0;i<4;++i){int v=hex();if(v<0)return ok=false;lo=lo*16+v;}
      if(lo<0xDC00||lo>0xDFFF)return ok=false;u=0x10000+((u-0xD800)<<10)+(lo-0xDC00);
     }else if(u>=0xDC00&&u<=0xDFFF)return ok=false;
     if(!u)return ok=false;
     if(u>=0x10000){if(!emit(0xF0|(u>>18))||!emit(0x80|((u>>12)&63)))return ok=false;}
     else if(u>=0x800){if(!emit(0xE0|(u>>12)))return ok=false;}
     if(u>=0x80){if(!emit(u>=0x800?0x80|((u>>6)&63):0xC0|(u>>6)))return ok=false;}
     c=u>=0x80?0x80|(u&63):u;
    }else return ok=false;
   }else if(c>=128){
    unsigned cp=0,count=0,min=0;
    if(c>=0xC2&&c<=0xDF){cp=c&31;count=1;min=0x80;}
    else if(c>=0xE0&&c<=0xEF){cp=c&15;count=2;min=0x800;}
    else if(c>=0xF0&&c<=0xF4){cp=c&7;count=3;min=0x10000;}else return ok=false;
    if(!emit(c))return ok=false;
    for(unsigned i=0;i<count;++i){if(p==end)return ok=false;unsigned d=static_cast<unsigned char>(*p++);if((d&0xC0)!=0x80||!emit(d))return ok=false;cp=(cp<<6)|(d&63);}
    if(cp<min||cp>0x10FFFF||(cp>=0xD800&&cp<=0xDFFF))return ok=false;continue;
   }
   if(!c||!emit(c))return ok=false;
  }
  out[n]=0;return eat('"');
 }
 bool text(const char* expected){char b[128];return string(b,sizeof(b))&&!std::strcmp(b,expected);}
 template<class F> bool object(const char* const* keys,unsigned count,F field){
  if(!eat('{'))return false;unsigned seen=0;ws();if(p<end&&*p=='}'){++p;return count==0;}
  for(;;){char key[64];if(!string(key,sizeof(key))||!eat(':'))return false;
   unsigned k=0;while(k<count&&std::strcmp(key,keys[k]))++k;
   if(k==count||(seen&(1u<<k)))return ok=false;seen|=1u<<k;
   if(!field(k))return ok=false;ws();if(p<end&&*p=='}'){++p;break;}if(!eat(','))return false;
  }return seen==((1u<<count)-1);
 }
};
bool device(const char* id){char b[97];unsigned i=0;while(id[i]&&id[i]!='.'&&i<96){b[i]=id[i];++i;}b[i]=0;
 return !std::strcmp(b,"con")||!std::strcmp(b,"prn")||!std::strcmp(b,"aux")||!std::strcmp(b,"nul")||
  (i==4&&(!std::memcmp(b,"com",3)||!std::memcmp(b,"lpt",3))&&b[3]>='0'&&b[3]<='9');}
bool id(const char* s){return validId(s)&&!device(s);}
bool version(const char* s,unsigned* v){for(unsigned i=0;i<3;++i){unsigned n=0,digits=0;bool zero=*s=='0';
 while(*s>='0'&&*s<='9'){if(++digits>9)return false;n=n*10+(*s++-'0');}
 if(!digits||(zero&&digits>1))return false;v[i]=n;if(i<2){if(*s++!='.')return false;}else if(*s)return false;}return true;}
bool compatible(const char* s){unsigned v[3];return version(s,v)&&v[0]==0&&(v[1]<6||(v[1]==6&&v[2]==0));}
}
bool parseRegistry(const char* text,unsigned size,Registry& out){
 if(!text||!size||size>65536)return false;Registry r;Json j(text,size);
 const char* keys[]={"format","capacity","generation","slots"};unsigned length=0;
 bool good=j.object(keys,4,[&](unsigned k){
  if(k==0)return j.text("groove-slots/1");if(k==1)return j.integer(r.capacity)&&r.capacity>=2&&r.capacity<=256;
  if(k==2)return j.integer(r.generation);if(!j.eat('['))return false;
  for(unsigned index=0;;++index){if(index>=256)return false;const char* sk[]={"index","coord","id"};
   if(!j.object(sk,3,[&](unsigned f){if(f==0){unsigned x;return j.integer(x)&&x==index;}
    if(f==1){if(index>=2)return j.null();if(!j.eat('['))return false;unsigned w,c,row;
      return j.integer(w)&&j.eat(',')&&j.integer(c)&&j.eat(',')&&j.integer(row)&&j.eat(']')&&w==0&&c==9&&row==index;}
    if(j.null())return true;if(index>=2)return false;return j.string(r.ids[index],97)&&id(r.ids[index]);
   }))return false;++length;j.ws();if(j.p<j.end&&*j.p==']'){++j.p;break;}if(!j.eat(','))return false;
  }return true;
 });
 if(!good||!j.done()||length!=r.capacity||(r.ids[0][0]&&!std::strcmp(r.ids[0],r.ids[1])))return false;out=r;return true;
}
bool parseManifest(Package& p){
 if(!p.manifestSize||p.manifestSize>16384)return false;Json j(p.manifest,p.manifestSize);char fmt[8]{},path[16]{},cap[32]{};
 const char* keys[]={"format","profile","id","version","title","engine_min","engine_contract","adapter","timeline","required_capabilities","results"};
 bool good=j.object(keys,11,[&](unsigned k){unsigned n;char b[32];switch(k){
 case 0:return j.text("groove-package/1");case 1:return j.text("runtime");case 2:return j.string(p.id,97)&&id(p.id);
 case 3:{unsigned v[3];return j.string(p.version,30)&&version(p.version,v);}
 case 4:return j.string(p.title,96)&&p.title[0];
 case 5:return j.string(b,sizeof(b))&&compatible(b);
 case 6:return j.integer(n)&&n==1;case 7:return j.text("multi");
 case 8:{const char* tk[]={"format","path"};return j.object(tk,2,[&](unsigned t){return t==0?j.string(fmt,8):j.string(path,16);});}
 case 9:return j.eat('[')&&j.string(cap,32)&&j.eat(']');case 10:return j.text("custom");default:return false;
 }});
 if(!good||!j.done())return false;
 bool gtf=!std::strcmp(fmt,"gtf"),gtl=!std::strcmp(fmt,"gtl");if(!gtf&&!gtl)return false;
 if(std::strcmp(path,gtf?"timeline.gtf":"timeline.gtl")||std::strcmp(cap,gtf?"timeline.gtf":"timeline.gtl"))return false;
 bool nonblank=false;for(const unsigned char* t=reinterpret_cast<unsigned char*>(p.title);*t;++t){if(*t<32||*t==127||(*t==0xC2&&t[1]>=0x80&&t[1]<=0x9F))return false;if(*t!=' ')nonblank=true;}
 if(!nonblank)return false;p.gtf=gtf;std::strcpy(p.timelinePath,path);return true;
}
bool runtimeTimeline(const Package& p,MultiTimeline& out){
 if(!p.timelineSize||p.timelineSize>61440)return false;
 // Preserve exact source. Scan package-only directives before authoritative parse.
 unsigned start=0,results=0;const char* s=p.timeline;const char* end=s+p.timelineSize;
 while(s<end){const char* e=s;while(e<end&&*e!='\n')++e;const char* c=s;while(c<e&&(*c==' '||*c=='\t'||*c=='\r'))++c;
  char words[3][256]{};unsigned count=0;
  while(c<e&&*c!='#'&&!(p.gtf&&e-c>=2&&c[0]=='/'&&c[1]=='/')&&count<3){unsigned n=0;while(c<e&&*c!='#'&&!(p.gtf&&e-c>=2&&c[0]=='/'&&c[1]=='/')&&*c!=' '&&*c!='\t'&&*c!='\r'){if(n>=255)return false;char b=*c++;words[count][n++]=count==0&&b>='A'&&b<='Z'?b+32:b;}++count;while(c<e&&(*c==' '||*c=='\t'||*c=='\r'))++c;}
  if(count){if(!std::strcmp(words[0],"match")||!std::strcmp(words[0],"force")||!std::strcmp(words[0],"disable"))return false;
   if(!std::strcmp(words[0],"start"))++start;
   if(!std::strcmp(words[0],"results")){++results;if(count!=2||std::strcmp(words[1],"exit"))return false;}}
  s=e<end?e+1:end;
 }
 if(start!=1||results!=1)return false;
 if(p.gtf){if(!parseGtf(out,p.timeline,p.timelineSize))return false;}
 else {if(!parseMulti(out,p.timeline,p.timelineSize))return false;}
 return out.valid&&out.resultsMode==0;
}
__attribute__((used,retain)) bool Loader::load(const Source& src,bool active){
 static unsigned char loaderBusy=0;TryLease lease(loaderBusy);
 if(!lease.held){return false;}
 if(active){error="session active";return false;}bool previouslyReady=hasAccepted;Registry previous=accepted;ready=false;registry={};for(auto& p:package)p.valid=false;
 auto gate=[&](){return src.probe&&src.probe(src.context,".installer/lock")==0&&src.probe(src.context,".installer/journal.json")==0;};
 if(!src.read||!gate()){error="installer lock/journal or IO";return false;}
 static char registryText[65537];unsigned size=0;
 if(!src.read(src.context,"slots.json",registryText,65536,&size)||!parseRegistry(registryText,size,registry)){error="registry";return false;}
 if(previouslyReady && (registry.capacity<previous.capacity || registry.generation<previous.generation || (registry.generation==previous.generation && (registry.capacity!=previous.capacity || std::memcmp(registry.ids,previous.ids,sizeof(registry.ids)))))){error="generation/content mismatch";return false;}
 static MultiTimeline validation; // Scratch, never a live playback owner.
 for(unsigned i=0;i<2;++i){auto& p=package[i];p={};if(!registry.ids[i][0])continue;char path[160];
  std::snprintf(path,sizeof(path),"levels/%s/manifest.json",registry.ids[i]);
  if(!src.read(src.context,path,p.manifest,16384,&p.manifestSize)||!parseManifest(p)||std::strcmp(registry.ids[i],p.id)){error="manifest";return false;}
  std::snprintf(path,sizeof(path),"levels/%s/%s",p.id,p.timelinePath);
  if(!src.read(src.context,path,p.timeline,61440,&p.timelineSize)||!runtimeTimeline(p,validation)){error="timeline";return false;}p.valid=true;
 }
 unsigned after=0;static char second[65537];Registry check;
 if(!gate()||!src.read(src.context,"slots.json",second,65536,&after)||after!=size||std::memcmp(second,registryText,size)||!parseRegistry(second,after,check)){error="registry changed";return false;}
 accepted=registry;hasAccepted=true;ready=true;error=nullptr;return true;
}
__attribute__((used,retain)) bool Loader::compile(unsigned i,MultiTimeline& out)const{return ready&&i<2&&package[i].valid&&runtimeTimeline(package[i],out);}
}

#include "v0_loader.hpp"
#include <cassert>
#include <cstring>
#include <string>
#include <cstdio>
using namespace groove::v0;
int main(){
 struct Guarded { uint64_t before=0x123456789ABCDEF0;Registry value{};uint64_t after=0xFEDCBA9876543210; } out;
 const std::string valid="{\"format\":\"groove-slots/1\",\"capacity\":2,\"generation\":0,\"slots\":[{\"index\":0,\"coord\":[0,9,0],\"id\":null},{\"index\":1,\"coord\":[0,9,1],\"id\":null}]}";
 assert(parseRegistry(valid.data(),valid.size(),out.value));
 uint32_t random=0x156151;
 for(unsigned i=0;i<10000;++i){
  std::string s=valid;random=random*1664525+1013904223;
  if(i&1)s.resize(random%(valid.size()+1));
  else {unsigned p=random%s.size();random=random*1664525+1013904223;s[p]=char(random>>24);}
  Registry previous=out.value;bool ok=parseRegistry(s.data(),s.size(),out.value);
  if(!ok)assert(!std::memcmp(&previous,&out.value,sizeof(previous)));
  assert(out.before==0x123456789ABCDEF0&&out.after==0xFEDCBA9876543210);
 }
 std::string maximum="{\"format\":\"groove-slots/1\",\"capacity\":256,\"generation\":2147483647,\"slots\":[";
 for(unsigned i=0;i<256;++i){if(i)maximum+=',';maximum+="{\"index\":"+std::to_string(i)+",\"coord\":"+(i<2?"[0,9,"+std::to_string(i)+"]":"null")+",\"id\":null}";}
 maximum+="]}";assert(parseRegistry(maximum.data(),maximum.size(),out.value));assert(out.value.capacity==256);
 const char* bad="{\"format\":\"groove-slots/1\",\"capacity\":02,\"generation\":0,\"slots\":[]}";
 assert(!parseRegistry(bad,std::strlen(bad),out.value));
 puts("PASS: native loader ASan/UBSan: 10000 mutations/truncations, guarded output, 256-slot boundary, strict integers");
}

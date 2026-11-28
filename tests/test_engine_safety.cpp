#include "gtf.hpp"
#include "timeline.hpp"
#include "numparse.hpp"
#include "parser_support.hpp"
#include "save_replace.hpp"
#include "metadata.hpp"
#include <cassert>
#include <cstring>
#include <map>
#include <string>
#include <thread>
#include <atomic>
#include <cstdio>
using namespace groove;
static MultiTimeline a,b;
static Timeline legacy;
struct Fs {
    std::map<std::string,std::string> data;
    int calls=0,fail=0,fail2=0;
    bool exists(const char* p) { return data.count(p); }
    bool rename(const char* p,const char* q) {
        ++calls;
        if(calls==fail || calls==fail2 || !exists(p) || exists(q)) return false;
        data[q]=data[p];data.erase(p);return true;
    }
};
int main() {
    int v=7;
    assert(!parseIntStrict("2147483648",v) && v==7);
    assert(!parseIntStrict("0xFFFFFFFF",v));
    assert(parseIntStrict("-0x80000000",v) && v==(-2147483647-1));
    assert(!parseTimeline(a,nullptr,1));
    const char badUtf8[]={char(0xff)};assert(!parseTimeline(a,badUtf8,1));
    assert(!parseTimeline(legacy,nullptr,1));
    const char* first="RING.hoop stable_tag\n";
    assert(parseTimeline(a,first,strlen(first)));
    const char* tag=a.ev[0].str;
    const char* next="RING.hoop next_tag\n";
    assert(parseTimeline(b,next,strlen(next)) && !strcmp(tag,"stable_tag"));
    for(int i=0;i<10000;++i) assert(parseTimeline(b,next,strlen(next)));
    for(int i=0;i<10000;++i) {
        char bad[128];snprintf(bad,sizeof(bad),"RING.hoop rejected_%d\nunknown\n",i);
        assert(!parseTimeline(b,bad,strlen(bad)));
    }
    assert(parseTimeline(b,next,strlen(next)) && !strcmp(tag,"stable_tag"));
    const char* old="GTL1\nH 0 -1\nC 0 stable\nend 1920 480\nfinish 3840\n";
    for(int i=0;i<10000;++i) assert(parseTimeline(legacy,old,strlen(old)));
    const char* multipart="GTL1\npart 64 6000 5000\nH 4000 -1\nA 4000 BgStep\npart 64\nH 0 -1\nend 1920 480\nfinish 3840\n";
    assert(parseTimeline(legacy,multipart,strlen(multipart)));
    TimelineMetadata meta;
    const char* validMeta="title \"Safe title\"\nprologue type_19\njingle 0x163\nRING.hoop\n";
    assert(parseMetadata(meta,true,validMeta,strlen(validMeta)) && !strcmp(meta.title,"Safe title") && meta.jingle==0x163);
    const char* badMeta="title \"Do not apply\"\njingle 0x163\nRING.hoop 16\n";
    assert(!parseMetadata(meta,true,badMeta,strlen(badMeta)) && meta.title[0]==0 && meta.jingle==-1);
    assert(!strcmp(tag,"stable_tag"));
    // Same live parser scratch cannot be entered concurrently (actual atomic lock).
    std::atomic<bool> rejected=false;
    { ParseGuard owner;assert(owner.held);
      std::thread worker([&] { rejected=!parseTimeline(b,next,strlen(next)); });worker.join(); }
    assert(rejected && parseTimeline(b,next,strlen(next)));
    for(int failure=0;failure<=3;++failure) {
        Fs fs;fs.data={{"save","old"},{"tmp","new"}};fs.fail=failure;
        auto result=replaceCustomSave(fs,"save","tmp","backup");
        if(failure==0 || failure==3) { assert(result==SaveReplace::Committed);assert(fs.data["save"]=="new" && fs.data["backup"]=="old"); }
        else { assert(fs.data["save"]=="old");assert(fs.data["tmp"]=="new"); }
    }
    Fs fs;fs.data={{"save","old"},{"tmp","new"}};fs.fail=2;fs.fail2=3;
    assert(replaceCustomSave(fs,"save","tmp","backup")==SaveReplace::RecoveryRequired);
    assert(fs.data["backup"]=="old" && fs.data["tmp"]=="new");
    Fs occupied;occupied.data={{"save","old"},{"tmp","new"},{"backup","older"}};
    assert(replaceCustomSave(occupied,"save","tmp","backup")==SaveReplace::Unchanged && occupied.calls==0);
    PersistentStrings<8> tiny;assert(tiny.intern("one",3));assert(tiny.intern("two",3));assert(!tiny.intern("x",1));assert(tiny.intern("one",3));
    puts("PASS: native parser bounds, 30000 repeated/failed loads, string lifetime, real atomic exclusion, save fault injection");
}

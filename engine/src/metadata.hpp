#pragma once
#include "timeline.hpp"
#include "gtf.hpp"
#include "parser_support.hpp"
#include <cstring>
namespace groove {
struct TimelineMetadata {
    int world=-1,col=9,row=0,jingle=-1;
    char title[96]{},prologue[96]{};
};
// Separate storage: inspecting map labels cannot overwrite an active timeline.
inline Timeline metadataSingle;
inline MultiTimeline metadataMulti;
inline unsigned char metadataBusy=0;
inline bool parseMetadata(TimelineMetadata& out,bool multi,const char* text,long size) {
    out=TimelineMetadata{};
    if (__atomic_test_and_set(&metadataBusy,__ATOMIC_ACQUIRE)) return false;
    struct Unlock { ~Unlock(){__atomic_clear(&metadataBusy,__ATOMIC_RELEASE);} } unlock;
    bool ok=multi ? parseTimeline(metadataMulti,text,size) : parseTimeline(metadataSingle,text,size);
    if (!ok) return false;
    if (multi) {
        out.world=metadataMulti.matchWorld;out.col=metadataMulti.matchCol;out.row=metadataMulti.matchRow;
        out.jingle=metadataMulti.jingle;
        memcpy(out.title,metadataMulti.title,sizeof(out.title));memcpy(out.prologue,metadataMulti.prologue,sizeof(out.prologue));
    } else {
        out.world=metadataSingle.matchWorld;out.col=metadataSingle.matchCol;out.row=metadataSingle.matchRow;
        memcpy(out.title,metadataSingle.title,sizeof(out.title));
    }
    return true;
}
}

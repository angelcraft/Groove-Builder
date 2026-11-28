#pragma once
#include "v0_session.hpp"
#include "multi.hpp"
namespace groove::v0 {
struct Registry { unsigned capacity=0,generation=0; char ids[2][97]{}; };
struct Package {
    char id[97]{},version[30]{},title[96]{},timelinePath[16]{};
    bool gtf=false,valid=false;
    unsigned manifestSize=0,timelineSize=0;
    // Exact bytes, frozen until the owner retires this snapshot. No SD pointers.
    char manifest[16385]{},timeline[61441]{};
};
// Return false on absent, oversized, unsafe type/path or any IO error. read must
// check file type and size BEFORE and DURING read, and reject links/components.
struct Source {
    void* context;
    bool (*read)(void*,const char*,char*,unsigned,unsigned*);
    // 0=absent, 1=present, -1=IO/unknown. Unknown always blocks custom loading.
    int (*probe)(void*,const char*);
};
struct Loader {
    Registry registry{},accepted{}; Package package[2]{};
    bool hasAccepted=false;
    bool ready=false; const char* error="not loaded";
    // Single owner phase only. Never overwrite an active session's snapshots.
    bool load(const Source&,bool sessionActive);
    bool compile(unsigned slot,MultiTimeline& out) const;
};
bool parseRegistry(const char*,unsigned,Registry&);
bool parseManifest(Package&);
bool runtimeTimeline(const Package&,MultiTimeline&);
}

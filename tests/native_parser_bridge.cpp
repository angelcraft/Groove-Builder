#include "gtf.hpp"
#include "timeline.hpp"
#include <cstring>
extern "C" int parse_view(const char* text,long size,groove::TimelineView* out) {
    static groove::MultiTimeline tl;
    bool ok=groove::parseTimeline(tl,text,size);
    groove::fillTimelineView(tl,*out);
    return ok;
}

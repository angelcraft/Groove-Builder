#include "hoop3_text_patch_plan.hpp"
#include <cassert>

int main() {
    using namespace hoop3_text_patch;
    Facts facts{};
    facts.main_start=0x72000000;
    facts.main_text_size=0xa66bf0;
    facts.carrier_start=0x76000000;
    facts.carrier_text_size=0x10000;
    facts.game_build_id=menu_column_switch::kGameBuildId;
    facts.sdk_build_id=kFullSdkBuildId;
    for (unsigned i=0; i<kCount; ++i) {
        facts.source_words[i]=kSites[i].original;
        facts.handlers[i]=facts.carrier_start+0x100+i*0x100;
    }
    const auto valid=prepare(facts);
    assert(valid.status==Status::candidate_only);
    assert(!valid.runtime_verified);
    for (unsigned i=0; i<kCount; ++i) {
        const auto src=facts.main_start+kSites[i].offset;
        const auto imm=valid.calls[i]&0x03ffffffu;
        std::int64_t words=(imm&0x02000000u)
            ? static_cast<std::int64_t>(imm)-0x4000000LL
            : imm;
        assert((valid.calls[i]&0xfc000000u)==0x94000000u);
        assert(std::uintptr_t(std::int64_t(src)+words*4)==facts.handlers[i]);
    }
    facts.source_words[0]^=1;
    assert(prepare(facts).status==Status::source_conflict);
    facts.source_words[0]^=1;
    facts.source_words[1]^=1;
    assert(prepare(facts).status==Status::source_conflict);
    facts.source_words[1]^=1;
    facts.handlers[1]=facts.carrier_start+facts.carrier_text_size;
    assert(prepare(facts).status==Status::invalid_module_layout);
    facts.handlers[1]=facts.carrier_start+0x200;
    facts.carrier_start=0x92000000;
    facts.handlers[0]=facts.carrier_start+0x100;
    facts.handlers[1]=facts.carrier_start+0x200;
    assert(prepare(facts).status==Status::branch_unreachable);
    facts.carrier_start=0x76000000;
    facts.handlers[0]=facts.carrier_start+0x100;
    facts.handlers[1]=facts.carrier_start+0x200;
    facts.sdk_build_id=menu_column_switch::kGameBuildId;
    assert(prepare(facts).status==Status::identity_mismatch);
    facts.sdk_build_id=kFullSdkBuildId;
    facts.main_text_size=0x1000;
    assert(prepare(facts).status==Status::invalid_module_layout);
    return 0;
}

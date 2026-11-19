// Experimental Switch-only, selection-scoped Hoop 3 MENU TEXT proof.
// No game identity/progress changes, no gameplay hooks, no save I/O.
// Disabled by default. The physical Switch mapping/cache path is unverified;
// a passing host or ARM64 compile is NOT permission to install it.
#include "hoop3_text_patch_plan.hpp"
#include "hoop3_title_dispatch.hpp"
#include <hk/ro/RoUtil.h>
#include <hk/hook/MapUtil.h>
#include <hk/svc/api.h>

#ifndef HOOP3_TEXT_PATCH_ACTIVE
#define HOOP3_TEXT_PATCH_ACTIVE 0
#endif
static_assert(HOOP3_TEXT_PATCH_ACTIVE==0 || HOOP3_TEXT_PATCH_ACTIVE==1,
              "The title experiment must be explicitly on or off");

extern "C" {
extern hoop3_title::Api hoop3_title_api;
void menu_hoop3_title_entry();
void menu_hoop3_instruction_entry();

// Own status: inspect with a debugger if the game starts but text is unchanged.
__attribute__((used,retain)) volatile unsigned hoop3_text_status=0xffffffffu;
__attribute__((used,retain)) volatile unsigned hoop3_text_hooks_written=0;
}

namespace {

bool same_name(const char* a,const char* b) {
    if(!a)return false;
    for(unsigned i=0;i<32;++i) {
        if(a[i]!=b[i])return false;
        if(!a[i])return true;
    }
    return false;
}

bool make_facts(hoop3_text_patch::Facts& facts) {
    auto* game=hk::ro::getMainModule();
    auto* sdk=hk::ro::getSdkModule();
    auto* self=hk::ro::getSelfModule();
    if(!game || !sdk || !self ||
       !same_name(self->getModuleName(),"MenuColumn.nss"))return false;

    facts.main_start=game->text().start();
    facts.main_text_size=game->text().size();
    facts.carrier_start=self->text().start();
    facts.carrier_text_size=self->text().size();
    if(facts.main_start==0 || facts.main_text_size<0x1D0244u)return false;

    // GNU-note bounds are checked before comparing the exact pinned IDs.
    // IDs reside in RO and need not have the NSO header's zero padding.
    return true;
}

// Fail-closed mapping of two instructions in the SAME game code page.
// Only called for an explicitly opt-in build after the complete preflight.
bool install_text_calls(const hoop3_text_patch::Facts& facts,
                        const hoop3_text_patch::Plan& plan) {
#if !HOOP3_TEXT_PATCH_ACTIVE
    (void)facts;(void)plan;
    return false;
#else
    using namespace hoop3_text_patch;
    const std::uintptr_t first=facts.main_start+kSites[0].offset;
    const std::uintptr_t second=facts.main_start+kSites[1].offset;
    if((first&~std::uintptr_t(0xfff))!=(second&~std::uintptr_t(0xfff)) ||
       (second-first)!=0x3cu)return false;
    // WARNING: LibHakkun's mapping API may itself abort on a service failure.
    // Runtime alias permissions/cache semantics still require a physical A/B.
    auto alias=hk::hook::mapRoToRw(first,second-first+4);
    if(!alias.hasValue())return false;
    auto* rw0=reinterpret_cast<std::uint32_t*>(alias.getInnerValue());
    auto* rw1=reinterpret_cast<std::uint32_t*>(alias.getInnerValue()+(second-first));
    if(__atomic_load_n(rw0,__ATOMIC_ACQUIRE)!=kSites[0].original ||
       __atomic_load_n(rw1,__ATOMIC_ACQUIRE)!=kSites[1].original)return false;
    std::uint32_t expected=kSites[0].original;
    if(!__atomic_compare_exchange_n(rw0,&expected,plan.calls[0],false,
                                    __ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE))return false;
    hk::svc::clearCache(alias.getInnerValue(),second-first+4);
    hk::svc::clearCache(first,second-first+4);
    hoop3_text_hooks_written=1;
    expected=kSites[1].original;
    if(!__atomic_compare_exchange_n(rw1,&expected,plan.calls[1],false,
                                    __ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE)) {
        expected=plan.calls[0];
        bool restored=__atomic_compare_exchange_n(rw0,&expected,kSites[0].original,
                              false,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE);
        hk::svc::clearCache(alias.getInnerValue(),second-first+4);
        hk::svc::clearCache(first,second-first+4);
        restored=restored &&
            *reinterpret_cast<volatile const std::uint32_t*>(first)==kSites[0].original;
        if(restored)hoop3_text_hooks_written=0;
        hoop3_text_status=restored?7u:8u;
        return false;
    }
    hoop3_text_hooks_written=2;
    hk::svc::clearCache(alias.getInnerValue(),second-first+4);
    hk::svc::clearCache(first,second-first+4);
    if(__atomic_load_n(reinterpret_cast<const std::uint32_t*>(first),__ATOMIC_ACQUIRE)!=plan.calls[0] ||
       __atomic_load_n(reinterpret_cast<const std::uint32_t*>(second),__ATOMIC_ACQUIRE)!=plan.calls[1]) {
        // We own both expected new opcodes. Attempt rollback in reverse
        // order; never overwrite an instruction a different mod changed.
        std::uint32_t old1=plan.calls[1],old0=plan.calls[0];
        bool restored1=__atomic_compare_exchange_n(rw1,&old1,kSites[1].original,
                               false,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE);
        bool restored0=__atomic_compare_exchange_n(rw0,&old0,kSites[0].original,
                               false,__ATOMIC_ACQ_REL,__ATOMIC_ACQUIRE);
        hk::svc::clearCache(alias.getInnerValue(),second-first+4);
        hk::svc::clearCache(first,second-first+4);
        const bool restored=restored1 && restored0 &&
            *reinterpret_cast<volatile const std::uint32_t*>(first)==kSites[0].original &&
            *reinterpret_cast<volatile const std::uint32_t*>(second)==kSites[1].original;
        if(restored)hoop3_text_hooks_written=0;
        hoop3_text_status=restored?7u:8u;
        return false;
    }
    __atomic_store_n(&hoop3_title_api.enabled,true,__ATOMIC_RELEASE);
    return true;
#endif
}

} // namespace

extern "C" __attribute__((used,retain,noinline)) void hkMain() {
    using namespace hoop3_text_patch;
    hoop3_text_hooks_written=0;
    __atomic_store_n(&hoop3_title_api.enabled,false,__ATOMIC_RELEASE);
    Facts facts{};
    if(!make_facts(facts)) {hoop3_text_status=2;return;}
    auto* game=hk::ro::getMainModule();
    auto* sdk=hk::ro::getSdkModule();
    std::uint8_t main_id[32]{},sdk_id[32]{};
    if(!menu_column_switch::canonical_gnu_build_id(game->getBuildId(),
                game->rodata().start(),game->rodata().size(),main_id) ||
       !menu_column_switch::canonical_gnu_build_id(sdk->getBuildId(),
                sdk->rodata().start(),sdk->rodata().size(),sdk_id)) {
        hoop3_text_status=1;return;
    }
    facts.game_build_id=main_id;
    facts.sdk_build_id=sdk_id;
    const std::uintptr_t handlers[kCount]={
        reinterpret_cast<std::uintptr_t>(&menu_hoop3_title_entry),
        reinterpret_cast<std::uintptr_t>(&menu_hoop3_instruction_entry)};
    for(unsigned i=0;i<kCount;++i) {
        facts.handlers[i]=handlers[i];
        facts.source_words[i]=*reinterpret_cast<volatile const std::uint32_t*>(
            facts.main_start+kSites[i].offset);
    }
    const auto plan=prepare(facts);
    if(plan.status!=Status::candidate_only) {
        hoop3_text_status=static_cast<unsigned>(plan.status);
        return;
    }
    const auto base=facts.main_start;
    hoop3_title_api.original=reinterpret_cast<hoop3_title::NativeTitle>(base+0x2BD0u);
    hoop3_title_api.lookup=reinterpret_cast<hoop3_title::NativeMessageLookup>(base+0x4EFE80u);
    hoop3_title_api.message_owner=reinterpret_cast<void* const*>(base+0x10A73F0u);
#if HOOP3_TEXT_PATCH_ACTIVE
    if(!install_text_calls(facts,plan)) {
        if(hoop3_text_status==0xffffffffu)hoop3_text_status=5u;
        return;
    }
    hoop3_text_status=9;
#else
    hoop3_text_status=10; // Read-only identity and callsite proof: no hooks.
#endif
}

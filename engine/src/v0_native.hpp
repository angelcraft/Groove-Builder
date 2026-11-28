#pragma once
#include "v0_session.hpp"
namespace groove::v0 {
enum class Hook : uint64_t { MapInit,MapDtor,Confirm,MapCell,Reverse,CellState,SaveState,Launch,
    BeginPlay,CampaignA,CampaignB,SetSel,GetSel,InitGameplay,CommitResult,MapReturn,WriteSave,PerfectSite,PerfectCtor,Count };
struct Frame { uint64_t x[8]; uint64_t lr; };
static_assert(sizeof(Frame)==72);
using Original=uint64_t(*)(uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t,uint64_t);
struct Memory {
    bool (*read)(uintptr_t,void*,size_t);
    bool (*write)(uintptr_t,const void*,size_t);
};
class Execution;struct Loader;struct MultiFactory;namespace gsv {struct IO;}
struct StageToken;
struct Backend {
    uintptr_t mainBase;
    Memory memory;
    Original original[unsigned(Hook::Count)];
    // Validate all four destinations and commit all-or-none, in an owned phase.
    bool (*writeCursor)(const uintptr_t*,const int*)=nullptr;
    Execution* execution=nullptr;
    const Loader* levels=nullptr;
    gsv::IO* saves=nullptr;
    const MultiFactory* factory=nullptr;
    uint64_t (*newTransaction)()=nullptr;
    // GE-151 interim (Grok): live binding. Called OUTSIDE the state lease, before MapInit is dispatched
    // (normal game context: loads sd:/groove/levels + slots.json when no session is active).
    void (*mapInitHook)()=nullptr;
    // After MapReturn (post of mapEnterFromStage) try H9 once; Pending/Blocked keep the session.
    bool persistOnMapReturn=false;
};
struct Acceptance {
    bool ownershipOnFailure,exclusiveRunnerMutation,noLateAppend,horizonJoin,transitiveStack,
         instructionsAndBuild,ipsCompatibility,visuals,registryContract,saveContract;
};
constexpr bool installationAllowed(const Acceptance& a) {
    return a.ownershipOnFailure && a.exclusiveRunnerMutation && a.noLateAppend && a.horizonJoin &&
        a.transitiveStack && a.instructionsAndBuild && a.ipsCompatibility && a.visuals &&
        a.registryContract && a.saveContract;
}
// Bound by the harnesses and, on grok/engine-b2-integration, by hkMain (installV0) when every V0 and B2 hook
// signature matches. Not an installable candidate until GE-154 review.
extern "C" bool groove_v0_bind(const Backend*);
extern "C" bool groove_v0_configure(const Slot*);
extern "C" bool groove_v0_configure_loaded();
extern "C" uint64_t groove_v0_dispatch(uint64_t,Frame*);
extern "C" bool groove_v0_finish(uintptr_t);
extern "C" bool groove_v0_quiesced(uintptr_t,bool);
extern "C" unsigned groove_v0_prepare_save(SaveIntent*);
extern "C" bool groove_v0_ack_save(const SaveIntent*,bool);
extern "C" unsigned groove_v0_fault();
extern "C" bool groove_v0_session_active();
extern "C" bool groove_v0_construct_bound_multi(uintptr_t,uintptr_t,const int*);
extern "C" bool groove_v0_finish_token(StageToken);
extern "C" bool groove_v0_quiet_token(StageToken,bool);
extern "C" unsigned groove_v0_persist_bound();
}

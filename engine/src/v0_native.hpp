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
struct Backend {
    uintptr_t mainBase;
    Memory memory;
    Original original[unsigned(Hook::Count)];
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
// Only a harness currently binds Backend. No live installer calls these entries.
extern "C" bool groove_v0_bind(const Backend*);
extern "C" bool groove_v0_configure(const Slot*);
extern "C" uint64_t groove_v0_dispatch(uint64_t,Frame*);
extern "C" bool groove_v0_finish(uintptr_t);
extern "C" bool groove_v0_quiesced(uintptr_t,bool);
extern "C" unsigned groove_v0_prepare_save(SaveIntent*);
extern "C" bool groove_v0_ack_save(const SaveIntent*,bool);
extern "C" unsigned groove_v0_fault();
}

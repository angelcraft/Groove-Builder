#include "hoop3_sequence_pointer_plan.hpp"

#include <cassert>
#include <cstdint>

using namespace hoop3_sequence_pointer;

int main() {
    constexpr std::uintptr_t base = 0x7100000000ULL;
    constexpr std::uintptr_t carrier = 0x7200000000ULL;
    const std::uint8_t game[32] = {
        0x03,0xff,0x4a,0x3b,0xec,0x96,0xbd,0xe3,0xa2,0xe3,
        0x7c,0xe3,0xaa,0x4c,0xaa,0x0c,0xae,0x89,0x35,0xa8,
    };
    const std::uint8_t sdk[16] = {
        0xcf,0xf2,0x68,0x0f,0xe7,0x4c,0xb7,0xd8,
        0xd1,0x3b,0x52,0x57,0x30,0xd1,0xa7,0xfd,
    };
    Facts f{};
    f.main_base = base;
    f.data_start = base + kNativeDataStartRva;
    f.data_size = kMinimumDataSize;
    f.carrier_text_start = carrier;
    f.carrier_text_size = 0x10000;
    f.interposer = carrier + 0x1000;
    f.game_build_id = game;
    f.sdk_build_id = sdk;
    f.observed_callback = base + kOriginalWorkerRva;
    f.observed_other_callbacks[0] = base + kOtherCallbacks[0];
    f.observed_other_callbacks[1] = base + kOtherCallbacks[1];
    for (std::size_t i = 0; i < 4; ++i)
        f.observed_registration[i] = kRegistration[i].original;

    auto p = preflight(f);
    assert(p.status == Status::candidate_only);
    assert(p.pointer_address == base + kPointerRva);
    assert(p.original_callback == base + kOriginalWorkerRva);
    assert(p.candidate_interposer == f.interposer);
    assert(!p.install_authorized && !p.writable_verified_on_switch &&
           !p.lifecycle_verified_on_switch);

    ++f.observed_callback;
    assert(preflight(f).status == Status::other_mod_owns_slot);
    --f.observed_callback;
    ++f.observed_other_callbacks[0];
    assert(preflight(f).status == Status::other_mod_owns_slot);
    --f.observed_other_callbacks[0];
    f.observed_registration[1] = 0;
    assert(preflight(f).status == Status::callback_drift);
    f.observed_registration[1] = kRegistration[1].original;
    f.interposer = base + kOriginalWorkerRva;
    assert(preflight(f).status == Status::invalid_interposer);
    f.interposer = carrier + 0x1000;
    f.data_size = 0x100;
    assert(preflight(f).status == Status::invalid_layout);
    f.data_size = kMinimumDataSize;
    f.game_build_id = nullptr;
    assert(preflight(f).status == Status::identity_mismatch);
}

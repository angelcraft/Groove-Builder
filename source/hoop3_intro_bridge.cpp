// Inert AArch64 prologue title candidate. No installer or native global binding.
#include "hoop3_intro_dispatch.hpp"

extern "C" {
__attribute__((used)) hoop3_intro::Api hoop3_intro_api{};

__attribute__((used, noinline)) void menu_hoop3_intro_dispatch_entry(
    int kind, int index, const void* menu_scene) {
    hoop3_intro::dispatch(hoop3_intro_api, menu_scene, kind, index);
}
}

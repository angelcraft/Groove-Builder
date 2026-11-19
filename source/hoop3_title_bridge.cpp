// Inert bridge target for an *uninstalled* AArch64 callsite hook.
// No hkMain, no patcher, and API remains unbound until future preflight.
#include "hoop3_title_dispatch.hpp"

extern "C" {
__attribute__((used)) hoop3_title::Api hoop3_title_api{};

__attribute__((used, noinline)) void* menu_hoop3_title_dispatch_entry(
    int kind, int index, const void* panel) {
    return hoop3_title::dispatch(hoop3_title_api, panel, kind, index);
}

__attribute__((used, noinline)) void* menu_hoop3_instruction_dispatch_entry(
    void* instruction_bank, const char* label, void* context, const void* panel) {
    return hoop3_title::dispatch_instruction(
        hoop3_title_api, panel, instruction_bank, label, context);
}
}

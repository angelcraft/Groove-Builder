// Compile-only probe against the pinned PUBLIC open-ead/nnsdk headers.
// NEVER link this into a game module or install it on a console. The
// function deliberately has no caller; its object imports are audited with
// nm against symbol names found in the owner's privately verified main.

#include "groove_hoop3_nnfs_borrowed.hpp"
#include "groove_hoop3_readonly_probe.hpp"

extern "C" groove_hoop3_probe::Report hoop3_verify_pinned_nnsdk_abi(
    groove_hoop3_nnfs::BorrowedRomFs::GameMountReady ready,
    void* ready_context) {
    groove_hoop3_nnfs::BorrowedRomFs native{ready, ready_context};
    return groove_hoop3_probe::inspect_header(native.api());
}

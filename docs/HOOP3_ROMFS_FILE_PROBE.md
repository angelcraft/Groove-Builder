# Hoop3 `.groove` file ingress — proposed LayeredFS probe, NOT installed

20 November 2026. Scope: **read-only filesystem ingress** for the existing
68-event Hoop3 draft. No game permissions, original menu table, save data,
workers, NSO, NPDM or SD contents are modified by this repository change.

## Why the direct `sdmc:` assumption is blocked

The user's **original**, privately supplied `main.npdm` was examined without
adding it to this repository. Its SHA-256 is pinned in
`tools/audit_hoop3_npdm_sd.py`. The effective filesystem authorization mask
(ACI0 FAH AND ACID FAC) was `0x4000000000000000`; the specific
`0x0000000000200000` SD filesystem access permission bit was **not** set.
That does **not** prove that every custom loader must fail, but does block
the assumption that a normal game-process `sdmc:` open is available.
The audit is read-only, refuses an unrecognized NPDM, and never suggests
patching NPDM privileges. Synthetic tests cover permission-present and
permission-absent inputs.

The SHA-verified private **`main` NSO** was also scanned via
`tools/audit_hoop3_nnfs_imports.py`: its original dynamic symbol strings
include exactly these seven NNSDK operations:

```text
nn::fs::QueryMountRomCacheSize(size_t*)
nn::fs::MountRom(const char*, void*, size_t)
nn::fs::OpenFile(FileHandle*, const char*, int)
nn::fs::GetFileSize(int64_t*, FileHandle)
nn::fs::ReadFile(size_t*, FileHandle, int64_t, void*, size_t)
nn::fs::CloseFile(FileHandle)
nn::fs::Unmount(const char*)
```

These are demangled **symbol spellings**, not a verified callable ABI,
live resolution, return semantics or service initialization. In particular,
the original `MountRom` requires a **mount cache pointer and size**, so a
future native callback must query/provide this cache with a verified lifetime.
Presence of symbols is not proof that the new LayeredFS file will open.

**Stronger discovery, specific to this original version:**
`tools/audit_hoop3_game_romfs_mount.py` checked the game's original code
sites `main+0x50b894` (cache query) and `main+0x50b8b4` (`MountRom`). It
independently resolved the native string argument to **`"data"`** at
`main+0xac7601`. This is the mount the game itself requests. It is a much
safer candidate than mounting its RomFS a second time. We have NOT proven
at which later scene it remains mounted on Switch, or that added files
from LayeredFS appear there.

Another SHA-pinned read-only audit (`tools/audit_hoop3_fs_init_chain.py`)
connects the earlier startup branch `main+0x6708` to the game initialization
`main+0x50cff0`, which calls the original mount at `main+0x50d034`.
These are **static ARM64 call relations only**. The audit deliberately
reports `hook_point_safe_to_use: false`: it does not certify a moment when
another module may execute safely, or confirm native mount success.

Primary references: [hactool NPDM parser](https://github.com/SciresM/hactool),
[Atmosphere filesystem interception and merged RomFS](https://github.com/Atmosphere-NX/Atmosphere/blob/master/docs/changelog.md),
and [Atmosphere per-title LayeredFS layout](https://github.com/Atmosphere-NX/Atmosphere).

## Candidate single-file SD layout

```text
sd:/atmosphere/contents/0100D9F01D474000/romfs/GrooveEngine/HoopTrundling3.groove
```

LayeredFS can merge per-title files into the game's virtual RomFS. The
**preferred candidate** is to borrow the original game-owned mount:

```text
data:/GrooveEngine/HoopTrundling3.groove
```

The borrowed route **must never mount or unmount `data:`**. It only checks
a verified game-initialized/readable condition, opens the file for reading,
and closes the file handle. An isolated mount called `groove0:` remains an
**explicitly opted-in fallback research option** if the borrowed route is
ruled out. Its additional cache/budget and lifecycle have not been proven.
Whether Atmosphere exposes this **newly added** file in the original game
RomFS remains unverified on Switch. File copying alone cannot make Hoop3
playable yet.

Restarting the game after copying or replacing a `.groove` is the conservative
initial assumption: LayeredFS can rebuild/caches the merged RomFS image, so
live SD hot-reload is not part of this proof. Eventually, once a loader exists,
adding a level can still mean copying one `.groove` with **no per-level IPS,
subsdk or APK rebuild**.

## Implemented portable contract

- `source/groove_hoop3_package_file.hpp`: strict 8 MiB initial package cap
  and a read-only file lease. Default `borrow_game_romfs` opens the fixed
  `data:/` path and **never unmounts game-owned RomFS**, including on error.
  A separate, explicitly selected `separate_probe_mount` uses `groove0:`
  with matching mount/unmount as an experimental fallback. The `nn::fs`
  functions remain injected callbacks, not linked Nintendo SDK imports.
  Exact reads and file bounds are enforced before ZIP parsing.
- `source/groove_hoop3_file_gateway.hpp`: connects that lease to the
  pre-existing ZIP CRC + strict JSON/GRT1 preflight + `SessionOwner`. A
  successfully decoded timeline is **copied** into the owner before the
  file closes. A missing file, failed mount, short read, invalid archive or
  invalid metadata leaves the simulated Hoop3 slot locked; an active native
  scene is never reloaded, mounted, or invalidated.
- `source/groove_hoop3_romfs_bridge.hpp`: **fallback-only** new-mount
  contract. It **requires an independently verified FS-initialized signal**,
  calls the native cache-size query first, verifies the caller-owned cache
  capacity, then mounts and unmounts using that *same* buffer. Query failure,
  absent readiness, zero/oversized cache, duplicate mounts and failed
  native mounts all stop before opening a file. Its local synthetic
  failure marker `0xFFFFFFFF` is **not** a Nintendo `nn::Result`.
- `tests/test_groove_hoop3_package_file.cpp` exercises lease error paths.
  `tests/test_groove_hoop3_archive_loader.cpp` now tests the entire fake
  filesystem → package → owner route and fail-closed behavior.
  `tests/test_groove_hoop3_romfs_bridge.cpp` checks cache lifetime, mounting
  order, ownership, startup readiness and the full error cleanup matrix.
- `source/groove_hoop3_nnfs_borrowed.hpp` is the **type-correct candidate
  native adapter**, with direct `nn::fs::OpenFile`, `GetFileSize`, `ReadFile`,
  and `CloseFile` calls. It uses `OpenMode_Read` only, checks native
  `FileHandle`/`Result` ABI sizes, transfers the 64-bit native handle without
  pointer punning, and requires a proven original-mount-ready callback.
  It has NO mount, unmount, write, commit or game patch call.
- `tests/fake_nnsdk/nn/fs.h` is an **original test fixture** that models the
  tiny ABI surface; it is NOT a Nintendo header or a substitute for the
  real target SDK. `tests/test_groove_hoop3_nnfs_borrowed.cpp` validates
  the native adapter against that mock. The Linux-only
  `tools/verify_hoop3_nnfs_borrowed.cpp` runs the complete fake-nnfs →
  native-adapter → ZIP/JSON/GRT1 → copied-session-owner pipeline, including
  the owner's actual private 68-event `.groove` draft. A Python regression
  builds a separate four-event synthetic pack and rejects missing files
  and stale JSON/cache content.
- `source/groove_hoop3_readonly_probe.hpp` is the intended **first
  hardware A/B diagnostic payload** (currently unlinked): after the
  externally verified game-ready gate, it opens the file read-only,
  enforces the package size cap and checks only its initial four ZIP
  signature bytes before closing the handle. It reports native errors
  without invoking the ZIP loader, altering a Stage68 object or changing
  any menu state. A ZIP local-header signature is *not* a valid full pack;
  the larger gateway must still perform strict CRC+JSON/cache checks.
  `tests/test_groove_hoop3_readonly_probe.cpp` checks every error and
  file-close path. The host-only 68-event verifier now runs the small
  probe first, then uses the full typed `nn::fs` gateway.
- `tools/verify_hoop3_pinned_nnsdk_abi.py` now compiles
  `tests/hoop3_pinned_nnsdk_abi.cpp` against the **actual pinned public**
  `open-ead/nnsdk` headers (`02dab8893e850d9f9f8d6f28c51491c1bf0d8f66`).
  It verifies the checkout commit and matches the object file's four
  unresolved `nn::fs` C++ symbols **exactly** to the original-game import
  spellings from `tools/audit_hoop3_nnfs_imports.py`. Tested on 64-bit Linux;
  no game-owned binary or third-party SDK headers are committed. Existing
  GitHub Actions cross-build now runs this separate check too.
- The pinned public cross-build template produces an **unlinked
  `Hoop3ReadOnlyAbiAudit` object**. Because CMake treats `SYSTEM_NAME NX`
  as a non-UNIX platform, an override forces the ELF object suffix `.o`
  so the checker below finds
  `CMakeFiles/Hoop3ReadOnlyAbiAudit.dir/hoop3_pinned_nnsdk_abi.cpp.o`.
  A local LLVM 19.1.1 AArch64 compile (`aarch64-none-elf`, cortex-a57)
  passed that check: ELF64 / REL / AArch64 and exactly the four original
  `OpenFile`, `GetFileSize`, `ReadFile` and `CloseFile` imports. The
  entry `hoop3_verify_pinned_nnsdk_abi` exists only in that object.
  `MenuColumn.nss` / `.nso` were not built in that run. Two C++23
  deprecation warnings come from the pinned public `nn/os.h` and do not
  fail the compile. This is build-time evidence, not a boot call to
  `nn::fs`.

The runtime behavior tests still use **fake host file APIs or mock SDK
declarations**. The compile-only audit now has both a host x86-64 object
and an unlinked AArch64 object against the pinned public headers. Neither
object is linked or executed as a Switch module. The real original-process
timing and file visibility remain unproven; the actual `.groove` DEFLATE
backend still needs a native binding. No file is written by the runtime
path described here.

To repeat the public-header and exact original ABI symbol check from an
externally cloned, pinned public `groove-mod` checkout:

```sh
python tools/verify_hoop3_pinned_nnsdk_abi.py \
  --sdk-dir /path/to/groove-mod/lib/nnsdk
```

After the separate pinned LLVM19/AArch64 build, check its unlinked object:

```sh
python tools/verify_hoop3_pinned_nnsdk_abi.py \
  --cross-object /path/to/build/CMakeFiles/Hoop3ReadOnlyAbiAudit.dir/hoop3_pinned_nnsdk_abi.cpp.o
```

To repeat the Linux-only native-adapter integration against an owner-owned
private archive (never commit that file):

```sh
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined \
  -Itests/fake_nnsdk -Isource tools/verify_hoop3_nnfs_borrowed.cpp \
  -lz -o /tmp/verify-hoop3-nnfs-borrowed
/tmp/verify-hoop3-nnfs-borrowed /private/HoopTrundling3-54-SCENES-DRAFT.groove
python3 -m unittest discover -s tools -p test_hoop3_nnfs_borrowed.py -q
```

The mount cache size is **not hardcoded**. The future native module must
provide a game-safe memory arena **only if the fallback separate mount is
ever used**. It must stay alive until after `Unmount`; inadequate size
fails closed. The preferred borrowed route needs no new cache. In either
case, the readiness callback must come from independently verified original
game initialization, not merely return true at module startup.

## Order of the eventual safe physical A/B

1. Correlate a safe post-initialization game callback with the original
   `MountRom("data", ...)` completion, and verify the exact `nn::fs::OpenFile`
   callable ABI. No fresh mount or game mount unmount is required for the
   preferred route. **Only a future native adapter/hardware test can prove
   that the original mounted filesystem and injected file are accessible**.
2. Only then build a **disabled-by-default**, read-only subsdk probe that
   reports original-mount readiness, open/size/read status and original
   `nn::Result` values, leaving game-owned `data:` mounted.
   It must not install the gameplay worker router or unlock the menu slot.
3. In an explicitly agreed hardware test, try missing-file vs valid-file
   LayeredFS placements, restart the game, and compare the probe status.
   Keep Hoop2 original untouched in both conditions. Record errors and
   remove the overlay to restore original behavior.
4. If and only if native ingress works, bind trusted raw-DEFLATE and the
   complete validated archive load before addressing the separately
   unverified Stage68 worker, practice skip, menu identity and saves.

**Stop conditions:** unavailable SDK symbol, unreadable original mount, denied open,
unexpected path/size, decompressor failure or unstable scene lifetime.
None warrants patching NPDM or unlocking a borrowed Hoop2 slot by default.

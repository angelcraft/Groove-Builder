# Continue Hoop Trundling 3 — Switch menu, 20 November 2026

## Current session: data-driven Hoop3 replacement policy (host-tested)

### 20 November, latest: isolated AArch64 reader object compiled and checked

- LLVM 19 (`clang 19.1.1`, `--target=aarch64-none-elf -mcpu=cortex-a57`)
  compiled **only** the unlinked `Hoop3ReadOnlyAbiAudit` object against the
  pinned public loader `a321204` / NNSDK `02dab88` and the public LibHakkun
  musl headers. No `MenuColumn.nss`, `MenuColumn.nso`, IPS, subsdk or SD
  file was produced. Hoop Trundling 2 was not modified.
- `tools/verify_hoop3_pinned_nnsdk_abi.py --cross-object` accepted the
  result: ELF64, machine AArch64, type REL. The only unresolved `nn::fs`
  imports are the original four:
  `_ZN2nn2fs8OpenFileEPNS0_10FileHandleEPKci`,
  `_ZN2nn2fs11GetFileSizeEPlNS0_10FileHandleE`,
  `_ZN2nn2fs8ReadFileEPmNS0_10FileHandleElPvm`,
  `_ZN2nn2fs9CloseFileENS0_10FileHandleE`.
  The defined entry `hoop3_verify_pinned_nnsdk_abi` stays in that object
  and is not part of a runtime module. The same four names also matched
  a disposable x86-64 host object against the same public headers.
- CMake does not know `SYSTEM_NAME NX`, so the first build named the ELF
  object `*.cpp.obj` and the prepared CI path `*.cpp.o` would have missed
  it. `templates/cmake/nx-elf-object-suffix.cmake` now forces the ELF
  suffix `.o` before the languages are configured. The rebuilt object is
  `CMakeFiles/Hoop3ReadOnlyAbiAudit.dir/hoop3_pinned_nnsdk_abi.cpp.o`.
- The compile emitted two `-Wdeprecated-declarations` notes from the
  pinned public `nn/os.h` (`std::aligned_storage_t` under C++23). They are
  not errors, the object was produced, and the public SDK was not edited.
- Host verification after the suffix fix: **129 Python tests passed**,
  `generate_extended_catalog.py --check` passed, and the existing host
  C++ policy/probe binaries passed, including the fake-`nn::fs` borrowed
  reader. Those host runs still do not call a Switch filesystem.
- **Still not proven:** a game-thread callback late enough to run after
  the original `MountRom("data")` returns, LayeredFS visibility of
  `data:/GrooveEngine/HoopTrundling3.groove`, or any hardware open.
  Do not link this object, install a hook, or unlock the Hoop3 cell on
  this evidence.

**Next step, still read-only:** audit the return path after the pinned
`MountRom("data")` at `main+0x50b880` and name one existing game-thread
site that cannot run before that call returns successfully. Record its
address, thread, and why an earlier `hkMain` call is too soon. Do not
patch that site and do not build a diagnostic subsdk until that point
is independently checked. Hoop2 stays on its original worker.

### 20 November, latest: isolated AArch64 reader-object cross-build prepared

- `tools/prepare.py` now includes the existing read-only `nn::fs` / ZIP-header
  audit source and its four portable headers in the **separate** pinned
  public-loader build directory. `templates/CMakeLists.txt` defines
  `Hoop3ReadOnlyAbiAudit` as an **OBJECT library**; it is NOT linked into
  `MenuColumn`, executed by `hkMain`, installed on Switch or given a hook.
- The existing **CI-only LLVM19/AArch64** workflow now compiles this inert
  object in both research configurations, checks its ELF64/AArch64/REL
  machine/type and exact four game-import `nn::fs` mangled names, and asserts
  the audit entry symbol is absent from the runtime `MenuColumn.nss`.
  Failure is fail-closed: the workflow cannot certify an incorrect object.
- Expanded host tests verify the build input copies and CMake source
  isolation, and reject altered architecture/object types. **129 Python
  tests passed locally**, plus the prior native-header host-object match.
- **Important:** this session has no LLVM AArch64 cross compiler installed;
  the new CI cross-build step is prepared, NOT yet executed or verified.
  Its diagnostic object cannot read a real Switch file until an independently
  verified post-mount game-thread callback and LayeredFS A/B exist. The
  current real Hoop3 slot stays locked; no installable files were created.

### 20 November, latest: exact public NNSDK header + original symbol ABI audit

- Retrieved the exact pinned **public** `UnusualNorm/groove-mod` loader commit
  `a321204` and `open-ead/nnsdk` submodule commit `02dab88` into an external
  temporary directory. The owner's original NSO/NPDM were never copied into
  either checkout or the repository.
- New `tests/hoop3_pinned_nnsdk_abi.cpp` compiles the **actual candidate
  read-only header probe** against those public NNSDK headers on 64-bit Linux.
  `tools/verify_hoop3_pinned_nnsdk_abi.py` checks the public SDK Git revision,
  compiles a disposable object, and compares its four unresolved, mangled
  `nn::fs::OpenFile/GetFileSize/ReadFile/CloseFile` symbol names *exactly*
  against the previously verified original-game imports. All four matched.
  This check is reproducible in the existing CI cross-build workflow without
  bundling external headers or game code.
- This **eliminates a C++ header/signature mismatch** for the preferred
  borrowed-`data:` file reader. It is still a **host x86-64 object audit**,
  not an ARM64 build or game runtime binding. There is no verified post-mount
  callback, SD LayeredFS file visibility test, Switch hardware test or
  installable reader. Do not unlock Hoop3 or hook startup on this evidence.

### 20 November, latest: startup call-chain audit + minimal ZIP header probe

- Read-only `tools/audit_hoop3_fs_init_chain.py` now verifies the original
  SHA-pinned `main` call chain:
  `main+0x6708 -> main+0x50cff0 -> main+0x50d034 -> main+0x50b880`
  (original `MountRom("data")`). This establishes static *call ordering*
  in the game's early startup. It does **NOT** prove a successful mount,
  safe patch site, surviving mount lifetime, or a valid callback after
  initialization. Synthetic regression rejects altered calls.
- New portable `source/groove_hoop3_readonly_probe.hpp` does **one read-only
  operation** against the borrowed `data:` mount: checks file open/size and
  first four ZIP bytes (`PK\x03\x04`), then immediately closes the handle.
  It never modifies the game session, text/DATA/worker, save or mount. It
  records separate statuses for not-ready, absent/oversized file, short
  read, invalid signature and success. This is a *visibility test*, not a
  complete ZIP validity check or a live injected subsdk.
- Host fixture `tests/test_groove_hoop3_readonly_probe.cpp` tests the
  complete error/cleanup matrix. Linux `verify_hoop3_nnfs_borrowed` now
  runs this probe before the full ZIP/JSON/GRT1 gateway; owner's real
  68-event `.groove` passed. All calls still target a FAKE SDK on Linux.
- **Next blocker:** verify a sufficiently late game-thread callback, link
  against actual pinned LibHakkun SDK headers and build a **disabled-by-
  default** read-only diagnostic module. Do not install early startup
  hooks or unlock the user-facing Hoop3 cell on static-call evidence alone.

### 20 November, latest: typed native `nn::fs` borrowed reader (mock SDK + host)

- New `source/groove_hoop3_nnfs_borrowed.hpp` now calls the **named
  original NNSDK APIs** `OpenFile` (read-only), `GetFileSize`, `ReadFile`
  and `CloseFile`. It transfers the verified 64-bit `FileHandle` without
  type punning, requires 32-bit `nn::Result`, and refuses the operation
  until an independently verified original `data:` ready signal exists.
  It never mounts, unmounts or writes to game-owned files.
- `tests/fake_nnsdk/nn/fs.h` is a handcrafted host-only test fixture,
  NOT an actual Nintendo SDK header. The typed native adapter successfully
  compiled against this fake SDK, including read/open/close failures, short
  reads, early initialization, size limits and exact read-only mode.
- New `tools/verify_hoop3_nnfs_borrowed.cpp` exercised the full
  **fake `data:` mount → typed nn::fs → FileLease/Gateway → ZIP CRC →
  editable JSON/GRT1 equivalence → SessionOwner** path against the owner's
  private **54 rings / 68 event** draft and returned `PASSED`.
  `tools/test_hoop3_nnfs_borrowed.py` additionally covers a synthetic
  four-event archive, absent file and stale-but-CRC-valid JSON.
- **STOP:** no actual cross-compile against the pinned public Hakkun
  `nn/fs.h` headers, real Switch `nn::Result` object verification, original
  game-lifecycle callback, game-owned FS visibility, native DEFLATE, ARM64
  hook, practice bypass or independent saves has been done. The real
  Hoop3 slot stays locked. No deployable subsdk/IPS/APK was generated.

### 20 November, latest: borrow original game-mounted `data:` (host)

- Stronger read-only original-main audit: `tools/audit_hoop3_game_romfs_mount.py`
  found `main+0x50b894` calls `QueryMountRomCacheSize`, and
  `main+0x50b8b4` calls `MountRom` with the exact literal `data` at
  `main+0xac7601`. The game itself requests this mount; no second mount is
  justified by default. Hash-pinned CLI and synthetic mutation tests pass.
- Preferred file read is now `data:/GrooveEngine/HoopTrundling3.groove`,
  supplied by the unchanged per-title Atmosphere LayeredFS SD path.
  `FileLease` / `Gateway` default to **borrowing** the game-owned RomFS,
  require an explicit readiness callback, and NEVER unmount it. The old
  `groove0:` mount/cache bridge is retained only as an opt-in fallback
  research mode. Host fake-read tests cover missing original mount, file
  errors, session busy and borrowed mount lifetime.
- **Not proven on Switch:** exact post-initialization timing, runtime `data:`
  visibility of newly added LayeredFS files, real NNSDK binding, native
  ZIP DEFLATE, stage/worker hook or independent saves. No executable module
  produced. See `docs/HOOP3_ROMFS_FILE_PROBE.md`.

### 20 November, latest: original RomFS mount cache contract (host)

- New `source/groove_hoop3_romfs_bridge.hpp` models the pinned original
  `nn::fs::QueryMountRomCacheSize` → `MountRom(name, cache, length)` ABI.
  Native queries are forbidden until a separately verified FS-initialization
  callback authorizes them; the buffer stays caller-owned until unmount.
  Zero/oversized cache, query errors, duplicate mounts, absent callbacks,
  open errors and cleanup are all fail-closed in host tests.
- `tests/test_groove_hoop3_romfs_bridge.cpp` injects fake native functions
  and verifies cache lifetime/mount→open→read→close→unmount ordering. It
  is **not** a live `nn::fs` binding and does not unlock Hoop3 on Switch.
- Actual cache allocation, module call timing, native SDK import linking,
  injected-file visibility, real DEFLATE and hardware A/B remain pending.
  See `docs/HOOP3_ROMFS_FILE_PROBE.md`.

### 20 November, latest: permission audit + candidate LayeredFS file gateway (host)

- Read-only `tools/audit_hoop3_npdm_sd.py` checked the owner's original
  SHA-pinned private `main.npdm`: the FAH/FAC effective permissions do NOT
  include the normal SD filesystem access bit `0x200000`. Therefore direct
  `sdmc:` inside the game process must NOT be presumed; the original NPDM
  was neither modified nor committed. Synthetic permission/malformed-file
  tests pass.
- Proposed one-file LayeredFS location:
  `atmosphere/contents/0100D9F01D474000/romfs/GrooveEngine/HoopTrundling3.groove`.
  The initial `groove0:` separate-mount candidate has been **superseded**
  by the read-only audited game-owned `data:` mount above. Injected-file
  visibility and post-init lifecycle remain unverified; do NOT present
  either route as a working hardware loader or hot-reload.
- New read-only `tools/audit_hoop3_nnfs_imports.py` independently confirms
  seven exact `nn::fs` symbol strings in the SHA-pinned original `main`:
  `QueryMountRomCacheSize`, `MountRom`, `OpenFile`, `GetFileSize`, `ReadFile`,
  `CloseFile`, `Unmount`. The original `MountRom` requires a caller-owned
  cache pointer and size; no adapter may call it with only a mount name.
  Symbols present do NOT prove callable FS service or LayeredFS visibility.
- Added `source/groove_hoop3_package_file.hpp` (read-only fixed path,
  8 MiB maximum, exact reads, RAII lease) and
  `source/groove_hoop3_file_gateway.hpp` (full file → ZIP → JSON/GRT1 →
  `SessionOwner`, with missing/invalid file locking the slot and busy scenes
  forbidding filesystem I/O). Host fake-filesystem integration tests pass.
- **Still missing:** real `nn::fs` binding, verified mount/runtime permission,
  native DEFLATE backend, original game-process hook, hardware A/B,
  practice skip and progress/save routing. No installable subsdk/IPS/APK
  was generated. See `docs/HOOP3_ROMFS_FILE_PROBE.md` for precise stop
  conditions and the proposed read-only A/B.

### 20 November, previous: ZIP -> verified events -> session owner (host)

- New `source/groove_hoop3_archive_loader.hpp` connects the **ZIP32
  read-at extractor**, bounded **Hoop3-only manifest and JSON/GRT1 equality
  verifier**, and `SessionOwner::load_prevalidated_timeline` into one
  synchronous all-or-nothing entry. The owner copies the entire binary
  cache into its own static event arena; the file and ZIP buffers can be
  closed/reused after `ArchiveLoadStatus::loaded`.
- **Fail closed:** a failed/missing reload clears any old *ready* cache and
  leaves the host Hoop3 slot locked; a reload during active/faulted/owned
  Stage68 playback returns `session_busy` without touching the running
  session. Only an owner-confirmed scene destruction **after native worker
  join** permits replacing that cache.
- Test `tests/test_groove_hoop3_archive_loader.cpp` builds a synthetic ZIP,
  checks valid launch, bad JSON vs unchanged cache, missing pack, hot reload,
  original worker completion after the backing ZIP was freed, quarantine
  and safe post-join unlock/lock transitions.
- The Linux `.groove` verifier now uses this WHOLE loader. Actual private
  54-ring/68-event archive passed: `Host SessionOwner ready; Switch
  menu/SD/ARM64 NOT connected.` This is a **host-only readiness** result,
  NOT evidence that a new level slot unlocks on a physical Switch.
- Still missing actual Horizon SD FS backend, original-process permissions,
  decompressor and lifetime integration, scoped ARM64 callback hook, skip
  practice, independent progress/save, and real hardware A/B. No installable
  IPS/subsdk or APK was built.

### 20 November, latest: initial Hoop3 JSON/cache equivalence preflight

- New `source/groove_hoop3_json_preflight.hpp` parses **real UTF-8 JSON**
  with bounded, allocation-free C++17 code. It accepts ONLY the verified
  Hoop3 v1 manifest (virtual ID, world1/col9/row0, native base kind1/index41,
  no practice, `replace` timeline, independent namespace). **Optional asset
  overrides deliberately stay blocked** until the actual engine adapters
  are live; missing assets are inherited.
- Its `timeline.json` parser checks exact fields, sorted native beat-grid
  timestamps, unique stable IDs, event arguments and command whitelist;
  each event must agree with the matching 16-byte GRT1 record **byte for
  byte in semantics**, regardless of JSON key order or whitespace. Even a
  syntactically valid altered JSON with the stale binary cache fails.
- The C++ host `verify_hoop3_zip_container` now requires ZIP CRC + exact
  manifest + full timeline/cache equivalence, and **passed the actual
  54-ring/68-event private Hoop3 draft**. Rebuilt caches with unordered
  events or zero rings, duplicate IDs, wrong origin, unverified calls,
  malformed JSON/UTF-8 or resource overrides remain blocked.
- This is **NOT a full native runtime**: the preflight is not yet bound to
  a Switch SD file handle, safe `SessionOwner` readiness, ARM64 hook,
  practice skip, save namespace or real Stage68 scene teardown. The visible
  new menu cell remains locked by policy until those parts exist.

### 20 November, latest: real `.groove` ZIP32 metadata extraction (host)

- New `source/groove_zip_archive.hpp` parses a `.groove` ZIP32 central index
  through an **injected read-at stream**, without C++ allocation or game
  stack buffers. It validates local/central headers, path safety, duplicates,
  symlinks, overlapping payloads, limits, compression method, and CRC32.
  Stored members copy directly; DEFLATE uses an injected exact-length raw
  decoder (not a hard dependency on zlib inside the portable core).
- New Linux `tools/verify_hoop3_zip_container.cpp` supplies `ifstream` +
  zlib backend; on the actual previously saved private 54-ring/68-event
  Groove draft, it **successfully extracts** the three metadata files and
  decodes a 68-event GRT1 sequence on the native 480-tick grid.
- New `tools/test_groove_zip_container.py` has malformed/corrupted ZIP
  regressions. Both STORE and the original DEFLATED archives work; the
  previously saved draft need NOT be changed.
- **Still BLOCKED:** this ZIP reader has no native SD handle, and no
  native integration to supply fully prevalidated data to
  `SessionOwner::load_prevalidated_timeline`. The separate Hoop3 JSON/cache
  semantic check is now implemented on the host as noted above.
  The extra menu slot MUST stay locked. Also no ARM64 callback interception,
  hardware test, independent save, practice skip or asset playback is wired.
  See `docs/GROOVE_ZIP_INGEST.md` for the exact contract and next step.

### 20 November, current: Stage68 original sequence-pointer discovery

- Found an **exact original callback pointer** for the native Hoop2 sequence
  at `main+0xd9c7a0` in the original NSO's DATA segment. It resolves to
  `main+0x42ca40` (already audited x0=Stage68/x1=SeqThread worker). The
  original Stage68 normal worker at `main+0x42c660` loads it at `0x42c7b4`,
  stores it into a game-owned callback at `0x42c7c0`, then registers it via
  `BL main+0x5153a0`. The two adjacent other callbacks and registration
  sites are independently verified; **none are modified**.
- New `tools/audit_hoop3_sequence_pointer.py` checks that direct DATA
  pointer and ADRP/LDR/STR/BL registration path against the owner's pinned
  private `main`. Synthetic negative tests reject changed entries, sources
  and destinations. Details in `docs/HOOP3_SEQUENCE_POINTER.md`.
- New no-write `source/hoop3_sequence_pointer_plan.hpp` fail-closes on
  incorrect Build IDs, DATA layout, changed callback slot or incompatible
  interposer. It NEVER certifies a live Switch install.
- New `source/groove_hoop3_sequence_router.hpp` and host tests distinguish
  **all normal Hoop2/untracked instances** (call original worker) from
  **one verified, already activated Hoop3 instance** (run `.groove` events).
  A tracked but unready, failed, wrong-thread or repeated callback must NOT
  fall back to original Hoop2 or replay custom events.
- This suggests a future **DATA callback interposer instead of a text IPS**
  for the sequence body, but the DATA page permissions, atomic install,
  concurrency, independent practice skip, SD loading and real stage join
  are **unverified**. No live pointer has been written, no subsdk/IPS installed.

### 20 November, current: original Stage68 worker action coverage

- Before proposing any real ARM64 worker replacement, independently audited
  the user's SHA-pinned original `main`. `main+0x42ca40` saves its entry
  `x0=Stage68` into x20 and `x1=original SeqThread` into x19. **This confirms
  the candidate worker ABI argument order; no physical hook is installed.**
- Crucial missing behavior discovered: the original worker contains **11
  non-ring calls** to `main+0x1390e0`, with original Stage68 object and
  whitelisted strings `basic` (twice), `change` (eight times), and `hide`
  (once). These maintain original scene transitions. The stage's one special
  mask call at `main+0x2171e0` is separately modeled, and all 34 ring emits
  use `main+0x217960`. Its 191 waits, 191 stopped checks and entire direct
  call inventory are now accounted for; no indirect BLR calls found.
- `tools/audit_hoop3_worker_contract.py` is the read-only, SHA-pinned
  extractor for the entry argument mapping and 11 scene-action coordinates.
  It does not copy game binaries or strings to Git; its test fixture is
  synthetic and independently checks ARM64 ADRP/ADD string addressing.
- Extended `.groove` with **`hoop.scene_action`** (binary command ID4),
  accepting ONLY `basic/change/hide`, and extended `NativeAdapter`/
  `groove_hoop_native_bridge.hpp` to model the original scene helper.
  Arbitrary native function calls remain forbidden.
- Regenerated the private **54-ring draft as 68 events**: 54 native ring
  commands, 11 original scene actions, and 3 BubbleState control commands.
  Both Python archive inspection and C++ native tick preflight pass. The
  prior Library `54-DRAFT.groove` has only 57 events and is **superseded**;
  do not mistake it for the fuller sequence.
- Still not playable: no scoped Stage68 worker replacement installed,
  no hardware A/B, no SD ZIP loader, no independent save and no proven
  game-thread join/teardown. Any real worker hook must retain equivalent
  original scene effects and ensure other hidden control-flow side effects
  are not lost.

### 20 November, follow-up: one scoped Stage68 owner and native-wait bridge

- Added `source/groove_hoop3_session_owner.hpp`, a **source-only** fixed-arena
  (10,000 events) lifecycle coordinator for the exact intended order:
  prevalidated GRT1 -> enabled Hoop3 slot -> menu confirmation -> first
  StageFactory -> matching Stage68 practice branch -> game-owned worker ->
  scene teardown **after confirmed worker join**. The original borrowed
  Hoop2 launch never activates the custom session.
- Invalid/stale manager snapshots, missing ring callbacks, double worker
  entry, worker wait failures and cancellation remain blocked; no mid-stage
  fall-through to native Hoop2 events. Binary timestamps are preflighted on
  the 480-tick original grid **before** the virtual cell becomes enabled.
- The owner quarantines the *first rejected factory object* until its
  verified destruction/join, while original Hoop2 on a different Stage68
  address remains untouched. If no trusted object exists, an explicit
  quiescence proof is required to recover from the rejected launch.
- `groove_hoop_native_bridge.hpp` now also expresses the original AArch64
  native wait/stopped routines with injected typed callbacks and no new
  worker. Their actual target binding and teardown are still **unverified**.
- New `tests/test_groove_hoop3_session_owner.cpp` exercises the original
  Hoop2 path, successfully owned Hoop3, stale selections, replay prevention,
  missing adapters, cancellation, wait failure and joined teardown.
- `tools/verify_hoop3_native_preflight.cpp` independently decoded and
  preflighted the **actual previously built 54-ring .groove's** `timeline.bin`
  in C++17: **54 native ring events accepted**, no Switch calls made. Its
  input must already have passed full ZIP/manifest/JSON comparison elsewhere.
- **This work does NOT patch the real Stage68 worker, install IPS/subsdk,
  read the ZIP from Switch SD, skip practice on hardware or save progress**.
  The new owner API assumes trusted lifecycle callbacks; those are the next
  ARM64 investigation, followed by an explicitly scoped hardware A/B.

### 20 November: original-engine Hoop bridge and native tick policy

- Owner's private Hoop54 research confirms Stage68 original emitter
  `SceneRing_Hoop` at `main+0x217960`, called as
  `(Stage68+0x2ca0, original worker, signed BubbleState)` in `x0/x1/w2`.
  **BubbleState is not a separate native function**; `-1` is a distinct
  original sentinel. Non-default masks are not all hardware verified.
- `groove_replace_session.hpp` now updates a pending mask and passes it to
  each ring callback. Four illustrative events exercise `-1` then `1`.
- New `groove_hoop_native_schedule.hpp` implements host-only ordered native
  waits/stopped checks, 480 ticks/beat exact-time preflight and error gates.
  New `groove_hoop_native_bridge.hpp` models the native scene/worker/mask
  call signature. Native callbacks are mocked in host tests: **no ARM64 hook
  or Switch installer is yet produced**.
- `.groove` Hoop replacement beat positions must map exactly onto the native
  480-tick grid. Current six-decimal beat format only expresses multiples
  of three ticks; future format revision can carry exact integer ticks.
- Prior hardware Hoop54 experiment confirmed original 34 + 20 additional
  rings, at extra beats `22,30,41,47,57,63,69,79,85,100,104,109,120,125,136,146,154,164,170,180`.
  It APPENDED to the native worker; it is **not** proof that the new full
  replacement works. Recover the exact original 34 ring coordinates from
  the owner's private hash-pinned `main` before authoring full Hoop3.
- The Switch still needs physical evidence for scoped launch/practice skip,
  worker ownership, original stream bypass, scene teardown, independent
  saves and `.groove` SD file access.
- **Owner's Drive ExeFS recovered and SHA verified**: local private
  `Groove-Switch-Ejecutables.zip` contained `main` matching the required
  `494c35e7...d5ee1870e`. The executable and extraction ZIP remain only in
  temporary private storage; neither was committed to public Git.
- New `tools/recover_hoop3_original_rings.py` audits 191 native waits,
  191 stopped guards, and precisely **34 original ring locations** from the
  hash-pinned NSO. It also verifies **33 constant -1 masks** and the special
  original ring #33 at **beat 178**: Stage68 byte `+0x2c94 == 1` selects
  mask 1, otherwise -1. Uses original runtime mask helper `main+0x2171e0`.
- New `hoop.stage68_mask` command (binary ID3) and guarded native-mask resolver
  model ensure that the original conditional behavior can be expressed in
  an editable `.groove` without hardcoding 1 for every playthrough.
- New `tools/build_hoop3_from_private_main.py` initially combined 34 original
  ring coordinates and 20 verified extra positions into **54 rings / 57
  events**. That earlier draft is now superseded by the **68-event** version
  incorporating original scene-state actions. Neither is Switch playable.
  It must NOT be described as an installable level until worker
  interception, no-practice scoped route, save, SD loading and scene teardown.

- The user accepted a **virtual level overlay**: Hoop3 uses original Hoop2
  mechanics and visual assets, but `HoopTrundling3.groove` owns its event
  timeline and must not append to or play the Hoop2 timeline. Hoop3 must **skip
  practice**, while the original Hoop2 still retains practice and gameplay.
- `examples/hoop_trundling_3/manifest.json` now requests
  `launch.practice=skip` and `sequence.mode=replace`. `tools/groove_pack.py`
  validates the combination and compiles deterministic `timeline.bin` (`GRT1`
  with 16-byte microbeat command records) *inside* a generated `.groove` ZIP.
  Stale/mismatched cache is rejected against editable `timeline.json`.
- `source/groove_replace_session.hpp` is an allocation-free, host-tested
  event dispatcher. It demands an explicitly verified launch, suppresses
  original cues during replacement, requests practice skip only for an active
  session and locks out replay if callbacks/clock fail. Its `NativeAdapter`
  callbacks are **unbound** until ARM64 entry signatures are proven.
- `source/groove_binary_timeline.hpp` is a portable GRT1 decoder. The
  `.groove` parser, SD access inside the title, real beat-clock binding,
  original scheduler bypass, secure Stage68 ticket and save routing are STILL
  NOT implemented. No runtime patch or installable build was produced.
- `tests/test_groove_hoop3_route_integration.cpp` links the existing
  Stage68 one-shot policy to the replacement session: the correct origin
  starts custom events; borrowed original Hoop2, stale manager records and
  cancellation cannot start them. **Host simulation, not hardware proof.**
- Four example events remain a **draft test**, not the 54-ring level. Recover
  and validate the proven 34+20 Hoop DX arrangement before claiming playable.
- Run `python3 -m unittest discover -s tools -p 'test_*.py' -q` and
  `g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource
  tests/test_groove_replace_session.cpp -o /tmp/groove-session &&
  /tmp/groove-session` (similarly `test_groove_binary_timeline.cpp`).

**Next critical hardware milestone:** correlate virtual Hoop3 launch
with Stage68, safely bypass its preliminary practice route for this instance,
and connect native command callbacks under its real beat clock. Do NOT install
the old Stage68-wide skip patch, and do NOT let an invalid mod fall back to
playing native Hoop2 under the Hoop3 identity.

## NEW direction: `.groove` packages and real native catalog growth

- The owner wants a **persistent Groove Engine (IPS + resident subsdk)** and
  many independent native levels, not a single borrowed level, an icon test,
  or a global Stage68 practice skip. Original kind=1 entries 0..79 remain
  untouched; the aspirational initial catalog capacity is 256 total entries.
- Extra slots should be disabled if no matching `.groove` file is loaded.
  `.groove` is a ZIP with level manifest, editable native-command timeline,
  and optional sprites/music/sound/intro. Missing resources inherit the base
  game's original assets. A single file should be portable from Android
  Groove Editor to Switch without rebuilding the engine for every level.
- **Host-only format prototype**: `tools/groove_pack.py`,
  `examples/hoop_trundling_3/`, `docs/GROOVE_FORMAT.md` and its tests.
  Current example has four demonstrative RingSpawn/BubbleState commands,
  is explicitly `draft`, **not** 54 playable aros or a Switch IPS.
- Priority is now native descriptor allocation/lookup, separate identity,
  SD loader and *real command bridge*. Prior Stage68-wide/scoped practice
  experiments remain diagnostic only; do not present them as a solution.

## Verified on the user's physical Switch

- World 1's extra visual column is visible and new `(world 1, column 9,
  row 0)` can be selected. A starts original Hoop Trundling 2 because the
  extra cell borrows native `(kind=1,index=41)`.
- The same visual alone proves neither independent progress nor custom cues.
- Current public repository ships *research source*, not a playable IPS/NSO.
  No new APK is needed for the next intended hardware A/B.

## Pinned user-owned input (never commit)

- Original Switch `main` NSO SHA-256:
  `494c35e74dae893615980134f8be7673779f8d4b9eb9601e0f1b130d5ee1870e`.
- Optional private Ring `prologue.zip`, original `main.spr`, `icon.spr`, TEX,
  MSBT, other SD modules and existing playable 54-hoop experiments are not
  included in this Git repository.
- The user provided a new private Drive reference folder for game resources;
  use it if originals are missing, and never upload game assets to public Git.

## Correct Stage 68 native route

- **StageFactory 67 is NOT Hoop 2.** Earlier `0x428fc0` practice notes were
  misattributed; that stage constructor is `0x428d70`, worker `0x428ef0`.
- **StageFactory 68 is Hoop 2.** Allocated at `0x488dc4`, constructor call
  at `0x488de8 -> 0x42bea0`, shared return `0x48a568` returns `x22` object.
- Stage68's worker is `0x42c0c0`. Its object-local byte `Stage+0x2c94` is
  checked at `0x42c190..0x42c198`; one path leads toward `0x42ed80`
  (preliminary worker), the other to `0x42c2ac` (normal route).
- That byte is also read at `0x42de7c` and `0x42e4a4`; **do not zero it** as a
  practice-skip trick. Global predicate `0x139020` affects other game logic;
  **do not patch it globally** either.
- Original branch emulated in Unicorn: flag `0 -> 0x42c2ac`,
  `1 -> 0x42c19c`, `2 -> 0x42c2ac`. This does not validate a scoped skip.
- `source/hoop3_stage68_route_gate.hpp` is an **inactive** host policy:
  exact menu confirmation -> first StageFactory return -> matching Stage68
  object -> consume on conditional branch. Scene cancellation/return lifecycle
  and safe ARM64 hook installation still need verification.
- **20 November, Stage68-wide diagnostic built (not Hoop3-specific):**
  `tools/build_stage68_global_probe.py` checks the unmodified user-owned
  original and can explicitly emit a one-opcode IPS replacing the branch
  at `main+0x42c198` (`0x540008a1` B.NE) with `0x14000045` (B).
  Optional Unicorn evidence: original flags `0,1,2` go to normal,
  preliminary, normal; IPS flags all go to normal `0x42c2ac`.
  **Original Hoop2 would be affected** as well as borrowed Hoop3: this
  does NOT establish an independent skip, scene lifetime, 54 hoops or scores.
  No hardware A/B result yet. The diagnostic kit must be removed after a
  single supervised test; it is NOT a proposed permanent install.
- **20 November, saved native menu identity found:** after `0x1d2eac` launch
  forwarding, `0x1d2ed0 -> 0x4890` copies live Scene world/col/row to manager
  `+0xb98/+0xb9a/+0xb9c`, indexed by menu mode 0/1. `0x1d3430` sets current
  mode at manager `+0x2904`, and `0x1d344c -> 0x48b0` saves native index
  `+0xba0+2*mode`. The manager singleton pointer is `*(main+0xd96058)`.
  There are TWO additional direct coordinate writers: `0x1cf294` and
  `0x1d1614`; restore reader `0x1ce03c -> 0x4860`.
  `tools/audit_hoop3_native_selection_record.py` checks opcodes and exact
  BL callers and executes real ARM64 setter/getter for four cases in Unicorn.
  `source/hoop3_stage68_route_gate.hpp` now requires a matching snapshot
  (mode 0/1, world1/col9/row0, native index41) both before tracking the object
  **and again at the original Stage68 branch**. Any intervening manager
  overwrite rejects and consumes the ticket.
  This *narrows* the async ambiguity, but the manager record may be overwritten
  while loading/returning; no scoped IPS should be installed without live proof.
- **20 November, scoped IPS A/B candidate:**
  `tools/build_stage68_scoped_probe.py` validates the user's SHA-pinned main
  and emits two IPS records only with explicit opt-in: replace the original
  `main+0x42c198` branch with a jump to a 140-byte ARM64 stub placed at
  `main+0xa66bf0`, inside the original text-page alignment gap (next rodata
  starts `0xa67000`). The stub checks live native manager mode 0/1,
  world1/col9/row0 and index41; on mismatch it reproduces the exact original
  branch using Stage68's object-local flag, without modifying that flag.
  It preserves original x9/x16/x17 and SP.
  **33 Unicorn cases PASS**: both Hoop3 modes, Hoop2 original, worlds0/2,
  other row/index, bad modes, null singleton, and flag values 0/1/2.
  Atmosphère's `ldr_process_creation.cpp` loads segments, clears alignment
  padding, then applies IPS and sets execute permission for rounded `.text`:
  https://github.com/Atmosphere-NX/Atmosphere/blob/master/stratosphere/loader/source/ldr_process_creation.cpp
  No hardware result yet. This is a high-risk prototype; disable the old
  `GrooveStage68GlobalProbe` before trying it (same branch).

## Native catalog ownership (newly proven)

- Kind=1 native descriptor table starts `0xd19108`, 48 bytes each.
  Kind=2 begins `0xd1a008`, **exactly 80** kind=1 descriptor entries.
- 80/80 records have unique original prologue resource paths.
- Index `40` = Ring 1, `41` = Ring 2, **`75..79` = Remix 16..20**, not free.
- Do not use index `80+` with the unmodified kind=1 accessor, or replace an
  occupied Remix descriptor. A separate virtual mod identity and catalog
  routing are needed for independent Hoop 3, progress and later new games.
- Optional Unicorn runs the *original* kind1 accessor for 40/41/75/79/80;
  index 80 resolves to the beginning of the kind2 descriptor array, not to
  newly allocated kind1 storage. This is **not** a playable extra entry.

## Groove Extended Catalog v1 (new code, NOT installed)

- `catalog/groove_extended_catalog.v1.json` is the canonical shared metadata
  for Android editor and Switch; entry `groove.hoop_trundling_3` gets **virtual
  index 80**, outside the original 0..79 catalog.
- It explicitly pins world1/col9/row0, original fallback kind1/index41 and
  StageFactory68. Custom title `I_RING_02`, 54-ring target and progress key
  are declarations only; external sprites, music, cues and scene/sequence
  references are null and **not packaged**.
- `tools/generate_extended_catalog.py` validates this manifest and builds
  `source/groove_extended_catalog.hpp` (checked in). It rejects duplicates,
  native index80, invalid paths, mismatched Hoop2 StageFactory and unverified
  installation claims. New slots are supported by the format but must be
  separately verified before enabling on Switch.
- The existing title/intro/Stage68 origin policies now read the generated
  Hoop3 cell/identity; no runtime hooks, playback, save or install is added.

## Other features still pending

- Actual separate Spanish name + instructions (`I_RING_02`), intro/splash 3,
  hard-style new icon, skip practice, 54-ring sequence and separate records.
- Source-only intro-title dispatcher is tested but not installed.
- Runtime code alias/IPS mechanism, instruction cache and coexistence with
  Orochi/Hoop DX/subsdk mods still need physical proof.

## Quick verification

```sh
python3 -m unittest discover -s tools -p 'test_*.py' -q
python3 tools/generate_extended_catalog.py --check
python3 tools/build_stage68_global_probe.py /private/main
python3 tools/audit_hoop3_native_selection_record.py /private/main --unicorn
python3 tools/build_stage68_scoped_probe.py /private/main
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_stage68_route_gate.cpp -o /tmp/hoop3-stage68
/tmp/hoop3-stage68

# Only with your private pinned main and lz4 installed:
python tools/audit_hoop3_catalog_ownership.py /private/main --unicorn
python tools/audit_hoop3_stage68_route.py /private/main --unicorn
```

**Next:** perform one reversible physical Switch A/B of the *scoped* preview,
checking original Hoop2, new (1,9,0), a second world and safe return to menu.
If hardware shows stale coordinates, trace transition/cancellation callbacks.
Do not mistake the earlier Stage68-global diagnostic for Hoop3-only behavior.
No new APK, no game assets in Git, no silently altered original Hoop2.

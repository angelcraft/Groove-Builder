# Hoop3 native sequence callback — verified candidate, NOT installed

20 November 2026. Source-only research against the owner's exact original
`main` (`SHA-256 494c35e7...d5ee1870e`). No proprietary executable or assets
are included here. The original Hoop2 remains unaffected by this research.

## Why this is a useful alternative to an executable-code IPS

The verified original Stage68 normal worker at `main+0x42c660` copies an
already registered callback address from main's **DATA** segment into an
original game-owned worker object. A potential resident subsdk could later
interpose that callback, passing all other Stage68 instances back to their
original sequence without patching text instructions. This is a **candidate**
only: being in the DATA segment does not prove actual Switch page permissions,
runtime exclusivity, cache/barrier behavior, or safe reentrancy.

Pinned findings in the unmodified file:

- Main NSO DATA spans `main+0xcd9000` through `main+0x10a7310`.
- At DATA `main+0xd9c7a0` sits the original callback RVA `0x42ca40`.
- Original AArch64 instructions at `0x42c7a4` (`ADRP`), `0x42c7b4`
  (`LDR x8`), `0x42c7c0` (`STR x8,[x22,#0x288]`), and `0x42c7c4`
  (`BL 0x5153a0`) register that worker callback.
- Two adjacent callbacks in the same worker setup resolve to `0x42e010`
  (`main+0xd9c7a8`) and `0x42df60` (`main+0xd9c7b0`). We **do not**
  interpose them; their setup paths are independently audited for drift.
- The original callback at `main+0x42ca40` receives `x0=Stage68` and
  `x1=original SeqThread`; its 34 native rings, 11 scene-state actions,
  191 waits, and cancellation checks are separately audited.

Run the read-only verifier against the owner's private executable:

```sh
python3 tools/audit_hoop3_sequence_pointer.py /private/main
```

The auditor validates the exact original NSO checksum and AArch64 operand
relationships, and only prints offsets and status. It never modifies `main`.

## Router rules: one virtual level, original game untouched

`source/hoop3_sequence_pointer_plan.hpp` is a no-write static preflight
of Build IDs, data/text bounds, the callback registration opcodes and
the original relocated callback pointers. It rejects a slot another mod
already changed. All physical-approval flags intentionally remain false.

`source/groove_hoop3_sequence_router.hpp` is the host-tested decision layer:

1. An **untracked Stage68** instance (including original Hoop2) calls the
   exact original callback, even when Groove's own wait/ring adapter is absent.
2. Only the Stage68 returned by the *first verified factory transition* can
   execute the Groove replacement; it must have also consumed the matching
   native practice-branch gate and be in `active` phase.
3. A tracked stage observed before authorization, on duplicate worker entry,
   with an unexpected worker pointer, or after a callback error **never calls
   the Hoop2 original sequence**. It is quarantined until verified teardown.
4. After the scene is destroyed **and** its worker is joined, the owner may
   reset; unrelated native stages were never retained or modified.

The router assumes a trusted, **single-thread-serialized** `SessionOwner`,
original callback and adapter lifetime. A future native integration must
provide and prove those conditions. This is not a concurrent-safe hook by
itself; the test environment does not simulate Switch threads or scene
destruction.

## Still missing for a real Switch run

- Prove main DATA permissions and atomic pointer installation/removal under
  Switch, with zero stale live worker objects; avoid overwriting other mods.
- Prove the exact menu confirmation -> StageFactory -> practice branch ->
  worker-entry -> join/scene-destruction correlation on hardware, including
  aborted launches. Do not mutate the shared Stage68 flag.
- Bind the original native worker/wait/stopped/emitter/scene callbacks with
  validated live object lifetime and a permanent (not stack-owned) context.
- Prevalidate and load a `.groove` from SD, skip practice only for Hoop3,
  connect independent progress and safely roll back after failures.
- Run a reversible physical A/B test with normal Hoop2 and Hoop3; no
  installable subsdk or IPS has been produced by this candidate.

Host verification:

```sh
python3 -m unittest discover -s tools -p 'test_audit_hoop3_sequence_pointer.py' -q
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_hoop3_sequence_pointer_plan.cpp -o /tmp/hoop3-pointer-plan
/tmp/hoop3-pointer-plan
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tests/test_groove_hoop3_sequence_router.cpp -o /tmp/hoop3-sequence-router
/tmp/hoop3-sequence-router
```

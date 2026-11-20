# .groove ZIP32 metadata ingest — portable proof, NO live Switch file loader

20 November 2026. The source-only native loader path can now inspect a real
`.groove` ZIP and extract its **three control files** without allocating from
the original game's worker stack. No Nintendo files are distributed, no
module is installed and no game data is changed.

## What is implemented

`source/groove_zip_archive.hpp` is an allocation-free C++17 ZIP32 index and
extractor. A caller supplies `Reader::read_at` with an open file handle,
its exact byte length, plus a static `Index` object (~120 KiB). The index
parses the central directory, checks matching local headers and names,
and refuses these unsafe archive states:

- Invalid ZIP signatures/lengths, ZIP64, multiple disks and comments;
- encrypted entries, data descriptors, symlinks, directories, duplicate
  names, path traversal, non-ASCII filenames and unsupported methods;
- inconsistent local/central CRC, sizes, compression or names, overlapping
  member byte ranges and invalid file offsets;
- more than 512 entries, any member larger than 64 MiB, or more than
  256 MiB in total declared expanded size.

Only STORE (0) and raw DEFLATE (8) are accepted. For DEFLATE, `extract`
requires an **injected** decompressor which must consume exactly all input
and produce exactly the requested uncompressed byte count. This keeps
the core independent of the eventual Switch decompression library. `extract`
validates a CRC32 of every decoded member before it is used.

`tools/verify_hoop3_zip_container.cpp` is a Linux-only test backend:
`std::ifstream` supplies the read-at service, and zlib supplies raw DEFLATE.
It extracts `manifest.json`, `timeline.json`, and `timeline.bin`, verifies
their ZIP CRCs, decodes the GRT1 cache and checks that its timestamps are on
the original game's 480-tick grid.

`source/groove_hoop3_json_preflight.hpp` is the separately introduced,
**Hoop3-only** portable semantic checker. It parses actual UTF-8 JSON with
bounded fixed-size storage; verifies required/unique manifest fields, the
virtual Hoop3 slot, the original native Hoop2 adapter, skip-practice request,
replace mode and independent progress namespace. This initial version
accepts only inherited resources (`null`); custom asset binding is not yet
verified. It checks each `timeline.json` event and its exact GRT1 record,
stable unique IDs, sorted beats on the 480-tick grid, the allowed commands,
and their exact arguments. It fails closed on stale caches even if the ZIP CRC
itself is valid. A static 160 KiB ID hash table avoids gameplay allocations.

## Checked against our actual Hoop3 draft

The owner's privately generated 68-event `HoopTrundling3-54-SCENES-DRAFT.groove`
passed both ZIP and C++ JSON/cache checks: **54 ring events, 11 scene
actions, 3 mask controls** (68 GRT1 records). The ZIP uses DEFLATE and
did **not** require changing its format or rebuilding the pack.

The public four-event synthetic example also passes. Automated host tests
cover deliberately corrupted compressed data, duplicates, path traversal,
symlink entries, unsupported compression, stored entries, invalid
native tick coordinates, stale cache, malicious commands, duplicate event
IDs, asset overrides and spoofed menu identities.

`source/groove_hoop3_archive_loader.hpp` now connects these two stages to
the existing 10,000-event static `SessionOwner`. A successful whole-package
load copies the decoded GRT1 cache into the owner's dedicated arena and
marks the **host simulated** Hoop3 slot ready. It does not retain any
uncompressed ZIP pointers. An invalid reload locks a previously ready slot;
a reload while the owner tracks a native Stage68 scene fails without touching
the active session. Once an externally confirmed joined teardown completes,
the next pack can be loaded. The synthetic C++ host integration test covers
the full state transitions, including playback *after freeing the source ZIP*.

For the proposed filesystem ingress, `source/groove_hoop3_package_file.hpp`
adds a read-only fixed-path RomFS lease and
`source/groove_hoop3_file_gateway.hpp` combines open → ZIP → strict preflight
→ copied owner state. Both are tested with **fake host native callbacks**;
the real Switch SDK functions, permissions and mount timing remain
unverified. An original `main.npdm` audit found no ordinary SD access bit,
so a proposed Atmosphere **LayeredFS** overlay is being investigated instead
of assuming direct `sdmc:`. See [`HOOP3_ROMFS_FILE_PROBE.md`](HOOP3_ROMFS_FILE_PROBE.md).

Build and check an archive on Linux:

```sh
g++ -std=c++17 -Wall -Wextra -Werror -fsanitize=undefined -Isource \
  tools/verify_hoop3_zip_container.cpp -lz -o /tmp/verify-groove-zip
/tmp/verify-groove-zip /private/HoopTrundling3-54-SCENES-DRAFT.groove
python3 -m unittest discover -s tools -p test_groove_zip_container.py -q
```

## What this does NOT prove (critical)

1. **Adapter coverage.** The native-compatible JSON check is now implemented
   for this exact Hoop3 origin, not for arbitrary imported games or asset
   overrides. `groove_pack.py` is the generic host validator; any future
   stage type or resource handler needs a separately audited adapter.
2. **Switch SD/virtual RomFS access.** A portable read-only file lease,
   fixed candidate LayeredFS path, package size cap and gateway are now
   implemented and host-tested. But no real Horizon `nn::fs` functions,
   confirmed original-process mount, concurrency contract or Switch
   A/B is connected. The `Reader`/gateway interfaces do **not** prove
   either `sdmc:` or a LayeredFS file can be read in the running title.
3. **Native playback.** The GRT1 is now copied into `SessionOwner` by a
   complete host-only load function; **no actual native Stage68 callback
   invokes it on Switch**. A future native FS backend must provide a stable
   source handle, establish the complete owner lifecycle and invoke the
   preflight before a real menu launch. Original Stage68 worker
   interposition, menu/practice, scoring and teardown remain uninstalled.
4. **Optional assets.** Resource members are indexed, but no sprite/music
   override is loaded or replaced. The eventual asset adapter must give
   them separate validated lifetimes and decompression budgets.

Next: audit native `nn::fs` imports and FS initialization, then verify a
**read-only LayeredFS virtual-RomFS open** in an explicitly scoped hardware
A/B. Only after successful file ingress bind native DEFLATE and verify the
real Stage68 worker lifecycle and callback interposer; leave the actual
menu slot locked until then.

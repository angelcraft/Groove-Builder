# Groove package contract — draft 0.1 (NOT implemented or frozen)

## Design decisions for review
.groove is a ZIP container, not a new event language. GTF remains the preferred Multi timeline and GTLM/GTL1 retain existing compatibility. The first implementation may validate and extract packages on the host into a staged SD directory; native ZIP support is not assumed. No package is executable until its adapter and capabilities are explicitly supported.

Example layout:
```
manifest.json
timeline.gtf
icon.png          # optional, editor preview only initially
sprites/          # reserved, unsupported initially
audio/            # reserved, unsupported initially
intro/            # reserved, unsupported initially
animations/       # reserved, unsupported initially
mechanics.json    # reserved, unsupported initially
```

Manifest example (synthetic; not a playable release):
```json
{
  "format": "groove-package/1",
  "id": "org.example.demo",
  "version": "1.0.0",
  "title": "Original Demo",
  "engine_min": "0.6.0",
  "adapter": "multi",
  "timeline": { "format": "gtf", "path": "timeline.gtf" },
  "required_capabilities": ["timeline.gtf"],
  "results": "custom"
}
```

- ID is immutable across updates, lowercase ASCII reverse-DNS-like, 3–96 characters; no slash, whitespace or path traversal. Separate display title from identity. Reject duplicates rather than silently overwrite. Version uses three nonnegative integer components.
- adapter initially multi (GTF/GTLM) or hoop (GTL1), subject to validated support. Reject mismatched timeline/adapter or unknown capability. engine_min is a compatibility gate, not a promise of availability.
- Runtime registry owns tile allocation and allowed host mapping. Packages never choose native memory offsets, executable code, save slots or arbitrary hooks. Legacy match/FORCE directives must not bypass package assignment; define exact compatibility policy before native integration.
- Existing native timeline parsers need hardening before accepting third-party inputs; validate cue arguments, animation allowlists, limits and timing. For Multi use 480 ticks per beat. Do not silently reinterpret existing GTF/GTL.
- Custom stats keyed by stable ID under a dedicated save directory, not tile or native host. Native results disabled for package mode until independent results are proven. Preserve previous valid save on write failure.
- Initial proposed host limits: max 32 MiB compressed archive, 64 MiB total decompressed, 256 files, 16 KiB manifest, timeline <= 60 KiB (existing runtime read limit); enforce before/during extraction. Native loader may impose smaller reviewed limits. Reject encrypted entries, symlinks, duplicate/case-colliding paths, absolute paths, traversal, unexpected executable files, nested archives and unsupported required features. UTF-8 manifest with unique keys; bounded JSON depth; fail closed. Never extract into game ROMFS directly.
- Unknown optional assets may be retained by editor but are not executed or loaded by an unsupported runtime. Fallback only to a compatible native resource when the adapter explicitly supports it; do not pretend arbitrary asset replacement works.
- Export deterministic paths/order and include package SHA-256 in release/report. A hash checks integrity, not trust.
- Registry scan and install must be transactional with rollback. Proposed SD path sd:/groove/levels/<id>/ (validated extracted directory); keep legacy stages paths intact. ZIP direct-load is a future decision.

## Open decisions
Native adapter ABI, real menu capacity, manifest schema formalization, asset formats, scoring UI, exact resource override behavior, limits after benchmarking, signature/build compatibility policy. Review with Codex/Gemini/Grok before freezing. No source changes are authorized by this draft alone.

## Acceptance
Valid synthetic package round trip; malformed archive/manifest/timeline rejection; duplicate ID and unsupported feature rejection; legacy level regression; independent stats; physical Switch evidence before playable release claims.

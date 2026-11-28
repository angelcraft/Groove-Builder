"""Limits from GE-154 Draft 0.2 + Draft 0.3 V0 decisions (preserving Draft 0.1) and the GE-151 runtime contract.

Do not edit independently: these mirror docs/GROOVE_PROFILE_DRAFT_02.md on
coordination/v0.6.0 @ 7a5fe22 and tools/engine_contract.json / tools/gtf.py on
codex/engine-v0.5.1-hardening @ 9b56aab (vendored, see vendor/PIN.json).
"""
MAX_ARCHIVE_BYTES = 32 * 1024 * 1024        # compressed .groove
MAX_TOTAL_EXPANDED = 64 * 1024 * 1024       # sum of declared and actual sizes
MAX_ENTRIES_AUTHORING = 256
RUNTIME_ENTRIES = 2                         # exactly manifest.json + one timeline
MAX_MANIFEST_BYTES = 16 * 1024
MAX_TIMELINE_BYTES = 60 * 1024              # 61440, same as native read limit
MIN_TIMELINE_BYTES = 1
MAX_NAME_BYTES = 255
MAX_JSON_DEPTH = 16
MAX_EOCD_COMMENT = 0                        # canonical exporters write none
TITLE_MAX_BYTES = 95
ID_MIN, ID_MAX = 3, 96

# Engine compatibility (installer side). Contract v1 only.
SUPPORTED_CONTRACTS = (1,)
# Full game build id (Draft 0.3 / GE-154 decision B): 40 uppercase hex chars, not a module hash.
KNOWN_BUILD_IDS = ("03FF4A3BEC96BDE3A2E37CE3AA4CAA0CAE8935A8",)
MAX_ENGINE_JSON = 4 * 1024
MAX_SLOTS_JSON = 64 * 1024
MAX_JOURNAL_JSON = 4 * 1024
MIN_PACKAGE_ENGINE = (0, 6, 0)              # first engine that is meant to read sd:/groove/levels/

# Registry
INITIAL_SLOTS = 2
MIN_SLOTS = 2
MAX_GENERATION = 0x7FFFFFFF
MAX_SLOTS = 256

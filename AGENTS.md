# Groove Engine — shared agent protocol

Read ROADMAP.md, TASKS.md, CONTINUE_HERE.md and docs/GROOVE_SPEC.md on coordination/v0.6.0 before starting. This is a coordination branch, not a release. The common runtime baseline is work/groove-engine-v0.5.0 at 61873906f016d46ac1d47d7a5016ec6e3fe93fa9; PR #3 remains draft.

## Rules
- Identify your task ID and inspect its GitHub issue/PR and branch before writing. If already claimed, do not duplicate it. Comment on the task when starting; include your agent and actual base SHA. Claiming is cooperative, not an atomic lock.
- Create a dedicated branch from the latest mutually agreed baseline (or continue your existing task branch). Never force push, overwrite another agent's branch or merge main. Cross-task changes require coordination first. Never assume other agents' changes have been merged.
- Keep the runtime and editor contracts versioned. GTF/GTL remain the timeline formats. Do not invent incompatible grammar.
- Report actual results, exact commands, commit SHA, changed files, limitations, and next steps. Separate static review, host tests, ARM64 build, emulation and physical Switch tests.
- Open a draft PR for review against the agreed integration base; mention task ID and dependencies. Keep reports on your own branch, not a shared mutable file.
- No proprietary game main, ROMFS, audio, sprites, extracted resources, private logs, credentials or personal data in the public repo. Do not upload compiled subsdk or IPS here. Use original/synthetic fixtures.
- Preserve HT2, Remix 8, original saves, Orochi and HoopDX compatibility. Reject unknown builds and invalid inputs safely. Backups and rollback before hardware experiments.
- If blocked, record exact blocker and alternative. Do not fabricate results or make silent changes to scope.

ChatGPT coordinates and reviews on request. Codex, Grok, Gemini and Cursor are separate services; this repo does not start their sessions or grant access automatically.

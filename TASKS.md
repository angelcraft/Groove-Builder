# Task registry — initial assignments

Status as of initial publication: proposed/ready, not evidence that an agent is currently working. Update through task PRs or GitHub issue comments, not concurrent edits here.

| Task | Owner | Suggested branch | Scope | Dependency / acceptance |
|---|---|---|---|---|
| GE-151 | Codex | codex/engine-v0.5.1-hardening | engine/, native parsers, CI, existing tools | PR #3 checklist; regression and differential tests; ARM64 build; no public binaries |
| GE-152 | Grok | grok/dynamic-stage-research | reports/GE-152/ | Research menu/selection/save ABI; evidence and safe prototype design; no runtime modifications |
| GE-153 | Gemini | gemini/visual-editor | editor/ | Browser editor GTF/GTL import/export, audio clock/BPM, cue catalog and validation; synthetic tests; contract review before .groove exporter |
| GE-154 | ChatGPT | coordination/v0.6.0 | docs/GROOVE_SPEC.md, coordination docs | Review package contract and integration; resolve cross-agent dependencies |
| GE-155 | Cursor (optional) | cursor/groove-package-validator | tools/groove_package.py, tests/package/ | Host validator and fixtures after contract approval; do not edit engine or editor; coordinate with Codex |
| GE-156 | User | none | hardware validation | Candidate build, backup and rollback, test HT3/Double Hell/Multi, verify original records and submit redacted logs |

## Workflow
1. Read AGENTS.md and this registry from the coordination branch.
2. Check active branches/PRs; report task ID, ownership and starting SHA in an issue comment or PR.
3. Work independently. Use report template in reports/TEMPLATE.md.
4. Open draft PR and list tests, dependencies and blockers. Do not mark complete solely on code generation.
5. Coordinator reviews and explicitly chooses integration order. No automatic merge.

Package integration is blocked until GE-154 contract review and relevant GE-151 safety work. Editor prototyping and menu research can proceed independently.

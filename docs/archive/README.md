# Archived documentation

The files in this directory are **superseded** historical reports. They are
preserved for traceability but should not be used as authoritative
references.

## What lives here

| File | Was authoritative for | Superseded by |
|---|---|---|
| `PRODUCTION_READINESS_MASTER.md` | Pre-stabilization full audit + phased hardening roadmap (Phases 1–5) | `../../PLATFORM.md` § 3 + § 4 |
| `FINAL_RUNTIME_STATE.md` | May 2026 hardening pass changelog | `../../PLATFORM.md` + `git log` |

## Why archive instead of delete

- They contain phase-specific findings that are useful for understanding
  *why* the codebase is shaped the way it is today.
- The git history shows exact commit-by-commit deltas; these documents
  describe the *intent* behind those commits.
- Some downstream references (in `OBSERVABILITY_SETUP.md`,
  `OPERATIONS_RUNBOOK.md`) cite specific phase numbers from the master
  report. Archiving rather than deleting keeps those citations valid.

## Use the current authoritative document instead

For platform state, production readiness, roadmap, security posture,
scaling, maintenance — see [`/PLATFORM.md`](../../PLATFORM.md).

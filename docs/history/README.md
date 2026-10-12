# docs/history/ — the HISTORICAL bucket (R122 docs reorg, 2026-10-07 · extended R135, 2026-10-12)

> Paths under this directory were **moved here from the `docs/` root (and
> repo root) on 2026-10-07 by the R122-D1 docs reorganization** — `git mv`
> (history preserved), content unchanged except the one-line ARCHIVED
> banner at the top of each file. **The R135 docs sweep (2026-10-12)
> extended the bucket the same way** with the executed post-R122 inspection
> rounds (r124–r130 + r134, 129 files) and the R116–R126 slice of the round
> ledger — same `git mv` + banner discipline. One posture change, on
> purpose: unlike R122, the R135 sweep **repointed the live-surface
> citations** (CHANGELOG rounds R127+, the progress log, the runbook, the
> READMEs, PERFORMANCE, OPERATOR_ACTIONS) at their new homes, while
> archived files keep their dated in-report citations as records of what
> they observed at audit time. Dated ledger entries that cite pre-move
> paths are otherwise intentionally NOT retro-edited — this stub is the
> move map.

## Move map (old → new)

| Was | Now |
|---|---|
| `docs/inspection-r94/` `r96/` `r97/` `r98/` `r111/` `r117/` `r118/` | `docs/history/inspection-*/` (44 files, round evidence — all rounds ≤R121 are evidence now) |
| `docs/inspection-r124/` `r125/` `r126/` `r127/` `r128/` `r129/` `r130/` `r134/` | `docs/history/inspection-*/` (129 files — 90 md + 39 jpg; the executed post-R122 rounds, archived R135 after the R122 policy: executed rounds are HISTORY) |
| `CHANGELOG.md` §R116–R126 (round entries + the mission-waves/merge records inside that span) | `docs/history/CHANGELOG-rounds-r116-r126.md` (cut verbatim R135 — the front door keeps R127+ and the pre-R116 compact summary; inspection citations inside re-based to this bucket) |
| `docs/round-9{2..8}-*.md`, `docs/r1{10,11,16,17}-*-report*.md` | `docs/history/…` (14 round reports + repair plans) |
| `docs/deep-audit-2026-09-06.md` · `strongest-round-2026-09-06.md` · `db-audit-2026-09-07.md` · `final-audit-2026-09-20.md` · `free-tier-optimization-2026-09-20.md` · `subnation-ux-world-class-plan-2026-09-06.md` | `docs/history/…` (6 dated audits/plans) |
| `docs/ux-audit-{storefront,admin,icons}.md` | `docs/history/…` (3 UX audits) |
| `docs/catalog/` (final-report + gap-analysis, 2026-09-20) | `docs/history/catalog/` |
| `docs/seo-enrichment-r116.md` | `docs/history/…` |
| `docs/deployment/RENDER_LEGACY_FALLBACK.md` | `docs/history/…` |
| `docs/project-state/wave-345-audit.md` | `docs/history/…` |
| `PLATFORM.md` (repo root) | `docs/history/PLATFORM.md` (snapshot 2026-09-02) |
| `PROJECT_OVERVIEW.md` (repo root) | `docs/history/PROJECT_OVERVIEW.md` (snapshot 2026-08-25, Arabic) |

Companion buckets: `docs/deprecated/` (migration-era guides + the executed
`project-plan/00–09` set) and `docs/pending/` (the Embronic adapter design).
The current index is [`docs/README.md`](../README.md); current live state:
[`docs/project-state/source-of-truth.md`](../project-state/source-of-truth.md).

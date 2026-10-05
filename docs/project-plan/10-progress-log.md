# 10 — Progress Log

Append-only. One entry per verified unit of work. Times +02 (VPS local).

## 2026-10-05

- **~19:50** Mission start. Wave 0 reconstruction.
- **20:0x** Located repo `/home/rh2011/Projects/SubNation2`; SSH to VPS verified; Coolify v4.3.23
  inventoried; two app containers identified (subnation image-pull-based; openwa sha-ba6a843).
- **20:1x** Reality probes: live healthz ok / summary degraded (pre-R117 code); Google login 503
  (Firebase unconfigured); Telegram live via DB config; OpenWA `/api/sessions` = `[]`;
  `openwa_sessions` table empty; Neon counts (45 products/6 units/7 orders/17 users/3 pending topups).
- **20:2x** Discovered GitHub main 4 commits ahead (R117 by parallel agent); local repo synced to
  `ef3d0c3`; superseded local drift (duplicate 0015 + dep bumps) discarded, backup kept outside repo;
  broken `github` remote URL fixed (embedded empty password → clean URL + stored PAT).
- **20:3x** Gate suite at `ef3d0c3`: lint 0 err/89 warn; typecheck green; backend 1517 tests and
  frontend 751 tests — all pass individually; ~7 tests flaky ONLY under full parallel load (timing);
  build exit 0. Flakiness logged for Wave 8 deflake.
- **20:4x** Wave 0 artifacts written: `docs/project-graph/00–12`, `docs/project-state/
  source-of-truth.md`, `docs/project-plan/00–10`. Live frontend bundle verified: all VITE_*
  build args empty (GA/Firebase/GSC/Sentry off — matches env matrix "optional, unset").
- **20:5x** WAVE 1 started: Coolify app 2 snapshot → API token mint → deploy key registration →
  reconfigure to Git-source dockerfile build (details in following entries).

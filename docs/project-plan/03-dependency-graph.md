# 03 — Dependency Graph

```
WAVE 0 (reality, graphs, SoT, plans) ── DONE
   └─→ WAVE 1 (Coolify build authority + deploy ef3d0c3 + live SHA)
         ├─→ WAVE 2 (WhatsApp operational completion)
         ├─→ WAVE 3 (provider architecture cleanup)
         │     ├─→ WAVE 4 (admin simplification)
         │     └─→ WAVE 6 (Embronic adapter preparation)   [external gate: API docs + creds]
         ├─→ WAVE 5 (Google/Firebase/tracking audit)        [partial external gate: creds]
         ├─→ WAVE 7 (security passes)
         └─→ WAVE 8 (browser QA) ── needs WAVE 2 for admin-whatsapp flows
               └─→ WAVE 9 (performance — measured only)
                     └─→ WAVE 10 (final verification + report) ── needs all
```

Cross-cutting: every wave ends with gates (lint/typecheck/tests/build), a wave commit, push to
GitHub main, deploy + live verification when runtime changed, and progress-log update.

Hard rules encoded in the graph:
- Wave 8 admin flows need Wave 2's verified WhatsApp control plane.
- Wave 4 removals need Wave 3's clarified provider boundary (else we'd delete capability we need).
- Wave 9 optimization needs Wave 8's measurement baseline (no speculative tuning).
- Wave 6 stops at the boundary gate: mocks + contract tests + mapping model; zero invented
  endpoints; resume on credential delivery.

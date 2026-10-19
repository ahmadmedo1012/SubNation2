# R171 — Round close: the deployment-mechanism discovery + the dispatch-sequencing law

**Date:** 2026-10-19 · **Head before:** `1f88dbab` (R170 close) · **Class:** operational documentation round (docs-only)
**Scope:** the R170 closing session's dispatches exposed two operational facts this round records and turns into law: the GHCR image push **is a production deployment event**, and the two heavy dispatches must **never run concurrently**. The round also adjudicates CI run #548's failures (none product) and records production's move to release `1f88dba`.

## 1. Trigger — the concurrent dispatches and a red verification run

The R170 close (pushed `3f2e83b1` + `1f88dbab`) dispatched, per its §4 plan, `ci.yml`
and `docker.yml` on the new head back-to-back. Three runs landed on `1f88dbab`:

| Run | Event | Result | Note |
|---|---|---|---|
| #547 | push | **success** — all standard jobs | the round's badge |
| #6 Docker | dispatch | **success** — image pushed | tags: `main-amd64`, `sha-1f88dba-amd64` |
| #548 | dispatch | **failure** — e2e 4 failed + 2 flaky; backend 1 timeout | the concurrent-orchestration casualty |

The push badge was green on the same SHA the dispatch run failed on — the exact
scheduled-gate blind-spot class R170 had just documented, this time self-inflicted.

## 2. Diagnosis — the redeploy window

### 2.1 The timeline (all UTC, 2026-10-19)

| Time | Event |
|---|---|
| 12:19 | probe: production serving release `9afaed2` (entry `index-BjivLNd7.js`) |
| 12:25 | push `1f88dbab` → CI #547 starts |
| 12:26 | both dispatches fire; docker #6 build starts; e2e in #548 starts |
| 12:28:38 | docker #6 completes — `main`-family + `sha-1f88dba` tags land in GHCR |
| **12:30:45–12:33:07** | **the 6 e2e anomalies: 4 tests fail all 3 attempts, 2 flaky** — all timeout-class ("element not found" on the price locator), all in **[tablet-768]** |
| 12:35 | #547 (push) and #548 (dispatch) complete |
| 12:44 | probe: production serving release **`1f88dba`** (entry `index-ChUtH_Mr.js`); local re-run of the authed spec tablet-768: **11/11 green (48.3s)** |

The GHCR `main`-tag push was followed within minutes by an **automatic production
redeploy** (the watcher is owner-side, outside repo view — the mechanism is
inferred; the correlation is empirical, and it repeated: docker run #5 on
`9afaed2b` at 04:59 preceded production's move to `9afaed2`). The e2e failures
were the tests whose three attempts fell inside the container-restart window:
navigation completes, the SPA renders, the product API never answers in time,
the price element never appears, 20 s expect timeouts fire.

Why every anomaly sat in **tablet-768**: it is the **last** of the three
Playwright projects, so its authed-spec portion ran exactly inside the window;
the two earlier projects (`desktop-chromium`, `mobile-390`) finished before the
redeploy began. The failures were *sequenced* by run order, not caused by the
viewport.

### 2.2 The backend failure — R153-class, unrelated

`2fa-verify-setup-lockout.test.ts` "a successful verify RESETS the counter"
timed out at 5 000 ms in #548. The same file was green in #547 (same SHA,
minutes earlier) and green locally on re-run (4/4, 426 ms of test time).
Runner slowness under the concurrent double-run; the documented R153 pattern.
No diagnosis beyond a green re-run is warranted.

### 2.3 What was NOT wrong

No product code, no e2e spec, and no production behavior was defective: the
full suite had been 144/144 green against production hours earlier (R170
record), the four failing tests pass 11/11 locally against the redeployed
production, and the sequenced re-dispatch (#549, below) is green end-to-end.
R170's own fixes (the screenshot-path deletion, the T3 anchor, the gitleaks
allowlist) all verified runner-side in both #548 and #549.

## 3. The law (the operational fix)

**Dispatch sequencing** (source-of-truth #17): `docker.yml` on `main` pushes
the `main`-family GHCR tags, which triggers the production auto-redeploy — it
is a **deployment action**, not a neutral artifact build. Therefore:

1. **Order**: push → verify (push run or `ci.yml` dispatch, incl. e2e) → **only
   then** `docker.yml`. The R169 dispatch discipline (#15(f)) is refined: the
   image dispatch rides *after* the round's verification is green.
2. **Never concurrent**: no `docker.yml` dispatch while any live-target run
   (`ci.yml` e2e) is in flight — a multi-minute restart window defeats even
   `retries: 2`.
3. **Rollback assets are unaffected**: the runbook's `sha-<short>` tags remain
   the manual path; the `main`-tag push is what carries the redeploy.

No code changed this round — the fix is the law above plus this record.

## 4. Verification record

| Gate | Result |
|---|---|
| CI #549 — sequenced re-dispatch on `1f88dbab` | **success, all 9 jobs** — e2e **144/144 in 3.2 m** (zero failed, zero flaky; twice as fast as #548's window-slowed run), backend + frontend + build + drift + gitleaks full-history green |
| local authed spec, [tablet-768], vs production | **11/11 green (48.3 s)** — includes the exact four tests #548 failed |
| local backend re-run | 4/4 green (426 ms) — the #548 timeout flake non-reproducing (R153) |
| production probe (read-only) on release `1f88dba` | healthz 200; entry `index-ChUtH_Mr.js`; `analytics-events-mbUZ-uHg.js` carries `subnation_ga4_sent` + all 7 ecommerce event names; exactly 1× `G-RKRV3ZC3MF` |
| GHCR assets | docker #6 log: `ghcr.io/ahmadmedo1012/subnation2:main-amd64` + `:sha-1f88dba-amd64` pushed |

## 5. Production state after this round

Production now serves release **`1f88dba`** (Sentry release id updated — an
observability win: the R170 head's marker is live; runtime code is identical
to `9afaed2` since R170 touched no production code, and the probe markers —
GA4 chunk, gtag count, healthz — are unchanged). The redeploy was triggered by
the dispatch sequence above; recorded here as the first **fully-correlated**
deployment-mechanism observation (run #5 → `9afaed2`, run #6 → `1f88dba`, both
2026-10-19).

## 6. Honesty notes

The #548 e2e failures were **self-inflicted** — by this closing session's own
concurrent-dispatch plan (the very plan the pushed R170 §4 records). The run
stands failed on the record; #549 is the clean verdict, and the sequencing law
is the correction. The deployment-mechanism claim is labeled inferred where it
is inferred: the watcher itself is owner-side and outside repo view; what the
repo can see — timestamps, tags, bundle identities — is recorded in §2.1.

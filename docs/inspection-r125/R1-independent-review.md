# R125-R1 — Independent Adversarial Review (Round R125)

- **Reviewer:** R125-R1 (independent adversarial review)
- **Base:** `main @ 09857fc` + uncommitted working tree (95 modified, 24 untracked paths; +4,551/−1,443)
- **Date:** 2026-10-09
- **Method constraint honored:** no files modified by the review (this report + one worklog entry only); 3 targeted single-file vitest runs (within the ≤3 budget); no full suites/builds; no commits.

## Method

1. Read the worklog tail (R125 entries: A1–A12, I4, I8) + all 12 audit reports in `docs/inspection-r125/` (A1–A12 present, 1,913 total lines).
2. `git status` / `git diff HEAD` per risk file, full context reads of every mutation-adjacent hunk (topups.tsx 13/13 hunks, pricing.tsx, pricing-config.ts, coupons.ts, admin/{users,tickets,risk,products}.ts, auth.ts, settings.tsx, dashboard.tsx).
3. Targeted greps for concurrent-lane artifact classes: duplicate imports (module-level + specifier-level), `console.log`/`debugger`/`XXX`/`FIXME` additions, stale cross-references, half-applied edits, R125-comment-vs-code mismatches.
4. Byte-level verification of suspect syntax via `od -c` (see Cleared #11 — a suspected corrupted deps array was a **tool-output rendering artifact**, not a file defect).
5. Three targeted vitest runs (topups money ×2 files, pricing-console, settings-2fa-re-enroll) — 25/25 tests pass.
6. Contract verification of rewritten e2e assertions against the live backend source (`products.ts:558`, `auth.ts:211`).

## Findings

No P0/P1/P2 findings. Four P3s (none block correctness; #1–#2 are push hygiene).

### F1 (P3) — Stale cross-lane comments: “I6’s socket-emit gap” is closed by the final tree, 3 frontend comments claim it isn’t

- **Evidence:** `frontend/src/pages/admin/users.tsx:686-689` (“The backend emits `admin-stats-update` only for orders-bulk/topups (I6’s socket-emit gap)”), `frontend/src/pages/admin/tickets.tsx:126-128` (same claim), `frontend/src/pages/admin/risk-event.tsx:118-122` (“risk writes have no emit yet (I6’s gap)”). The final tree ADDS five emits in this very round: `backend/src/routes/admin/tickets.ts:251-260` + `:287-297` (ticket-reply, ticket-status-update), `backend/src/routes/admin/users.ts:408-418` (user-update), `backend/src/routes/admin/risk.ts:350-360` + `:433-442` (risk-label, risk-bulk-label).
- **Why it matters:** this is the exact “comment says X, code does Y” artifact class round R125 hunts — I4 wrote the comments truthfully at its write time, then I6 landed the emits later in the same tree; the comments now misstate shipped reality in a repo with a strict comment-truth discipline. Zero behavior impact (the frontend invalidations remain correct as belt-and-suspenders alongside the socket push).
- **Fix (3 one-liners, optional but recommended):** reword each to “the backend emits `admin-stats-update` for these writes since R125-I6; this frontend invalidation is the belt-and-suspenders half (covers the no-socket path)”.

### F2 (P3) — `frontend/test-results/` is untracked AND un-gitignored (Playwright output junk)

- **Evidence:** `git status --porcelain` → `?? frontend/test-results/`; contents: `.last-run.json` (45 bytes, mtime Oct 9 05:10); `.gitignore:139` ignores only `.playwright-cli/`.
- **Why it matters:** a `git add -A` round commit would ship a runtime artifact file.
- **Fix:** `rm -rf frontend/test-results/` (or append `test-results/` to `.gitignore`) before the round commit.

### F3 (P3) — Worklog gap confirmed: I1/I2/I3/I5/I6/I7 entries are MISSING

- **Evidence:** `grep -n "^Task ID: R125-I" worklog.md` → only `R125-I4` (line 1345) and `R125-I8` (line 1366). Yet the tree carries their work under those IDs: topups.tsx `R125-I2`, pricing.tsx/system.tsx/products.tsx `R125-I3`, users/risk/tickets FE `R125-I4`, settings.tsx `R125-I5`, all five BE emits + pageParam/lift changes `R125-I6`, storefront sweep `R125-I7`.
- **Why it matters:** six implementation lanes shipped code with no process record; the parent’s plan to append consolidated entries before commit is REQUIRED for the round’s audit trail.
- **Fix:** parent appends consolidated I1/I2/I3/I5/I6/I7 entries before the commit (already planned; this review confirms the gap is real, not partial).

### F4 (P3, observation — no action) — Partial ink-token adoption is a documented residual, not a regression

- **Evidence:** `text-yellow-400` survivors at alerts.tsx:67, referrals.tsx:69/170/189/480/497, system.tsx:186/997/1102/1202 while dashboard/topups/orders got `--status-warning`/`--status-*` this round.
- **Why it matters:** looks like “two fix styles colliding,” but the A6/A7 audit reports and the I4/I7 worklog entries explicitly scope these as not-in-mandate residuals for future rounds. Behavior-neutral (color tokens only).
- **Fix:** none this round; the residuals are already ledgered in A7-storefront-followup §B.

**Scope note (not a finding):** the review brief listed a “products” admin-stats emit; `backend/src/routes/admin/products.ts`’s diff is SEO-projection-only (no emit) — the five real emits are tickets ×2, users ×1, risk ×2, all pattern-equal to the orders idiom.

## Challenged-and-cleared — the 10 riskiest hunks I tried to break

| # | Hunk | Attack attempted | Result |
|---|------|------------------|--------|
| 1 | topups.tsx memoization (551 lines) | Byte-diffed every mutation-adjacent line: single approve/reject bodies inside `useCallback` are character-identical (same confirm payload, same `generateIdempotencyKey()` per click, same `.mutate` vars); bulk loop untouched (hunks never reach it); `isRejecting`/`isProcessing`/`allPendingSelected` rewrites are algebraically equivalent to the old expressions; hooks hoisted above `!adminToken` return correctly (rules of hooks). Ran `topups-approve-confirm` + `topups-approve-all`: **9/9 pass** | CLEARED — display-only |
| 2 | pricing.tsx `mutate`→`mutateAsync` seq-guard | Removed hook-level `onError` — checked the try/catch fully replaces it: fresh errors toast + `setResult(null)`, stale successes AND stale errors both dropped (`seq !== calcSeqRef.current` guard on both paths); mock upgraded to dual-shape with body capture intact. Ran `pricing-console`: **8/8 pass** | CLEARED |
| 3 | pricing.tsx `fmt()` toFixed→Intl grouping | All 20 call sites are display-only JSX/template strings; zero parse-back consumers (`parseFloat`/`Number(fmt(` greps: 0 hits); en-US grouping matches `formatCurrency`; negative/zero semantics unchanged; formatter cache keyed by decimals is sound | CLEARED — grouping only |
| 4 | pricing-config.ts recompute TRANSACTION wrap | Per-row loop byte-preserved (`db`→`tx` only, incl. the products MIN() refresh); audit + `bumpCatalogCache` correctly POST-commit; Express 5 (`backend/package.json:28`) forwards the tx rejection to the global error middleware (`app.ts:1655`) → 500, no unhandled rejection; new test injects REAL pglite triggers (no mocks) and asserts old prices survive + zero audit rows in BOTH failure positions (mid-loop, post-loop) — not a tautology | CLEARED |
| 5 | coupons.ts `roundLyd` swap | The delta vs `+toFixed(2)` is confined to the half-cent dust zone (roundLyd’s 1e-9 epsilon), and the swap direction is preview→checkout alignment: the charge path already rounds through `roundLyd` (`lib/pricing.ts:316,326,327`), so `POST /coupons/validate` now previews what checkout actually charges | CLEARED — consistency fix, documented in-code |
| 6 | admin-stats emits (tickets/users/risk ×5) | Byte-shape equal to `orders.ts:702-705`: dynamic `import("../../lib/socket")`, `emitToAdmins("admin-stats-update", {...})`, `.catch(logger.warn("socket admin-stats notify failed"))`; all fire-and-forget POST-mutation; the users emit sits after the no-change 400 return and after `AdjustmentService` commit (mutation path itself untouched — scoped idempotency key preserved at users.ts:337-369) | CLEARED |
| 7 | auth.ts + settings.tsx 2FA re-enroll | Backend gate PRE-EXISTED (auth.ts diff is comment-only): `wasEnabled` branch 400s on missing/empty/non-string password, `checkLockout`→429, `verifyPassword`→401+`recordFailedAttempt`, `resetAttempts` on success — all BEFORE `generateSecret()`; fresh branch stays bodyless-optional; new BE tests pin empty-string + non-string 400s with row-untouched; FE test pins the rotate POST body + zero bodyless calls + bodyless fresh path. Ran `settings-2fa-re-enroll`: **8/8 pass** | CLEARED |
| 8 | strictFunctionTypes flip + 4 fixes | `lazyWithRetry<T extends ComponentType<any>>`: `T` still infers concretely from the factory’s default export (constraint-only widening — JSX call sites keep full prop checking; App.tsx consumers are prop-less route pages); `isolate<T extends (...args:any[])=>any>`: returns `T`, call sites keep their types (heartbeat.ts consumer checked); `settings.tsx` qrcode `err: Error \| null \| undefined` is the CORRECT param widening, not an any; `buildApp(...routers: Router[])` replaces a weaker structural type with the real one | CLEARED — no hidden caller errors |
| 9 | dashboard.tsx ChartPickers extraction + `refetch()` removal | Non-empty path: same GRANULARITY_OPTIONS/PERIOD_OPTIONS loops, same labels/classes/export handler (plus aria-pressed/aria-label additions); empty state adds pickers WITHOUT export (correct — nothing to export); zero stale refs (`refetch` survivors are the separate recent-orders query; recharts survives only as type-only import that erases); `refetch()` removal kills a genuine double-fire (invalidateQueries refetches active queries); chart race guard = abort + seq-guarded writes + guarded finally + unmount cleanup, and the new test pins last-call-wins with manually deferred responses (the parent’s date-fixture fix makes weekly bucketing real: valid UTC dates, ~13 buckets) | CLEARED |
| 10 | Test-honesty rewrites (7 sites) | loyalty `findByRole("alert")`→`findByText(/رصيد النقاط غير كاف/)`: the page toast is MOCKED OUT (`useToast`→`toastSpy`, test:47-48), so the regex can only match the persistent banner — no broader-toast rubbergreen possible; the 409 case got STRICTER (specific message); topups selector regex pins the NEW more-specific label (old was the generic it replaced); a4-nesting pin removal is honest — the CTA is genuinely deleted and `highlight` has 0 consumers in products.tsx; terms SVG pin asserts `lucide-chevron-left` present + `rotate-180` absent (fresh pin on new behavior); settings-2fa `setupResponse` reset in beforeEach fixes real test-order coupling, documented in-file; e2e api-contracts rewrites verified against the shipped backend: `available_products` (products.ts:558) and `{providers: [...]}` (auth.ts:211) — the spec was drifting, not the code | CLEARED — equal-or-stronger in all 7 |
| 11 | (bonus) settings.tsx suspected syntax corruption | `grep`/`sed` displayed `}, eaders]);` at settings.tsx:428/725 (looks like a mangled `[headers]` deps array) — `od -c` hexdump proves the bytes are `}, [headers]);` at BOTH sites; the `[h` was being eaten by tool-output rendering. No file defect | CLEARED — tooling artifact |
| 12 | (bonus) in-flight lane errors | The I4-reported in-flight breakage (alerts.tsx FILTERS redeclare, dashboard recharts imports) is resolved: exactly 1 `const FILTERS` in alerts.tsx; dashboard imports recharts only as type-only + the dynamic `import("recharts")` | CLEARED |

## Required before push

| # | Item | Owner | Evidence |
|---|------|-------|----------|
| 1 | Append consolidated worklog entries for lanes I1/I2/I3/I5/I6/I7 (only I4 + I8 exist) | parent (planned) | worklog grep: 2 of 8 I-entries present while tree code carries all lane IDs |
| 2 | Delete `frontend/test-results/` (or gitignore `test-results/`) so it cannot enter the commit | parent | `?? frontend/test-results/`, `.gitignore` has no matching entry |
| 3 | (Recommended, 3 one-liners) Truth-up the stale “I6 socket-emit gap” comments: users.tsx:686-689, tickets.tsx:126-128, risk-event.tsx:118-122 | parent | F1 above |
| 4 | (Confirmation) Ensure `docs/inspection-r125/` (currently untracked `??`) is included in the round commit — F35/I8 executed on that assumption | parent | `git status --porcelain` |

## Verdict

**SHIP** — contingent on the four push-hygiene items above (1 and 2 are hard requirements; 3 is a 3-line truth-up the repo’s comment discipline argues for; 4 is a confirmation).

Money safety: verified intact at every mutation boundary I attacked (single/bulk approve+reject, Idempotency-Key lifecycle, wallet adjust route, coupon validate rounding, recompute atomicity). Auth security: the 2FA rotate gate verifies password with lockout before minting, fresh enrollment stays bodyless, and both properties are pinned by tests that assert DB-row invariance. The strictFunctionTypes flip hides no caller errors. The concurrent-lane artifact sweep found no duplicate imports, no debug leftovers, no half-applied edits — only the F1 comment staleness and the F2 junk dir. Test rewrites are equal-or-stronger throughout, with the two rubbergreen suspects (loyalty regex, e2e key rename) disproven against mocked toasts and the real backend contract respectively.

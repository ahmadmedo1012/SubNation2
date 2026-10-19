# R173 — Round close: the final comprehensive inspection, purification & perfection sweep

**Date:** 2026-10-20 · **Head before:** `9a9e8068` (R172 close) · **Class:** final verification + supply-chain purification round
**Scope:** the owner directive «اعمل جولة اخيرة شاملة من الفحص والتشخيص والمحاكاة والتحسين والتطوير وتنظيم وتطهير المستودع وكل الاكواد والفحص مجددا للوصول للمثالية من كل النواحي» — the final comprehensive round of inspection, diagnosis, simulation, improvement, development, organization, and purification of the repository and all code, re-checked toward perfection from every aspect.

The state this round inherited was already the R172 close: majors shipped (zod 4, pino 10, redis 6, recharts 3, web-vitals 6, PWA 2, lucide 1), lint 0/0, and a documented-accept audit floor of 10 full-chain findings. This round's job was not to repeat that work but to (1) re-verify every gate from scratch on the inherited head, (2) push the audit floor to its mathematical minimum, (3) take the aged-in in-range bumps the R172 policy deliberately left waiting, and (4) sweep the repo for every remaining impurity — file modes, artifact dirs, dead markers, broken doc links, stale CI state.

## 1. The re-verification baseline (everything, from scratch, on `9a9e8068`)

| Gate | Result (pre-change baseline) |
|---|---|
| typecheck | clean ×4 (libs, backend, frontend, scripts) |
| lint | **0 errors / 0 warnings** |
| backend suite | **288 files / 2,677 green** (8 chunks) |
| frontend suite | **297 files / 2,762 green** (2 chunks) |
| scripts suite | 6 files / 59 green |
| build | green — eager **148,984 B gz** (budget 150 KiB warn / 160 KiB fail) |
| parity gates | openapi **87 ops** / error-codes **50** / header-params **7/7** |
| drift gates | drizzle: zero diff · orval: zero diff |
| audit | prod **0** · full **10** (the R172 documented-accept floor) |
| CI on head | run 39292620989 (push, `9a9e8068`) **success**; uptime schedule green |
| production (read-only) | healthz 200 · entry `index-mcKmZcso.js` carries **SENTRY_RELEASE `9a9e806`** (production on the latest head) · GA4 id exactly 1× in the entry bundle |

Baseline confirmed: local == origin == production. Every number matches the R172 close exactly — nothing regressed in the interim.

## 2. The supply-chain purification lane (`audit 10 → 4`)

### 2.1 The diagnosis

All ten R172-era findings lived in exactly two dev-only chains — `@lhci/cli` (the local validate-suite Lighthouse runner) and `@sentry/vite-plugin>unplugin>chokidar 3` — with three distinct fates:

| Finding | Advisory class | Fate |
|---|---|---|
| tmp ≤0.2.3 / <0.2.6 (1 HIGH + 1 LOW) | path traversal + symlink write | **fixable** — 0.2.x patch line |
| basic-ftp ≤6.2.0 (1 HIGH) | quadratic-time ReDoS in `Client.list()` | **fixable** — 6.2.1 patch |
| uuid <11.1.1 (1 MODERATE) | v3/v5/v6 buffer bounds (API lhci never calls) | **fixable** — 11.1.1 patch |
| extract-zip ≤2.0.1 (2 HIGH) | symlink path traversal ×2 | **no patched release exists** (`<0.0.0`) |
| braces ≤3.0.3 (1 HIGH) | stack-exhaustion DoS | **no patched release exists** |
| sprintf-js ≤1.1.3 (1 MODERATE) | unbounded format DoS | **no patched release exists** (dead package, 1.1.3 is final) |

### 2.2 The floors (three new overrides, hand-edited per the house rule)

- **`tmp: 0.2.7`** — the pre-0.2 resolutions (0.1.0 / 0.0.33) jumped to the 0.2.x patch line. First attempt pinned 0.2.6, which re-audit revealed sits inside a *third* advisory's `>=0.2.6 <0.2.7` range — the floor is 0.2.7. The `fileSync`/`file` API external-editor calls is stable across the line.
- **`basic-ftp: 6.2.1`** — crosses the 5→6 line, verified safe: get-uri 7 itself resolves basic-ftp 6, and the Client API (`access`/`list`) is unchanged in 6.x.
- **`uuid: 11.1.1`** — `@lhci/cli` is the tree's only uuid consumer (verified against the lockfile — the old google-gax note is stale; google-gax no longer resolves uuid). lhci's exact usage `const uuid = require('uuid'); uuid.v4()` is v11-CJS-compatible (checked in `node-runner.js:11`); the vulnerable v3/v5/v6-with-buf API is never called.

### 2.3 The simulation proof (the overrides verified, not assumed)

`pnpm exec lhci --version` → `0.15.1` (dep graph loads), then a **real 1-run `lhci collect` against production** (`https://subnation.ly`, performance category, local Chrome-for-Testing 155) → **exit 0** — the collect exercised the exact chains the overrides touched (uuid in the node runner, proxy-agent/basic-ftp at import, tmp in the collect flow). Read-only by design; the tool validate.ts already runs against production.

### 2.4 The new floor — and why it is the mathematical minimum

```
full audit: 10 findings (2 low | 2 moderate | 6 high)  →  4 findings (1 moderate | 3 high)
prod audit: 0 (unchanged)
```

Every one of the four remaining findings — extract-zip ×2, braces, sprintf-js — has **no patched release in existence** (`patched: <0.0.0` or a final dead version). No override, no bump, and no dependency removal short of dropping Lighthouse CI entirely can close them; they stay documented-accept in the dev chain that never enters the Docker runtime image (`--prod --filter` prunes root devDeps) and never runs on CI.

## 3. The aged-in in-range bumps (`pg`, `argon2`)

The R172 sweep closed with `motion 14.4.0` left to age (published < 24 h, `minimumReleaseAge 1440` honored). This round's aged-in re-check found six in-range candidates — **four published 2026-10-19 (under 24 h, policy-blocked, left to age again)**: motion 14.4.0, @tanstack/react-query 5.104.5, typescript-eslint 8.72.0, impeccable 4.7.0. The two aged candidates shipped:

- **`pg ^8.20.0 → ^8.23.1`** (both holders: `@workspace/db` + `@workspace/scripts`, hand-edited together; published 2026-09-30). The runtime DB driver's three-minor maintenance line; drizzle's peer context and pg-pool re-resolved on it cleanly.
- **`scripts/argon2 ^0.44.0 → ^0.45.1`** — an alignment, not a bump: backend was already on 0.45.1 while scripts lagged on 0.44.0; the tree now carries one instance. (R169's plan listed argon2 0.45.1; backend took it then, scripts didn't.)

Also examined and deliberately not taken: `@types/node` 25.3.5 → 25.9.9 (in-range types refresh, zero functional gain, pure typecheck churn — the pinned 25.3.5 is green across all four typechecks). The R172 refused table (TypeScript 7, vite 8, vitest 5, @sentry 11, firebase 13, jsdom 30 / jest-dom 7 / playwright 1.64, prom-client → @prometheus-io/client, the react/tsx single-instance pins) was re-verified against the current `pnpm outdated` output — every refusal's rationale still holds verbatim.

## 4. The purification & organization sweeps

- **1,881 file-mode flips normalized** — the session's workspace reset restored every tracked file as 0755 (a 0-content-diff noise storm over the whole tree). All restored to the index's 0644; the 8 legitimately-executable `scripts/*.sh` kept 0755. `git status` clean before any work began.
- **`scripts/.lighthouseci/` removed** — an empty artifact dir from a no-`--outputDir` lhci invocation; validate.ts itself uses mkdtemp, so nothing references it.
- **TODO/FIXME/HACK census: 0 real** — a broad grep shows 12 hits; all are `XXXX` phone-digit placeholders (`091XXXXXXX` Libyan formats) and `\uXXXX` escape documentation, none are work markers.
- **console.log census: all legitimate** — 46 hits: CLI tooling stdout (scripts/src seed/backup/import/dev/start + risk-rules seed) and the documented Sentry boot banner (`backend/src/lib/sentry.ts:443`). Zero stray debug logs in app code.
- **Doc-link integrity: 158/158** — every relative `.md/.ts/.tsx/.json/.yaml/.sh/.sql` link across the docs tree resolves to a real file.
- **Security headers reviewed** — helmet v8 config (CSP with the GA4/Firebase origins, Permissions-Policy default-deny, COOP same-origin-allow-popups for the Firebase popup, HSTS) re-read: complete and correct, nothing to add.
- **CI state verified via API** — head run 39292620989 green; the uptime schedule green; the R172 failure (39281315849) stands on the record as documented.

## 5. The verification record (post-change, on the round's tree)

| Gate | Result |
|---|---|
| `pnpm install` | **exit 0 — real exit code, no pipe-tail** (the R172 §3.2 law) |
| `pnpm install --frozen-lockfile` | **exit 0** (lockfile/manifest agree — the R172 false-green class re-checked) |
| typecheck | clean ×4 |
| lint | **0 errors / 0 warnings** |
| backend suite | **288 files / 2,677 green** (8 chunks — exact baseline count) |
| frontend suite | **297 files / 2,762 green** (2 chunks — exact baseline count) |
| scripts suite | 6 files / 59 green |
| build | green — eager **148,984 B gz** (byte-identical to the R172 baseline; the bumps touch no frontend code) |
| parity gates | openapi 87 ops / error-codes 50 / header-params 7/7 |
| drift gates | drizzle zero-diff · orval zero-diff |
| audit | prod **0** · full **4** (the new floor, §2.4) |
| impeccable source gate | exit 0 (clean) |
| lhci collect (1 run, production) | exit 0 |
| diff shape | exactly 4 files: `pnpm-workspace.yaml` (+30), `pnpm-lock.yaml`, `scripts/package.json`, `shared/db/package.json` — zero source-code changes |

CI + deployment verification (the R171 sequencing law — push verified first, docker dispatched only after, e2e after the redeploy settles) is recorded in §6.

## 6. Deployment record (the sequencing law held)

| Step | Record |
|---|---|
| Push (this round) | CI run on the new head — recorded below at close time |
| `ci.yml` dispatch (post-deploy e2e) | run recorded below at close time |
| `docker.yml` dispatch | only after the above verified green — recorded below |
| Production settle + probe | healthz · entry · SENTRY_RELEASE · GA4 1× — recorded below |

## 7. Honesty notes

- The four remaining full-audit findings are **unclosable today** — each advisory's patched range is empty (`<0.0.0`) or the version is the package's final release. The floor is at the ecosystem's mercy, not ours.
- The 0.2.6 → 0.2.7 tmp correction was found by **re-auditing after the first override** — the first floor was itself inside a newer advisory's range. The lesson (audit after every floor, not once) is now part of this record.
- Four in-range bumps were **refused because of the age policy**, not because they are bad: motion 14.4.0, react-query 5.104.5, typescript-eslint 8.72.0, impeccable 4.7.0 all published 2026-10-19, inside the 1440-minute window. `minimumReleaseAge` is not bypassed for convenience; they age in for a future round.
- `@types/node` 25.9.9 exists in-range and was deliberately skipped — types churn with zero functional gain is not perfection, it is motion for its own sake.
- The 24 R162 catalog mechanical corrections + 12 business decisions remain **owner-side actions** (admin-UI, unchanged from R168–R172).

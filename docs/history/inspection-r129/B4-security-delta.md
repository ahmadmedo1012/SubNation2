> **ARCHIVED (2026-10-12, R135 docs sweep).** Moved from `docs/inspection-r129/B4-security-delta.md`; dated historical record — content unchanged except cross-round `docs/inspection-*/` citations repointed to their `docs/history/` homes, not current state (see ../README.md for the current index).

# R129-B4 — Security Re-Verification of the R128 Delta

- **Agent:** R129-B4 (adversarial security, round 129)
- **Repo:** `SubNation2` @ `main` = `76017f4` (read-only; only this report + one worklog append)
- **Scope — the R128 delta** (`7d469d5..76017f4`, 5 commits, 178 files): (1) share-card OG seo-field interpolation, (2) `formatLyd`/`formatLydNumber`, (3) `/assets` 404 guard + `redirect:false`, (4) the shared `csvCell` + users-CSV export, (5) notifications `?page=` pagination (+ the new notifications page), (6) CopilotPanel `ProgressTraceLine` render swap, (7) login account-intent banner, (8) brand assets (manifest/favicon/offline-reveal/CSP), (9) workbox `sourcemap:false` + guard root sweep.
- **Read first, not re-reported:** R128-B3 (docs/history/inspection-r128/B3-security-redteam.md — 2 P3 + 3 P4). §10 below records the delta's *disposition* of every one of them (four of five were fixed by this very delta — verified with line cites, not re-reported as open).
- **Method:** full reads of every target file at HEAD + `git diff 7d469d5..76017f4` per surface (to separate delta from pre-existing), regex/URL-parser reasoning walked per payload, test-suite evidence where the delta shipped pins. No network probes, no builds, no source writes (read-only mandate).
- **Verdict:** **0 P0 · 0 P1 · 0 P2 · 2 P4 (both informational/hardening, no action required before push).** Every walked attack on the new surface terminates in a code-level block. The delta *closed* the two R128-B3 P3s (CSV formula injection, statement_timeout telemetry) rather than opening new risk.

---

## 1. Findings (P4 only — nothing above)

### B4-D1 [P4 — informational, doc-truth nit] The CSV `'`-prefix is hidden by Google Sheets but *displayed* by Excel's CSV import — the csv.ts header comment overstates the cosmetic outcome

**File:line:** `frontend/src/lib/csv.ts:18-20` (the claim), `:33-39` (the behavior)

The formula guard is the correct OWASP mitigation and **works**: a cell `"'+218913456789"` does not evaluate as a formula in Excel, Google Sheets, or LibreOffice (the leading apostrophe is not a formula trigger; the payload renders as inert text — pinned by `frontend/src/lib/__tests__/csv.test.ts:42-51`). But the comment's claim *"it does not display in the cell"* is true only for Sheets (which consumes `'` as a text-affordance marker on import) and for *typed* Excel input. Excel's **CSV import** keeps the apostrophe as a literal character — an incident responder opening the users export in Excel sees `'+218913456789` rather than `+218913456789`. Zero security impact (evaluation is prevented in every engine — that is the whole point of the guard); the inaccuracy is only in the explanatory comment, so a future maintainer doesn't over-promise when copy-pasting the rationale. **Conclusion: not exploitable — formula injection is blocked by the `'` prefix at csv.ts:35-37; the note is a one-word comment correction ("Sheets hides it; Excel shows it as literal text"), no code change needed.**

### B4-D2 [P4 — hardening nicety, no bypass today] The sourcemap-guard root sweep is case-sensitive and non-recursive — `.MAP` or a nested-directory map would evade it

**File:line:** `frontend/vite.config.ts:595-606` (`sweptDirs = [assets, distRoot]`, `readdirSync` non-recursive, `f.endsWith(".map")`)

The backstop sweep deletes only files ending in lowercase `.map` in the top level of `dist/public/assets` and `dist/public`. Two theoretical evasions: (a) a `.MAP` extension (endsWith is case-sensitive); (b) a map in a *subdirectory* (e.g. `dist/public/products/foo.js.map`, reachable if a stray `.map` ever landed under `frontend/public/`). **Walked to conclusion:** every map emitter in the toolchain (Vite/Rollup, esbuild, workbox-build, the Sentry plugin) writes lowercase `.map`, and `rg --files -g '*.map' -g '!node_modules'` over the repo returns **zero** files — `frontend/public/` carries none, so no public-subdirectory map deploys today. The guard is a regression backstop on a trusted build machine, not an attacker-facing gate; the *primary* defense (`workbox.sourcemap: false` at vite.config.ts:893, which stops the SW maps from being emitted at all) is unconditional and pinned inside the workbox block by `pwa-offline-shell.test.ts` ("R128-IMP-4 (B5-F1)" suite, verbatim `sourcemap: false,` index > `workbox: {` index). **Conclusion: not exploitable today — blocked by toolchain convention + zero existing maps; if the sweep is ever touched again, `distRoot + '/**'` glob with a case-insensitive extension check would close both evasions in one line.**

---

## 2. Surface-by-surface analysis (all attacks walked to a conclusion)

### S1 — Share-card OG HTML with operator SEO fields (`backend/src/app.ts:1627-1716`)

**The escaper.** `escapeHtmlAttr` (app.ts:1052-1059) replaces, in order: `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `"`→`&quot;`. It does **not** escape `'`. The delta (`git diff 7d469d5..76017f4 -- backend/src/app.ts`) swapped `${esc(product.name)} — SubNation` for `${esc(cardTitle)}` (:1694, :1697, :1702) and `${esc(desc)}` (:1698, :1703), where `cardTitle = clampSeoTitleForShell(seoTitle ?? …)` (:1683-1685) and `desc = buildShareDescription(seoDescription ?? product.description, displayPrice)` (:1689).

**Attack 1 — attribute breakout via `seo_title = `"><script>fetch('//evil')(` ` (products-scope admin plants it; the card renders for any UA claiming an unfurler token).** Every one of the card's interpolations is either a **text** context (`<title>…</title>` :1694; the `<a>` anchor text :1705) or a **double-quoted attribute** (`content="${esc(…)}"` at :1697-1703, `href="${esc(canonical)}"` :1705). Walk:

- `<title>` (RCDATA): the leading `"` is inert text; `<script>` → `&lt;script&gt;` — no tag can open; `</title>`-breakout needs a literal `<`, which is escaped. **Inert.**
- `content="${esc(cardTitle)}"`: the payload's leading `"` becomes `&quot;` — the attribute value cannot be exited (the only quote characters in the produced attribute delimiters are the template's own two `"`); `<script>` is entity-encoded inside the value. **Inert.**
- The unescaped `'` (single quote) is present in the payload and passes esc() — but **no single-quoted attribute exists anywhere in the card template** (:1690-1706 — verified by reading the literal), so there is no context in which `'` is a delimiter. **Inert by context.**

**Conclusion 1: blocked — by esc() at app.ts:1053-1059 plus the double-quote-only attribute grammar of the card template; every render path (`title`, `og:title`, `og:description`, `og:image`, `og:url`, `twitter:title`, `twitter:description`, body anchor) is escaped with the same `esc` binding (:1658). Not exploitable.**

**Attack 2 — href/URL injection via the canonical or og:image.** `canonical = `${origin}/product/${slugOrId}`` (:1660) — `origin` is `APP_URL || https://subnation.ly` with trailing-slash strip (:1048-1050, not request-derived); `slugOrId = decodeURIComponent(match[1])` where the route regex `^\/product\/([^/]+)\/?$` (:1632) bars any literal `/` in the segment — so a protocol-relative `//evil.com` or a `javascript:` scheme cannot be formed (the prefix is always `https://subnation.ly/product/`), and the whole string is esc()'d into the only href (:1705). Percent-decoded `%22` (`"`) is escaped by esc() the same as a raw quote. `ogImage` (:1669-1673) passes through esc() too; even an operator-pointed external image URL is inert in a `<meta>` content attribute (never an executable context). **Conclusion 2: blocked — URL construction at :1659-1673 + esc() at :1700/:1705; no scheme or origin control for any requester.**

**Attack 3 — slicing splitting an escape.** `buildShareDescription` (:1084-1091) and `clampSeoTitleForShell` (:1100-1102) slice the **raw** string *before* esc() is applied at render — slicing can only remove characters, never mint `&`/`<`/`"`; escape-after-slice cannot reconstitute a metacharacter. **Blocked by ordering.**

**Attack 4 — UA collision: can a *browser* get the card instead of the SPA?** The predicate (app.ts:1877-1881) is **unchanged by the delta** (verified in the range diff — the R128 changes touch only the card's *content*, not `isUnfurlerUserAgent`/`isIndexerUserAgent`). Tokens are unfurler-signature substrings (`facebookexternalhit`, `whatsapp`, `telegrambot`, …) that no stock browser UA carries — pinned against real Chrome-Android/Safari/Firefox UAs (`share-card-bot-split.test.ts:227-232`), with the Googlebot-smartphone trap case pinned to the SPA (:269-273). The theoretical residual is an in-app webview that *appends* a token (historically, WhatsApp's pre-Custom-Tabs webview): such a user would get the static card — which contains **the same public, escaped product data** the SPA renders, no JS, no session surface — a UX degradation, not a security boundary. A deliberate UA forger gets the same public bytes. **Conclusion 4: no browser collision in practice; deliberate spoofing exposes only already-public catalog data; the R122 A3-P1 cache bounds the DB cost of spoofed-UA bursts.**

**Belt note:** the same seo fields were *already* rendered pre-R128 on the plain-UA shell path (`resolveSpaShellMeta` :1503-1508 → `applySpaShellMeta` → `escapeHtmlAttr` at :1338/:1347/:1396) — the delta equalized the unfurler surface to the existing one; no new field reached a sink.

### S2 — `formatLyd` / `formatLydNumber` (`backend/src/lib/money.ts:47-61`) — new in the delta

**Locale risk.** One module-level `Intl.NumberFormat("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2})` (:47-50) with a **hard-coded locale** — no `undefined`-locale lookup, no host dependence. en-US grouping/decimal separators are U+002C/U+002E **plain comma/period** — NBSP (U+00A0) or narrow-NBSP separators belong to fr/ru/families and cannot appear. Pinned by tests: `"1,000.00"`, `"1,380.00"`, `"1,000,000.00"`, `"-1,380.00"` (`backend/src/lib/__tests__/money.test.ts:100-121`) — a U+00A0 in any of those strings would fail the byte-exact match. **Conclusion: no locale-dependent output risk.**

**Call-site trace (all R128-new sites):**
1. `app.ts:1075` — `shareDisplayPrice`: `Number(listPrice)` NaN-guarded (:1069-1070, returns the raw string on non-finite — so a hypothetical pre-formatted `"1,380.00"` input passes through unchanged, never double-formatted); normal path formats the numeric exactly once. The result rides `buildShareDescription` → `desc` → **`esc(desc)` at app.ts:1698** — the «— السعر X د.ل» price line is escaped with everything else; the comma is not a metachar. **Blocked.**
2. `telegram.ts:190/223/236/261` — inputs are typed `number` fields fed from DB numerics via `Number`/`parseFloat` (e.g. `wallet.ts:619-626` `storedAmount = Number(topup.amount)`); single formatting; the output ("1,380.00 د.ل") contains no `&<>` so Telegram's HTML parse_mode is safe even unescaped — and every genuinely stringy field (phone, productName, code, paymentReference) is separately `escapeHtml`'d (:188, :197, :260, :262).
3. `topup.service.ts:607/622/684` — `formatLyd(WELCOME_BONUS_LYD)` (a constant) and `formatLyd(parseFloat(String(topup.amount)))` (DB numeric → number → one format). These strings are **notification titles** — rendered as React children by the bell and the new notifications page; no HTML sink exists for them.

**Conclusion: verified-OK.** Observation (not a finding): `formatLyd` has no NaN guard (the frontend's `formatCurrency` does — `frontend/src/lib/utils.ts:23`), so `formatLyd(NaN)` would render «NaN د.ل» — unreachable at every current call site (all typed/guarded), display-only even if reached.

### S3 — `/assets` 404 guard + `redirect:false` (`backend/src/app.ts:1542-1554` mount, `:1718-1735` guard) — new in the delta

**Information disclosure.** The guard's entire response is `res.status(404).type("text").send("Not Found")` (:1732-1734) — a constant string; **no path reflection, no filesystem path, no stack**. Compare: the express default final 404 (reachable only for non-GET/HEAD methods, pre-existing, outside this delta) does echo the method+path — unchanged by R128 and escaped by Express. **Conclusion: no leak.**

**Fall-through reachability with `redirect:false`.** `serve-static` only answers files it finds; with `redirect:false` on the `/assets` mount (:1552) the bare-`/assets` directory probe gets **no 301** and falls through both static mounts (the root mount has `index:false` + `redirect:false` :1571/:1581) into the fallback middleware, where the guard owns it. Pinned through the real app composition by the delta's own suite: real file → 200 (mount not shadowed), missing hashed asset → 404 `text/plain` `Not Found`, bare `/assets` → 404, non-asset unknown path → SPA shell 200 (`backend/src/__tests__/spa-static-assets-404.test.ts:104-129`, `redirect: "manual"` harness). **Not an open redirect (no redirect is ever issued on these paths), not a directory listing (serve-static never lists; `index:false` on the root mount).**

**HEAD parity.** The guard's method gate admits GET and HEAD (:1719); `res.send()` on a HEAD request emits headers (Content-Type/Length) with no body — standard Express behavior, same 404 verdict for both verbs. ✓

**Exact-prefix analysis.** `req.path === "/assets" || req.path.startsWith("/assets/")` (:1732) — the slash is required, so `/assetsfoo`, `/asset`, `/ASSETS/x` are **not** caught (they take the ordinary unknown-path SPA branch, exactly as pre-R128). No legitimate route lives under `/assets/` (SPA inventory: `/`, `/products`, `/product/:slug`, `/category/:slug`, `/cart`, `/checkout`, `/orders`, `/order/:code`, `/wallet`, `/loyalty`, `/referrals`, `/notifications`, `/support`, `/terms`, `/flash-sales`, `/login`, `/register`, `/onboarding`, `/auth`, `/profile`, `/status`, `/admin/*`), and the guard runs **after** both static mounts so real hashed files are never shadowed (pinned :105-109). `sw.js`/`registerSW.js`/`manifest.json` live at the dist **root**, outside the prefix — untouched. The R128 `/products` client alias (`App.tsx:574-580`, a fixed `navigate("/", {replace:true})` — no user input) is likewise outside the prefix. **Conclusion: the guard is exact, inert for non-assets, and closes the soft-200-stale-link/scanner-probe class it was built for.**

### S4 — CSV export: `csvCell` + the users export (`frontend/src/lib/csv.ts`, `users.tsx:796-831`, `security.tsx:326-408`)

This surface *is* the R128 landing of **R128-B3's B3-F2 (P3)** — see §10. Adversarial re-check of the new helper:

- **Formula guard:** leading `=`, `+`, `-`, `@`, tab, CR → `'` prefix (csv.ts:25, :35-37) — the OWASP idiom; `=WEBSERVICE`, `=HYPERLINK`, `=cmd|' /C calc'!A0`, `=1+1`, `+SUM`, `+218…`, `-2+3+cmd…`, `@SUM`, `\t=cmd`, `\r=cmd` all pinned neutralized (`csv.test.ts:28-51`), including the quote-interaction case `="a""b"` (:70) — the doubled-quote escaping composes with the prefix instead of shifting columns.
- **RFC 4180:** whole-cell double-quoting with embedded quotes doubled (:38) — grouped currency strings ("1,234.50 د.ل") can no longer shift columns (pinned :58 + `users-csv-export.test.tsx:31-51`).
- **User-controlled fields into the users export:** `u.phone` only (users.tsx:807) — the sole user-authored cell; `+`-phones are the canonical trigger case and are guarded (:43). No usernames/emails flow into this export (columns: phone, formatted balance, tier label, points, formatted spend, order count, formatted date). The security-tab arms carry the richer fields (admin-planted `actorUsername`, webhook `metadata`, user `identifier`) — all through the shared `csvCell` (security.tsx:367, :401).
- **No new endpoint:** the export is client-side over `sorted` — the accumulated `useInfiniteQuery` pages of the pre-existing `/api/admin/users` (users.tsx:444-475, 806); the button sits inside the same users-scope admin page (users.tsx:880-889). Zero new server surface; nothing an unauthenticated client can reach.
- **Conclusion: verified-OK** (B3-F2 resolved — §10); the one residual is cosmetic B4-D1 (Excel shows the `'` literal).

### S5 — Notifications `?page=` pagination (`backend/src/routes/notifications.ts:38-93`) — new in the delta

- **Auth/ownership:** every route mounts `requireUser` (:38, :95, :104); both the bell and paged queries pin `WHERE user_id = req.userId` from the verified JWT (:56, :74, :81). `?page=`/`?limit=`/`?page` manipulation cannot cross users — the params feed only ORDER BY/LIMIT/OFFSET, never the WHERE. Ownership of the action routes is pinned live-by-test (foreign `:id` → 404 with the row untouched, `notifications.test.ts:346-368`; stranger rows never in the list, :105-107).
- **Clamps:** `pageParam` (http.ts:71-75) — `parseInt` garbage/NaN → `|| 1`, floor 1, **ceiling MAX_PAGE = 10 000**; `limitParam` (http.ts:49-52) — NaN → default 20, clamped `[1, 100]` (route passes DEFAULT_PAGE_LIMIT=20 / MAX_PAGE_LIMIT=100, notifications.ts:21-22, 65-66). `?page=999999` → page 10 000 → offset ≤ 10 000 × 100 − 100 < 1M — and the underlying scan is bounded by the **caller's own** row count (the userId filter caps the scan set; Postgres stops at exhaustion) — the exact audit-logs idiom R128-B3 probed live and reported as holding. No unbounded offset, no count-query amplification (one `count(*)` on the same filtered set per request, behind `userLimiter`).
- **NaN / negative / weird shapes:** `?page=abc` → 1, `?page=-5` → 1, `?page=1e2` → 1, `?limit=0` → 1, `?limit=99999` → 100 — pinned (`notifications.test.ts:252-264`). Object params (`?page[a]=1`, extended-qs) — `queryString` (http.ts:23-32) returns the fallback `""` for non-string values → the `=== ""` bell branch (:52) → plain array capped at 40: no crash, no shape confusion (same posture B3 probed green on audit-logs). The opt-in contract (bare `?page=` degenerates to the bell shape) is deliberate and pinned (:172-210).
- **Response shape:** envelope `{notifications, total, page, limit, hasMore}` (:86-92) — `total` is the caller's **own** row count (no global/leaked count), `hasMore` is computed honestly (`offset + rows.length < total`); rows carry only the DTO keys (id/type/title/message/link/is_read/created_at — :26-36), `no-store` at the router level (:12-15).
- **The new frontend page** (`frontend/src/pages/notifications.tsx`): renders titles/messages as React children; `actionHref = n.link ?? cfg.actionHref` (:294) → `navigate(href)` (:193) — `link` values are **server-authored literals only** (`createNotification` callers pass `/orders`, `/wallet`, `/loyalty`, `/support?ticket=…`, `/order/<code>`), and even a hostile value could not redirect: wouter's `navigate` → `history.pushState`, which **throws** on cross-origin URLs. Guest gate threads `encodeURIComponent(pathname+search)` into `/login?redirect=` (:205) — the sanitized-consumer side of S7.
- **Conclusion: verified-OK, no findings.**

### S6 — CopilotPanel `ProgressTraceLine` render swap (`frontend/src/components/admin/copilot/CopilotPanel.tsx:368-397`) — new in the delta

- **Zero `dangerouslySetInnerHTML`** in the file (grep over CopilotPanel.tsx: 0 matches) — the R128-A6 change replaced emoji glyphs with lucide icons at the *render* layer only; the string transport (SSE handler → `appendProgress`/`replaceLastProgress` → persisted localStorage conversations) is untouched (:821-853, persistence :240-242).
- **Every render arm is a React text child:** `{line.slice(2)}` for the `✓ `/`✗ ` arms (:374, :382), `{line.slice(emoji.length).trimStart()}` for the tool-glyph arm (:392), and the fallback renders the **raw string** `{line}` (:396) — as a child of `<div>`, i.e. auto-escaped by React. There is no sink anywhere in the panel where the raw string becomes markup; the markdown-lite renderer for assistant answers (`MarkdownLite` :1659-1716, `InlineMd` :1718-1753) is likewise a tokenizer over React children (`<strong>/<em>/<code>/<pre>` elements), no `innerHTML`.
- **Threat inputs walked:** progress strings are built by `progressFor` (:735-750) from SSE `tool_call_start/done` events — `e.name` mapped through a fixed label table (unknown tool → literal `🔧 ${name}` concat), `e.summary` from tool output — i.e. model/tool-derived and catalog-derived text; the same strings persist to localStorage and re-render identically on reload (:1287). All of it terminates in text children. **Conclusion: not exploitable — React auto-escaping is the single sink class; confirmed by line cites above.**

### S7 — Login account-intent banner (`frontend/src/pages/login.tsx:42-82, 179-214`; `sanitizeInternalPath` `frontend/src/lib/utils.ts:105-115`)

- **The banner renders only derived labels.** Account intent = `accountSurfaceFor(sanitizeInternalPath(params.get("redirect")))` (login.tsx:79) — a lookup into the fixed `ACCOUNT_SURFACES` dictionary (:45-50, keys `/wallet /orders /loyalty /referrals` + the `/order/` prefix family :55-61). The rendered text is `intent.surface.headline` — a compile-time literal (:211). **The raw `?redirect=` value never reaches the DOM** (the only other consumers are `navigate(redirectTarget)` on success :109 — and the register link `encodeURIComponent(redirectTarget)` :156-159/:255-258, both post-sanitize).
- **`sanitizeInternalPath` attack table (each walked):**
  - `javascript:alert(1)` / `data:text/html,…` / `https://evil.com` — no leading `/` → `null` (utils.ts:107).
  - `//evil.com` — `startsWith("//")` → `null` (:107). Pinned live-by-test (`login-account-intent-r128.test.tsx:93-97`: `//evil.com` renders the generic chips, no banner).
  - `/\evil` and `/\/evil` (backslash tricks) — pass the string checks, but WHATWG `new URL(target, origin)` normalizes `\`→`/` under special schemes, promoting them to authority-relative (`https://evil/…`) → `url.origin !== window.location.origin` → `null` (:109-110). **Blocked by the origin check, not just the string check.**
  - `%2F%2Fevil.com` — `URLSearchParams.get` **decodes** percent-encoding, so the value arrives as `//evil.com` → `null` at :107. `/%2F%2Fevil` decodes to `///evil` → also `startsWith("//")` → `null`.
  - Tab/newline padding (`/\t/evil`) — the URL parser strips tabs/newlines → same-origin path → inert SPA target.
  - Output is always `url.pathname + url.search` — an origin-relative string; the sole sink (`navigate`, wouter) is `history.pushState`, which **throws** on cross-origin arguments — no open-redirect even for a future caller.
  - `https://subnation.ly/wallet` (absolute same-origin) is *rejected* (no leading `/`) — conservative, safe direction.
- **Pre-existing buy variant** (`?product=` → `productName`, :73, sliced to 80) does render user-controlled text — inside a template literal as a React child (:194-196), auto-escaped; unchanged by the delta (93-C8 era).
- **Conclusion: verified-OK — every bypass family terminates at utils.ts:107 or :110.**

### S8 — Brand assets + offline reveal + CSP

- **`manifest.json`** (all URL-bearing fields): `id/start_url/scope` = `/`, `url` fields `/` and `/orders`, icon/screenshot `src` all site-relative `/pwa-*.png` — **no absolute or external URL anywhere**, nothing points off-origin. ✓
- **`favicon.svg`** (355 B, decoded byte-level): exactly one `<rect rx="28" fill="#dc1840"/>` and one `<path fill-rule="evenodd" … fill="#fff"/>` under `<svg xmlns=…>` — **pure vector shapes**: no `<script>`, no event handlers, no `href`/`xlink:href`, no `<foreignObject>`, no external references. ✓
- **The 6s offline reveal (R128-IMP-4 / B5-F4) vs CSP:** the reveal is a pure-CSS timer — inline `<style>` block + inline style attributes + `animation: sn-offline-reveal 0.4s ease 6s forwards` (index.html:165-199). The production CSP sets `styleSrc: ["'self'", "'unsafe-inline'"]` (app.ts:201), which authorizes **both** the inline `<style>` element and inline `style` attributes (style-src-attr falls back to style-src) — the reveal fires under CSP as shipped. The `script-src` gate keeps `'unsafe-inline'` **out** in production (app.ts:176-178 — dev only), and the reveal respects it by construction (no inline script; index.html:160-163 documents exactly this ban). The delta only moved the delay 2.5s→6s — a value change inside the already-allowed style block; no CSP interaction changed. ✓ (og:image dims 1200×630 were re-declared to match the regenerated `opengraph.jpg` — metadata accuracy, not a security surface.)
- **Conclusion: verified-OK.**

### S9 — Workbox `sourcemap:false` + guard root sweep (`frontend/vite.config.ts:881-893, 589-620`)

- **Primary fix:** `workbox.sourcemap: false` (:893) — vite-plugin-pwa's inheritance of `build.sourcemap` (which is `"hidden"` on token'd Docker builds, :1105) is severed, so `sw.js.map`/`workbox-*.js.map` are **not emitted at all**. Pinned by the new suite *structurally*: the test asserts the `sourcemap: false,` occurrence's index sits **after** `workbox: {` (a stray same-named line elsewhere in the 1,258-line config can't satisfy it) — `pwa-offline-shell.test.ts` describe "R128-IMP-4 (B5-F1)".
- **Backstop sweep:** `sweptDirs = [dist/public/assets, dist/public]` (:595-596) — the R128 widening to the dist **root** is what covers the SW-artifact location that leaked pre-R128 (live probe in the commit message: `/sw.js.map` 200, 6,484 B; `/workbox-*.js.map` 200, 217,501 B). The R128 gate run recorded "sourcemap guard: 0 .map in dist root+assets".
- **Legitimate files survive:** the sweep deletes only names ending exactly `.map` — `sw.js`, `registerSW.js`, `workbox-*.js`, `manifest.json`, `init.js`, `index.html`, the art files: none ends in `.map`, so **nothing legitimate is deleted by the root sweep** (string-suffix semantics, no wildcard). ✓
- **Bypass analysis (walked in B4-D2):** `.MAP` case-variations and subdirectory maps evade `endsWith(".map")` + non-recursive `readdirSync` — but no tool in the chain emits either shape, and `rg` confirms **zero** `.map` files in the repo outside node_modules (a `frontend/public/products/*.map` would be the one deployable path — none exists). Conclusion: **not bypassable by any current emitter; residual is the P4 hardening note.**
- **Adjacent delta hardening verified:** the SW `navigateFallbackDenylist` gained the root-static regex `/^\/(?:sw\.js|registerSW\.js|workbox-[^/]+\.js|manifest\.json|init\.js)$/` (:1045-1049) so a top-level navigation to `/sw.js` no longer gets the SPA shell from the service worker — semantics pinned by a served/denied matrix in the same test suite (SPA routes incl. `/admin/*` keep the offline shell; the denylist is anchored `^…$` and cannot grow into route space).
- **Conclusion: verified-OK + B4-D2.**

---

## 3. Verified-OK register (the negative results that matter)

| # | Surface | What was attacked | Why it held (file:line) |
|---|---|---|---|
| 1 | OG card esc() | `"><script>` breakout from `seoTitle`/`seoDescription`/`name` | `& < > "` all escaped (app.ts:1053-1059); every context is text or double-quoted attr (:1690-1706); `'` unescaped but no single-quoted attribute exists |
| 2 | OG card URLs | scheme/origin control via `slugOrId`, `imageUrl` | fixed-origin canonical (app.ts:1048-1050, 1660), `[^/]+` segment regex (app.ts:1632), esc() on the only href (:1705) |
| 3 | OG card slicing | slice-reconstituted metachars | raw-slice-then-escape ordering (:1084-1102 → :1694-1703) |
| 4 | Unfurler UA regex | browser getting the card | predicate unchanged by delta; stock-browser UAs pinned false (share-card-bot-split.test.ts:227-232); spoofing yields only public data |
| 5 | formatLyd locale | NBSP/locale-dependent output | hard-coded en-US (money.ts:47-50); byte-exact plain-comma pins (money.test.ts:100-121) |
| 6 | formatLyd call sites | double-formatting / unescaped HTML concat | NaN-guarded passthrough (app.ts:1069-1070); typed-number inputs (telegram.ts:213-215, wallet.ts:619-626); card price rides `esc(desc)` (app.ts:1698) |
| 7 | /assets 404 guard | path/filesystem reflection | constant `Not Found` body (app.ts:1732-1734) |
| 8 | /assets guard scope | catching non-asset routes, shadowing real files | slash-required prefix (:1732); runs after mounts; pinned (spa-static-assets-404.test.ts:105-129) |
| 9 | redirect:false | open redirect / directory listing | serve-static emits neither with redirect:false (app.ts:1552, 1581); fall-through verified by the real-app suite |
| 10 | HEAD parity | GET/HEAD divergence | method gate admits both (app.ts:1719); `res.send` HEAD = headers-only |
| 11 | csvCell | `=`/`+`/`-`/`@`/tab/CR formula triggers, quote-shift | OWASP `'` prefix + RFC-4180 doubling (csv.ts:33-39); payload matrix pinned (csv.test.ts:28-77) |
| 12 | users export | user-controlled cells, new endpoint | only `u.phone` (users.tsx:807) through csvCell; client-side over pre-existing `/api/admin/users` pages (users.tsx:444-475, 806, 823) |
| 13 | notifications `?page=` | cross-user rows via params | `requireUser` + `WHERE user_id=JWT id` on both queries (notifications.ts:38, 56, 74, 81); foreign-id 404 pinned |
| 14 | notifications clamps | `?page=999999` unbounded offset | MAX_PAGE 10 000 × limit ≤ 100 (http.ts:49-52, 69-75); scan bounded by own rows; garbage pinned (notifications.test.ts:252-264) |
| 15 | notifications shape | leaked counts / shape confusion | `total` = own-row count only (:84-92); object params → bell shape via queryString fallback (http.ts:23-32); no-store (:12-15) |
| 16 | notifications page link | hostile `link` navigating off-origin | server-authored literal links only (notify.ts:18-29 callers); wouter navigate → pushState throws cross-origin |
| 17 | CopilotPanel render | raw string as markup from SSE/localStorage | 0 `dangerouslySetInnerHTML` in file; all arms React children (CopilotPanel.tsx:374, 382, 392, 396); MarkdownLite/InlineMd also children-only (:1659-1753) |
| 18 | login banner | raw `?redirect=` rendering | only the dictionary-derived headline renders (login.tsx:79, 211); raw value never reaches DOM |
| 19 | sanitizeInternalPath | `javascript:`/`data:`/`//`/`/\`/`%2F%2F`/`///`/tab-pad | no-leading-slash + `//` reject (utils.ts:107) + origin check (:109-110) covers backslash-normalized and percent-decoded forms; output always origin-relative |
| 20 | manifest.json | off-origin URL fields | all URL fields site-relative (manifest.json:5-7, 17-45, 63-88) |
| 21 | favicon.svg | script/external refs in SVG | pure `<rect>`+`<path>` shapes, no script/href/foreignObject (byte-level decode) |
| 22 | offline reveal vs CSP | inline style blocked / reveal dead | `styleSrc 'unsafe-inline'` (app.ts:201) authorizes the inline block + attrs; script-src keeps prod inline-script ban (app.ts:176-178); reveal is pure CSS (index.html:165-199) |
| 23 | sourcemap guard | deleting legit files (sw.js) | `.map`-suffix-only match (vite.config.ts:601); no legit filename ends `.map`; root-static denylist anchored `^…$` (:1048) |
| 24 | SW navigation fallback | `/sw.js` navigation answered by SPA shell | denylist regex + served/denied matrix pinned (pwa-offline-shell.test.ts, B5-F3 suite) |
| 25 | `/products` alias (adjacent delta) | open redirect / new server surface | fixed client-side `navigate("/", {replace:true})` (App.tsx:574-580); no user input; backend shell contract unchanged |

---

## 4. Priority table

| ID | Sev | One-line | Effort |
|---|---|---|---|
| B4-D1 | P4 (info) | csv.ts comment overstates the `'`-prefix cosmetics (Excel shows the literal apostrophe on import; Sheets hides it) — guard itself is correct | one-word comment tweak, whenever the file is next touched |
| B4-D2 | P4 | Sourcemap sweep is case-sensitive + non-recursive — theoretical `.MAP`/nested-public-dir evasion; zero current emitters, zero existing maps | one line if the guard is ever revisited (`distRoot/**` + case-insensitive ext) |

No P0/P1/P2. Nothing blocks the push/deploy.

---

## 5. Recommended next actions

1. None blocking. Optionally fold B4-D1's comment correction into the next copy/docs commit and B4-D2's glob widening into the next build-config touch — both are one-liners with no behavioral urgency.
2. If a future round adds more unfurler tokens to `isUnfurlerUserAgent`, re-run the S1 context audit (the invariant to preserve: **every card attribute stays double-quoted** — the current esc() does not escape `'`).
3. Consider (nice-to-have, not security) mirroring the frontend `formatCurrency` NaN guard into backend `formatLyd` for display parity — unreachable today.

---

## 6. Verification basis (mine, this lane)

- Full reads at HEAD: `backend/src/app.ts` (share card + static mounts + guard + CSP + shell rewrite), `backend/src/lib/money.ts`, `backend/src/lib/http.ts`, `backend/src/routes/notifications.ts`, `backend/src/notify.ts`, `backend/src/telegram.ts`, `backend/src/lib/csv.ts` (frontend), `frontend/src/pages/admin/users.tsx`, `frontend/src/pages/admin/security.tsx`, `frontend/src/components/admin/copilot/CopilotPanel.tsx`, `frontend/src/pages/login.tsx`, `frontend/src/pages/notifications.tsx`, `frontend/src/lib/utils.ts`, `frontend/index.html`, `frontend/public/manifest.json`, `frontend/public/favicon.svg` (byte-level), `frontend/vite.config.ts` (guard + workbox + denylist), `frontend/src/App.tsx` (alias).
- Test evidence read (not re-run — R128's gate run is fresh and recorded): `spa-static-assets-404.test.ts`, `share-card-bot-split.test.ts` (incl. R128 B8-D1/D3 suites), `notifications.test.ts` (R128-IMP-5 suite), `csv.test.ts`, `users-csv-export.test.tsx`, `money.test.ts`, `login-account-intent-r128.test.tsx`, `pwa-offline-shell.test.ts` (B5-F1/F3/F4 suites), `db-statement-timeout.test.ts`.
- `git diff 7d469d5..76017f4` per touched backend/frontend file to attribute every behavior to delta vs pre-existing; `rg` sweeps: `formatLyd*` call sites (all), `dangerouslySetInnerHTML` in copilot (0), `*.map` outside node_modules (0), notification `link` writers (server literals only).
- No network probes, no builds, no installs, no source modifications (read-only lane; this report + the worklog append are the only writes).

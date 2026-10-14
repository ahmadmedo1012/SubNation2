# GSC Verification R144 — the one operator action that finishes Google Search Console

> Status: CURRENT @ 2026-10-14 (R144-D1, Task 144-D1).
> Scope: the precise OWNER steps to verify `subnation.ly` in Google Search
> Console. This is account-level work (the operator's Google account +
> Coolify panel) — **report-and-stop territory** per `.hermes.md`. The repo
> side is DONE and shipped: the injection mechanism exists, the build arg
> exists, only the token is missing.
> State of record (R144-0 recon, 2026-10-14): the live homepage serves
> `<meta name="google-site-verification" content="" />` — the
> `VITE_GSC_VERIFICATION` build arg is **unset** in Coolify.
> `robots.txt` + `sitemap.xml` are 200 and healthy — verification is the
> only open GSC item (`OPERATIONS_RUNBOOK.md` §14, first pending action
> since R122).
> Reference: https://support.google.com/webmasters/answer/9008080 (Google's
> own verification methods guide).

## 0. Why no repo change is needed (and never invent a token)

The mechanism ships (R96-era, reinforced R143):

- `frontend/index.html:19-23` — the
  `<meta name="google-site-verification" …>` tag is injected at BUILD time
  by the `seoHeadInject` Vite plugin (`frontend/vite.config.ts`). When
  `VITE_GSC_VERIFICATION` is unset the meta is emitted with `content=""` —
  harmless, ignored by Search Console (exactly what the live site serves
  today). When set, the operator's token appears in the served HTML.
- `COOLIFY_FINAL_SETUP.md` §2.2 already lists `VITE_GSC_VERIFICATION=` in
  the build-args panel (the "optional, public-only" block).

The token can ONLY come from **your Google account** (GSC generates it per
property). Never hardcode, guess, or commit one — the repo deliberately
takes it as a build arg, and the value is public-by-design (it appears in
the served HTML; it proves domain ownership, it is not a secret).

## 1. The steps (HTML-tag method — matches the shipped mechanism)

1. **Google Search Console** → https://search.google.com/search-console →
   add a **URL-prefix property** for `https://subnation.ly` (the apex — the
   canonical host everywhere in this repo: sitemap, robots, canonical link,
   www→apex redirect).
2. Choose the **HTML tag** verification method and copy the token — the
   `content` value Google shows (a ~43-char string; NOT the whole tag).
3. **Coolify** → SubNation resource → build-args panel (§2.2 of
   `COOLIFY_FINAL_SETUP.md`) → set:
   ```
   VITE_GSC_VERIFICATION=<paste-the-token>
   ```
   It rides the same panel as `GIT_SHA` / `VITE_APP_ORIGIN` — public,
   non-secret values only (it is one).
4. **Redeploy** the SubNation resource (the meta is baked at build time —
   a plain restart of the old image will NOT pick it up). Watch the deploy
   log finish, then `/api/healthz` go 503→200.
5. **Verify externally** (the tag must be on the LIVE served HTML):
   ```bash
   curl -s https://subnation.ly/ | grep -o 'google-site-verification[^>]*'
   # expect: google-site-verification" content="<your token>"
   # today it prints: google-site-verification" content=""   ← that is the gap this runbook closes
   ```
6. Back in **GSC → Verify**. Google re-fetches the page and the property
   turns Verified. (If it fails on first click: the deploy may still be
   propagating — re-run the curl in step 5, then retry.)

After verification: submit `https://subnation.ly/sitemap.xml` in GSC's
Sitemaps section (it is already 200/healthy) so indexing data starts
accumulating.

## 2. The DNS TXT alternative (if you prefer provider-level verification)

A **Domain property** (covers `subnation.ly` + all subdomains + both http
and https) verifies via a **DNS TXT record** instead of the HTML tag —
added in Cloudflare (the zone is DNS-only grey, so the record is served
verbatim). Same GSC flow, choose "Domain" → copy the `google-site-verification=…`
TXT value → Cloudflare DNS → add TXT record `@` → Verify.

Trade-offs: domain properties give the broadest coverage and survive any
hosting change, but they live in DNS (this repo's records are
operator-owned) instead of the build. Either method satisfies GSC; the
HTML-tag path is documented first because the repo mechanism (§0) is
already built for it — **do not do both for the same property type**;
pick one.

## 3. Rollback / notes

- Removing verification later = delete the token from GSC (or the DNS
  record); leaving the meta tag in place is harmless either way
  (`content=""` was always harmless — `frontend/index.html:19-23`).
- To change/revoke the token: unset or replace `VITE_GSC_VERIFICATION` in
  the build args + redeploy — same flow as step 3–4, no repo commit.
- The weekly uptime watchdog (`.github/workflows/uptime-monitor.yml`,
  `OPERATIONS_RUNBOOK.md` §16) keeps sampling the homepage every 5 minutes
  — if the redeploy breaks the shell, the watchdog pages before GSC's own
  crawler ever notices.

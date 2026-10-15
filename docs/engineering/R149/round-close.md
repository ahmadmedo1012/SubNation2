# R149 — WhatsApp delivery engineering: the retry-contract fix + the transport decision: closing report

Round base: `1d229d6` (R148 close). Method: the repo's standing Ponytail
ruleset (root `AGENTS.md`) with Caveman terse-output discipline applied
manually (no executable middleware in this remote session — same honest
status as R147/R148). Two independent research lanes (worklog 2-a, 3-a)
plus the coordinator implementation lane.

## Priority zero — the "Waiting for this message" root cause, proven and fixed

**Root cause (verified in the locked dependency's own source, not inferred
from issue titles):** `@whiskeysockets/baileys` 6.7.24 calls the app-supplied
`getMessage(key)` at exactly ONE live site — `lib/Socket/messages-recv.js`
`sendMessagesAgain`, reached only when a RECIPIENT device sends a retry
receipt (it could not decrypt; stale Signal session on their side). The
engine then re-relays the ORIGINAL message content to the requesting device
under the SAME message id (the placeholder resolves, no duplicate). Without
`getMessage`, the request is silently dropped at debug level
(`'recv retry request, but message not available'`) and the recipient's
"Waiting for this message. This may take a while." is **permanent**. The
gateway (`ahmadmedo1012/openwa` @ `ba6a843`) configured NEITHER `getMessage`
NOR any outbound message store — `sendMessage` stores nothing by itself
(the library's own source carries a `// todo: implement a cache … (copy
whatsmeow)` comment). Canonical issue: WhiskeySockets/Baileys#1767 (open);
per-issue verdicts recorded in the worklog (#2499/#2704/#1686 are
group/Cloud-API-coexistence cases, not SubNation's 1:1 OTP class; #1701 is
the LID-drift sibling).

**The fix (gateway repo, R149 commit):** the full retry contract —
- every engine-sent message's content is recorded by message id
  (in-memory, per session record so it SURVIVES reconnects; TTL 30 min =
  6× the 5-min OTP validity; FIFO cap 500 = the delivery-log discipline;
  deliberately NO at-rest plaintext OTP archive);
- `getMessage` serves that content on retry receipts (miss → `undefined`,
  the safe explicit result Baileys expects — never a stub);
- `msgRetryCounterCache` moved onto the session record (survives
  reconnects; TTL 1 h matching the library default) so the protocol's
  5-resend bound holds across the whole retry window;
- each retry request is logged `[retry] resend request` with message id +
  masked JID + `served` flag (privacy-preserving diagnostics: operators
  can finally SEE recipient-side decryption problems being healed);
- pairing death clears the store (WA-02 discipline — a re-paired session
  can never re-serve the old pairing's OTP content).

**Tests:** 13 new acceptance cases in `tests/retry-store.test.mjs` (recorded
send retrievable by id with exact content; independent ids; absent/expired →
safe miss + eviction; just-inside-TTL served; FIFO cap; re-set updates;
bounds of record; delete/clear; WA-02 pairing-death wipe; reconnect
survival through the lazy-init idiom; counter-cache CacheStore usage
pattern; counter TTL). Full gateway suite **116/116 green** (was 103),
`npm run build` (strict tsc) clean.

**Version verdict:** STAY on 6.7.24 — it is the FINAL 6.x release; 7.x is
RC-only (7.0.0-rc14, 2026-07-29) with zero retry-path changes in its
changelog; the fix is application-side and works identically on 6.7.24.
Re-evaluate only when 7.x leaves RC with #1767 closed by a merged fix.

**The settle/warm-up gates answer (mission question):** the existing
96-F1/97-F3 gates address ONLY the post-link key-propagation window (the
narrower race — first sends after pairing); they cannot heal a stale
recipient session at arbitrary times. The two defenses now compose:
settle gate avoids sending into the post-link window; the retry contract
heals the general case when it still happens.

## The transport decision (mission §3) — decided and acted on, not just tabulated

**Retained + hardened: the existing Baileys gateway** (fix above; zero
migration risk: same session, same REST contract, no re-pair). **Long-term
target: the official WhatsApp Cloud API** — the only transport eliminating
the whole unofficial-client failure class — gated on Meta owner
prerequisites that do not exist today (business portfolio, WABA,
authentication template COPY_CODE, sender number with the same-number
unlink caveat, ≈$0.0048/delivery North-Africa auth pricing). **Rejected:
all third-party alternatives** — Evolution API 2.3.7 carries the IDENTICAL
failure mode UNFIXED (open #2705: its getMessage miss burns the retry);
WPPConnect/open-wa/whatsapp-web.js are the same unofficial class with
worse footprint/licensing. Full decision matrix + the 5 exact owner
prerequisites + the acceptance gate before retiring the Baileys path:
**`docs/pending/whatsapp-cloud-api-migration.md`** (new, PENDING bucket,
indexed in `docs/README.md`).

## The external tracks, re-verified at their real boundary

- **Ports :8080/:6001/:8000** — re-probed from this round's independent
  vantage (2026-10-15): 301/404/302 → **all three STILL PUBLIC** (dark
  control port confirms the probe). Owner-gated exactly as R148 recorded;
  the watchdog's exposure-guard step keeps measuring every 5 min.
- **Telegram alert secrets** — Actions secrets (names only): SubNation2
  `NEON_API_KEY`, `RENDER_DEPLOY_HOOK_URL`; openwa: none. **TELEGRAM_BOT_TOKEN
  / TELEGRAM_CHAT_ID still absent** → workflow Telegram delivery remains
  the exact owner action from R148 (values from the Coolify env of record).
- **Release identity** — live bundle still `index-CzyjQ4-D.js` (the R148
  deployment); no `VITE_RELEASE_SHA` in the served bundle → the Coolify
  build-arg owner action stands.
- **GSC** — live `<meta name="google-site-verification" content="">` →
  token still unset; the R144 §1 owner action stands.
- **Embronic** — re-searched: no developer API documentation has appeared;
  R148's Phase A finding + owner action in
  `docs/pending/embronic-adapter-design.md` remain the accurate record.
  No adapter invented, checkout untouched.

## Application-side review: honest and unchanged

The OTP lifecycle was mapped end-to-end (route → service → settle gate →
gateway → Baileys → persistence → verdicts → frontend auto-retry):
`SendResult` on the app side is `{ ok: true }` = "accepted by the engine"
— it never treats HTTP 200/message-id as proof of recipient readability
(mission §2 requirement already satisfied); `whatsapp_settling` /
`gateway_waking` verdicts + `WhatsAppPhoneSignIn.tsx` auto-retry ride the
retryable states; the REST contract is UNCHANGED by the gateway fix, so
zero app code changes were required this round — the app deliverable is
the decision record + this report + the CHANGELOG entry.

## Gates

- openwa: `npm run build` clean (strict tsc); full suite **116/116**;
  CI comment count updated (103 → 116). Docker multi-arch build runs in
  its CI on push (docker.yml, GHCR sha-tagged).
- SubNation2: docs-only diff this round (new pending doc + index row +
  this report + CHANGELOG) — no code, schema, contract, or migration
  changes; the CI battery runs on the pushed SHA as the runbook-approved
  quota path.

## What this round did NOT do (honesty section)

1. **The production gateway binary is NOT yet the fixed one.** The code is
   pushed and CI-verified, but the Coolify openwa resource is pinned to
   `ghcr.io/ahmadmedo1012/openwa:sha-ba6a843`. Owner action: re-pin to the
   R149 commit's `sha-<short>` tag (single-gateway rule: stop old, start
   new) and verify `/healthz` + the first live OTP. Until then the fix is
   delivered in code, not in production.
2. **No real-handset acceptance test was performed** (no test handset /
   operator-approved recipient available to this session). The
   `[retry] resend request` log line is the production observability that
   will evidence the fix working live; a genuine end-to-end test to an
   operator-controlled number remains an owner-observable step after the
   re-pin.
3. No Cloud API adapter was implemented (prerequisites absent — §"Exact
   owner prerequisites" in the pending doc).
4. No port closure, Telegram secret, release-identity build arg, GSC
   token, or Embronic credentials were touched — all remain the recorded
   owner actions, re-verified this round.
5. No `db:push`, no migration, no money-invariant surface touched.

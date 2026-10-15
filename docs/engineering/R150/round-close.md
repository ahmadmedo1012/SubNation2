# R150 — WhatsApp OTP reliability: evidence-based gateway repair completion + Cloud API decommission: closing report

Round base: `0ae1091` (R149 close). Method: the repo's standing Ponytail
ruleset (root `AGENTS.md`) with Caveman terse-output discipline applied
manually (no executable middleware in this remote session — same honest
status as R147–R149). One research lane (worklog 2-research, R150) plus
the coordinator implementation lane.

Mission: the recipient-side `Waiting for this message. This may take a
while.` persisted in real-world testing after R149. This round had to (1)
establish why, (2) repair or replace the gateway on evidence, (3)
permanently decommission WhatsApp Cloud API from the project, (4) verify
everything that can be verified from this vantage — and state the rest as
exact owner actions.

## 1. Why the failure persisted after R149 — the two-part answer

**Part A — the production binary was never verified as updated.** R149's
own closing record states it plainly: the fix shipped to
`ghcr.io/ahmadmedo1012/openwa:sha-363b594`, but the running Coolify
container kept `sha-ba6a843` until the operator re-pinned it — a manual
owner action with no verification path. Nothing in the R150 baseline
contradicts this: the gateway listens only on the compose-internal network
(`http://openwa:2785`, not published), the Coolify dashboard at `:8000`
requires owner credentials, and no endpoint of the old image identifies
its build. **If the old image is still running, every decrypt failure is
still permanent — exactly the reported symptom, with zero code-level
contradiction.** R150 closes the *verification* gap so this can never be
ambiguous again: `/healthz` now exposes `release` (the commit SHA baked
into the image at build time), so the running binary answers "which build
am I?" in one request.

**Part B — a real, repairable defect remained even with R149 deployed.**
R149's message store was in-memory by design ("restart gap documented as
shortcut"). The failure mode: a message is sent, the container redeploys
(or restarts) inside the message's retry window, the recipient's device
then requests a re-send, and the freshly booted gateway has no content to
serve — `served: false`, placeholder permanent. Every Coolify redeploy of
the gateway image is exactly this window. The mission's §3A required the
store to survive container restarts; R150 implements it (below). A second
sub-case: exhausted retry counters reset on restart, re-arming the
5-resend budget — also closed.

**What was NOT wrong:** the library machinery. Baileys 6.7.24's
`sendMessagesAgain` (read in the locked dependency's own source this
round) already does the heavy lifting correctly: it force-fetches a FRESH
session for the requesting device (`assertSessions([participant], true)`),
re-relays the ORIGINAL content under the SAME message id, targets the
specific requesting device when the retry receipt names one
(`device_fanout: 'false'`), and bounds the whole thing at
`maxMsgRetryCount = 5`. R149's `getMessage` + store is the only missing
half, and its content shape (`proto.IMessage`, the `message` field) is the
correct one.

## 2. The repair — gateway commit `9398374` (openwa R150)

All in `ahmadmedo1012/openwa`, REST contract unchanged (healthz gains the
additive `release` field):

1. **Restart persistence of the full retry contract.** Both stores
   (outbound message content + resend counters) now flush atomically
   (tmp+rename) to `__openwa_retry_state.json` inside the session auth
   folder on EVERY mutation — the folder is already the persistence unit:
   it is snapshotted into the AES-256-GCM-encrypted DB blob by the
   existing serializer, restored on boot BEFORE the engine starts, and
   wiped with the pairing (WA-02) automatically. TTL is anchored to the
   ORIGINAL send time (a restart never resets the 30-min window); expired
   entries never resurrect; FIFO/cap bounds re-apply at hydrate; malformed
   file rows drop individually; a torn/absent file boots fresh, never
   crashes. **A container redeploy inside a message's retry window no
   longer orphans it, and an exhausted 5-resend budget stays exhausted.**
   At-rest exposure: plaintext only on the container-local `DATA_DIR`
   volume (the same class as the Signal keys already stored there) and
   inside the encrypted DB blob — bounded by TTL + cap; OTP values still
   never appear in any log.
2. **Retry-outcome observability + a closed PII leak.** Baileys is now
   wired through a masking log adapter: `warn`/`error` always forwarded,
   `info` only when retry-relevant, every value JID-masked by a deep
   masker, `[baileys]`-prefixed. This surfaces the exact failure
   signatures an operator needs (`will not send message again, as sent too
   many times` = budget exhausted; `recv retry for not fromMe message` =
   retry receipt misclassified — the LID/PN addressing-drift class;
   `error in sending message again` = resend failed) while FIXING a real
   leak found this round: without a logger override, Baileys' default
   bare-`pino()` runs at level `info` with NO masking — raw recipient JIDs
   were reaching the retained stdout surface.
3. **Deployment identity.** `/healthz` exposes `release`
   (`OPENWA_RELEASE_SHA` baked via Dockerfile `ARG` + docker.yml
   build-args from `github.sha`). One request now proves which build runs.
4. **Companion identity.** `Browsers.ubuntu("Chrome")` (the upstream
   default) replaces the `Windows/Chrome` override: WhatsApp has been
   428-rejecting WIN32/DARWIN identities at pairing since ~2026-06-30
   (WhiskeySockets/Baileys#2677). The live session is unaffected; the
   next re-pair is protected.

Gates: strict tsc clean; suite **116 → 143/143 green** (27 new acceptance
tests: snapshot surface, restart round-trip through the exact JSON chain,
original-TTL anchoring, no-expired-resurrection, cap trims, malformed-row
dropping, counter-budget totality, filename legality vs Baileys' auth
files, deep PII masking incl. embedded-JID strings and buffer frames,
forward-filter signatures, adapter child/binding composition);
`npm audit` 0 vulnerabilities; gitleaks runs in CI.

## 3. Repair-vs-replace — the evidence-based decision

The R150 research lane (worklog 2-research) evaluated every mandated
candidate against CURRENT upstream evidence:

- **whatsmeow** (first-time evaluation): the strongest retry machinery of
  ANY library — 256-entry send ring buffer (the exact design Baileys' own
  source TODO says "copy whatsmeow"), a persistent DB-backed
  `UseRetryMessageStore`, 4-level `getMessageForRetry` fallback, forced
  session recreation, LID-first addressing. MPL-2.0, ~0.8 commits/day.
  **And its own tracker still carries the failure class**: issue #160
  ("Waiting for this message") open since 2022 with a 2026-01 comment;
  #1018 (the exact SubNation symptom, older iOS recipients) and #981
  closed NOT_PLANNED by the maintainer without fixes. Migration cost: Go
  service or a REST wrapper (wuzapi/evolution-go — new dependencies),
  mandatory new QR pairing, REST contract rewrite, Go ops in a JS stack.
- **WPPConnect Server 2.10.55** (2026-10-14): browser class (real
  WhatsApp Web JS does the crypto — a genuine class change), but
  ~300–500 MB Chromium/session, re-pairing, rewrite, same unofficial
  ban-risk class, license posture unchanged.
- **whatsapp-web.js 1.34.7** (2026-04-24): npm releases stalled ~5.5
  months; its own tracker has "Waiting for this message" reports closed
  NOT_PLANNED undiagnosed (#3662/#3297).
- **Baileys 7.x**: still RC-only, silent since 2026-07-29; #1767 still
  open, no merged retry fix.

**Verdict: repair, do not replace.** No candidate demonstrably eliminates
the recipient-side decrypt/retry failure class — whatsmeow, with the best
retry machinery in the field, still carries it in its own tracker. The
R149+R150 in-house implementation now matches whatsmeow's heal path
(message store + forced session rebuild + bounded retries) with ZERO
re-pairing, ZERO contract change, and restart persistence — strictly less
risk than any migration. The browser-based options change the class but
bring footprint/cadence/licensing costs that fail the mission's own
decision rule ("do not assume changing libraries eliminates a
protocol-level problem"). **Designated fallback** (recorded, not acted
on): whatsmeow behind a thin Go REST gateway (or wuzapi) IF the current
link dies or the failure class demonstrably persists after R150 is
deployed and its new observability has produced evidence.

## 4. Cloud API decommission — what was removed, what was verified

The R150 mission permanently excludes WhatsApp Cloud API. Audit of the
entire application and deployment surface (application modules, provider
interfaces, env declarations, `.env.example`, deploy compose examples,
CI workflows and their secrets, webhooks, scheduled jobs, docs):

- **No code path, provider registration, env var, secret, webhook, or CI
  dependency for Cloud API existed** — the integration was never built;
  R149's exposure was documentation-only. Verified by repo-wide scan
  (`cloud.?api|graph.facebook|waba|whatsapp.cloud` over backend, frontend,
  shared, docs, config, deploy, scripts, .github): matches only in
  comments/docs.
- **Removed:** `docs/pending/whatsapp-cloud-api-migration.md` (the R149
  pending migration plan — explicitly ordered deleted by the mission).
- **Corrected active statements:** the architecture diagram's transport
  edge was mislabeled "WhatsApp Cloud via Baileys" (it never was Cloud
  API) → now "WhatsApp Web linked-device protocol via Baileys
  (self-hosted, non-Cloud-API — R150)"; `user-provider.ts` no longer
  lists Cloud API as a "future provider addition" example; the OTP
  message comment now states the exclusion is permanent rather than "out
  of scope"; `docs/README.md` PENDING bucket updated (2→1) with the
  removal recorded.
- **Preserved as HISTORY (audit records, by design):** the R149
  round-close report and CHANGELOG entries describe the Cloud API
  recommendation as it stood at R149 — they are dated records, superseded
  by this document as active guidance.
- **Meta-side account state:** no project-owned Meta Cloud API assets are
  known to exist — R149's research established the project has NO Meta
  developer account, Business Portfolio, WABA, or Cloud app (that is WHY
  the migration was owner-gated, never executed). No tokens, permissions,
  or webhook subscriptions were ever issued to this project, so there is
  nothing to revoke. **Owner verification (the only remaining check):**
  confirm in your Meta Business portfolio (business.facebook.com →
  Business settings → WhatsApp accounts / Apps) that no WhatsApp Cloud
  API app is attached to this project. If one exists (it would postdate
  R149 and be owner-created), delete the app / remove the phone number
  from it — do NOT delete the WhatsApp account or phone number itself.

The supported architecture, stated in active docs: **self-hosted,
non-Cloud-API WhatsApp Web linked-device integration (openwa on Baileys),
deployed as `ghcr.io/ahmadmedo1012/openwa`, pinned per deploy.**

## 5. Delivery-state semantics (unchanged, re-verified)

SubNation's OTP path already encodes the honest ladder: `SendResult`
`{ok:true}` means *accepted by the engine* — never recipient readability
(R149 verified this in `whatsapp-otp.service.ts`; R150 re-read it). The
gateway's delivery log records per-message protocol statuses
(PENDING → SERVER_ACK → DELIVERY_ACK → READ, monotonic max-rank
authoritative) — i.e. server acknowledgement and device delivery are
distinct recorded states. The NEW `[baileys]` lines add the final rungs:
resend requested/served, budget exhausted, resend failed. Recipient-side
*rendering* remains observable only by a human or the recipient requesting
the next OTP — which is why the acceptance matrix below is owner-gated.

## 6. Owner actions (exact, nothing hidden)

1. **Deploy the R150 image:** in Coolify, re-pin the openwa gateway
   service to `ghcr.io/ahmadmedo1012/openwa:sha-9398374` (R150) — or at
   minimum `sha-363b594` (R149) if R150 is not yet published when you
   read this. Then VERIFY:
   `docker exec <gateway> wget -qO- http://127.0.0.1:2785/healthz` → the
   `release` field must equal the full SHA `9398374853734f0d39f71a85476bc587f2df2d46`
   (R150 images only; `null` = wrong/local build). This is the exact
   check R149 lacked.
2. **Real-device acceptance matrix** (10 consecutive decrypted-and-rendered
   messages per platform + the previously failing scenario; correlate the
   SubNation request id ↔ gateway `[retry]`/`[baileys]` log lines ↔ the
   recipient's screen): Android + iPhone recipients, existing + fresh
   conversations, a normal send, an OTP send, and — if reproducible — the
   decrypt-failure retry path. The new observability lines make the
   correlation mechanical. No automated or fabricated substitute exists
   for this step.
3. **Meta-side Cloud API check** (§4 above) — one look at the Business
   portfolio; expected outcome: nothing attached.
4. **If the failure class persists after R150 is deployed:** collect the
   `[retry]`/`[baileys]` lines for the affected message ids and escalate
   on evidence — the designated fallback (whatsmeow gateway) is recorded
   in §3. Do not re-pair blindly; a re-pair resets recipient sessions and
   can mask the mechanism.

## 7. Rollback

`sha-ba6a843` (pre-R149) and `sha-363b594` (R149) remain on GHCR and are
pull-stable. Re-pinning Coolify to either tag restores the prior binary;
the R150 state file is additive (unknown to older builds — they ignore
it) and the healthz `release` field is additive (older images simply
don't have it). No database or credentials migration exists to reverse.

## 8. Honesty boundary

- No real-handset test was possible from this session (no devices, no
  authorized recipient, no production gateway access) — the acceptance
  matrix is owner-gated and stated as such.
- The running production image could not be read from this vantage
  (compose-internal service; Coolify at `:8000` is owner-credentialed).
  What this round did about it: made the binary self-identifying from now
  on.
- CI/registry verification for the R150 push is recorded in the worklog
  release lane with run ids and SHAs.

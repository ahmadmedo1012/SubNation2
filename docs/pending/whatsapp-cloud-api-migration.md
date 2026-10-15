# WhatsApp Cloud API migration — R149 decision record (pending owner prerequisites)

Status: **pending external prerequisites** (2026-10-15, R149). The current
Baileys gateway is retained and HARDENED — this document records the
evidence-backed long-term route and the exact owner actions that unlock it.
Nothing here is implemented against a real Meta asset; no speculative
adapter exists in the codebase.

## The decision (R149, evidence-backed)

Two independent research lanes (worklog tasks 2-a and 3-a, R149) converged:

1. **Now — retain and harden the existing gateway** (`ahmadmedo1012/openwa`,
   Baileys 6.7.24): the "Waiting for this message. This may take a while."
   failure had a code-level root cause — the gateway implemented NONE of
   Baileys' message-retry contract (`getMessage` + an outbound message
   store were absent, so recipient re-send requests were silently dropped;
   WhiskeySockets/Baileys#1767 is the canonical issue). Fixed in R149 in
   the gateway repo (see its README §"Message retry contract"). Staying on
   6.7.24 is deliberate: it is the FINAL 6.x release; 7.x is RC-only and
   its changelog contains no retry-contract fix.
2. **Long term — the official Cloud API** is the only transport that
   eliminates the entire unofficial-client failure CLASS (E2EE retry
   dependency on a reverse-engineered linked-device protocol). Migration
   is gated on owner-controlled Meta assets that do not exist today.
3. **Rejected — every third-party alternative**: Evolution API 2.3.7 ships
   the SAME failure mode unfixed (open issue #2705: its getMessage returns
   an empty stub and burns the retry); WPPConnect / open-wa /
   whatsapp-web.js all wrap the same unofficial WhatsApp Web protocol (or
   a heavier browser variant) with new pairing, licensing and footprint
   risk. Swapping one reverse-engineered transport for another solves
   nothing.

The provider boundary is already the smallest sound one:
`backend/src/services/openwa/` (gateway-client + settle-gate + admin-sessions)
is the transport seam; `whatsapp-otp.service.ts` is the domain layer. A
Cloud API provider would slot in as a sibling of `openwa/` behind the same
`SendResult` verdict vocabulary — no generic messaging framework is needed
or wanted.

## Exact owner prerequisites to enable the Cloud API route

All of these are Meta-account actions the engineering environment cannot
perform (no Meta credentials exist in any authorized surface):

1. **Create the Meta business assets:** a Meta developer account → a
   Business Portfolio → a WhatsApp Business Account (WABA) → an app with
   the WhatsApp product. (developers.facebook.com)
2. **Provide the sender number:** either register a new number for Cloud
   API use, or onboard the existing subnation.ly number. ⚠ **Onboarding
   the CURRENT number onto Cloud API unlinks every companion device** —
   the Baileys linked-device session dies with it. To run a comparative
   cut-over without disrupting OTP delivery, use a SECOND number for the
   Cloud API trial; only move the primary number at the final switch.
3. **Create the authentication template:** OTP delivery on the Cloud API
   requires an approved `authentication` template (one-time-password
   category; COPY_CODE button works on all platforms, zero/one-tap
   autofill is Android-only). Free-form OTP text is not deliverable to
   arbitrary customers outside the 24-hour customer-service window.
4. **Record the secrets** (Coolify env of record → later GitHub Actions
   secrets if alerting needs them): `WHATSAPP_CLOUD_*` per the provider
   implementation when it is written — server-side only, never frontend.
5. **Accept the per-message cost:** authentication-category messages are
   billed per delivery (North-Africa rate ≈ **$0.0048/delivery** as of
   2026-10; ≈ $48 per 10k OTP). The 250-unique-customers/24h
   (unverified) starting cap and 250-template/2-number limits fit
   SubNation's current volume.

## Acceptance gate before the Baileys path is retired

The functioning linked-device path is NOT disabled until the Cloud API
provider has passed: template approval, a live readable OTP to the
operator's own handset, delivery-status webhooks (`sent → delivered →
read → failed`) observed end-to-end, failure-rate parity or better vs
the hardened Baileys baseline, and a tested rollback (re-pin the openwa
image; the two transports must never send the same OTP concurrently —
no cross-provider fallback after an ambiguous timeout).

## Related

- Gateway retry-contract fix: `ahmadmedo1012/openwa` README §"Message
  retry contract (R149)" + its R149 round commit.
- Settle/warm-up gates (the post-link half of the defense):
  `backend/src/services/openwa/settle-gate.ts` header.
- Embronic decision record (same pending pattern):
  `docs/pending/embronic-adapter-design.md`.

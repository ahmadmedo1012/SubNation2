# 07 — Deployment Plan (post-Wave-1 steady state)

## Regular flow

1. Finish a verified wave locally (gates green, evidence cited).
2. Commit by wave, push to GitHub main.
3. Coolify deploy (API/UI): git source main → dockerfile build → healthcheck gate.
4. Verify: build log clean → container `GIT_SHA` == pushed HEAD → `https://subnation.ly/api/healthz`
   ok → `healthz/summary` stable when warm → smoke the money path (read-only) → smoke admin login.
5. Update progress log + graph if topology changed.

## Guards

- Deploy only from verified-clean main. Never deploy untested waves.
- Money-invariant suites rerun for any diff near `checkout.service`, `topup.service`,
  `refund.service`, wallet routes, or `migrate.ts`.
- Migrations expand-first; a failed boot migration exits the container (healthcheck keeps old
  target down — rollback = redeploy previous deployment).

## Rollback

1. Coolify → previous deployment → redeploy (image already built + cached).
2. Confirm SHA + healthz + money-path smoke.
3. If DB-stage-related: migrations are additive; previous code tolerates expanded schema by design
   (V1-M* stages are probe→alert→skip). DB never rolls back.
4. Never deploy `6caa63b` / `3a2e2e1`.

## Secrets change flow

Change only in Coolify env (app + openwa) → redeploy affected app → verify health. Cross-service
equality (`WHATSAPP_OTP_API_KEY` == `OPENWA_API_KEY`) must be changed together.

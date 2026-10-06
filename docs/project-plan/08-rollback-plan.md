# 08 — Rollback Plan (quick reference)

| Failure | Detection | Rollback action | Verification |
| --- | --- | --- | --- |
| Bad deploy (crash loop / healthz fail) | Coolify healthcheck fails; healthz down | Redeploy previous Coolify deployment | healthz ok, SHA = previous |
| Bad deploy (works but wrong behavior) | smoke checks | Same as above | targeted smoke |
| Migration regression | boot exits / stage alerts | Redeploy previous (schema expanded, old code tolerates) | boot logs clean |
| Env mistake | boot fail-fast (secrets/origins) | Revert env in Coolify, redeploy | boot logs + healthz |
| OpenWA regression | whatsapp probes | Redeploy previous openwa image tag | `/api/sessions` responds |
| Cloudflare/DNS | reachability | Operator-only — do not automate | — |
| Data corruption | money invariant alerts | STOP. Restore drill runbook + operator decision. Never improvise writes | drill evidence |

Immutable floors: never delete Neon data or openwa volumes; never force-push; never weaken M1–M14;
never deploy `6caa63b` / `3a2e2e1`.

Wave-1 specific rollback: re-point app 2 back to `source_type=dockerimage`
(`ghcr.io/ahmadmedo1012/subnation2:coolify-latest` still on the VPS) + redeploy; restore env from
the preserved snapshot.

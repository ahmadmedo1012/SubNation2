# Quickstart: AI Admin Copilot (Phase 1 Surface)

**Audience**: SubNation engineers picking up the implementation after `/speckit-tasks`. This document walks through the smallest end-to-end slice — Phase 1 read/explain — so anyone can verify their environment, then expands into the Phase 2 (preview) and Phase 3 (execute) flows. It is not a full operations runbook; the on-call playbook lives in `OPERATIONS_RUNBOOK.md`.

> All copilot endpoints require an authenticated admin session. The same admin login flow applies as for any other admin route.

---

## 0. Prerequisites

Before the first request:

| Requirement                            | How to satisfy                                                                                                                                                                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local Postgres + Redis from `pnpm dev` | Already part of the project — no copilot-specific setup.                                                                                                                                                               |
| `ANTHROPIC_API_KEY` env var            | Add to your local `.env` (production injects it via Render). The boot validator fails fast if missing in prod.                                                                                                         |
| New tables migrated                    | `pnpm migrate` runs the boot migrations idempotently. The three new tables (`copilot_previews`, `copilot_actions`, `copilot_action_items`) are created by the new migration.                                           |
| Phase flags set                        | In dev, all phases default ON. In production, set the `copilot_phase{1,2,3}_enabled` admin settings via the admin settings UI; sub-flag `copilot_phase3_high_risk_enabled` controls whether high-risk classes execute. |
| Admin permissions                      | The acting admin must hold the relevant scope (`inventory`, `finance`, `admins`, etc.). A super-admin (`["all"]`) sees the full tool catalog.                                                                          |

---

## 1. Phase 1 — read/explain (no writes anywhere)

The `POST /api/admin/copilot/ask` endpoint streams back an SSE response. It exposes only the **read tools** to the model.

### Smoke test from the admin UI

1. Sign in to `/admin/login` as a super-admin.
2. Open any admin page (e.g., `/admin/products`).
3. Press **Ctrl/Cmd+K** (or click the Copilot floating button). The slide-out panel opens.
4. Type: `how many active products do we have in the streaming category?` and submit.
5. Observe a streamed answer with citations to specific product IDs.
6. Try: `delete product 123` — the copilot must refuse with `"write actions are not yet enabled"` (Phase 1 has no draft tools).

### Smoke test from the API

```bash
curl -N -X POST http://localhost:8080/api/admin/copilot/ask \
  -H "Content-Type: application/json" \
  -H "Cookie: _admin=<your-admin-session-cookie>" \
  -d '{ "intent_text": "show me the 5 lowest-stock products" }'
```

You should see SSE frames:

```
event: tool_use
data: {"name":"list_low_stock","input":{"threshold":5}}

event: tool_result
data: {"products":[{"id":42,...}]}

event: token
data: "Here are the 5 lowest-stock products: ..."

event: done
data: {"correlation_id":"abc...","tokens":{"input":..., "output":...}}
```

If the stream errors with `429`, you've tripped the rate limit. Wait 1 minute or check `copilot_rate_limit_denials_total`.

---

## 2. Phase 2 — draft and preview (no execute)

Phase 2 unlocks the **draft tools**. The model can propose actions; the human can inspect them; nothing writes yet.

### Smoke test from the admin UI

1. Open the copilot panel from `/admin/products/<id>`.
2. Type: `change the description to mention 24/7 support`.
3. Wait for the **PreviewCard** — it should show the current description, the proposed new description as a diff, "preview only — not yet executed", and an Approve / Cancel pair.
4. Click **Cancel**. Observe the preview disappears, no audit row in `audit_logs`, but a `copilot_actions` row with `outcome=cancelled` is recorded.

### Smoke test from the API

```bash
curl -X POST http://localhost:8080/api/admin/copilot/draft \
  -H "Content-Type: application/json" \
  -H "Cookie: _admin=<your-admin-session-cookie>" \
  -d '{ "intent_text": "increase Pro Plan price to 49.99" }'
```

Expected response (200):

```json
{
  "preview_id": "01J0...",
  "preview": {
    "id": "01J0...",
    "action_class": "price_change",
    "risk_tier": "high",
    "payload": {
      "kind": "single",
      "intent_summary": "Update price of product #17 (\"Pro Plan\") from 39.99 to 49.99",
      "entity_type": "product",
      "entity_id": 17,
      "changes": [{ "field": "price", "before": "39.99", "after": "49.99" }],
      "validation_warnings": [],
      "side_effects": ["Customer-visible price will change immediately on publish."],
      "irreversible": false
    },
    "created_at": "...",
    "expires_at": "<created_at + 5 minutes>"
  }
}
```

If the proposal is invalid (e.g. field doesn't exist), you'll get a `409` with a `RefusalResponse` and a stable `code` (e.g., `COPILOT_HALLUCINATED_FIELD`). If a bulk filter matches more than 500 rows, you'll get `422 COPILOT_BULK_OVER_CAP` with `suggested_narrowing` text.

### What Phase 2 does NOT do

- It does NOT write to `products`, `inventory`, etc.
- It does NOT debit wallets.
- It does NOT register an `audit_logs` row.
- The `Approve` button in the UI is rendered, but in Phase 2 it is wired to a no-op handler — Phase 3 wires it to `/confirm`.

---

## 3. Phase 3 — execute (gated)

Phase 3 enables the `/confirm` and `/double-confirm` endpoints.

### Low-risk flow (single confirm)

```bash
# 1) draft (returns preview_id)
curl -s -X POST http://localhost:8080/api/admin/copilot/draft \
  -H "Cookie: _admin=$COOKIE" -H "Content-Type: application/json" \
  -d '{ "intent_text": "add an FAQ entry to product 17 about refund policy" }' \
  | jq -r '.preview_id'  # -> 01J0...

# 2) confirm (single click)
curl -s -X POST http://localhost:8080/api/admin/copilot/previews/01J0.../confirm \
  -H "Cookie: _admin=$COOKIE"
```

Expected response: `{ "outcome": "success", "action_id": 142, "result_url": "/admin/products/17" }`. The product now has the new FAQ entry. `audit_logs` has a `copilot.execute` row pointing at `copilot_actions.id = 142`.

### High-risk flow (single + double confirm)

```bash
# 1) draft a price change → returns preview with risk_tier="high"
PREVIEW_ID=$(curl -s -X POST .../draft -d '{ "intent_text": "change Pro Plan price to 49.99" }' | jq -r '.preview_id')

# 2) first confirm — does NOT execute, starts the cooldown
curl -X POST .../previews/$PREVIEW_ID/confirm
# -> { "outcome": "awaiting_double_confirm", "cooldown_seconds": 3, "action_id": null }

# 3) attempt double-confirm BEFORE 3 seconds elapse → 425 Too Early
sleep 1
curl -X POST .../previews/$PREVIEW_ID/double-confirm  # -> 425

# 4) wait the cooldown, then double-confirm
sleep 3
curl -X POST .../previews/$PREVIEW_ID/double-confirm
# -> { "outcome": "success", "action_id": 143, ... }
```

### What you should be able to verify after a successful execute

| Check                                                                           | Expected result                                                                                                      |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `SELECT * FROM copilot_actions WHERE id = 143`                                  | one row with `outcome='success'`, `confirmed_once_at` and `confirmed_twice_at` populated, `executed_at IS NOT NULL`. |
| `SELECT * FROM audit_logs WHERE target_type='copilot_action' AND target_id=143` | exactly one row with `action='copilot.execute'`, `actor_type='admin'`.                                               |
| `confirmed_twice_at - confirmed_once_at`                                        | ≥ 3 seconds (FR-CONFIRM-002).                                                                                        |
| `executed_at - created_at` (joined to preview)                                  | < 5 minutes (FR-PREVIEW-003).                                                                                        |
| `SELECT * FROM products WHERE id = 17`                                          | `price = '49.99'`, `updated_at` advanced.                                                                            |

### Wallet/refund handoff

```bash
curl -s -X POST .../draft -d '{ "intent_text": "refund $20 to user 99 for duplicate charge" }'
# -> 200 OK, preview risk_tier="no_execute", payload.handoff.target_url="/admin/topups?user=99&prefilled=..."

curl -X POST .../previews/<id>/confirm   # 403 with handoff URL
curl -X POST .../previews/<id>/double-confirm  # 403 with handoff URL
```

The admin clicks the handoff URL and runs the actual refund through the existing wallet admin tooling, where the constitution's transactional ledger guarantees apply.

---

## 4. Acceptance test paths

Map each spec User Story to a hands-on verification:

| Story                            | Verify                                                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **US1** read-only                | Run §1 above; verify the copilot refuses any draft phrase with "write actions are not yet enabled".                                                                                                                       |
| **US2** draft+preview            | Run §2 above; confirm the new `copilot_actions` row has `outcome=cancelled` for the cancelled flow.                                                                                                                       |
| **US3** low-risk execute         | Run §3 low-risk above; verify the audit row pair is written atomically.                                                                                                                                                   |
| **US4** high-risk double-confirm | Run §3 high-risk above; verify the 3-second 425 then success.                                                                                                                                                             |
| **US5** bulk preview             | Draft `lower price by 10% on all draft products`; verify `total_affected ≤ 500`, `sample` is rendered, `aggregate_impact.margin_delta_total` is computed; double-confirm; verify per-item rows in `copilot_action_items`. |
| **US6** audit history            | Hit `GET /history`; filter by `action_class=price_change`; verify pagination via `next_cursor`.                                                                                                                           |
| **US7** anomalies                | Insert a product with `price < cost_price * 0.95`; ask `summarize loss-making products`; verify the row appears with the cost/price gap.                                                                                  |
| **US8** suggested commands       | Open the panel from `/admin/products/<id>`; verify the suggestion list references that product and excludes wallet suggestions if the admin lacks the `finance` scope.                                                    |

---

## 5. Operating limits (locked by spec)

| Limit                             | Value         | Source                     |
| --------------------------------- | ------------- | -------------------------- |
| Bulk row cap per single operation | 500           | FR-BULK-003                |
| Per-admin commands per minute     | 30 (sliding)  | FR-SAFETY-004              |
| Per-admin commands per hour       | 200 (sliding) | FR-SAFETY-004              |
| Preview validity window           | 5 minutes     | FR-PREVIEW-003             |
| High-risk second-confirm cooldown | 3 seconds     | FR-CONFIRM-002             |
| Wallet/refund execute via copilot | NOT ALLOWED   | FR-DATA-002 / Out of Scope |

---

## 6. Observability shortcuts

```bash
# Recent copilot activity for one admin
psql $DATABASE_URL -c "SELECT id, action_class, outcome, executed_at FROM copilot_actions WHERE admin_id = 1 ORDER BY id DESC LIMIT 20"

# Copilot rate-limit denials in the last hour (Prometheus)
curl -s localhost:8080/metrics | grep copilot_rate_limit_denials

# Stale-preview reaper status (worker tier)
psql $DATABASE_URL -c "SELECT count(*) FROM copilot_previews WHERE expires_at < now() - interval '24 hours'"
# expected ~0 if reaper is running on the worker

# Audit-reconciliation invariant — must equal 0
psql $DATABASE_URL -c "
  SELECT count(*) AS missing_audit
  FROM copilot_actions a
  LEFT JOIN audit_logs l
    ON l.target_type='copilot_action' AND l.target_id = a.id
  WHERE a.outcome IN ('success','partial') AND l.id IS NULL
"
```

If any reconciliation invariant returns non-zero, page the on-call — it indicates a copilot-side audit drop, which violates SC-003.

---

## 7. What to read next

- **Spec**: `specs/010-ai-admin-copilot/spec.md` — user stories, FRs, success criteria.
- **Plan**: `specs/010-ai-admin-copilot/plan.md` — technical context, constitution mapping, file tree.
- **Research**: `specs/010-ai-admin-copilot/research.md` — engineering decision log (R-1…R-15).
- **Data model**: `specs/010-ai-admin-copilot/data-model.md` — schema, JSONB shapes, state machine, reconciliation invariants.
- **Contracts**: `specs/010-ai-admin-copilot/contracts/` — OpenAPI fragment + tool catalog.
- **Tasks**: `specs/010-ai-admin-copilot/tasks.md` — produced by `/speckit-tasks`.

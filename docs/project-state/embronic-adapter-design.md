# Wave 6 — Embronic Adapter Design (PREPARED, not implemented)

Status: **design-ready boundary. NO invented endpoints. NO fake integration.**
Blocked on: official Embronic API documentation + credentials (+ reseller subscription if required).
Recorded in `docs/project-plan/09-external-blockers.md` (#1).

## What exists today (verified)

- `FulfillmentProvider` interface (`backend/src/services/providers/types.ts:95-127`):
  - `id: string` — registry key.
  - `fulfill(req: FulfillmentRequest, tx): Promise<FulfillmentResult>` — REQUIRED, must be
    idempotent per `(provider, provider_order_id)`, no unbounded network I/O inside the checkout
    transaction, business refusals returned as `{ok:false, reason}` not thrown.
  - Optional: `syncCatalog(tx)`, `queryStatus(providerOrderId)`, `release(providerOrderId)`.
- Registry (`providers/registry.ts`): env-driven (`FULFILLMENT_PROVIDER`), fail-safe to `manual`
  on unknown values — an operator typo can never break checkout.
- Checkout single transaction (`checkout.service.ts:403-418`): provider claims a unit →
  wallet debit + ledger + loyalty + coupon + order + `provider_fulfillments` row (UNIQUE
  `(provider, provider_order_id)` idempotency anchor, `checkout.service.ts:556-562`) all commit
  atomically. Failed purchase ⇒ no fulfillment row (test-pinned).
- Refund path looks up the provider order (`refund.service.ts:70-83`) and calls the optional
  `release` hook post-commit (fire-and-forget; no-op for manual).
- Secrecy: 19-key forbidden-vocabulary gate + raw-text probes on every public catalog route
  (`catalog-security.test.ts:67-90`); cost_price/sku exist ONLY in admin schemas
  (`openapi.yaml` AdminProduct*; public `Product` schema clean).

## Embronic adapter lifecycle (when docs + credentials arrive)

```
provider auth → catalog discovery → product/variant mapping → cost retrieval
  → availability → provisioning → order submission → provider order/ref
  → fulfillment result → delivery → status reconciliation
  → replacement/refund/release (where supported) → audit trail
```

Mapping model (local persistence already in place to support it):
- `products`/`product_variants` gain a provider-mapping side table (proposal:
  `provider_product_mappings`: local product/variant id ↔ provider catalog id, last-synced-at,
  last-cost, provider hash for change detection). Local business presentation (Arabic copy,
  categories, markup, featured state, visibility) stays in `products` — the provider is NEVER
  the source of presentation truth, only of supply.
- Availability: provider truth → local cache/snapshot (`inventory` semantics move to
  "provider reservation + local order ownership"). Avoid double-selling: reservations recorded
  in the same transaction as checkout, reconciled against provider status.
- Idempotency: reuse `provider_fulfillments` UNIQUE `(provider, provider_order_id)` exactly as
  today — the adapter generates no order ids locally; it persists whatever the provider returns.
- Reconciliation: a scheduler job (web tier, single-instance shape) polls `queryStatus` for
  non-terminal provider orders and reconciles drift (stuck provisionings → admin alert; failed →
  refund flow with the existing M7 transactional refund).
- Failure handling: `FulfillmentFailureReason.PROVIDER_UNAVAILABLE` (already reserved in the
  interface) becomes live for async/timeout cases; checkout stays fail-closed — money never moves
  unless the fulfillment outcome is deterministic inside the tx, or an explicit async-provisioning
  flow is added with its own ledger rules (M-invariant review REQUIRED before enabling that).
- Admin visibility: provider monitoring lives in `/admin/system` (scheduler/health surface) plus a
  new read-only provider-fulfillments view (operator-only vocabulary, already admin-scoped).
- Secrets: `EMBRONIC_API_*` env vars (Coolify env table, server-side only; never build args, never
  client bundles). Env contract + validator entry added in `scripts/src/validate-production-env.ts`.

## Contract tests to ship BEFORE real credentials

1. Adapter unit tests with a mock HTTP server asserting: no PII/cost leakage in error strings;
   timeouts bounded; retries idempotent (same provider_order_id never double-submitted).
2. Registry integration test: `FULFILLMENT_PROVIDER=embronic` + mock → checkout transaction
   commits the correct `provider_fulfillments` row; provider 5xx → checkout fails closed, no money
   movement.
3. Reconciliation test: provider status drift → admin alert + refund path invoked per policy.
4. Catalog sync test: `syncCatalog` upserts mappings WITHOUT overwriting local merchandising
   fields (Arabic copy, markup, visibility).
5. Secrecy tests extended to the new mapping tables (forbidden keys in public routes unchanged).

## Explicitly NOT done (per directive)

- No endpoint guessing, no scraping as the production path, no fabricated credentials, no
  premature `embronic.provider.ts` that pretends to work. The moment official docs + credentials
  exist, implementation starts from this boundary — checkout, wallet, catalog and admin remain
  untouched.

# Notes — admin_alerts.type column shape

**Audit task**: T002.

**Verdict**: `admin_alerts.type` is a plain `varchar(30)` with default `"system"` — verified at `shared/db/src/schema/admin_alerts.ts:5`. **NOT a Postgres enum.**

**Implication for T007 migration**: the `DO $$ ... ALTER TYPE admin_alert_type ADD VALUE IF NOT EXISTS 'forecast_stockout' ... $$` block in `data-model.md` §4 is **unnecessary**. The migration can write rows with `type = 'forecast_stockout'` directly without any DDL change. The defensive `DO $$` block is harmless if kept (the inner `IF EXISTS` guard on `pg_type` is false), but T007 may omit it for simplicity.

**Existing type literals seen in code** (informational):
- `coupon_maxed`, `coupon_expiring`, `low_stock`, `no_stock`, `system` — used in `frontend/src/pages/admin/alerts.tsx`
- `risk` — added by 003-anomaly-detection
- `forecast_stockout` — added by this feature

The frontend's `AlertType` union in `alerts.tsx` MUST be extended with `forecast_stockout` so the UI doesn't crash on the new rows; that's a small follow-up the runtime won't strictly need but the type-checker will demand once the new alerts ship.

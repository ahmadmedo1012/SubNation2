# Final Inventory Loading — SubNation2 Operator Runbook

Scope: how sellable stock (the `inventory` table) is loaded, verified, and
rolled back on the r112 production system. Loading inventory is OPERATOR DATA
ENTRY — tooling and guardrails only; nothing here fabricates stock, and no
automation (including the AI copilot) may ever add it. Code claims verified at
HEAD 521234f against the cited files.

## 1. Data-model truth

`shared/db/src/schema/inventory.ts` — table `inventory`:

| Column | Shape | Meaning |
|---|---|---|
| `product_id` | integer NOT NULL → products.id (CASCADE) | owning product |
| `variant_id` | integer NULL → product_variants.id (SET NULL) | scoped-pool membership |
| `account_email` | varchar(255) NULL | credential part 1 (stored plaintext — dedup key) |
| `account_password` | varchar(512) NULL | credential part 2 — AES-256-GCM at rest |
| `extra_details` | text NULL | code products / recovery notes — GCM at rest (F7, round-94) |
| `is_sold` / `sold_at` | bool / timestamptz | claim state |
| `created_at` / `updated_at` | timestamptz | `updated_at` = copilot staleness clock (raw SQL must set it explicitly) |

Rules:
- `variant_id IS NULL` = GENERIC pool — claimable by any variant of the
  product. `variant_id = X` = SCOPED pool — variant X only; no production
  write path sets `variant_id` today (scoped uploads are consciously-deferred
  work — the contract comment at inventory.ts:33-39).
- A unit is DELIVERABLE when at least ONE of `account_email`,
  `account_password`, `extra_details` is non-null (`deliverableUnitCondition()`,
  backend/src/routes/products.ts:82-87; manual.provider.ts:99-102).
- Two-pool availability mirrors checkout exactly:
  - Claim order (manual.provider.ts:50-79): variant-scoped `FOR UPDATE SKIP
    LOCKED` select first, then the generic pool (`variant_id IS NULL`), both
    `is_sold = false`, `ORDER BY id`.
  - R93-DATA gate (manual.provider.ts:97-110): refuse the sale unless ≥1
    credential field is present AND every present encrypted field decrypts
    (`INVENTORY_CORRUPT`); guarded claim `UPDATE ... WHERE is_sold = false`
    (manual.provider.ts:114-119) with the `INVENTORY_CLAIMED` race check.
  - Public availability (products.ts:152-156): a variant is `is_available`
    when its scoped pool has a deliverable unsold unit OR the product's
    generic pool has one; product `stock_count` = unsold deliverable rows,
    `is_available = stock_count > 0`.

## 2. How stock is loaded TODAY (the real mechanism)

Bulk upload EXISTS — a per-product paste/file upload, not a cross-product CSV
importer:

1. Admin panel → المنتجات (frontend/src/pages/admin/products.tsx) → the
   per-row «رفع مخزون» button opens InventoryUploadDialog
   (frontend/src/components/admin/InventoryUploadDialog.tsx).
2. Paste into the textarea, drag-drop, or upload a `.txt`/`.csv` file
   (≤ 256 KB — the file is read client-side into the same textarea).
3. Live parse (frontend/src/lib/inventory-parser.ts) auto-detects per line:
   `email|password`, `email|password|extra`, single-column codes
   (Xbox / Steam / gift keys), TSV/CSV from Sheets, JSON lines. Separators:
   `|`, `,`, `;`, tab. `#` / `//` lines are comments; blank lines dropped.
4. The preview shows ready-to-add, duplicates (in-paste AND against existing
   DB rows via GET /api/admin/products/:id/inventory), and unparseable lines.
5. Submit → POST /api/admin/products/:id/inventory
   (backend/src/routes/admin/products.ts:509-749): structured `entries[]` (the
   UI path) or legacy `bulk_text`; per-row validation (credentials need
   email+password, codes a value — one bad row rejects the batch, 400); cap
   500 rows/batch; dedup-then-insert as ONE transaction under per-product
   advisory lock `pg_advisory_xact_lock(hashtextextended('inventory-upload:<id>',0))`;
   server-side dedup keys `c:<email>` / `k:<code>` (case-insensitive, against
   DECRYPTED existing values — duplicates SKIPPED, reported as
   `skipped_duplicates`); password + extraDetails GCM-encrypted at INSERT;
   audit `product.inventory.upload`; fires the throttled (10 min) stock sweep.

Honest limits of the adjacent mechanisms:
- POST /products/:id/inventory/set-count (products.ts:435-507) can only
  DECREASE unsold stock (deletes the OLDEST unsold rows first); raising the
  number is rejected 400 — stock is credentials, never a count.
- Copilot `update_stock` (backend/src/services/copilot/admin-direct.ts:521+):
  `delta > 0` refused outright; `delta < 0` (≤1000) deletes the most-recent
  unsold rows in a transaction. Read tools (copilot/tools/read.ts) are
  stock read-only — NO tool adds stock.
- NO endpoint accepts `product_slug` / `variant_sku` columns, and no write
  path sets `variant_id`. Scoped pools need a code change (shipped together
  with the variant-DELETE guard per inventory.ts:33-39), not data entry.

## 3. Bulk template (what actually exists)

There is no cross-product CSV with product_slug/variant_sku. The real template
is per-product text lines, loaded from THAT product's dialog:

```
# one line per unit — paste or .txt/.csv file, ≤500 lines per batch
user1@mail.com|Password123                    → account (email + password)
user2@mail.com|Password456|recovery@mail.com  → account + extra_details
XBOX-12345-ABCDE                              → code-only (extra_details)
```

Constraints (enforced in products.ts:509-749): the product must exist (404
otherwise) — the admin products list filters `is_archived = false`
(products.ts:104), so the normal upload path cannot target archived products;
no variant column exists — every uploaded row lands in the GENERIC pool;
duplicate detection is in-paste + against existing rows, PER PRODUCT, keyed on
email (credentials) or the code (code-only) — the same email under two
different products is NOT flagged.

## 4. DRY-RUN then COMMIT — SQL verification (read-only)

For bulk verification use psql on the VM (over SSH): open a transaction,
run the checks, ALWAYS roll back — never mutate here:

```sql
BEGIN;
-- (a) unsold rows per product (sanity vs the admin UI stock column)
SELECT p.slug, COUNT(*) AS unsold FROM inventory i
JOIN products p ON p.id = i.product_id
WHERE i.is_sold = false GROUP BY p.slug ORDER BY unsold DESC;
-- (b) deliverable stock under ACTIVE products (what the storefront can sell)
SELECT COUNT(*) AS deliverable_active FROM inventory i
JOIN products p ON p.id = i.product_id
WHERE i.is_sold = false AND p.is_active AND p.is_archived = false
  AND (i.account_email IS NOT NULL OR i.account_password IS NOT NULL
       OR i.extra_details IS NOT NULL);
-- (c) duplicate account_email within one product (dedup key = email)
SELECT product_id, LOWER(account_email) AS email, COUNT(*) AS n FROM inventory
WHERE is_sold = false AND account_email IS NOT NULL
GROUP BY product_id, LOWER(account_email) HAVING COUNT(*) > 1;
-- (d) non-deliverable unsold rows (checkout refuses to sell these)
SELECT id, product_id FROM inventory WHERE is_sold = false
  AND account_email IS NULL AND account_password IS NULL
  AND extra_details IS NULL;
ROLLBACK;  -- read-only verification: ALWAYS roll back
```

## 5. Rollback of a bad load

Inventory is append-mostly. Before ANY load, capture the id ceiling
(`SELECT MAX(id) FROM inventory;`). Remove a bad batch unsold-only, verified:

```sql
BEGIN;
SELECT COUNT(*) FROM inventory            -- verify scope FIRST
WHERE product_id = <id> AND is_sold = false AND id > <max_id_before_load>;
-- expect exactly the number of units the bad load added
DELETE FROM inventory
WHERE product_id = <id> AND is_sold = false AND id > <max_id_before_load>;
COMMIT;                                   -- or ROLLBACK if the count surprised you
```

NEVER delete `is_sold = true` rows (delivered goods; orders reference them).
Unsold units under ARCHIVED products are flagged by the orphan sweep
(backend/src/jobs/stockWatcher.ts:135-168) — review them with the same shape.

## 6. Secret / order safety

- `account_email`, `account_password`, `extra_details` ARE the goods — a row
  is money in the database. Load them ONLY via the admin UI over HTTPS, or a
  psql session on the VM reached over SSH — NEVER over chat, email, tickets,
  or any AI channel.
- The admin inventory listing never returns `account_password` and is served
  `Cache-Control: no-store` (products.ts:26-32, 388-394).
- r112 rule: the agent NEVER modifies inventory — loading is the operator's
  action, executed with real supplier credentials.

## 7. Expected state after a load

- `/api/admin/stats` → `available_stock` counts all unsold rows (30s cache,
  backend/src/routes/admin/stats.ts:65,76).
- Storefront flips: product `is_available` (deliverable unsold > 0) and each
  variant per the two-pool rule; the catalog cache bumps (≤60s TTL).
- stockWatcher (backend/src/jobs/stockWatcher.ts) arms: low-stock alert at
  ≤3 unsold units, zero-stock at 0; event-driven sweep (admin writes /
  checkout / refund, throttled 10 min), DB dedupe keys `stock:low:<id>` /
  `stock:zero:<id>` + Telegram notify. The audit trail carries
  `product.inventory.upload` with added/skipped counts.

## 8. The r112 truth (live state)

- Catalog: 59 products total, 45 ACTIVE (is_active AND NOT is_archived),
  263 variants.
- Deliverable stock under ACTIVE products: 1 unit — product slug
  `netflix-premium`; 10 deliverable units total incl. archived products' stock.
- Restock is the operator's data entry task (§2): set-count cannot raise the
  number, copilot cannot, and no script should ever exist that tries.

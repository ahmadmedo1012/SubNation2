# SubNation — سبنيشن

## Overview

Arabic (RTL) digital subscriptions marketplace for Libya. Users buy Netflix, Spotify, PS Plus, Disney+ and other digital subscriptions using a wallet topped up via Madar or Libyana mobile payment networks.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + wouter + TanStack Query + Framer Motion
- **Backend**: Express 5 + Drizzle ORM + PostgreSQL
- **Auth**: JWT (user: `auth_token` in localStorage, admin: `admin_token` in localStorage)
- **Font**: Tajawal (Arabic-compatible Google Font)
- **Currency**: Libyan Dinar — formatted as "X.XX د.ل"
- **Language**: Arabic (RTL) — `dir="rtl"` and `lang="ar"` on `<html>`

## Artifacts

| Artifact | Path | Port |
|---|---|---|
| SubNation frontend | `/` | 21071 |
| API Server | `/api` | 8080 |
| Mockup Sandbox | `/__mockup` | 8081 |

## Key Files

- `lib/api-spec/openapi.yaml` — OpenAPI spec (source of truth — do not change `info.title`)
- `lib/api-zod/src/index.ts` — must remain `export * from "./generated/api";` only
- `lib/db/src/schema/index.ts` — exports all Drizzle table definitions
- `artifacts/api-server/src/routes/` — all backend route handlers
- `artifacts/subnation/src/pages/` — all frontend pages
- `artifacts/subnation/src/lib/auth.tsx` — auth context (token management)
- `artifacts/subnation/src/lib/utils.ts` — formatCurrency, formatDate, tierLabel, statusColor etc.

## Database Tables

- `users` — phone, password_hash, wallet_balance, loyalty_points, loyalty_tier, lifetime_spend, referral_code
- `products` — name, description, image_url, price, category, is_active, is_archived, usage_terms
- `inventory` — product_id, account_email, account_password, extra_details, is_sold, sold_at
- `orders` — order_code, user_id, product_id, inventory_id, amount, status, delivered_* fields
- `wallet_topups` — user_id, amount, payment_network (madar/libyana), sender_phone, payment_reference, status
- `flash_sales` — title, discount_percent, ends_at, is_active
- `admin_users` — username, password_hash, display_name, role

## Default Credentials

- **Admin login**: username=`admin`, password=`SubNation@2026`
- Admin access URL: `/admin/login`

## API Routes

- `POST /api/auth/register` — register with phone + password + optional referral_code
- `POST /api/auth/login` — login with phone + password → returns JWT token
- `GET /api/auth/me` — get current user (requires Bearer token)
- `GET /api/products` — list products (params: search, category, sort, available_only)
- `GET /api/products/:id` — get single product
- `GET /api/catalog/stats` — catalog statistics
- `GET /api/flash-sale` — active flash sale info
- `GET /api/orders` — user's orders (auth required)
- `POST /api/orders` — create order / purchase product (auth required)
- `GET /api/orders/:orderCode` — order detail (auth required)
- `GET /api/wallet` — wallet balance + recent orders (auth required)
- `GET /api/wallet/topups` — topup history (auth required)
- `POST /api/wallet/topups` — submit topup request (auth required)
- `POST /api/admin/login` — admin login → returns separate JWT
- `GET /api/admin/stats` — admin dashboard stats (admin auth)
- `GET /api/admin/orders` — all orders (admin auth)
- `GET /api/admin/topups` — all topups (admin auth)
- `POST /api/admin/topups/:id/approve` — approve topup + credit wallet (admin auth)
- `POST /api/admin/topups/:id/reject` — reject topup (admin auth)
- `GET /api/admin/products` — all products with stock/order counts (admin auth)
- `POST /api/admin/products` — create product (admin auth)
- `PATCH /api/admin/products/:id` — update product (admin auth)
- `DELETE /api/admin/products/:id` — archive product (admin auth)
- `GET /api/admin/users` — list users (admin auth)

## Phase 2 Features (Enhancement & Advanced)

### Theme System
- Dark/Light toggle in navbar (sun/moon icon), persisted in localStorage as `sn_theme`
- Light mode uses `.light` class on `<html>` (CSS variables override)
- FOUC prevention via inline `<script>` in index.html
- ThemeProvider context: `artifacts/subnation/src/lib/theme.tsx`

### Notification Bell
- Polling-based (30s interval) user notification bell in Navbar
- Fetches `/api/orders` + `/api/wallet/topups`, shows recent events with unread count
- Unread count based on `sn_notif_seen` timestamp in localStorage
- Component: `artifacts/subnation/src/components/layout/NotificationBell.tsx`

### Real-time Admin Dashboard
- All admin data queries use `refetchInterval: 30_000` for live updates
- Live indicator in admin header: "آخر تحديث: Xث" (seconds since last fetch)
- Manual refresh button in admin header for immediate refresh
- Alert banner when pending topups exist

### Admin User Management
- Edit modal in `/admin/users` for adjusting: wallet (add/subtract/set), loyalty points, loyalty tier
- Backend: `PATCH /api/admin/users/:id` supports `wallet_balance`, `wallet_adjustment`, `loyalty_points`, `loyalty_tier`

### Admin Inventory Bulk Upload
- Upload panel per-product in `/admin/products` (click "مخزون" button)
- Paste-style bulk upload: one per line as `email|password|extra_details`
- Backend: `POST /api/admin/products/:id/inventory` (bulk_text or JSON entries)
- Max 500 entries per upload

### Telegram Notifications
- Helper: `artifacts/api-server/src/telegram.ts`
- Backend: `GET /api/admin/settings` returns Telegram config status
- Settings page: `/admin/settings` shows Telegram status + setup instructions
- Triggers: new user register, new topup request, topup approved/rejected, new order
- Requires: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` env vars (Replit Secrets)

## Important Notes

- Run `pnpm --filter @workspace/api-spec run codegen` after changing openapi.yaml, then manually restore `lib/api-zod/src/index.ts` to `export * from "./generated/api";`
- Flash sale applies a discount to ALL products when active
- Inventory items are assigned one-per-order; purchasing deducts wallet_balance and marks inventory as sold
- Referral signup grants 5 د.ل to the new user's wallet
- Loyalty points = floor(purchase amount) added per completed order
- Admin JWT uses `SESSION_SECRET + "_admin"` as secret key

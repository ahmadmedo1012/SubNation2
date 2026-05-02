# SubNation — سبنيشن

## Overview

Arabic (RTL) digital subscriptions marketplace for Libya. Users buy Netflix, Spotify, PS Plus, Disney+ and other digital subscriptions using a wallet topped up via Madar or Libyana mobile payment networks.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Frontend**: React + Vite + Tailwind CSS v4 + shadcn/ui + wouter + TanStack Query + recharts
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

- `users` — phone, password_hash, wallet_balance, loyalty_points, loyalty_tier, lifetime_spend, referral_code, referred_by
- `products` — name, description, image_url, price, category, is_active, is_archived, usage_terms
- `inventory` — product_id, account_email, account_password, extra_details, is_sold, sold_at
- `orders` — order_code, user_id, product_id, inventory_id, amount, status, delivered_* fields
- `wallet_topups` — user_id, amount, payment_method (mobile_transfer/lypay), payment_network (libyana/madar), sender_phone, sender_account, payment_reference, status
- `flash_sales` — title, discount_percent, ends_at, is_active
- `admin_users` — username, password_hash, display_name, role
- `support_tickets` — user_id, title, category, status (open/in_progress/closed)
- `ticket_replies` — ticket_id, author_type (user/admin), message
- `referral_events` — referrer_id, referee_id, status (pending/credited), credited_at

## Default Credentials

- **Admin login**: username=`admin`, password=`SubNation@2026`
- Admin access URL: `/admin/login`

## API Routes

### Auth
- `POST /api/auth/register` — register with phone + password + optional referral_code
- `POST /api/auth/login` — login → returns JWT token
- `GET /api/auth/me` — current user (Bearer token required)

### Products & Catalog
- `GET /api/products` — list products (params: search, category, sort, available_only)
- `GET /api/products/:id` — single product
- `GET /api/catalog/stats` — catalog statistics
- `GET /api/flash-sale` — active flash sale

### Orders
- `GET /api/orders` — user's orders (auth)
- `POST /api/orders` — create order (auth)
- `GET /api/orders/:orderCode` — order detail (auth)

### Wallet
- `GET /api/wallet` — wallet balance + recent orders (auth)
- `GET /api/wallet/topups` — topup history (auth)
- `POST /api/wallet/topups` — submit topup request (auth) — supports mobile_transfer or lypay

### Loyalty (Phase 4)
- `GET /api/loyalty` — points, tier, referral code/link, referral stats (auth)
- `POST /api/loyalty/convert-points` — convert points → wallet balance (min 100 pts, auth)

### Support (Phase 4)
- `GET /api/support/tickets` — user's tickets (auth)
- `POST /api/support/tickets` — create ticket (auth)
- `GET /api/support/tickets/:id` — ticket + replies (auth)
- `POST /api/support/tickets/:id/reply` — add reply (auth)

### Admin
- `POST /api/admin/login` — admin login
- `GET /api/admin/stats` — dashboard stats
- `GET /api/admin/chart-data` — 7-day orders/revenue/users chart data
- `GET /api/admin/orders` — all orders
- `GET /api/admin/topups` — all topups
- `POST /api/admin/topups/:id/approve` — approve topup, credit wallet, update tier, trigger referral credit
- `POST /api/admin/topups/:id/reject` — reject topup
- `GET /api/admin/products` — all products
- `POST /api/admin/products` — create product
- `PATCH /api/admin/products/:id` — update product
- `DELETE /api/admin/products/:id` — archive product
- `GET /api/admin/users` — list users
- `PATCH /api/admin/users/:id` — edit wallet/points/tier
- `GET /api/admin/tickets` — all support tickets (filter: ?status=)
- `GET /api/admin/tickets/:id` — ticket detail + replies
- `POST /api/admin/tickets/:id/reply` — admin reply
- `PATCH /api/admin/tickets/:id/status` — change ticket status

## Phase 2 Features

### Theme System
- Dark/Light toggle in navbar, persisted in `sn_theme` localStorage
- ThemeProvider: `artifacts/subnation/src/lib/theme.tsx`

### Notification Bell
- Polling (30s), shows recent orders/topup events
- Component: `artifacts/subnation/src/components/layout/NotificationBell.tsx`

### Admin Dashboard
- Auto-refresh every 30s, live indicator in header
- recharts: AreaChart (orders+revenue 7-day), BarChart (new users 7-day)

### Admin User Management
- Edit modal: wallet adjustment, loyalty points, tier override

### Inventory Bulk Upload
- `/admin/products` → "مخزون" button → paste `email|password|extra_details` per line

### Telegram Notifications
- Triggers: register, topup request, topup approved/rejected, new order
- Env vars: `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`

## Phase 3 Features (Wallet Enhancement)

- Wallet page supports two payment methods: **تحويل رصيد** (mobile_transfer via libyana/madar) and **LyPay** (bank transfer)
- Dynamic presets per network, copy buttons for account details
- Admin topups show method/network badges

## Phase 4 Features (Loyalty + Support)

### Loyalty & Referral System
- `/loyalty` page: points balance, tier progress bar, referral code/link copy, points conversion
- Unique referral code per user, generated on registration
- Anti-fraud: referral credited only after referee's first approved topup
- 50 points per successful referral, 100 points = 1 LYD
- Tier progression: bronze → silver (500 LYD) → gold (2000 LYD) → platinum (5000 LYD)
- Tier auto-upgrades when topup is approved

### Points Conversion
- Convert any multiple of 100 points → wallet balance
- Minimum 100 points, immediate credit

### Support / Ticket System
- `/support` — user-facing: create ticket (title, message, category), chat-style reply view
- `/admin/tickets` — admin: list all tickets with filters, split-pane chat view, close/reopen
- Categories: billing, technical, order, account, other
- Status: open → in_progress → closed

## Important Notes

- Run `pnpm run typecheck:libs` after modifying any `lib/db/src/schema/*.ts` file
- Run `cd lib/db && pnpm drizzle-kit push --force` to apply schema changes to DB
- Flash sale applies discount to ALL products when active
- Referral signup grants 5 LYD to the new user's wallet automatically
- Admin JWT uses `SESSION_SECRET + "_admin"` as secret key

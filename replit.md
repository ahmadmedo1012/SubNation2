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
- `GET /api/loyalty/referrals` — list of referral events with masked phone, status, credited_at (auth)
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
- `/loyalty` page: points balance, tier progress bar, referral code/link copy, points conversion, link to referrals history
- `/referrals` page: dedicated referral program page — stats (total/credited/pending/points earned), referral code + link with copy, share button (Web Share API), how-it-works 4-step grid, full referral history list with masked phone numbers and status
- `GET /api/loyalty/referrals` — returns list of referral events with masked referee phone, status, timestamps, points earned
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

## Phase 7 Features (Admin Panel UI/UX Overhaul — Section 2)

### AdminLayout (`artifacts/subnation/src/pages/admin/layout.tsx`)
- **Collapsible sidebar**: collapse toggle button, icon-only mode at w-16
- **Mobile overlay sidebar**: hamburger menu button in top bar, backdrop dismiss
- **Badge system**: sidebar nav items show pending counts (topups, tickets) via `badges` prop
- **Sticky top bar**: backdrop-blur header with live refresh indicator + refresh button

### Dashboard (`artifacts/subnation/src/pages/admin/dashboard.tsx`)
- 8 KPI metric cards in 2×4 grid, each linking to relevant admin page
- Yellow alert banner when pending topups exist
- AreaChart (orders + revenue) and BarChart (new users) with gradient fills
- Quick access link list

### Topups (`artifacts/subnation/src/pages/admin/topups.tsx`)
- All topups fetched at once, client-side filtered (no double hook calls)
- Rich cards: amount prominent, method/network badges (LyPay vs تحويل رصيد)
- Approve/reject inline with optional reject note
- Animated pending count badge

### Orders (`artifacts/subnation/src/pages/admin/orders.tsx`)
- Zebra-striped table with status badges
- Search bar (order code / phone / product name) + status filter tabs

### Users (`artifacts/subnation/src/pages/admin/users.tsx`)
- Zebra-striped table, current state summary in edit modal
- Wallet mode toggle: Add / Subtract / Set
- Tier select dropdown

### Products (`artifacts/subnation/src/pages/admin/products.tsx`)
- Card grid with product image, stock, order count
- Delete confirmation inline (two-step: trash → archive icon + X)
- Product search bar (>4 products)

### Tickets (`artifacts/subnation/src/pages/admin/tickets.tsx`)
- Avatar-style chat bubbles (shield icon for admin, user icon for user)
- Auto-scroll to latest message on open/reply
- Empty state in right pane when no ticket selected
- Close/reopen status buttons

### Settings (`artifacts/subnation/src/pages/admin/settings.tsx`)
- Three tabs: التكاملات / الإشعارات / الأمان
- Integrations tab: Telegram config status + setup instructions
- Security tab: JWT, password hashing, rate-limit, CORS status display

## Phase 5 Features (Flash Sale + Admin Enhancements)

- Flash sale admin panel: create/stop sale, discount 1–99%, countdown timer on homepage
- Admin settings page: Telegram toggle, platform name, maintenance mode, custom JSON
- Admin inventory view: table of all stock items with sold/available status
- Admin support badge: unread ticket count on nav link

## Phase 6 Features (Security + Validation)

- **Libyan phone validation**: 10-digit, prefixes 091/092/093/094. Validated backend + frontend with real-time inline feedback. Util: `artifacts/subnation/src/lib/validation.ts`
- **Pending topup limit**: max 3 pending topups per user (HTTP 429 + locked UI banner)
- **Google OAuth**: `POST /api/auth/google` — verifies ID token via tokeninfo API. New users get `phone = g_<sub>` placeholder. Requires `VITE_GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_ID` env vars
- **Input sanitization**: trim + length guards on all register/login inputs
- **JWT hard-fail**: `SESSION_SECRET` env var throws on startup if not set

## Production Hardening

- **Rate limiting** (`express-rate-limit`): `/api/auth/*` = 20 req/15min; all `/api/*` = 120 req/min
- **CORS**: Restricted to `REPLIT_DOMAINS` in production; open in development
- **DB pool**: `max: 10`, `idleTimeoutMillis: 30s`, `connectionTimeoutMillis: 5s`
- **Vite build**: `sourcemap: false`; function-based `manualChunks` (vendor-react, vendor-query, vendor-charts, vendor-icons) — keeps React in one chunk to prevent duplicate context errors
- **Font loading**: Google Fonts loaded once via `<link rel="preload">` in HTML only (CSS `@import` removed)
- **SEO**: `<meta name="description">`, `theme-color`, Open Graph tags in `index.html`
- **Seed script**: `pnpm --filter @workspace/scripts seed` — creates admin user + 8 sample products. Reads `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars (defaults: `admin`/`SubNation@2026`)

## Important Notes

- Run `pnpm run typecheck:libs` after modifying any `lib/db/src/schema/*.ts` file
- Run `cd lib/db && pnpm drizzle-kit push --force` to apply schema changes to DB
- Flash sale applies discount to ALL products when active
- Referral signup grants 5 LYD to the new user's wallet automatically
- Admin JWT uses `SESSION_SECRET + "_admin"` as secret key
- Password hashing: SHA256 + `"subnation_salt"` — changing salt invalidates all existing accounts

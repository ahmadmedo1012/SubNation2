> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/r116-round-report.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# R116 Round Report — The Complete Product Overhaul

> Post-migration deep pass on the live product (Coolify → Docker → Neon,
> HEAD `afd7c0a` → this round). 10 parallel audit agents (product/UX,
> visual design, mobile/iPhone, money-flow UX, admin, frontend
> architecture, backend, security, SEO/a11y, WhatsApp/notifications,
> code-quality) + 5 implementation lanes (backend+admin, app-shell,
> design-core, money-pages, SEO content) + main-agent integration.

## Verification record (final tree)

- `pnpm run typecheck` exit 0 (all workspaces)
- `pnpm run lint` — **0 errors / 90 warnings** (baseline 91)
- Backend: **163 files / 1511 tests / 0 failed** (baseline 1497 → +14)
- Frontend: **108 files / 747 tests / 0 failed** (baseline 703 → +44)
- `pnpm run build` exit 0 — entry **27.2KB gz** (was 35.9), sonner
  deferred to its own chunk, Firebase no longer modulepreloaded,
  arabic-600 font preload added
- Browser QA (mock-API preview server, real Chromium): home / category /
  product / flash-sales / login at 390 + 360 + 1440px — **zero console
  errors, zero horizontal overflow at 360px**, product-page desktop
  split verified live (2×548px grid + sticky buy panel)

## Major improvements

**Security & money integrity (backend)**
- **B6-03 closed (the r111 residual):** admin orders list no longer
  decrypts up to 600 AES-GCM credential fields per refresh —
  `GET /api/admin/orders/:id/credentials` (audited, no-store) is the
  only decrypt surface; wallet summary ships `has_credentials` flags
  instead of plaintext; encryption key memoized; safeDecrypt warn
  throttled (kills 600-log-line floods).
- Refund bulk path finance-scoped (B1-3 parity — orders-only admins can
  no longer credit wallets).
- `/api/auth/me` + `/probe` now `Cache-Control: no-store` (PII/wallet
  parity with wallet routes).
- OTP start race serialized via advisory lock (no more double-SMS with
  two live codes); OpenWA origin-truth boot warning; Render blueprint
  Vercel-origin pin removed; copilot tool preserves query strings.
- Public product search LIKE-escaped.

**Customer experience (storefront)**
- **Product page desktop split** — lg+ renders a 2-column layout (media
  + content / sticky buy panel) instead of a centered max-w-xl mobile
  column; mobile DOM order byte-identical (flex order-1..12).
- Whole-dinar topups (USSD codes cannot carry fractions — the floor
  mismatch guaranteed admin rejections), honest min-bound copy, intent
  key rotation on normalization.
- `variant_label` survives the purchase (orders list + order-detail
  chips), loyalty credits attributed in the wallet statement, wallet
  page gets live topup updates (socket), waiting-modal close affordance
  at 10s, background polling dropped.
- 44px tap-target sweep down the money path (coupon buttons, transfer
  code copy, filter chips, back buttons, dialog footers); product sticky
  bar hides on iOS keyboard (visualViewport hook).
- Route-change focus management + sr-only title announcer (F3-07, the
  last r111 a11y residual); 100vh stragglers → dvh; `autoComplete="tel"`.

**Design system convergence**
- Light-theme `--shadow-2xl` bug fixed (dialogs rendered 60%-black
  shadows); light status tokens darkened to AA (measured 4.6–6.5:1);
  31 hardcoded `shadow-black/*` → tokens; dead popover/sidebar token
  families deleted; CTA recipe unified (`size="lg"`); FlashCard
  converged with ProductCard; ProductCard CTA on the shared Button;
  `statusColor()` retired (93-C7 finally landed — 10 sites migrated,
  function + tests deleted); Arabic headline line-heights respect the
  1.3 floor; hero cta-glow removed; tracking-tight dead utilities gone.

**Admin**
- Topup reviewer attribution (`reviewed_by` V1-M23 + «أُقرّ بواسطة … ·
  وقت»); durable order-status notifications (bell rows, not just the
  transient socket emit); `whatsapp_channel` alert type with its own
  badge; send-failure ratio watch (intermittent channel death now
  alerts); admin badge contrast fixed; dates unified via formatDate;
  «استرداد»/«رمز التحويل»/«تعذّر النسخ» copy ledger enforced (✓ glyphs
  dropped).

**Performance**
- Entry diet: −8.7KB gz (sonner lazy + replay bridge for pre-mount
  toasts, admin-session dynamic import, Firebase init gated on actual
  Google identity, boot probes timeout at 10s); admin guard on TanStack
  cache (no remount refetch); toast-shim accepts both sonner-style and
  positional description args (fixed a real double-wrap bug the replay
  tests caught).

**SEO**
- 37 new curated Arabic product entries (8 → 45 — full catalog
  coverage, honest claims, 5 FAQs each) — `docs/SEO_PRODUCTS.json` +
  `docs/seo-enrichment-r116.md` (operator import command documented).
- twitter:card + og:image dimensions static; no-JS message reworded.

## Known follow-ups (documented, deliberate)

- Admin local CopyButton (bare-icon, dense rows) still separate from the
  shared labeled CopyButton (consolidation needs a bare-icon variant).
- B6-07/08 index DDL batches — still deferred (live tables tiny).
- A4-03 wallet-history admin tab not started; A4-05 beyond-name search
  (description/variants/typo tolerance) not started — the `name` ILIKE
  pushdown (`products.ts:236-243`) predates R116 and was hardened in A6-9
  (LIKE-escape).
- Dark-theme white-on-status-error badge ≈3.2:1 (predates round;
  visually identical token swap queued for a dark-tone pass).
- Operator: TOTP on the sole admin + `import-seo.ts --apply` for the 37
  new entries + product shelf restock (pre-existing TODOs).

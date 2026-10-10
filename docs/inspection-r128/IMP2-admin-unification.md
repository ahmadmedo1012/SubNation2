# R128-IMP2 — Admin Visual Unification + Security/A11y Implementation Log

**Agent:** R128-IMP2 (admin lane — المظهر round) · **Base:** main @ `7d469d5` + working tree (other lanes' edits present; admin tree = mine)
**Canon read first:** A1 (§2 D1–D14, F1/F2/F3), A3 (matrix + F1–F9), B3 (F2 CSV, F4 actor dir), A6 (P3-1 sidebar), B8 (terminology tail), A4-F2 (/70 pair). All cites re-verified at HEAD before editing (line drift noted where found).
**Method:** incremental log per work-item (transport-safety). Files touched: `frontend/src/pages/admin/**`, `frontend/src/components/admin/**` only.

---

## Pre-flight census (2026-10-10, at HEAD of my lane's tree)

Raw-palette line hits in admin source (rg census, same regex family as A1 §2.1): **227 lines / 21 files**
(system 81, products 19, pricing 19, dashboard 18, alerts 16, users 14, topups 12, referrals 12, orders 8, promotions 5, risk 4, layout 4, tickets 3, admins 3, whatsapp 2, settings 2, coupons 2, risk-event 1, CopilotPanel 1, ProductVariantsDialog 1) + 1 test-file hit (negative-guard fixture — excluded).

New tokens verified LIVE in index.css (read-only): `--destructive-surface` (dark 0 80% 52% / light 0 80% 48%), `--status-success-surface` (152 65% 30% / 152 60% 28%), `--status-purple`, `--tier-bronze/silver/gold/platinum` (theme-aware AA pairs), `--cat-*` 9-hue family.

---

## Migration plan (locked before editing)

Token map (A1 §2.2, all AA-tuned both themes): emerald/green→`status-success` · yellow/amber→`status-warning` · red→`status-error` · blue/cyan→`status-info` · orange→`status-low-stock` · purple/violet→`status-purple` · topups approve solid→`status-success-surface` (NEW) · referrals tier pills→`tier-silver`/`tier-gold` (NEW) · CATEGORY_INITIAL_COLOR→`cat-*`.
Order (A1-F1): (1) topups badges+buttons, (2) layout chips/dot, (3) CATEGORY_INITIAL_COLOR, (4) D1 severity maps (system→alerts→dashboard→users→orders→pricing→risk→tickets→whatsapp→coupons→promotions→settings→admins→risk-event→enrichment), (5) D9 violet/purple tiles, (6) D7 topups network surfaces, (7) referrals tiers. Then P3 security/a11y batch, /70→/85 pair, negative-guard pin. D8 auth-provider brand hues (lib/admin/user-display.ts — outside my dirs) NOT migrated, per instruction.

---

## Work log (append-only per item)

### [P2 · A1-F1] Admin palette migration — DONE (all 7 steps)

- **(1) topups.tsx (D2 + D13/F2 + B8 tail):** MethodBadge (LyPay/mobile) + NetworkBadge (libyana/madar) → `StatusBadge` purple/info/success/info `size="xs"` (D2's exact proposal); pending-card border + hairline gradient → `status-warning` trio; single + bulk-modal approve buttons `bg-emerald-700 hover:bg-emerald-600` → **`bg-status-success-surface hover:bg-status-success-surface/90`** (the NEW F2 token, 5.05:1 white both themes — retires the documented hand-roll); reject buttons → `status-error` trio; bulk approve/approveAll outline buttons → `status-success` trio. B8 tail: «مثال: المرجع غير صحيح…» → «رمز التحويل غير صحيح…» (:450) + confirm description «مرجع التحويل» → «رمز التحويل» (:921) — the R116-S2 canon is now 100% live in admin.
- **(2) layout.tsx (D3):** 3 solid `bg-yellow-400 text-black` count dots (NavItem collapsed :221, brand tile :1163, hamburger :1326) → the EXPANDED sibling pill's AA recipe `bg-status-warning/15 text-status-warning border-status-warning/30` — **deviation from D3's literal `bg-status-warning text-foreground` proposal, deliberate**: computed, that pairing is ~1.9:1 in dark (warning is a light amber; foreground near-white) and ~8:1/black-impossible in light — the sibling ink-pair is the only both-theme AA shape; live dot `bg-emerald-400` → `bg-status-success` (pill test updated).
- **(3) products.tsx (D4):** `CATEGORY_INITIAL_COLOR` → the canonical 9-hue `bg-cat-*/10 text-cat-*` family (kills the one true admin↔storefront hue split: software sky→217°, vpn cyan→199°).
- **(4) D1 severity maps (14 files, scripted hue-swap with alphas preserved byte-for-byte):** system.tsx 95 tokens (STATUS_META was already warning-tokenized by R126-L5; added the migration header comment), alerts TYPE_META, dashboard KPI maps + legend swatches, users summary strip, orders coupon/discount cluster, pricing SAFE/WATCH/THIN + margin tones + violet rows, risk warn/danger, tickets action buttons, whatsapp banner, coupons, promotions, settings Bot tile, risk-event, admins. Map: emerald/green→success · red→error · blue/cyan/sky→info · orange→low-stock · yellow/amber→warning · violet/purple/fuchsia→purple.
- **(5) D9:** pricing violet KPI rows + system violet/purple icon tiles → `status-purple` (rode the same script).
- **(6) D7 (topups half):** NetworkBadge surfaces → status tokens (wallet.tsx half is the STOREFRONT lane's file — untouched). Brand hue identity preserved (libyana=green, madar=blue) via success/info — the wallet.tsx ink-token precedent.
- **(7) referrals (D10/F3):** `MEDAL_COLORS` slate-400/amber-600 → **`tier-silver`/`tier-bronze`** (gold re-spelled `tier-gold` = var(--status-warning), visually identical); leaderboard Trophy → `tier-gold`. NEW tokens live.
- **D5:** dashboard low-stock KPI card — orange border → `status-low-stock/30` and the codebase's only ad-hoc rgba shadow `shadow-[0_0_0_1px_rgba(251,146,60,0.12)]` DELETED (now the urgent sibling's exact border+hover shape).
- **Migration stats:** 227 raw-palette line-hits → **0** across `pages/admin/**` + `components/admin/**` (rg census, exit 1). ~250 class tokens migrated in 20 source files. NOT migrated (justified): D8 auth-provider brand hues in `lib/admin/user-display.ts` (outside my dirs, brand marks — reported to storefront lane owner); wallet.tsx D7 surfaces (storefront file).
- Two comment-only mentions of raw classes (CopilotPanel:1514, layout:215) paraphrased so the negative guard can stay absolute.

### [P3 · A3-F4] Drawer width typo — NOT A BUG at HEAD (verified, no change)

The audit's `w-in(18rem,85vw)]` claim is a **transport-display artifact**, the same class the design-system-css test header documents ("a display layer that eats the '[h' substring renders 'a[href],' as 'aref],'"). Byte-level proof at base 7d469d5: `git show 7d469d5:…layout.tsx | grep -c 'w-\[min'` = **1**, `grep -c 'w-in('` = **0**, `git diff HEAD -- layout.tsx` clean (the class is `w-[min(18rem,85vw)]` and always was at this commit; Read/Bash outputs that displayed `w-in(` were the mangled renderings — re-verified with od -c). No edit made; A3's "byte-verified via cat -A" was fooled by the same layer.

/**
 * R140-p — CONTRAST HARDENING pins (the r140 consolidation freeze).
 *
 * WHAT THIS SUITE FREEZES: the orchestrator-applied fixes from the
 * r140-i comprehensive WCAG contrast sweep
 * (.kiro/specs/observability-seo-cwv-maturity/inspection-data/
 * contrast-sweep-r140.md — 190 pairs computed, both themes, alpha
 * composited per-channel). The sweep's own lane was AUDIT + REPORT
 * only (index.css orchestrator-owned); the fixes landed centrally and
 * had NO pin suite — every one of them is one blind "cleanup" away
 * from silently regressing. This suite is that guard.
 *
 *   F1  — the toast [data-button] surface pins to hsl(var(--primary))
 *         (white-on-accent measured 1.96:1 on dark success/warning).
 *   F2  — the 12 audited raw-`text-primary` SMALL-TEXT sites ride
 *         text-primary-text (the ink variant; ~5.76:1 dark on card).
 *   F8  — the admin hover sweep rides hover:text-primary-text (the
 *         storefront swept this class in r125 B-2; admin never did).
 *   F3–F6 — five light-theme opacity-step micro-fixes (the /75–/80
 *         alphas that missed AA by 0.01–1.4 in light only).
 *   F7  — ErrorBoundary's dev <pre> drops the /75 alpha.
 *
 *   KEEP-RAW (negative pins): the six LARGE-TEXT money spans stay raw
 *   text-primary — they clear the 3:1 large-text floor (30px/24px/20px
 *   bold tabular-nums) and converting them would visibly brighten the
 *   storefront's anchor money surfaces for zero AA gain. The pins are
 *   deliberately negative-style so nobody "fixes" them blindly: those
 *   spans must NOT gain -text.
 *
 * Source-scan craft (the r139-i/r140 LINE-COMMENTS-FIRST stripper):
 * positive class-fragment pins and ALL negative guards run against
 * comment-stripped sources — the rationale comments NAME the retired
 * tokens ("text-primary → text-primary-text"), so raw absence checks
 * would false-fire on the fix's own documentation. Only the pins that
 * freeze a COMMENT (the keep-raw / 1.96:1 rationale) read raw.
 *
 * Line numbers cited in comments are the SWEEP REPORT's original
 * coordinates; the orchestrator's fix comments shifted a few lines —
 * the pins are content-exact, not line-exact.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** LINE-COMMENTS-FIRST stripper (the 140-g lesson: a `//` note quoting
 *  a `/*` glob must never open a phantom block comment). */
function stripComments(src: string): string {
  return src.replace(/^[ \t]*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Comment-stripped source (class fragments + negative guards). */
function live(rel: string): string {
  return stripComments(read(rel));
}

const INDEX_CSS_RAW = read("src/index.css");

const ADMIN_PRODUCT_CARD = live("src/components/admin/products/ProductCard.tsx");
const BULK_ACTION_BAR = live("src/components/admin/products/BulkActionBar.tsx");
const PRODUCTS_TOOLBAR = live("src/components/admin/products/ProductsToolbar.tsx");
const REFERRAL_ROW_ITEM = live("src/components/admin/referrals/ReferralRowItem.tsx");
const WHATSAPP_HEADER = live("src/components/admin/whatsapp/WhatsappHeader.tsx");
const ENRICHMENT = live("src/pages/admin/enrichment.tsx");
const INVENTORY_DIALOG = live("src/components/admin/InventoryUploadDialog.tsx");
const RISK_META = live("src/components/admin/risk/risk-meta.ts");
// R167 (F12 wave 2): order-detail decomposes into the shared
// components/orders/ family — the F3 refund-points line moved with the
// terminal card, so the pin reads the page ∪ family dir (the R146
// CopyField precedent; the /75 ban is stronger over the union).
const ORDER_DETAIL = [
  "src/pages/order-detail.tsx",
  ...readdirSync(resolve(process.cwd(), "src/components/orders"))
    .filter((f) => f.endsWith(".tsx"))
    .map((f) => `src/components/orders/${f}`),
]
  .map((f) => live(f))
  .join("\n");
const TRANSFER_CODE_PANEL = live("src/components/wallet/TransferCodePanel.tsx");
const ACCOUNT_TAB = live("src/pages/admin/settings/account-tab.tsx");
const ERROR_BOUNDARY = live("src/components/ErrorBoundary.tsx");
const DESKTOP_ORDER_ROW = live("src/components/admin/orders/DesktopOrderRow.tsx");
const MOBILE_ORDER_CARD = live("src/components/admin/orders/MobileOrderCard.tsx");
const ORDERS_TABLE = live("src/components/admin/orders/OrdersTable.tsx");
const RISK_EVENT = live("src/pages/admin/risk-event.tsx");
const PROVIDER_CARD = live("src/pages/admin/settings/provider-card.tsx");
const PRICE_STOCK_PANEL = live("src/components/product/PriceStockPanel.tsx");
const PRICE_STOCK_PANEL_RAW = read("src/components/product/PriceStockPanel.tsx");
const CTA_BLOCK = live("src/components/product/CtaBlock.tsx");
const PROFILE = live("src/pages/profile.tsx");
const PROFILE_RAW = read("src/pages/profile.tsx");

// ── F1 — the toast action button pins to brand primary ────────────────────

describe("R140-i F1 — toast [data-button] rides the brand CTA surface, not the status accent", () => {
  const dataButtonBlock =
    INDEX_CSS_RAW.match(
      /\[data-sonner-toast\]\[data-styled="true"\]\.premium-toast \[data-button\]\s*\{[^}]*\}/,
    )?.[0] ?? "";

  it("the action surface is hsl(var(--primary)) with white primary-foreground ink", () => {
    // White on --toast-accent measured 1.96:1 on the dark
    // success/warning variants (error/info 3.39/3.24 — all short of
    // the 4.5 AA floor). The severity hue stays carried by the accent
    // strip + icon bubble; the button reads as the standard brand CTA
    // (white on primary: 4.93 dark / 5.29 light — AA both themes).
    expect(dataButtonBlock).toContain("background: hsl(var(--primary));");
    expect(dataButtonBlock).toContain("color: hsl(var(--primary-foreground));");
  });

  it("the [data-button] block carries ZERO --toast-accent reference", () => {
    // The OTHER toast rules (accent strip, icon bubble, glow) keep
    // --toast-accent legitimately — only the BUTTON surface had the
    // 1.96:1 white-ink collision. The pin is scoped to the extracted
    // [data-button] declaration block for exactly that reason.
    expect(dataButtonBlock).not.toContain("--toast-accent");
    expect(INDEX_CSS_RAW).toContain("[data-button]");
  });

  it("the R140 central rationale comment survives (the 1.96:1 measurement)", () => {
    // Latent today (zero production `action:` call sites; use-toast.ts
    // documents the option) — the comment is the reason the first
    // caller inherits an AA button instead of a green 1.96:1 one.
    expect(INDEX_CSS_RAW).toContain(
      "R140 central (140-i F1): the action surface pins to brand primary",
    );
    expect(INDEX_CSS_RAW).toContain("white on --toast-accent measured 1.96:1");
  });
});

// ── F2 — the 12 audited small-text sites ride text-primary-text ────────────

describe("R140-i F2 — raw text-primary small text converted to the text-primary-text ink", () => {
  it("admin ProductCard ×3: the 14px bold price, the 11px variant-count chip, the 12px manage button", () => {
    // Sweep sites :158 / :183 / :276 — dark ratios 3.44–3.77 → 5.76+.
    expect(ADMIN_PRODUCT_CARD).toContain('className="font-bold text-primary-text tabular-nums"');
    expect(ADMIN_PRODUCT_CARD).toContain(
      "text-3xs font-bold px-1.5 py-0.5 rounded border bg-primary/10 text-primary-text border-primary/30",
    );
    expect(ADMIN_PRODUCT_CARD).toContain(
      "flex-1 min-w-[88px] h-8 text-xs text-primary-text active:scale-[0.97] transition-transform",
    );
  });

  it("BulkActionBar: the «N منتج محدد» count line (sweep :31)", () => {
    // R188-5 (D-F3): the count rides formatCount (the compound family) —
    // the span keeps the /primary-text bold register the sweep pinned.
    expect(BULK_ACTION_BAR).toContain('<span className="text-sm font-bold text-primary-text">');
    expect(BULK_ACTION_BAR).toContain("{formatCount(selectedCount, PRODUCT_SELECTED_COUNT_FORMS)}");
  });

  it("ReferralRowItem: the credit CTA chip (sweep :114)", () => {
    expect(REFERRAL_ROW_ITEM).toContain(
      "h-7 px-2.5 text-xs gap-1 border-primary/25 text-primary-text hover:bg-primary/8 hover:border-primary/40",
    );
  });

  it("WhatsappHeader: the brand eyebrow over the page title (sweep :16)", () => {
    expect(WHATSAPP_HEADER).toContain(
      '<div className="flex items-center gap-2 text-primary-text mb-1">',
    );
  });

  it("enrichment: the FIELD_LABEL pill chip (sweep :328)", () => {
    expect(ENRICHMENT).toContain(
      'className="text-2xs text-primary-text bg-primary/10 border border-primary/30 px-2 py-0.5 rounded-full"',
    );
  });

  it("InventoryUploadDialog: the upload link + the «كود» chip (sweep :555 + the link site)", () => {
    expect(INVENTORY_DIALOG).toContain(
      "text-xs font-bold text-primary-text hover:text-primary-text/80 flex items-center gap-1.5",
    );
    expect(INVENTORY_DIALOG).toContain(
      "inline-flex items-center gap-1 text-3xs font-bold bg-primary/10 text-primary-text border border-primary/30 px-1.5 py-0.5 rounded",
    );
  });

  it("risk-meta: the primary chip variant (sweep :66 — light missed by 0.01–0.37)", () => {
    expect(RISK_META).toContain('primary: "bg-primary/15 text-primary-text border-primary/40",');
  });
});

// ── F8 — the admin hover sweep rides hover:text-primary-text ───────────────

describe("R140-i F8 — the admin hover sweep: hover:text-primary → hover:text-primary-text", () => {
  const SWEPT_FILES: Array<[string, string]> = [
    ["ProductsToolbar.tsx", PRODUCTS_TOOLBAR],
    ["admin ProductCard.tsx", ADMIN_PRODUCT_CARD],
    ["WhatsappHeader.tsx", WHATSAPP_HEADER],
    ["DesktopOrderRow.tsx", DESKTOP_ORDER_ROW],
    ["MobileOrderCard.tsx", MOBILE_ORDER_CARD],
    ["OrdersTable.tsx", ORDERS_TABLE],
    ["risk-event.tsx", RISK_EVENT],
    ["provider-card.tsx", PROVIDER_CARD],
  ];

  it("every swept site carries the hover:text-primary-text ink transition", () => {
    // Dark raw hover:text-primary on muted links measured 3.62–3.77
    // (floor 4.5). The storefront swept this class in r125 (B-2);
    // these ten admin sites (risk-event carries two) never did.
    for (const [name, src] of SWEPT_FILES) {
      expect(src, name).toContain("hover:text-primary-text");
    }
    // risk-event's TWO sites (sweep :179/:214 — both detail-panel links).
    expect(RISK_EVENT.match(/hover:text-primary-text/g)).toHaveLength(2);
  });

  it("ZERO raw hover:text-primary (non -text) remains in the swept files", () => {
    // The (?!-text) lookahead keeps the converted class legal while
    // flagging any bare-brand hover that creeps back.
    for (const [name, src] of SWEPT_FILES) {
      expect(src, name).not.toMatch(/hover:text-primary(?!-text)/);
    }
  });
});

// ── F3–F6 — the light-theme opacity-step micro-fixes ───────────────────────

describe("R140-i F3–F6 — light-theme opacity steps corrected inside the existing ramp", () => {
  it("F3 order-detail :649 — «كما خُصمت نقاط الشراء…» steps /75 → /85 (3.71 → 4.65 light)", () => {
    // R167 (F12 wave 2): the line rides the terminal-card extract —
    // the pin reads the page ∪ family surface.
    expect(ORDER_DETAIL).toContain("text-2xs text-muted-foreground/85 leading-relaxed mt-1 mb-4");
    expect(ORDER_DETAIL).not.toContain("muted-foreground/75");
  });

  it("F4 enrichment :165 — the «تُعرض أول N» note steps /80 → /90 (4.14 → 5.23 light)", () => {
    expect(ENRICHMENT).toContain(
      'className="text-muted-foreground/90"> (تُعرض أول {drafts.length})</span>',
    );
    expect(ENRICHMENT).not.toContain("muted-foreground/80");
  });

  it("F4 TransferCodePanel :110 — the code display drops the alpha entirely (3.88 → 6.06 light)", () => {
    expect(TRANSFER_CODE_PANEL).toContain(
      "rounded-lg bg-muted/60 border border-border/40 px-3 py-2.5 min-h-[44px] flex items-center text-muted-foreground text-sm",
    );
    expect(TRANSFER_CODE_PANEL).not.toContain("muted-foreground/80");
    // The DISABLED /60-on-/40 pair (:143) is deliberately untouched —
    // WCAG 1.4.3 exempts inactive UI components.
    expect(TRANSFER_CODE_PANEL).toContain("text-muted-foreground/60 cursor-not-allowed");
  });

  it("F5 account-tab :265/:283 — «المصادقة الثنائية» + «تاريخ الإنشاء» inherit text-muted-foreground", () => {
    // The old text-foreground/50 measured 3.39:1 in light; the label
    // pattern at line 263 was already plain muted — these two join it
    // (6.68 light) instead of carrying a 50% foreground step.
    expect(ACCOUNT_TAB).toContain(
      '<span className="block text-muted-foreground">المصادقة الثنائية</span>',
    );
    expect(ACCOUNT_TAB).toContain(
      '<span className="block text-muted-foreground">تاريخ الإنشاء</span>',
    );
    expect(ACCOUNT_TAB).not.toContain("text-foreground/50");
  });

  it("F6 ReferralRowItem :87 — the «قُيِّد: …» timestamp drops /70 → plain success (3.18 → 5.89 light)", () => {
    expect(REFERRAL_ROW_ITEM).toContain('<div className="text-status-success text-3xs mt-0.5">');
    expect(REFERRAL_ROW_ITEM).not.toContain("status-success/70");
  });
});

// ── F7 — ErrorBoundary's dev <pre> ─────────────────────────────────────────

describe("R140-i F7 — ErrorBoundary dev <pre> drops the /75 alpha", () => {
  it("the «للمطورين» stack trace rides plain text-status-error on the /8 wash (3.40 → 5.06 dark)", () => {
    expect(ERROR_BOUNDARY).toContain(
      'className="mt-2 text-3xs text-status-error bg-status-error/8 border border-status-error/15 rounded-lg p-3 overflow-auto text-left leading-relaxed"',
    );
    expect(ERROR_BOUNDARY).not.toContain("status-error/75");
  });
});

// ── KEEP-RAW — the six large-text money spans STAY raw text-primary ────────

describe("R140-i keep-raw — large-text money spans stay text-primary (the 3:1 large floor)", () => {
  it("PriceStockPanel :38 — the 30px bold PDP price stays raw (3.68 dark / 5.13 light ≥ 3:1)", () => {
    expect(PRICE_STOCK_PANEL).toContain(
      '<div className="text-3xl font-bold text-primary leading-none tabular-nums">',
    );
    // Negative-style pin: the money span must NOT "gain" the ink
    // variant — converting it would brighten the storefront's anchor
    // money surface for zero AA gain (large-text floor already met).
    expect(PRICE_STOCK_PANEL).not.toContain("text-3xl font-bold text-primary-text");
    // The in-source rationale (the sweep's own math) survives.
    expect(PRICE_STOCK_PANEL_RAW).toContain(
      "the primary ink clears AA at the large-text 3:1 floor: 3.68:1",
    );
  });

  it("CtaBlock ×4 — the 20px bold price stacks stay raw (3.77–3.98 ≥ 3:1)", () => {
    // Sweep sites :151/:238/:270/:321 — the guest, loading, authed and
    // compact-twin price stacks, one shape across all four branches.
    expect(CTA_BLOCK.match(/font-bold text-primary text-xl/g)).toHaveLength(4);
    expect(CTA_BLOCK).not.toMatch(/text-xl[^"]*text-primary-text|text-primary-text[^"]*text-xl/);
    // The SMALL shortfall span (:297, «تحتاج إضافة» on bg-primary/8)
    // is the deliberate opposite: small text on a tint well DOES need
    // the ink variant — both registers coexist in one file.
    expect(CTA_BLOCK).toContain('className="font-bold text-primary-text tabular-nums"');
  });

  it("profile :311 — the 24px bold tier initial stays raw (3.98 ≥ 3:1 on the muted well)", () => {
    expect(PROFILE).toContain('<span className="text-2xl font-bold text-primary select-none">');
    expect(PROFILE).not.toContain("text-2xl font-bold text-primary-text");
    // The in-source rationale comment survives.
    expect(PROFILE_RAW).toContain("text-primary (2xl bold = large text, ≥3:1 on the muted");
  });
});

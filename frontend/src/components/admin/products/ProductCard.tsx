import React from "react";
// 93-C7 / C-UX2 (A12 B9): product inactive/out-of-stock pills migrate
// from a square rounded/raw-orange tuple to the canonical StatusBadge
// (neutral / low-stock tones on the --status-* tokens).
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { InlineStockEdit } from "@/components/admin/products/InlineStockEdit";
import { CATEGORY_INITIAL_COLOR } from "@/components/admin/products/products-meta";
import { categoryLabel, formatCount, formatCurrency } from "@/lib/utils";
import { productArtUrl } from "@/lib/product-art";
import type { AdminProduct } from "@workspace/api-client-react";
import { CheckSquare, Edit2, Layers, Square, Trash2, Upload } from "lucide-react";

// R137 (FE decomposition): extracted verbatim from pages/admin/products.tsx —
// the catalog card (selection checkbox, category tile, status pills, the
// price/variant-count/margin stat bar, the inline stock editor trigger and
// the four row actions). Presentational by contract: every atom it reads
// (product identity, isSelected, isEditingStock) arrives as a prop and all
// seven interactions call page-owned callbacks — the R124-I5 memoization
// (typing in the search box re-renders nothing but the box) is preserved
// byte-for-byte. The move only changes its address; DOM, classes, aria and
// event semantics are byte-identical.

/* ── R124-I5 (A6 F4 — the R118-B2 orders.tsx pattern) ──────────────────
 * The search box is a CONTROLLED input — every keystroke re-rendered the
 * whole page and (with the 200-card grid inlined in the map closure) all
 * card subtrees with fresh inline handlers, TWICE a minute more via the
 * 60s refetchInterval. The card is now a module-level React.memo
 * component whose props are stable across a keystroke (product refs come
 * from the query data array; isSelected/isEditingStock are primitives;
 * the seven callbacks are useCallback-stable), so typing re-renders the
 * search box and nothing else, and the poll only busts cards whose rows
 * actually changed identity. */
interface ProductCardProps {
  product: AdminProduct;
  isSelected: boolean;
  /** Whether THIS card's inline stock editor is open. */
  isEditingStock: boolean;
  onToggleSelect: (id: number) => void;
  onEdit: (product: AdminProduct) => void;
  onEditStock: (id: number) => void;
  onStockEditDone: () => void;
  onUploadInventory: (product: AdminProduct) => void;
  onManageVariants: (product: AdminProduct) => void;
  onArchive: (product: AdminProduct) => void;
}

const ProductCard = React.memo(function ProductCard({
  product,
  isSelected,
  isEditingStock,
  onToggleSelect,
  onEdit,
  onEditStock,
  onStockEditDone,
  onUploadInventory,
  onManageVariants,
  onArchive,
}: ProductCardProps) {
  return (
    <div
      className={`bg-card border rounded-2xl overflow-hidden transition-all hover:shadow-lg ${
        /* R139 (precision): the selected card drops the ring + colored
           md-shadow stack (a selection state wearing BOTH a ring and a
           brand-colored shadow — row elevation + glow) for the calm
           tinted dialect: border-primary/30 + bg-primary/5, the same
           1px border width every other branch carries. The family's
           selected-row tint; the neutral hover:shadow-lg step above
           stays the only elevation. */
        isSelected
          ? "border-primary/30 bg-primary/5"
          : !product.is_active
            ? "opacity-55 border-border/60"
            : product.stock_count === 0
              ? "border-status-low-stock/25"
              : "border-border/60 hover:border-border"
      }`}
    >
      <div className="p-4">
        {/* Product info */}
        <div className="flex items-start gap-3 mb-3">
          {/* Checkbox — 94-C2: aria-label so the icon-only
              toggle is announced (and reachable by tests). */}
          <button
            onClick={() => onToggleSelect(product.id)}
            aria-label={`تحديد ${product.name}`}
            /* R124-I5 (A6 F10): the bulk-archive selection state feeding
               the destructive action was visual-only — aria-pressed
               exposes it (the orders.tsx row-selector idiom). */
            aria-pressed={isSelected}
            className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary-text transition-colors"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-primary" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
          {/* R139 (precision): the thumb joins the r138 shelf family —
              bg-muted/60 well + border-border/40 edge (the cart thumbnail
              / EmptyState tile vocabulary; the old bg-muted was the same
              tone as the card body, sub-perceptual as a well). The cat-hue
              fallback tiles keep their semantic wash on top. */}
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border border-border/40 ${!product.image_url ? (CATEGORY_INITIAL_COLOR[product.category ?? ""] ?? "bg-muted/60") : "bg-muted/60"}`}
          >
            {product.image_url ? (
              <img
                src={productArtUrl(product.image_url)}
                alt={product.name}
                loading="lazy"
                decoding="async"
                /* R-140-a (image discipline): width/height mirror the
                   catalog art's measured 1024×1024 intrinsic (all 45
                   /products/*.webp, the R132 L4-F9 census re-probed
                   this round) — the fixed w-11 h-11 well already pins
                   CLS at zero; the attrs keep the aspect-ratio
                   reserve honest pre-CSS. */
                width={1024}
                height={1024}
                className="w-full h-full object-contain p-1.5"
                onError={(e) => {
                  // R139 (precision): the failed-image fallback wash matches
                  // the well's new bg-muted/60 (one shelf tone — class
                  // literal only, the swap logic untouched).
                  e.currentTarget.style.display = "none";
                  e.currentTarget.parentElement!.classList.add(
                    CATEGORY_INITIAL_COLOR[product.category ?? ""]?.split(" ")[0] ?? "bg-muted/60",
                  );
                }}
              />
            ) : (
              <span className="text-base font-bold">{product.name.charAt(0).toUpperCase()}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-sm truncate">{product.name}</div>
            <div className="text-xs text-muted-foreground">{categoryLabel(product.category)}</div>
          </div>
          <div className="flex flex-col gap-1 items-end shrink-0">
            {/* 93-C7 / C-UX2 (A12 B9): canonical pills (were a
                square rounded + raw orange tuple). */}
            {!product.is_active && (
              <StatusBadge variant="neutral" size="xs">
                غير نشط
              </StatusBadge>
            )}
            {product.stock_count === 0 && product.is_active && (
              <StatusBadge variant="low-stock" size="xs">
                نفد المخزون
              </StatusBadge>
            )}
          </div>
        </div>

        {/* Stats bar — inline stock edit */}
        <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/25 border border-border/40 rounded-lg mb-3">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <span className="font-bold text-primary-text tabular-nums">
              {formatCurrency(product.price)}
            </span>
            {/* catalog-recon: variant-count badge — the display
                price is MIN(active variants); zero variants =
                unbuyable product (actionable catalog signal). */}
            {(() => {
              const count = product.variants?.length ?? 0;
              if (count === 0)
                return (
                  <span
                    title="لا باقات — اضغط «الباقات» لإضافة باقة"
                    className="text-3xs font-bold px-1.5 py-0.5 rounded border bg-status-warning/15 text-status-warning border-status-warning/30"
                  >
                    بلا باقات
                  </span>
                );
              return (
                <span
                  title="عدد باقات المنتج — اضغط «الباقات» للإدارة"
                  /* R139 (precision): the static-badge edge /25 → the
                     family /30 — one border value across the catalog
                     lane (the InventoryUploadDialog «كود» badge + the
                     r138 family pill border ride /30; a same-family
                     10% alpha spread is vocabulary drift). */
                  className="text-3xs font-bold px-1.5 py-0.5 rounded border bg-primary/10 text-primary-text border-primary/30"
                >
                  {formatCount(count, {
                    one: "باقة",
                    two: "باقتان",
                    few: "باقات",
                    many: "باقة",
                    other: "باقة",
                  })}
                </span>
              );
            })()}
            {(() => {
              // R125-I3 (A2-20): the generated AdminProduct already
              // declares cost_price — the pre-codegen-era cast is gone.
              const cp = product.cost_price;
              if (cp == null) return null;
              const margin = product.price - cp;
              const pct = product.price > 0 ? (margin / product.price) * 100 : 0;
              const tone =
                margin < 0
                  ? "bg-destructive/15 text-destructive border-destructive/30"
                  : pct < 10
                    ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                    : "bg-status-success/15 text-status-success border-status-success/30";
              return (
                <span
                  /* 96-F7 (R96 A6 #11): 9px → 10px — a
                      functional money hint (margin %), not
                      decoration. */
                  className={`text-3xs font-bold tabular-nums px-1.5 py-0.5 rounded border ${tone}`}
                  title={`تكلفة: ${formatCurrency(cp)} / هامش: ${formatCurrency(margin)}`}
                >
                  {margin >= 0 ? "+" : ""}
                  {pct.toFixed(0)}%
                </span>
              );
            })()}
          </div>
          <div className="flex items-center gap-3 text-xs">
            {isEditingStock ? (
              <InlineStockEdit
                productId={product.id}
                current={product.stock_count}
                onDone={onStockEditDone}
              />
            ) : (
              <button
                onClick={() => onEditStock(product.id)}
                className={`font-bold tabular-nums hover:underline decoration-dashed underline-offset-2 transition-colors ${
                  product.stock_count === 0 ? "text-status-low-stock" : "text-status-success"
                }`}
                /* R115 (A9 P3-7): the inline edit is an absolute
                   SET, not +N — say so on the trigger too. */
                title="انقر لتعديل المخزون — تعيين العدد الكلي (وليس إضافة)"
              >
                {product.stock_count} وحدة
              </button>
            )}
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{product.order_count} طلب</span>
          </div>
        </div>

        {/* Actions */}
        {/* 96-F7 (R96 M9): destructive archive stays visually
            separated (gap-2 + min-w-9) from the adjacent
            «رفع مخزون» button, and now opens the shared
            confirm dialog instead of swapping into the inline
            Archive/X icon pair. */}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 min-w-[88px] h-8 text-xs active:scale-[0.97] transition-transform"
            onClick={() => onEdit(product)}
          >
            <Edit2 className="w-3 h-3 me-1" /> تعديل
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="flex-1 min-w-[88px] h-8 text-xs text-muted-foreground active:scale-[0.97] transition-transform"
            onClick={() => onUploadInventory(product)}
          >
            <Upload className="w-3 h-3 me-1" /> رفع مخزون
          </Button>
          {/* catalog-recon: variant manager entry (plan/duration/
              cost + engine pricing). */}
          <Button
            size="sm"
            variant="outline"
            aria-label={`إدارة باقات ${product.name}`}
            className="flex-1 min-w-[88px] h-8 text-xs text-primary-text active:scale-[0.97] transition-transform"
            onClick={() => onManageVariants(product)}
          >
            <Layers className="w-3 h-3 me-1" /> الباقات
          </Button>
          <Button
            size="sm"
            variant="outline"
            aria-label={`أرشفة ${product.name}`}
            className="h-8 min-w-9 px-2 border-destructive/15 text-destructive/50 hover:border-destructive/35 hover:text-destructive hover:bg-destructive/8 active:scale-90"
            onClick={() => onArchive(product)}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Inventory upload now happens in a full-screen
          dialog (see InventoryUploadDialog). The 'رفع مخزون'
          button above opens it; it gives the operator a
          preview table, drag-drop file support, and dedup
          detection before the POST fires. */}
    </div>
  );
});

export { ProductCard };

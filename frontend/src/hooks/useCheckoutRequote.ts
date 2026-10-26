// R158 (hooks lane — decomposition): extracted verbatim from
// pages/checkout.tsx — the 98-F2 live-requote state machine (the three
// requote atoms + quotedProductIdsRef + the settle/requote loop) moved
// here; every other atom, effect and handler stays in the page. The
// hook takes the useCallback-stable cart commands (removeItem /
// reconcileLine — deps []) and the page's token/isLoaded/items, and
// returns the requote state the page consumes (canSubmit's
// pricingRecheckInFlight gate + CartSummaryAside's notices). The
// checkout-decomposition-r136 pin now asserts this ownership.
import { useEffect, useRef, useState } from "react";
import { getProduct } from "@workspace/api-client-react";
import { readLiveCartItems, roundToCents, type LocalCartItem } from "@/lib/cart";
import { quoteLineFromProduct } from "@/components/checkout/live-requote";

/** The page-owned inputs the requote machine consumes (all defined
 * before the hook's call site in checkout.tsx — see lib/cart.tsx for
 * the command types; removeItem/reconcileLine are useCallback-stable
 * with deps [], so the effect below re-runs only for real cart
 * changes). */
export interface UseCheckoutRequoteInput {
  token: string | null;
  isLoaded: boolean;
  items: LocalCartItem[];
  removeItem: (productId: number, variantId?: number | null) => void;
  reconcileLine: (
    productId: number,
    pricing: Pick<LocalCartItem, "priceLYD" | "salePriceLYD" | "discountPercent"> & {
      stockCount?: number | null;
    },
    variantId?: number | null,
  ) => void;
}

/** The requote state the page consumes: the CTA's in-flight gate +
 * the summary aside's two notice lines. */
export interface UseCheckoutRequoteResult {
  pricingRecheckInFlight: boolean;
  pricesUpdatedNotice: string | null;
  droppedLineNotices: string[];
}

export function useCheckoutRequote({
  token,
  isLoaded,
  items,
  removeItem,
  reconcileLine,
}: UseCheckoutRequoteInput): UseCheckoutRequoteResult {
  // 98-F2 (R98-A3 F5 / P2): mount-time live-price reconciliation state —
  // see the re-quote effect below for the full contract.
  const [pricingRecheckInFlight, setPricingRecheckInFlight] = useState(false);
  const [pricesUpdatedNotice, setPricesUpdatedNotice] = useState<string | null>(null);
  const [droppedLineNotices, setDroppedLineNotices] = useState<string[]>([]);

  // 98-F2 (R98-A3 F5 / P2): re-quote every cart line from the LIVE
  // catalog before the confirm CTA unlocks. Cart snapshots are taken at
  // add-to-cart time (lib/cart.tsx) and were NEVER refreshed here — a
  // flash sale that ended between add and confirm had the shopper
  // approve "80.00 د.ل" while every unit charged the live 100.00.
  //
  // Contract (per DISTINCT product id, at most once per checkout visit):
  //   • price changed → reconcileLine refreshes the snapshot (quantity
  //     untouched) and ONE subtle notice «تم تحديث الأسعار حسب الأسعار
  //     الحالية» is shown — never a silent repricing;
  //   • product archived (404/410) / deactivated (is_active:false) /
  //     selected variant gone (VARIANT_NOT_FOUND server-side) → the
  //     line is dropped with its own notice (those orders 400 anyway);
  //   • fetch failure → fail-open (the snapshot stands; the server is
  //     the charge authority and surfaces any mismatch);
  //   • no change → silent.
  // The loop's mutations are lineKey-targeted (removeItem/reconcileLine
  // no-op on already-changed lines), so an items edit landing mid-flight
  // degrades safely; customFetch bounds each request with a 20 s abort
  // so the CTA gate below can never hang. New products arriving later
  // (cross-tab storage event) are picked up by the next run — each id is
  // quoted at most once per visit.
  const quotedProductIdsRef = useRef<Set<number>>(new Set());
  // B-F1 (R188-6): a FLIGHT counter, not a boolean — a second requote
  // flight (a cross-tab storage-event add during the mount window) arming
  // while the first is in flight had the FIRST flight's finally clear the
  // shared gate and unlock the confirm CTA while the new line's live
  // price was still unreconciled (the 98-F2 class).
  const requoteFlightsRef = useRef(0);
  useEffect(() => {
    if (!token || !isLoaded || items.length === 0) return;
    const pending = [...new Set(items.map((i) => i.productId))].filter(
      (id) => !quotedProductIdsRef.current.has(id),
    );
    if (pending.length === 0) return;
    pending.forEach((id) => quotedProductIdsRef.current.add(id));
    requoteFlightsRef.current += 1;
    setPricingRecheckInFlight(true);
    // try/finally + .catch: the in-flight gate MUST clear even when the
    // re-quote dies before its first await (a synchronous throw out of
    // the client module — e.g. a mis-mocked or broken import — rejects
    // this promise before any fetch timeout can bound it). Without it
    // the CTA stayed «جارٍ تحديث الأسعار…» forever: fail-open is the
    // contract, and the server re-prices every unit order anyway.
    void (async () => {
      try {
        const settled = await Promise.allSettled(pending.map((id) => getProduct(id)));
        let anyPriceChanged = false;
        const dropped: string[] = [];
        const lineNotice = (line: LocalCartItem, productId: number) =>
          `${line.name.trim() || `#${productId}`} لم يعد متاحاً للشراء — أُزيل من الطلب.`;
        // G-3 (R142): the drop branches iterate this effect's STALE items
        // snapshot, but removeItem is KEY-targeted — a remove-then-re-add
        // of the same (productId, variantId) while the quote was in flight
        // would otherwise remove the RE-ADDED line on a possibly-transient
        // verdict (a transient 404 killing a live intent). Guard: at drop
        // time, re-read the LIVE cart and only remove when the line still
        // occupying the key carries THIS snapshot's quantity — a re-add
        // resets it to the add-time quantity, so a superseded intent fails
        // the equality and survives. Unverifiable storage (null) or an
        // already-user-removed line means nothing to mutate — no drop,
        // no notice (the old code dropped unconditionally on stale data).
        const removeIfStillSameIntent = (line: LocalCartItem): boolean => {
          const live = readLiveCartItems();
          if (!live) return false;
          const current = live.find(
            (l) => l.productId === line.productId && l.variantId === line.variantId,
          );
          if (!current || current.quantity !== line.quantity) return false;
          removeItem(line.productId, line.variantId);
          return true;
        };
        for (let i = 0; i < pending.length; i++) {
          const productId = pending[i];
          const result = settled[i];
          // A 404 (archived product) arrives as a rejected ApiError — the
          // only rejection class acted on; everything else is fail-open.
          if (result.status === "rejected") {
            const reason = result.reason as { name?: string; status?: number } | undefined;
            const archived =
              reason?.name === "ApiError" && (reason?.status === 404 || reason?.status === 410);
            if (archived) {
              for (const line of items) {
                if (line.productId !== productId) continue;
                if (removeIfStillSameIntent(line)) dropped.push(lineNotice(line, productId));
              }
            }
            continue;
          }
          const live = result.value;
          if (live.is_active === false) {
            // Deactivated products are refused server-side
            // (PRODUCT_NOT_FOUND in checkout.service) while the detail
            // route still serves them for display — this is the honest
            // drop point.
            for (const line of items) {
              if (line.productId !== productId) continue;
              if (removeIfStillSameIntent(line)) dropped.push(lineNotice(line, productId));
            }
            continue;
          }
          for (const line of items) {
            if (line.productId !== productId) continue;
            const quote = quoteLineFromProduct(live, line);
            if (quote.status === "unavailable") {
              if (removeIfStillSameIntent(line)) dropped.push(lineNotice(line, productId));
              continue;
            }
            const snapshotPrice = line.salePriceLYD ?? line.priceLYD;
            const priceChanged =
              roundToCents(quote.effectiveUnitPrice) !== roundToCents(snapshotPrice);
            // R129-A1 (F1 wiring — B-11): the re-quote refreshes the
            // line's stock snapshot alongside price — guarded by
            // value-inequality because reconcileLine has no same-value
            // identity guard (an unconditional call inside this
            // items-dependent effect would loop). A stale «متبقٍ N فقط»
            // / «نفد المخزون» verdict now corrects itself here, BEFORE
            // the charge.
            const stockChanged = line.stockCount !== quote.stockCount;
            if (priceChanged || stockChanged) {
              reconcileLine(
                productId,
                {
                  priceLYD: quote.priceLYD,
                  salePriceLYD: quote.salePriceLYD,
                  discountPercent: quote.discountPercent,
                  stockCount: quote.stockCount,
                },
                line.variantId,
              );
            }
            if (priceChanged) anyPriceChanged = true;
          }
        }
        // Shown ONCE for the whole re-quote (subtle status, not an error —
        // the totals next to it already carry the new numbers).
        if (anyPriceChanged) setPricesUpdatedNotice("تم تحديث الأسعار حسب الأسعار الحالية");
        if (dropped.length > 0) setDroppedLineNotices(dropped);
      } finally {
        // B-F1 (R188-6): only the LAST flight to land clears the gate —
        // an overlapping flight's verdict is still unreconciled stock.
        requoteFlightsRef.current -= 1;
        if (requoteFlightsRef.current === 0) setPricingRecheckInFlight(false);
      }
    })().catch(() => {
      // Fail-open, silently: the snapshot stands and the CTA unlocks
      // (the flag was already cleared by the finally block).
    });
    // removeItem/reconcileLine are useCallback-stable (deps []) — the
    // effect re-runs only for real cart changes, and early-returns
    // while every product id is already quoted.
  }, [token, isLoaded, items, removeItem, reconcileLine]);

  return { pricingRecheckInFlight, pricesUpdatedNotice, droppedLineNotices };
}

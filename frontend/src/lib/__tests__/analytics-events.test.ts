/**
 * R168 — the GA4 ecommerce event layer's unit contract.
 *
 * The app-side contract under test is the dataLayer push (gtag.js
 * suppresses collect beacons under automated browsers — the R168
 * verification note — so transmission is deliberately NOT asserted
 * here; the e2e spec covers loader + config + Enhanced Measurement
 * against the live surface).
 *
 * jsdom's REAL localStorage rides the purchase dedup guard; module
 * state (the search dedupe variable + the in-memory sent-set) is
 * reset per-test via vi.resetModules() + a fresh dynamic import —
 * the same isolation a page refresh gives the real module.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EcommerceItem, PurchaseOrderInput } from "../analytics-events";

/** Fresh module copy (fresh module-level state) — a simulated reload. */
async function freshModule() {
  vi.resetModules();
  return await import("../analytics-events");
}

/** Arm the R164 loader's own gtag shape: pushes land on dataLayer. */
function armGtag(): void {
  window.dataLayer = [];
  window.gtag = (...args: unknown[]) => {
    window.dataLayer!.push(args);
  };
}

type LayerEntry = [string, ...unknown[]];

/** The payloads of every pushed occurrence of `eventName`. */
function fired(eventName: string): Record<string, unknown>[] {
  return ((window.dataLayer ?? []) as unknown as LayerEntry[])
    .filter((e) => e[0] === "event" && e[1] === eventName)
    .map((e) => e[2] as Record<string, unknown>);
}

function order(code: string, overrides: Partial<PurchaseOrderInput> = {}): PurchaseOrderInput {
  return {
    order_code: code,
    amount: 42,
    status: "completed",
    product_id: 9,
    product_name: "Spotify Premium",
    variant_label: "فردي — 1 شهر",
    coupon_code: null,
    discount_amount: 0,
    ...overrides,
  };
}

const ITEM: EcommerceItem = {
  item_id: "7",
  item_name: "Netflix Premium",
  item_category: "streaming",
  item_variant: "Individual — 1 month",
  price: 25.5,
  quantity: 2,
};

beforeEach(() => {
  localStorage.clear();
  delete window.gtag;
  window.dataLayer = [];
});

describe("R168 analytics-events — the gtag guard", () => {
  it("every event is a no-op without window.gtag (zero dataLayer growth)", async () => {
    const m = await freshModule();
    m.trackViewItem(ITEM);
    m.trackViewItemList([ITEM], "catalog");
    m.trackSelectItem(ITEM, "catalog");
    m.trackSearch("نتفلكس");
    m.trackAddToCart(ITEM);
    m.trackBeginCheckout([ITEM], 51);
    m.trackPurchase(order("ORD-NOGTAG"));
    expect(window.dataLayer).toHaveLength(0);
    // The purchase guard must also not have burned the code: arming
    // gtag afterwards still fires the event once.
    armGtag();
    m.trackPurchase(order("ORD-NOGTAG"));
    expect(fired("purchase")).toHaveLength(1);
  });
});

describe("R168 analytics-events — discovery payload shapes", () => {
  it("view_item: currency LYD, numeric value = price × quantity, single item", async () => {
    const m = await freshModule();
    armGtag();
    m.trackViewItem(ITEM);
    const [payload] = fired("view_item");
    expect(payload!.currency).toBe("LYD");
    expect(typeof payload!.value).toBe("number");
    expect(payload!.value).toBe(51);
    expect(payload!.items).toEqual([ITEM]);
  });

  it("view_item_list: item_list_id + items, NO value (impressions are not transactions)", async () => {
    const m = await freshModule();
    armGtag();
    const other: EcommerceItem = { ...ITEM, item_id: "8", item_variant: "Family — 1 month" };
    m.trackViewItemList([ITEM, other], "search");
    const [payload] = fired("view_item_list");
    expect(payload!.item_list_id).toBe("search");
    expect(payload!.items).toEqual([ITEM, other]);
    expect("value" in payload!).toBe(false);
  });

  it("select_item: item_list_id only when provided", async () => {
    const m = await freshModule();
    armGtag();
    m.trackSelectItem(ITEM, "flash-sales");
    m.trackSelectItem(ITEM);
    const payloads = fired("select_item");
    expect(payloads[0]!.item_list_id).toBe("flash-sales");
    expect("item_list_id" in payloads[1]!).toBe(false);
    expect(payloads[1]!.items).toEqual([ITEM]);
  });

  it("every payload stays numeric money — no «د.ل» anywhere", async () => {
    const m = await freshModule();
    armGtag();
    m.trackViewItem(ITEM);
    m.trackViewItemList([ITEM], "catalog");
    m.trackSelectItem(ITEM, "catalog");
    m.trackSearch("نتفلكس");
    m.trackAddToCart(ITEM);
    m.trackBeginCheckout([ITEM], 51, "SAVE10");
    m.trackPurchase(order("ORD-FMT"));
    expect(JSON.stringify(window.dataLayer)).not.toContain("د.ل");
  });
});

describe("R168 analytics-events — search", () => {
  it("passes the committed term through and dedupes consecutive + empty terms", async () => {
    const m = await freshModule();
    armGtag();
    m.trackSearch("نتفلكس");
    m.trackSearch("نتفلكس"); // consecutive duplicate
    m.trackSearch("  نتفلكس  "); // trimmed compare
    m.trackSearch(""); // empty
    m.trackSearch("   "); // whitespace-only
    expect(fired("search")).toHaveLength(1);
    expect(fired("search")[0]!.search_term).toBe("نتفلكس");

    m.trackSearch("spotify");
    expect(fired("search")).toHaveLength(2);
    expect(fired("search")[1]!.search_term).toBe("spotify");

    // an empty term must not clobber the last FIRED term
    m.trackSearch("");
    m.trackSearch("spotify");
    expect(fired("search")).toHaveLength(2);
  });
});

describe("R168 analytics-events — cart funnel", () => {
  it("add_to_cart: value = effective price × quantity", async () => {
    const m = await freshModule();
    armGtag();
    m.trackAddToCart({ ...ITEM, price: 12.5, quantity: 4 });
    const [payload] = fired("add_to_cart");
    expect(payload!.currency).toBe("LYD");
    expect(payload!.value).toBe(50);
    expect(payload!.items).toEqual([{ ...ITEM, price: 12.5, quantity: 4 }]);
  });

  it("begin_checkout: coupon_code only when present, value verbatim from the caller", async () => {
    const m = await freshModule();
    armGtag();
    m.trackBeginCheckout([ITEM], 99.97, "SAVE10");
    const [withCoupon] = fired("begin_checkout");
    expect(withCoupon!.currency).toBe("LYD");
    expect(withCoupon!.value).toBe(99.97);
    expect(withCoupon!.coupon_code).toBe("SAVE10");
    expect(withCoupon!.items).toEqual([ITEM]);

    m.trackBeginCheckout([ITEM], 51);
    const [withoutCoupon] = fired("begin_checkout").slice(1);
    expect("coupon_code" in withoutCoupon!).toBe(false);
    expect(withoutCoupon!.value).toBe(51);
  });
});

describe("R168 analytics-events — purchase eligibility", () => {
  it("fires for pending/completed confirmed orders only, with a code and a finite amount", async () => {
    const m = await freshModule();
    armGtag();
    m.trackPurchase(order("ORD-FAIL", { status: "failed" }));
    m.trackPurchase(order("ORD-REFUND", { status: "refunded" }));
    m.trackPurchase(order("", { status: "completed" }));
    m.trackPurchase(order("ORD-NAN", { amount: Number.NaN }));
    m.trackPurchase(order("ORD-INF", { amount: Number.POSITIVE_INFINITY }));
    m.trackPurchase(order("ORD-NEG", { amount: -1 }));
    // missing order_code (runtime hole the guard covers)
    m.trackPurchase(order("ORD-X", { order_code: undefined as unknown as string }));
    expect(window.dataLayer).toHaveLength(0);

    m.trackPurchase(order("ORD-PENDING", { status: "pending" }));
    m.trackPurchase(order("ORD-DONE", { status: "completed" }));
    expect(fired("purchase")).toHaveLength(2);
  });
});

describe("R168 analytics-events — purchase dedup", () => {
  it("happy path: transaction_id = order_code, value = amount, one item with the variant label", async () => {
    const m = await freshModule();
    armGtag();
    m.trackPurchase(order("ORD-1001"));
    const [payload] = fired("purchase");
    expect(payload!.transaction_id).toBe("ORD-1001");
    expect(payload!.currency).toBe("LYD");
    expect(typeof payload!.value).toBe("number");
    expect(payload!.value).toBe(42);
    expect(payload!.items).toEqual([
      {
        item_id: "9",
        item_name: "Spotify Premium",
        item_variant: "فردي — 1 شهر",
        price: 42,
        quantity: 1,
      },
    ]);
    // gtag owns the identity — the app never sets these
    expect("user_id" in payload!).toBe(false);
    expect("client_id" in payload!).toBe(false);
    // no coupon on the order → no coupon_code on the event
    expect("coupon_code" in payload!).toBe(false);
  });

  it("coupon_code rides the event only when the order carries one", async () => {
    const m = await freshModule();
    armGtag();
    m.trackPurchase(order("ORD-C1", { coupon_code: "SAVE5", discount_amount: 5 }));
    const [payload] = fired("purchase");
    expect(payload!.coupon_code).toBe("SAVE5");
    expect((payload!.items as EcommerceItem[])[0]!.discount).toBe(5);
  });

  it("one purchase per order_code in-session, across a simulated refresh, and per distinct code", async () => {
    const a = await freshModule();
    armGtag();
    a.trackPurchase(order("ORD-D1"));
    a.trackPurchase(order("ORD-D1"));
    expect(fired("purchase")).toHaveLength(1);

    // Simulated refresh: fresh module copy (fresh in-memory Set), same
    // localStorage — the durable sent-set must still suppress.
    const b = await freshModule();
    armGtag();
    b.trackPurchase(order("ORD-D1"));
    expect(fired("purchase")).toHaveLength(0);

    b.trackPurchase(order("ORD-D2"));
    expect(fired("purchase")).toHaveLength(1);
    expect(fired("purchase")[0]!.transaction_id).toBe("ORD-D2");

    // The sent-set survives under the documented analytics-only slot.
    expect(JSON.parse(localStorage.getItem("subnation_ga4_sent")!)).toEqual(["ORD-D1", "ORD-D2"]);
  });

  it("the sent-set is bounded to the 100 most recent codes (the 101st evicts the oldest)", async () => {
    const m = await freshModule();
    armGtag();
    for (let i = 1; i <= 100; i++) {
      m.trackPurchase(order(`ORD-B${String(i).padStart(3, "0")}`));
    }
    expect(JSON.parse(localStorage.getItem("subnation_ga4_sent")!)).toHaveLength(100);

    m.trackPurchase(order("ORD-B101"));
    const stored = JSON.parse(localStorage.getItem("subnation_ga4_sent")!) as string[];
    expect(stored).toHaveLength(100);
    expect(stored).not.toContain("ORD-B001"); // first evicted
    expect(stored[0]).toBe("ORD-B002");
    expect(stored).toContain("ORD-B101");
    // All 101 distinct codes fired (the bound caps only the persisted
    // array) — and the in-session Set still dedupes an evicted code.
    expect(fired("purchase")).toHaveLength(101);
    m.trackPurchase(order("ORD-B001"));
    expect(fired("purchase")).toHaveLength(101);
  });

  it("corrupt localStorage payload resets the sent-set instead of throwing", async () => {
    localStorage.setItem("subnation_ga4_sent", "{not json");
    const m = await freshModule();
    armGtag();
    m.trackPurchase(order("ORD-CORRUPT"));
    expect(fired("purchase")).toHaveLength(1);
  });
});

describe("R168 analytics-events — PII guard (absolute)", () => {
  it("a purchase and a view_item payload carry none of the forbidden substrings", async () => {
    const m = await freshModule();
    armGtag();
    // The kitchen-sink order: every delivered_* field populated — the
    // mapper must not be able to leak any of it.
    const leaky = {
      ...order("ORD-PII", { coupon_code: "SAVE5", discount_amount: 5 }),
      delivered_email: "victim@example.com",
      delivered_password: "hunter2",
      delivered_extra_details: "recovery: 0900PHONE",
      delivered_usage_terms: "terms of use",
      delivered_at: "2026-01-01T00:00:00Z",
      has_credentials: true,
      decrypt_failed: false,
      order_group_id: "group-token-1",
    };
    m.trackPurchase(leaky);
    m.trackViewItem(ITEM);
    const serialized = JSON.stringify(window.dataLayer);
    for (const forbidden of ["delivered_", "password", "email", "phone", "wallet"]) {
      expect(serialized).not.toContain(forbidden);
    }
    // The allowed money + identity fields DID land.
    expect(fired("purchase")[0]!.transaction_id).toBe("ORD-PII");
  });
});

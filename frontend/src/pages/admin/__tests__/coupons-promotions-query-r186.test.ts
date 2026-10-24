/**
 * R186 (C-F8) — the last two hand-rolled admin-core lists ride TanStack
 * Query (the panels-scope-self-gate-r183 source-pin idiom).
 *
 * coupons.tsx and promotions.tsx were the only admin-core list pages on
 * hand-rolled useState/fetch — no 5-minute poll fallback, no socket
 * invalidation surface (the layout/SocketInitializer refresh only
 * touches registered query keys), so another admin's coupon/promotion
 * writes never reached an open tab of these pages until a manual
 * refresh. Both now ride the sibling pages' contract:
 *
 *   • useQuery on the documented base key ("/api/coupons/admin" /
 *     "/api/admin/flash-sales") — the invalidation surface;
 *   • `enabled: !!adminToken && canView` — the self-gate every
 *     query-bearing admin page carries (the R183 idiom);
 *   • refetchInterval: 300_000 + refetchIntervalInBackground: false —
 *     the 5-minute socket-dropout fallback;
 *   • mutations invalidate the shared base key (was fetchCoupons(true)
 *     / void load()).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

describe("R186 (C-F8) — coupons + promotions ride the query contract (source pins)", () => {
  it("coupons.tsx: useQuery + the token/scope self-gate + the 5-min fallback + the documented key", () => {
    const source = read("src/pages/admin/coupons.tsx");
    expect(source).toContain("useQuery<Coupon[]>({");
    // THE panels-scope-self-gate idiom — the enabled arm.
    expect(source).toContain("enabled: !!adminToken && canView,");
    // The documented base key + the poll fallback.
    expect(source).toContain('const COUPONS_ADMIN_QUERY_KEY = ["/api/coupons/admin"] as const;');
    expect(source).toContain("refetchInterval: 300_000,");
    expect(source).toContain("refetchIntervalInBackground: false,");
    // The mutation refresh rides the shared base key (was fetchCoupons(true)).
    expect(source).toContain(
      "void queryClient.invalidateQueries({ queryKey: COUPONS_ADMIN_QUERY_KEY });",
    );
    // And the hand-rolled loader is GONE (state + callback both).
    expect(source).not.toContain("const [coupons, setCoupons] = useState");
    expect(source).not.toContain("const fetchCoupons = useCallback(");
  });

  it("promotions.tsx: useQuery + the token/scope self-gate + the 5-min fallback + the documented key", () => {
    const source = read("src/pages/admin/promotions.tsx");
    expect(source).toContain("useQuery<{ flash_sales?: FlashSale[] }>({");
    // THE panels-scope-self-gate idiom — the enabled arm.
    expect(source).toContain("enabled: !!adminToken && canView,");
    // The documented base key + the poll fallback.
    expect(source).toContain('const FLASH_SALES_QUERY_KEY = ["/api/admin/flash-sales"] as const;');
    expect(source).toContain("refetchInterval: 300_000,");
    expect(source).toContain("refetchIntervalInBackground: false,");
    // The mutation refresh rides the shared base key (was void load()).
    expect(source).toContain(
      "void queryClient.invalidateQueries({ queryKey: FLASH_SALES_QUERY_KEY });",
    );
    // And the hand-rolled loader is GONE (state + callback both).
    expect(source).not.toContain("const [sales, setSales] = useState");
    expect(source).not.toContain("const load = useCallback(");
  });
});

/**
 * 96-F4 (R96 A2 P1-1 / P1-2 / A1 M13): cart touch ergonomics.
 *
 * P1-1: steppers/trash are 44px targets with ≥8px separation between the
 *       stepper cluster and the trash — and every line removal (minus-at-
 *       qty-1 AND the trash) now carries a 6s undo toast («تمت إزالة
 *       المنتج — تراجع») that re-adds the item WITH ITS QUANTITY.
 * P1-2: «إفراغ السلة» is destructive + now goes through useConfirm's
 *       AlertDialog (destructive tone) instead of firing instantly.
 * M13:  the row wraps so the price cluster sits on its own clean line at
 *       320px instead of ragged-wrapping inside a ~92px column.
 *
 * The undo toast rides sonner directly (the use-toast shim doesn't expose
 * sonner's action API) — "sonner" is mocked here so the test can invoke
 * the action's onClick exactly like a tap on «تراجع» would.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CartPage from "@/pages/cart";
import { CartProvider, type LocalCartItem } from "@/lib/cart";

const sonnerToastMock = vi.fn();
// Lazy delegation (not a direct reference) — vi.mock factories are hoisted
// above the const's initialization, so the mock must only touch
// sonnerToastMock when the page actually calls toast() at runtime.
vi.mock("sonner", () => ({
  toast: (...args: unknown[]) => sonnerToastMock(...args),
}));

// R115-I1 (A7 P3-4): cart.tsx now reads the wallet-balance chip from
// useGetWallet — mocked at the hook boundary (this suite renders without
// a QueryClientProvider; the chip's data path is pinned in the dedicated
// describe below, everything else sees "probe not answered" → no chip).
const walletMock = vi.hoisted(() => ({ data: undefined as { balance: number } | undefined }));

vi.mock("@workspace/api-client-react", () => ({
  useGetWallet: () => ({ data: walletMock.data, isLoading: false, isError: false }),
  getGetWalletQueryKey: () => ["/api/wallet"],
}));

// R111-F2 copy pins: the auth state is hoisted + mutable so one render
// helper can pin BOTH summary CTAs — the authed checkout entry and the
// guest login entry.
const authState = vi.hoisted(() => ({ token: null as string | null }));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ token: authState.token }),
}));

const toastSpy = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastSpy }),
}));

const CART_ITEM: LocalCartItem = {
  productId: 5,
  variantId: 101,
  variantLabel: "شهر واحد",
  slug: "netflix-1m",
  name: "Netflix شهر",
  imageUrl: null,
  priceLYD: 75,
  salePriceLYD: 49,
  discountPercent: 35,
  quantity: 3,
};

function seedCart(quantity: number) {
  localStorage.setItem("subnation_cart_v2", JSON.stringify([{ ...CART_ITEM, quantity }]));
}

function readCart(): LocalCartItem[] {
  const raw = localStorage.getItem("subnation_cart_v2");
  return raw ? (JSON.parse(raw) as LocalCartItem[]) : [];
}

function renderPage() {
  return render(
    <Router>
      <CartProvider>
        <CartPage />
      </CartProvider>
    </Router>,
  );
}

async function findRow() {
  await screen.findByText("Netflix شهر");
}

describe("CartPage — undo toast on line removal (96-F4 / R96 A2 P1-1)", () => {
  beforeEach(() => {
    sonnerToastMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("trash removal fires an undo toast whose «تراجع» re-adds the item with its quantity", async () => {
    seedCart(3);
    renderPage();
    await findRow();

    fireEvent.click(screen.getByRole("button", { name: "حذف المنتج Netflix شهر" }));

    // Removed from cart + localStorage…
    await waitFor(() => expect(readCart()).toHaveLength(0));
    // …but the undo affordance carries the snapshot.
    expect(sonnerToastMock).toHaveBeenCalledTimes(1);
    const [title, opts] = sonnerToastMock.mock.calls[0];
    expect(title).toBe("تمت إزالة المنتج");
    expect(opts.action).toEqual(expect.objectContaining({ label: "تراجع" }));
    expect(opts.duration).toBeGreaterThanOrEqual(6000);

    // Tap «تراجع» — the line comes back WITH ITS QUANTITY (3).
    opts.action.onClick();
    await waitFor(() => expect(readCart()[0]?.quantity).toBe(3));
    expect(await screen.findByText("Netflix شهر")).toBeInTheDocument();
  });

  it("minus-at-qty-1 still deletes — but now with the same undo toast", async () => {
    seedCart(1);
    renderPage();
    await findRow();

    // A4-F6 (R120-B2): at qty 1 both the minus (X icon) and the trash
    // carry the item-named delete label — the minus is the FIRST one in
    // DOM order.
    const deleteButtons = await screen.findAllByRole("button", {
      name: "حذف المنتج Netflix شهر",
    });
    expect(deleteButtons.length).toBe(2);
    fireEvent.click(deleteButtons[0]);

    await waitFor(() => expect(readCart()).toHaveLength(0));
    expect(sonnerToastMock).toHaveBeenCalledTimes(1);
    const [, opts] = sonnerToastMock.mock.calls[0];
    expect(opts.action.label).toBe("تراجع");

    opts.action.onClick();
    await waitFor(() => expect(readCart()[0]?.quantity).toBe(1));
  });

  it("steppers, count and trash are 44px targets with ≥8px cluster separation (P1-1)", async () => {
    seedCart(3);
    renderPage();
    await findRow();

    const minus = screen.getByRole("button", { name: "إنقاص كمية Netflix شهر" });
    const plus = screen.getByRole("button", { name: "زيادة كمية Netflix شهر" });
    const trash = screen.getByRole("button", { name: "حذف المنتج Netflix شهر" });
    for (const btn of [minus, plus, trash]) {
      expect(btn.className).toContain("min-h-11");
      expect(btn.className).toContain("min-w-11");
    }

    // The controls wrapper separating the stepper cluster from the trash.
    const controls = trash.closest("div.flex");
    expect(controls).toBeInstanceOf(HTMLElement);
    expect(controls!.className).toContain("gap-2");

    // Stepper still works: plus raises the stored quantity.
    fireEvent.click(plus);
    await waitFor(() => expect(readCart()[0]?.quantity).toBe(4));
  });

  it("M13: the row wraps (controls cluster on its own row below ~480px) and the price cluster wraps cleanly", async () => {
    seedCart(3);
    const { container } = renderPage();
    await findRow();

    // Row root: flex-wrap (the 44px controls cluster drops to its own row
    // when the viewport is too narrow — freeing the middle column).
    const rowRoot = container.querySelector(".gap-x-3\\.5");
    expect(rowRoot).toBeInstanceOf(HTMLElement);
    expect(rowRoot!.className).toContain("flex-wrap");

    // Middle column keeps a readable floor (min-w-[10rem]) so the price
    // cluster fits on ONE line instead of ragged-wrapping in ~92px.
    const middle = container.querySelector(".min-w-\\[10rem\\]");
    expect(middle).toBeInstanceOf(HTMLElement);

    // Price cluster itself is wrap-tolerant (price / strikethrough / badge).
    const priceCluster = container.querySelector(".items-baseline");
    expect(priceCluster).toBeInstanceOf(HTMLElement);
    expect(priceCluster!.className).toContain("flex-wrap");
  });
});

describe("CartPage — summary CTA copy (R111-F2 N1 + N6)", () => {
  beforeEach(() => {
    sonnerToastMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    authState.token = null;
    walletMock.data = undefined;
  });

  it("authed: the checkout entry CTA reads «إتمام الطلب» (the destination page's own name)", async () => {
    authState.token = "t";
    seedCart(1);
    renderPage();
    await findRow();

    // A3-F13 (R120-B2): the summary CTA is an asChild anchor now (was
    // Link>Button nesting — two same-named elements, the inner one
    // queryable by button role).
    const cta = screen.getByRole("link", { name: "إتمام الطلب" });
    // Destination is the checkout funnel (unifying the CTA verb with
    // checkout.tsx's h1; kills the old «متابعة الشراء» /«متابعة التسوق»
    // near-duplicate pair on one screen).
    expect(cta).toHaveAttribute("href", "/checkout");
    expect(screen.queryByText("متابعة الشراء")).not.toBeInTheDocument();
  });

  it("guest: the login entry CTA reads «سجّل دخولك للشراء» (shadda + pronoun, app-standard)", async () => {
    seedCart(1);
    renderPage();
    await findRow();

    const cta = screen.getByRole("link", { name: "سجّل دخولك للشراء" });
    expect(cta).toHaveAttribute("href", "/login?redirect=/checkout");
    expect(screen.queryByText("سجل دخول للشراء")).not.toBeInTheDocument();

    // A3-F4 + A3-F13 (R120-B2): the ghost «متابعة التسوق» is the
    // populated-state twin of the empty-cart CTA — ONE 44px anchor (was
    // a 36px Button nested inside a same-named anchor).
    const ghost = screen.getByRole("link", { name: "متابعة التسوق" });
    expect(ghost).toHaveAttribute("href", "/");
    expect(ghost.className).toContain("min-h-11");
    expect(screen.queryByRole("button", { name: "متابعة التسوق" })).not.toBeInTheDocument();
  });
});

describe("CartPage — destructive clear goes through useConfirm (96-F4 / R96 A2 P1-2)", () => {
  beforeEach(() => {
    sonnerToastMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    walletMock.data = undefined;
  });

  it("«إفراغ السلة» requires an explicit destructive confirm before wiping", async () => {
    seedCart(3);
    renderPage();
    await findRow();

    fireEvent.click(screen.getByRole("button", { name: "إفراغ السلة" }));

    // The shared AlertDialog opens with the confirm copy…
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("إفراغ السلة؟")).toBeInTheDocument();

    // …and the cart is NOT cleared yet (one mis-tap must not wipe lines).
    expect(readCart()).toHaveLength(1);
    expect(toastSpy).not.toHaveBeenCalled();

    // The confirm action carries the destructive treatment.
    const confirmBtn = within(dialog).getByRole("button", { name: "إفراغ السلة" });
    expect(confirmBtn.className).toContain("bg-destructive");

    fireEvent.click(confirmBtn);

    await waitFor(() => expect(readCart()).toHaveLength(0));
    expect(toastSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "تم إفراغ السلة" }));
    // The empty state replaces the item list.
    expect(await screen.findByText("سلتك فارغة")).toBeInTheDocument();
  });

  it("cancelling the dialog keeps the cart intact", async () => {
    seedCart(2);
    renderPage();
    await findRow();

    fireEvent.click(screen.getByRole("button", { name: "إفراغ السلة" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "إلغاء" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(readCart()[0]?.quantity).toBe(2);
    expect(toastSpy).not.toHaveBeenCalled();
    expect(await screen.findByText("Netflix شهر")).toBeInTheDocument();
  });

  it("the clear trigger itself is a 44px target (was 32px via size=sm)", async () => {
    seedCart(3);
    renderPage();
    await findRow();

    const clear = screen.getByRole("button", { name: "إفراغ السلة" });
    expect(clear.className).toContain("min-h-11");
    expect(clear.className).not.toContain("min-h-8");
  });
});

describe("CartPage — per-line totals + wallet chip (R115-I1 / A7 P3-4)", () => {
  beforeEach(() => {
    sonnerToastMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    authState.token = null;
    walletMock.data = undefined;
  });

  it("a qty>1 line shows «N × unit = line total» (checkout-parity arithmetic)", async () => {
    // salePriceLYD 49 × qty 3 → «3 × 49.00 د.ل = 147.00 د.ل».
    seedCart(3);
    renderPage();
    await findRow();

    expect(
      screen.getByText((_, el) => {
        // `===` already yields a boolean — the trailing `?? false` was a
        // no-constant-binary-expression eslint error (left side can never
        // be nullish).
        return el?.textContent === "3 × 49.00 د.ل = 147.00 د.ل";
      }),
    ).toBeInTheDocument();
    // The grand total is the same arithmetic at basket level (the line
    // total span + the summary total span both read 147.00).
    expect(screen.getAllByText("147.00 د.ل").length).toBe(2);
  });

  it("a qty=1 line shows no arithmetic row (unit price IS the line total)", async () => {
    seedCart(1);
    renderPage();
    await findRow();

    expect(screen.queryByText(/×/)).not.toBeInTheDocument();
    // Unit price (line) + grand total (summary) — both 49.00 for qty 1.
    expect(screen.getAllByText("49.00 د.ل").length).toBe(2);
  });

  it("the summary shows the wallet balance chip when the wallet probe answered (authed)", async () => {
    authState.token = "t";
    walletMock.data = { balance: 200 };
    seedCart(1);
    renderPage();
    await findRow();

    expect(screen.getByText("رصيدك 200.00 د.ل")).toBeInTheDocument();
  });

  it("no fabricated balance: the chip is absent while the probe has not answered (or failed)", async () => {
    authState.token = "t";
    walletMock.data = undefined;
    seedCart(1);
    renderPage();
    await findRow();

    expect(screen.queryByText(/رصيدك/)).not.toBeInTheDocument();
  });

  it("guests see no wallet chip (the query is disabled without a token)", async () => {
    authState.token = null;
    walletMock.data = { balance: 500 };
    seedCart(1);
    renderPage();
    await findRow();

    expect(screen.queryByText(/رصيدك/)).not.toBeInTheDocument();
  });
});

describe("CartPage — R120-B2 (A4-F6 labels + A3-F4/F13 empty CTA + A1-F9 links)", () => {
  beforeEach(() => {
    sonnerToastMock.mockReset();
    toastSpy.mockReset();
    localStorage.clear();
    sessionStorage.clear();
    authState.token = null;
    walletMock.data = undefined;
  });

  it("A4-F6: qty/remove labels name the line's item — no ambiguous repeats in multi-item carts", async () => {
    // Two different items so the identical-static-label ambiguity is the
    // exact scenario the finding measured.
    localStorage.setItem(
      "subnation_cart_v2",
      JSON.stringify([
        { ...CART_ITEM, quantity: 2 },
        {
          ...CART_ITEM,
          productId: 6,
          variantId: 102,
          slug: "disney-1m",
          name: "Disney سنة",
          quantity: 2,
        },
      ]),
    );
    renderPage();
    await screen.findByText("Netflix شهر");

    expect(screen.getByRole("button", { name: "زيادة كمية Netflix شهر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "إنقاص كمية Netflix شهر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف المنتج Netflix شهر" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "زيادة كمية Disney سنة" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "حذف المنتج Disney سنة" })).toBeInTheDocument();
  });

  it("A3-F4 + A3-F13: the empty state ships ONE «متابعة التسوق» target at 44px", async () => {
    renderPage();
    await screen.findByText("سلتك فارغة");

    // Exactly one element carries the CTA name — the anchor itself
    // (asChild composition; the old Link>Button nesting rendered TWO
    // same-named elements, anchor 152×20 + button 152×38).
    const cta = screen.getByRole("link", { name: "متابعة التسوق" });
    expect(cta).toHaveAttribute("href", "/");
    expect(cta.className).toContain("min-h-11");
    expect(cta.className).not.toContain("min-h-9");
    expect(screen.queryByRole("button", { name: "متابعة التسوق" })).not.toBeInTheDocument();
  });

  it("A1-F9: a null-slug line links to /product/{id} — never to home", async () => {
    localStorage.setItem(
      "subnation_cart_v2",
      JSON.stringify([{ ...CART_ITEM, slug: null, imageUrl: null, quantity: 1 }]),
    );
    renderPage();
    await screen.findByText("Netflix شهر");

    // Thumbnail + title links both resolve to the numeric id (the thumb
    // link's accessible name is just the «N» initial tile, so query by href).
    const productLinks = screen
      .getAllByRole("link")
      .filter((l) => l.getAttribute("href") === "/product/5");
    expect(productLinks).toHaveLength(2);
    // …and no line element routes to the home dead end anymore.
    expect(screen.queryByRole("link", { name: "Netflix شهر" })).not.toHaveAttribute("href", "/");
  });
});

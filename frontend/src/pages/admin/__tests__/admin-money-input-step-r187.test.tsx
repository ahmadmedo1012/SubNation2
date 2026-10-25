/**
 * R187 (D-F1) — the two admin money inputs' native step contract.
 *
 * The products price editor (ProductEditorCard) and the wallet amount
 * field (UserEditDialog) were the ONLY two `step="0.5"` sites in the
 * app (every sibling money input rides step="0.01" — including the
 * cost field in the SAME editor). The server contract is 2-decimal
 * (products price zod min 0.01; wallet numeric(10,2)), so a 44.99
 * entry fired an English native step-mismatch bubble, and EDITING any
 * variant-priced product pre-failed validation on its seeded price
 * (the engine writes MIN(priceLyd) — e.g. 79.8 — so the editor opened
 * already-invalid and blocked unrelated saves).
 *
 * Behavior pins (the source pins live in the products/users
 * decomposition suites): seed each form with a cent-legal value that
 * is NOT a multiple of 0.5 → the form is NATIVELY valid
 * (`checkValidity() === true`) — jsdom implements the constraint-
 * validation layer, so this is the exact gate the old step="0.5"
 * failed.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProductEditorCard } from "@/components/admin/products/ProductEditorCard";
import { UserEditDialog } from "@/components/admin/users/UserEditDialog";
import {
  EMPTY_FORM as PRODUCT_EMPTY_FORM,
  type ProductForm,
} from "@/components/admin/products/products-meta";
import type { EditUserForm } from "@/components/admin/users/user-directory-meta";
import type { AdminUser } from "@workspace/api-client-react";

const noop = () => {};
const noopSetter = vi.fn();

const PRODUCT_FORM_SEED = (price: string): ProductForm => ({
  ...PRODUCT_EMPTY_FORM,
  name: "Netflix Premium",
  price,
});

const USER: AdminUser = {
  id: 16,
  phone: "0913456789",
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: "bronze",
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
} as unknown as AdminUser;

const USER_FORM_SEED = (walletValue: string): EditUserForm => ({
  wallet_mode: "add",
  wallet_value: walletValue,
  loyalty_points: "",
  note: "سبب التعديل",
});

function renderEditor(price: string) {
  const { container } = render(
    <ProductEditorCard
      editingId={null}
      form={PRODUCT_FORM_SEED(price)}
      onFormChange={noopSetter}
      onSeoTouchedChange={noopSetter}
      onSubmit={noop}
      onCancel={noop}
      createPending={false}
      updatePending={false}
    />,
  );
  // The form the page's ⌘S shortcut and submit button target — the
  // native constraint-validation gate the step attr feeds.
  return container.querySelector("form") as HTMLFormElement;
}

function renderWalletDialog(walletValue: string) {
  render(
    <UserEditDialog
      editingUser={USER}
      form={USER_FORM_SEED(walletValue)}
      saving={false}
      canEditMoney={true}
      noteRequired={true}
      noteValid={true}
      editingPointsNow={null}
      onWalletModeChange={noop}
      onWalletValueChange={noop}
      onNoteChange={noop}
      onPointsChange={noop}
      onClose={noop}
      onSubmit={noop}
    />,
  );
  // AppDialog portals to document.body — query the document, not the
  // render container.
  return document.querySelector("form#user-edit-form") as HTMLFormElement;
}

describe("R187 (D-F1) — admin money inputs accept server-legal cent values natively", () => {
  it("ProductEditorCard: a variant-priced product's seeded 79.8 price is step-valid", () => {
    // 79.8 is what refreshProductDisplayPrice writes for a variant
    // floor (MIN(priceLyd) in cents) — the old step="0.5" made the
    // EDIT-mode editor open pre-failed on exactly this value.
    const form = renderEditor("79.8");
    expect(form.checkValidity()).toBe(true);
  });

  it("ProductEditorCard: an operator-typed 44.99 price is step-valid (no mismatch bubble)", () => {
    const form = renderEditor("44.99");
    expect(form.checkValidity()).toBe(true);
  });

  it("UserEditDialog: a 44.99 wallet adjustment is step-valid", () => {
    // wallet numeric(10,2) — the exact cent-legal value the old
    // step="0.5" rejected with an English bubble on the money dialog.
    const form = renderWalletDialog("44.99");
    expect(form.checkValidity()).toBe(true);
  });
});

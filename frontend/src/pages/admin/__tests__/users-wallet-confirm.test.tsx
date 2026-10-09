/**
 * 93-C6 / F-07 (round-93 — A5 S-1/U-1) + 94-C2 (A2 P1-1 + P2-5) —
 * users wallet-adjust confirmation tests.
 *
 * The edit dialog's "حفظ" submits the wallet PATCH directly:
 *
 *   - No confirmation, no resulting-balance preview — a typo like 50
 *     instead of 5.00 overwrote/credited a wallet in one tap ("set"
 *     mode especially).
 *   - A NON-NUMERIC wallet value was silently DROPPED from the body
 *     (parseFloat NaN → field omitted) while loyalty fields still
 *     saved — the toast said "تم الحفظ" without the money change
 *     (U-1).
 *
 * The fix (same useConfirm idiom as the orders bulk refund):
 *   1. Non-numeric wallet input blocks the submit (destructive toast).
 *   2. A wallet change opens a styled confirm dialog showing the exact
 *      amount, the current balance, and the RESULTING balance.
 *   3. Cancel = no PATCH; confirm = the PATCH fires once with the
 *      idempotency key.
 *
 * 94-C2 (A2 P2-5) adds: the modal shell itself is now the shared
 * AppDialog (Radix) — the money form can't be destroyed mid-PATCH:
 * ESC while `saving` is blocked (`dismissable={!saving}`), and the
 * dialog carries role="dialog"/aria-modal + focus-trap instead of the
 * old hand-rolled fixed overlay. The list itself is a useInfiniteQuery
 * over the frozen `?page=&limit=` contract via customFetch (P1-1), so
 * the rows land asynchronously and the tests await them.
 *
 * `@workspace/api-client-react`, `@/lib/auth`, the admin shell and the
 * toast hook are mocked at the module boundary (vitest-config pattern).
 *
 * (r110) Wallet-note contract tests — R109 §109-m P1: round-94
 * (39a84be) made `note` (≥3 trimmed chars) mandatory on the backend
 * whenever a wallet field rides the PATCH, but this dialog never
 * sent one → every wallet adjust from the admin UI was a guaranteed
 * 400. The dialog now renders a note input that (a) is required
 * only when a wallet amount is filled (mirroring the backend's
 * when-required semantics — loyalty-only saves neither need nor
 * send it), (b) keeps the submit disabled until the note is valid
 * (with a save-path guard for programmatic/novalidate submits), and
 * (c) rides the PATCH body — trimmed, ≤500 chars — whenever the
 * wallet fields do.
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { beforeEach, afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminUsersPage from "@/pages/admin/users";
import { customFetch } from "@workspace/api-client-react";

vi.mock("@workspace/api-client-react", () => ({
  // 94-C2 (A2 P1-1): the directory moved from useListAdminUsers to a
  // useInfiniteQuery over the frozen `?page=&limit=` contract via
  // customFetch — the mock follows the new module surface.
  customFetch: vi.fn(),
  getListAdminUsersQueryKey: (params?: unknown) => ["/api/admin/users", params ?? null],
  // 93-C6: useAdminHeaders registers the global 401 observer through
  // this export — the mock must carry the module surface the page
  // graph imports.
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    // R120-B4 (A2-F4): the wallet/points form is finance-gated —
    // default-grant keeps these confirm-flow tests scoped to their own
    // concern.
    hasAdminPermission: () => true,
  }),
}));

vi.mock("@/pages/admin/layout", () => ({
  AdminLayout: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock, dismiss: vi.fn() }),
}));

const USER = {
  id: 16,
  phone: "0913456789",
  wallet_balance: 150,
  loyalty_points: 100,
  loyalty_tier: "bronze",
  order_count: 2,
  lifetime_spend: 200,
  created_at: "2026-08-01T10:00:00.000Z",
};

function mockUsersResult(data: unknown[]) {
  // 94-C2: the page's useInfiniteQuery resolves this as page 1 — the
  // rows land asynchronously, so tests await them.
  (customFetch as unknown as Mock).mockResolvedValue(data);
}

/** Minimal Response-like object — avoids depending on a global Response. */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = 200, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Gated promise — keeps a fetch in flight across assertions. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const fetchMock = vi.fn();

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router>
        <AdminUsersPage />
      </Router>
    </QueryClientProvider>,
  );
}

/** Opens the AppDialog edit shell for the first user row (94-C2: the
 *  rows arrive asynchronously; the dialog is the Radix AppDialog). */
async function openEditModal() {
  // R123 (E3 P3b): the mobile edit button now carries the same
  // accessible name as its desktop twin — both render in jsdom (the
  // md:hidden/hid CSS classes do not unmount either), so scope by
  // all-matches and click the first (desktop) one.
  const editButtons = await screen.findAllByRole("button", { name: /تعديل المستخدم 0913456789/ });
  fireEvent.click(editButtons[0]);
  const dialog = await screen.findByRole("dialog");
  // 94-C2 (A2 P2-5): the shared shell — dialog semantics, not a bare
  // fixed overlay.
  expect(dialog).toHaveAttribute("aria-modal", "true");
  return dialog;
}

/** The wallet amount input inside the edit dialog (placeholder follows the selected mode). */
function walletInput(dialog: HTMLElement, placeholder: string) {
  return within(dialog).getByPlaceholderText(placeholder);
}

/** (r110) The wallet-edit note input — required (≥3 trimmed chars) by
 *  the backend whenever a wallet field rides the PATCH. */
const NOTE_PLACEHOLDER = "سبب التعديل (3 أحرف على الأقل)";

function noteInput(dialog: HTMLElement) {
  return within(dialog).getByPlaceholderText(NOTE_PLACEHOLDER);
}

/** (r110) A valid default note so the wallet-confirm helper passes
 *  the note gate (the backend rejects wallet bodies without one). */
const DEFAULT_NOTE = "تسوية رصيد إدارية";

async function openWalletConfirm(
  dialog: HTMLElement,
  amount: string,
  placeholder = "المبلغ للإضافة",
  // (r110) wallet edits carry a mandatory note — the helper fills a
  // valid one so the حفظ click passes the note gate.
  note: string = DEFAULT_NOTE,
) {
  fireEvent.change(walletInput(dialog, placeholder), { target: { value: amount } });
  fireEvent.change(noteInput(dialog), { target: { value: note } });
  fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));
  // The useConfirm AlertDialog (rendered at page level) opens.
  const title = await screen.findByText("تأكيد تعديل المحفظة");
  const confirmDialog = title.closest('[role="alertdialog"]') as HTMLElement;
  expect(confirmDialog).toBeTruthy();
  return confirmDialog;
}

describe("AdminUsersPage — wallet adjust confirmation (S-1/U-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsersResult([USER]);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("a wallet change opens a confirm dialog with the resulting-balance preview BEFORE any request", async () => {
    renderPage();

    const dialog = await openEditModal();
    const confirmDialog = await openWalletConfirm(dialog, "25");

    // Amount + current + resulting balance are all visible.
    expect(within(confirmDialog).getByText(/سيتم إضافة 25\.00 د\.ل/)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/الرصيد الجديد: 175\.00 د\.ل/)).toBeInTheDocument();
    // Submit is gated: no PATCH has fired yet.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancel performs no PATCH (submit gated by the dialog)", async () => {
    renderPage();

    const dialog = await openEditModal();
    const confirmDialog = await openWalletConfirm(dialog, "25");

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument());

    expect(fetchMock).not.toHaveBeenCalled();
    // The edit dialog itself stays open (its own إلغاء is separate).
    expect(screen.getByText("تعديل المستخدم")).toBeInTheDocument();
  });

  it("confirm fires the PATCH once with the amount + Idempotency-Key + note (r110)", async () => {
    fetchMock.mockResolvedValue(
      resLike({ body: { id: 16, wallet_balance: 175, loyalty_points: 100 } }),
    );
    renderPage();

    const dialog = await openEditModal();
    // (r110) whitespace-padded note — the dialog trims (and caps at
    // 500) before the PATCH, mirroring what the backend persists.
    const confirmDialog = await openWalletConfirm(
      dialog,
      "25",
      "المبلغ للإضافة",
      "  إضافة رصيد عبر تحويل بنكي  ",
    );

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تنفيذ التعديل" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/users/16");
    expect(init.method).toBe("PATCH");
    expect(init.headers).toMatchObject({ "Idempotency-Key": expect.any(String) });
    expect(JSON.parse(String(init.body))).toMatchObject({
      wallet_adjustment: 25,
      // (r110) the note rides the PATCH exactly when a wallet field
      // does — trimmed like the backend's own note guard expects.
      note: "إضافة رصيد عبر تحويل بنكي",
    });

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("تم الحفظ");
  });

  // (r110) The note input exists and mirrors the backend's
  // when-required semantics: unconstrained with no wallet amount
  // (loyalty-only saves stay submittable), required + ≥3 chars once
  // one is filled.
  it("(r110) renders the note field — required only when a wallet amount is filled", async () => {
    renderPage();
    const dialog = await openEditModal();

    const note = noteInput(dialog);
    expect(note).toBeInTheDocument();
    // No wallet amount yet → the note is not required.
    expect(note).not.toHaveAttribute("required");

    fireEvent.change(walletInput(dialog, "المبلغ للإضافة"), { target: { value: "25" } });
    // A wallet amount is in the form → the note gates the PATCH.
    expect(note).toHaveAttribute("required");
    expect(note).toHaveAttribute("minLength", "3");
    expect(note).toHaveAttribute("maxLength", "500");
  });

  // (r110) The two-layer note gate (same layering as the
  // numeric-wallet guard): the disabled submit covers the click
  // path; the handleSave guard covers programmatic / novalidate
  // submits. Nothing reaches the PATCH or the money-confirm dialog.
  it("(r110) a wallet change with a <3-char note never reaches the PATCH (two-layer gate)", async () => {
    renderPage();
    const dialog = await openEditModal();

    fireEvent.change(walletInput(dialog, "المبلغ للإضافة"), { target: { value: "25" } });
    const save = within(dialog).getByRole("button", { name: "حفظ" });

    // Layer 1 — empty note: the submit button is disabled.
    expect(save).toBeDisabled();
    // Two trimmed chars still fail the ≥3-char backend contract.
    fireEvent.change(noteInput(dialog), { target: { value: "لا" } });
    expect(save).toBeDisabled();

    // Layer 2 — the save-path guard: destructive toast, no money
    // confirm dialog, no PATCH (direct submit dispatch bypasses the
    // browser's interactive validation — the guard is the layer
    // under test, mirroring novalidate/programmatic submits).
    fireEvent.submit(document.getElementById("user-edit-form") as HTMLFormElement);
    expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "سبب التعديل مطلوب",
      variant: "destructive",
    });

    // A valid note re-opens the submit path.
    fireEvent.change(noteInput(dialog), { target: { value: "تسوية دفعة يدوية" } });
    expect(save).toBeEnabled();
  });

  it("subtract mode previews the deduction and flags an overdrawn result", async () => {
    renderPage();

    const dialog = await openEditModal();
    // Switch to خصم mode (the placeholder follows the mode).
    fireEvent.click(within(dialog).getByRole("button", { name: /خصم/ }));
    const confirmDialog = await openWalletConfirm(dialog, "200", "المبلغ للخصم");

    // 150 - 200 = -50 → preview + explicit overdraw warning.
    expect(within(confirmDialog).getByText(/سيتم خصم 200\.00 د\.ل/)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/الرصيد الجديد: -50\.00 د\.ل/)).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/يتجاوز الرصيد الحالي/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a negative wallet value never reaches the PATCH (layered guard)", async () => {
    renderPage();

    const dialog = await openEditModal();
    // "abc" is sanitized to "" by the number input itself; "-5"
    // survives as a value but fails the input's min=0 constraint —
    // the browser's interactive validation blocks the form submit
    // entirely (verified: jsdom fires no submit event). handleSave's
    // own isFinite/>=0 check is the second layer for novalidate /
    // programmatic-submit paths. Either way, the OLD silent-drop
    // behavior (loyalty saved + "تم الحفظ" while the money field
    // vanished from the body, U-1) is impossible: nothing is sent.
    // (r110: the empty note ALSO disables the submit button in this
    // state — a wallet amount is filled — one blocked layer earlier.)
    fireEvent.change(walletInput(dialog, "المبلغ للإضافة"), { target: { value: "-5" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    // No false "تم الحفظ" success toast for a blocked submit.
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("a loyalty-only save (no wallet change) does not open the money confirm", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { id: 16 } }));
    renderPage();

    const dialog = await openEditModal();
    // R115: a points CHANGE (100 → 150) with a valid note is a
    // loyalty-only PATCH — still no money-confirm dialog (the wallet
    // preview confirm covers WALLET mutations), and the note rides the
    // body (the backend 400s a points edit without one).
    const pointsInput = within(dialog).getByDisplayValue("100");
    fireEvent.change(pointsInput, { target: { value: "150" } });
    fireEvent.change(noteInput(dialog), { target: { value: "تسوية نقاط يدوية" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("تأكيد تعديل المحفظة")).not.toBeInTheDocument();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({
      loyalty_points: 150,
      note: "تسوية نقاط يدوية",
    });
    // R115: loyalty_tier is NEVER sent — the backend 400s any tier edit
    // (tiers derive from net spend, Part 11).
    expect(body.loyalty_tier).toBeUndefined();
  });

  // R115: the form pre-fills the current points balance — an untouched
  // form is NOT a save. The old behavior shipped the unchanged
  // loyalty_points value on every PATCH; the backend now demands a note
  // + finance scope for it (and 400s an empty body «لا توجد تعديلات»).
  it("an untouched form (no wallet, unchanged points) never reaches the PATCH — honest «لا توجد تعديلات»", async () => {
    renderPage();

    const dialog = await openEditModal();
    // Wallet left EMPTY, points left at the pre-filled 100.
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "لا توجد تعديلات",
      variant: "destructive",
    });
  });

  // R115: a points change without a note is a guaranteed 400 — the same
  // two-layer gate the wallet path has (disabled submit + save-path
  // guard for programmatic/novalidate submits).
  it("a points change with a <3-char note never reaches the PATCH (two-layer gate)", async () => {
    renderPage();
    const dialog = await openEditModal();

    const pointsInput = within(dialog).getByDisplayValue("100");
    fireEvent.change(pointsInput, { target: { value: "150" } });
    const save = within(dialog).getByRole("button", { name: "حفظ" });
    // Layer 1 — empty note: the submit button is disabled.
    expect(save).toBeDisabled();

    // Layer 2 — the save-path guard: destructive toast, no PATCH.
    fireEvent.submit(document.getElementById("user-edit-form") as HTMLFormElement);
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0]).toMatchObject({
      title: "سبب التعديل مطلوب",
      variant: "destructive",
    });

    // A valid note re-opens the submit path.
    fireEvent.change(noteInput(dialog), { target: { value: "تسوية نقاط يدوية" } });
    expect(save).toBeEnabled();
  });

  // 96-F7 (R96 M14): the input's min="0" doesn't stop a typed "-5" from
  // surviving programmatic submits — the save path clamps loyalty_points
  // to ≥0 so a negative value can never reach the PATCH (r94 P3-13).
  // R115: the clamp result (0 ≠ 100) is a points CHANGE — a valid note
  // now rides the body too.
  it("a NEGATIVE loyalty_points value is clamped to 0 at the save path (96-F7 M14)", async () => {
    fetchMock.mockResolvedValue(resLike({ body: { id: 16, loyalty_points: 0 } }));
    renderPage();

    const dialog = await openEditModal();
    // Wallet left EMPTY → loyalty-only PATCH, no money confirm dialog.
    const pointsInput = within(dialog).getByDisplayValue("100");
    fireEvent.change(pointsInput, { target: { value: "-5" } });
    fireEvent.change(noteInput(dialog), { target: { value: "تصفير نقاط بالخطأ" } });

    // Direct submit dispatch bypasses the browser's min=0 constraint
    // validation (jsdom blocks the click path) — the SAVE-PATH clamp is
    // the guard under test, mirroring novalidate/programmatic submits.
    fireEvent.submit(pointsInput.closest("form") as HTMLElement);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({ loyalty_points: 0, note: "تصفير نقاط بالخطأ" });
    expect(body.loyalty_points).not.toBe(-5);
  });

  it("ESC does NOT destroy the edit dialog while the money PATCH is in flight (94-C2 A2 P2-5)", async () => {
    // The old hand-rolled overlay closed on any backdrop/ESC tap — a
    // stray ESC mid-PATCH hid the form while the request kept flying
    // and the result toast landed with no surface around it.
    const gate = deferred<Response>();
    fetchMock.mockImplementation(() => gate.promise);
    renderPage();

    const dialog = await openEditModal();
    const confirmDialog = await openWalletConfirm(dialog, "25");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "تنفيذ التعديل" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    // The PATCH is in flight: the dialog is guarded (dismissable=false).
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("تعديل المستخدم")).toBeInTheDocument();

    // Complete the PATCH — the save resolves normally.
    gate.resolve(resLike({ body: { id: 16, wallet_balance: 175 } }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    expect(toastMock.mock.calls[0][0].title).toBe("تم الحفظ");
  });

  // R125-I4 (A1-2 / A6 B-12 + A10 §C-12): the money field itself —
  // the r103 label pass covered the note + points fields but missed
  // the primary wallet-amount input; screen readers announced only
  // the mode-dependent placeholder (WCAG 1.3.1/3.3.2). The
  // htmlFor↔id pair (+ the mode aria-describedby hint) is the fix.
  it("the wallet-amount input is programmatically labeled (htmlFor↔id + mode hint)", async () => {
    renderPage();
    const dialog = await openEditModal();

    // getByLabelText resolves through the htmlFor↔id pair — the
    // «تعديل المحفظة (د.ل)» label now focuses/reaches the input.
    const amount = within(dialog).getByLabelText("تعديل المحفظة (د.ل)");
    expect(amount).toBeInTheDocument();
    expect(amount).toHaveAttribute("id", "user-edit-wallet");
    expect(amount).toHaveAttribute("aria-describedby", "user-edit-wallet-hint");
    // The hint names the MODE semantics (the placeholder alone was
    // the only signal before).
    expect(within(dialog).getByText("سيُضاف المبلغ إلى الرصيد الحالي")).toBeInTheDocument();
  });
});

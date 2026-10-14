/**
 * L13-4 #1 (R143, deferred) — the RBAC page's mutation pins.
 *
 * R143's ledger landed the admin mutation pins PARTIALLY; the admins.tsx
 * (RBAC surface) page test was the deferred half. L13-4's evidence at
 * 528ef39: "admins.tsx (RBAC surface) — zero behavioral page tests. The
 * only suites touching it are source-text assertions
 * (admin-admins-decomposition-r137.test.ts — greps the page source for
 * `adminFetch(` substrings). Creating operator accounts, editing
 * permission scopes (incl. the super-admin `["all"]` preservation at
 * admins.tsx:315), and disable/enable (which kills live sessions — the
 * confirm says so at :229-231) are unpinned. A regression that sends
 * `[]` on create ships green."
 *
 * This suite is the missing pin, in the orders-credentials-retry idiom
 * (module-boundary mocks for the admin shell/auth/toast; the real
 * adminFetch/adminFetchJson wrappers run against the stubbed global
 * fetch, so the wire contract — method + URL + body — is what the page
 * actually sends):
 *
 *   1. create with ZERO scopes never reaches the POST (client gate) —
 *      the destructive «اختر صلاحية واحدة على الأقل» toast fires;
 *   2. create happy path: the POST body carries the EXACT checked-scope
 *      set (a regression that drops/empties `permissions` fails) plus
 *      the trimmed username/password and the display-name→username
 *      fallback;
 *   3. disable: the confirm dialog discloses the session-kill
 *      consequence («ستنتهي جلساته الحالية فوراً») BEFORE the POST, and
 *      confirming fires POST /api/admin/admins/:id/disable exactly once;
 *   4. enable: the confirm carries NO session-kill clause (nothing is
 *      being revoked), and CANCEL means no POST at all — the confirm is
 *      a real gate, not decoration;
 *   5. edit a SUPER-admin: the PATCH body preserves `permissions:
 *      ["all"]` (admins.tsx:315) — never `[]`, never the granular set —
 *      while the display-name edit still rides through;
 *   6. edit a regular admin: the PATCH carries the granular re-checked
 *      set (unchecking one scope sends exactly the remainder).
 */

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Router } from "wouter";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { type ReactNode } from "react";
import AdminAdminsPage from "@/pages/admin/admins";

vi.mock("@workspace/api-client-react", () => ({
  // useAdminHeaders registers the global 401 observer through this
  // export — the mock must carry the module surface the page graph
  // imports (the orders-credentials-retry idiom).
  setUnauthorizedHandler: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    adminToken: "test-admin-token",
    // R134 (A3-F1): the page mounts fetch-free without the scope —
    // default-grant keeps these mutation tests scoped to their concern.
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

/** The scope catalog the GET /api/admin/admins/scopes route serves. */
const SCOPE_CATALOG = [
  { id: "orders", label: "الطلبات" },
  { id: "topups", label: "الشحن" },
  { id: "admins", label: "المسؤولون" },
];

/** The accounts list. id=1 is ME (no edit/toggle affordances on the
 *  «أنت» card); 2 is a super-admin other than me (the ["all"]
 *  preservation leg); 3 is a regular active admin (disable leg); 4 is
 *  an inactive admin (enable leg — no sessions to kill). */
const ADMINS = [
  {
    id: 1,
    username: "owner",
    display_name: "المالك",
    role: "super_admin",
    permissions: ["all"],
    is_active: true,
    totp_enabled: true,
  },
  {
    id: 2,
    username: "root2",
    display_name: "المدير العام",
    role: "super_admin",
    permissions: ["all"],
    is_active: true,
    totp_enabled: false,
  },
  {
    id: 3,
    username: "mod1",
    display_name: "مشرف الشحن",
    role: "admin",
    permissions: ["topups", "orders"],
    is_active: true,
    totp_enabled: false,
  },
  {
    id: 4,
    username: "old1",
    display_name: "حساب سابق",
    role: "admin",
    permissions: ["orders"],
    is_active: false,
    totp_enabled: false,
  },
];

/** Minimal Response-like object — adminFetch reads .status, the page
 *  reads .ok/.json() (the users-wallet-confirm resLike idiom). */
function resLike(over: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const { ok = true, status = ok ? 200 : 500, body = {} } = over;
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const fetchMock = vi.fn();

/** Route the stubbed global fetch by `${method} ${url}` — the page's
 *  post-mutation reload() re-fires the three GETs, so ordered
 *  mockResolvedValueOnce chains would desync. `stalls` parks chosen
 *  routes on a promise the test releases (the R147 2-c D3 in-flight
 *  busy legs). */
function routeFetch(stalls: Record<string, Promise<Response>> = {}) {
  return (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url)}`;
    if (key in stalls) return stalls[key];
    switch (key) {
      case "GET /api/admin/admins":
        return Promise.resolve(resLike({ body: ADMINS }));
      case "GET /api/admin/admins/scopes":
        return Promise.resolve(resLike({ body: { scopes: SCOPE_CATALOG } }));
      case "GET /api/admin/session":
        return Promise.resolve(resLike({ body: { id: 1 } }));
      case "POST /api/admin/admins":
      case "POST /api/admin/admins/3/disable":
      case "POST /api/admin/admins/4/enable":
      case "PATCH /api/admin/admins/2":
      case "PATCH /api/admin/admins/3":
        return Promise.resolve(resLike({ body: {} }));
      default:
        return Promise.resolve(resLike({ ok: false, status: 404, body: {} }));
    }
  };
}

function renderPage() {
  return render(
    <Router>
      <AdminAdminsPage />
    </Router>,
  );
}

/** The account card containing @username (the cards render both the
 *  desktop grid rows — there is no mobile twin on this page, one card
 *  per admin). */
async function cardOf(username: string): Promise<HTMLElement> {
  const handle = await screen.findByText(`@${username}`);
  const card = handle.closest("div.bg-card") as HTMLElement | null;
  expect(card).toBeTruthy();
  return card as HTMLElement;
}

/** Every fetch call with a mutating method, as [key, body] pairs. */
function mutationCalls(): { key: string; body: unknown }[] {
  return (fetchMock as unknown as Mock).mock.calls
    .filter((c: unknown[]) => {
      const init = c[1] as RequestInit | undefined;
      const method = init?.method ?? "GET";
      return method !== "GET";
    })
    .map((c: unknown[]) => {
      const init = c[1] as RequestInit | undefined;
      let body: unknown = null;
      try {
        body = init?.body ? JSON.parse(String(init.body)) : null;
      } catch {
        body = String(init?.body);
      }
      return { key: `${init?.method ?? "GET"} ${String(c[0])}`, body };
    });
}

describe("AdminAdminsPage — RBAC mutation pins (L13-4 #1, R143 deferred)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockReset();
    fetchMock.mockImplementation(routeFetch());
    vi.stubGlobal("fetch", fetchMock);
    renderPage();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // Radix's RemoveScroll mutates document.body — reset between tests
    // (topups-dialogs-chrome-r143 idiom).
    document.body.style.pointerEvents = "";
    document.body.style.overflow = "";
    document.body.style.paddingRight = "";
  });

  it("create with ZERO scopes never reaches the POST — the destructive gate fires instead", async () => {
    expect(await screen.findByText("@mod1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة مسؤول" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("اسم المستخدم"), {
      target: { value: "newbie" },
    });
    fireEvent.change(within(dialog).getByLabelText("كلمة المرور"), {
      target: { value: "strong-password" },
    });
    // NO scope checkbox touched.
    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "اختر صلاحية واحدة على الأقل", variant: "destructive" }),
      );
    });
    // Nothing mutating ever left the page — the wire stayed GET-only.
    expect(mutationCalls()).toEqual([]);
  });

  it("create happy path: the POST body carries the EXACT checked scopes (a dropped/emptied permissions array fails)", async () => {
    expect(await screen.findByText("@mod1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إضافة مسؤول" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("اسم المستخدم"), {
      target: { value: "newbie" },
    });
    fireEvent.change(within(dialog).getByLabelText("كلمة المرور"), {
      target: { value: "strong-password" },
    });
    // Display name left EMPTY on purpose — the fallback to the username
    // is part of the pinned body contract.
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "الطلبات" }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "الشحن" }));

    fireEvent.click(within(dialog).getByRole("button", { name: "إنشاء" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم إنشاء حساب المسؤول", variant: "success" }),
      );
    });

    const posts = mutationCalls().filter((m) => m.key === "POST /api/admin/admins");
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toEqual({
      username: "newbie",
      password: "strong-password",
      // The empty display name falls back to the trimmed username.
      display_name: "newbie",
      // The EXACT checked set — the L13-4 regression class: a form
      // refactor that sends [] (or drops the field) fails here.
      permissions: ["orders", "topups"],
    });
  });

  it("disable: the confirm discloses the session-kill consequence BEFORE the POST; confirming fires it exactly once", async () => {
    const card = await cardOf("mod1");

    fireEvent.click(within(card).getByText("تعطيل"));

    // The useConfirm AlertDialog opens (page-level mount).
    const title = await screen.findByText("تعطيل المسؤول؟");
    const confirmDialog = title.closest('[role="alertdialog"]') as HTMLElement;
    expect(confirmDialog).toBeTruthy();
    // The consequence copy: disabling KILLS LIVE SESSIONS (the
    // operator must know the one-way door before walking through it).
    const description = within(confirmDialog).getByText(/سيتم تعطيل الحساب @mod1\./);
    expect(description.textContent).toContain("ستنتهي جلساته الحالية فوراً.");
    expect(within(confirmDialog).getByRole("button", { name: "تعطيل" })).toBeInTheDocument();

    // Cancel first — the POST must NOT fire (the confirm is a gate).
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => {
      expect(mutationCalls().filter((m) => m.key.includes("disable"))).toHaveLength(0);
    });

    // Re-open and CONFIRM — now the disable POST fires exactly once.
    fireEvent.click(within(card).getByText("تعطيل"));
    const dialog2 = (await screen.findByText("تعطيل المسؤول؟")).closest(
      '[role="alertdialog"]',
    ) as HTMLElement;
    fireEvent.click(within(dialog2).getByRole("button", { name: "تعطيل" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم تعطيل المسؤول @mod1", variant: "success" }),
      );
    });
    const disables = mutationCalls().filter((m) => m.key === "POST /api/admin/admins/3/disable");
    expect(disables).toHaveLength(1);
  });

  it("while the disable POST is in flight, the row's toggle is busy — a double-click cannot re-fire it (R147 2-c D3)", async () => {
    // Park the disable POST on a gate the test releases — the row's
    // button must disable + read «جارٍ...» for exactly that window
    // (the coupons.tsx `toggling` idiom, first pinned here for admins:
    // the POST kills live sessions, so a double-fire was never
    // cosmetic).
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    (fetchMock as unknown as Mock).mockImplementation(
      routeFetch({ "POST /api/admin/admins/3/disable": gate.then(() => resLike({ body: {} })) }),
    );

    const card = await cardOf("mod1");
    fireEvent.click(within(card).getByText("تعطيل"));
    const dialog = (await screen.findByText("تعطيل المسؤول؟")).closest(
      '[role="alertdialog"]',
    ) as HTMLElement;
    fireEvent.click(within(dialog).getByRole("button", { name: "تعطيل" }));

    // In-flight: the row's toggle flips to the busy label AND disables
    // (the TopupCard «جارٍ...» idiom).
    const busy = await within(card).findByText("جارٍ...");
    expect(busy.closest("button")).toBeDisabled();

    // Release the POST — exactly ONE disable fired, then the success
    // toast + reload ride the normal path.
    release();
    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم تعطيل المسؤول @mod1", variant: "success" }),
      );
    });
    const disables = mutationCalls().filter((m) => m.key === "POST /api/admin/admins/3/disable");
    expect(disables).toHaveLength(1);
  });

  it("enable: the confirm carries NO session-kill clause, and CANCEL means no POST at all", async () => {
    const card = await cardOf("old1");

    fireEvent.click(within(card).getByText("تفعيل"));

    const title = await screen.findByText("تفعيل المسؤول؟");
    const confirmDialog = title.closest('[role="alertdialog"]') as HTMLElement;
    // Enabling revokes nothing — the clause must NOT render (an
    // unconditional copy would scare operators off a safe action).
    const description = within(confirmDialog).getByText(/سيتم تفعيل الحساب @old1\./);
    expect(description.textContent).not.toContain("ستنتهي جلساته");

    // Cancel — no mutating call ever leaves the page.
    fireEvent.click(within(confirmDialog).getByRole("button", { name: "إلغاء" }));
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(mutationCalls()).toEqual([]);
  });

  it('edit a SUPER-admin: the PATCH preserves permissions:["all"] — never [] (the super-admin invariant)', async () => {
    const card = await cardOf("root2");

    fireEvent.click(within(card).getByText("تعديل"));
    const dialog = await screen.findByRole("dialog");

    // The super-admin lock notice renders INSTEAD of the scope grid —
    // the wildcard is not editable from this surface.
    expect(within(dialog).getByText(/هذا الحساب يملك جميع الصلاحيات/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();

    // Display-name edit rides through (the one editable axis).
    const nameInput = within(dialog).getByLabelText("الاسم الظاهر");
    fireEvent.change(nameInput, { target: { value: "المدير العام الأول" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم تحديث الحساب", variant: "success" }),
      );
    });

    const patches = mutationCalls().filter((m) => m.key === "PATCH /api/admin/admins/2");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({
      display_name: "المدير العام الأول",
      // admins.tsx:315 — editingIsSuper ? ["all"] : … A regression
      // that sends the (empty) granular draft would DEMOTE the
      // super-admin to zero scopes on a display-name save.
      permissions: ["all"],
    });
  });

  it("edit a regular admin: the PATCH carries the granular re-checked set (exactly the remainder)", async () => {
    const card = await cardOf("mod1");

    fireEvent.click(within(card).getByText("تعديل"));
    const dialog = await screen.findByRole("dialog");

    // The granular grid renders pre-checked with the persisted set.
    const orders = within(dialog).getByRole("checkbox", { name: "الطلبات" });
    expect(orders).toHaveAttribute("aria-checked", "true");
    // Uncheck «الطلبات» → the PATCH must send exactly ["topups"].
    fireEvent.click(orders);

    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ title: "تم تحديث الحساب", variant: "success" }),
      );
    });

    const patches = mutationCalls().filter((m) => m.key === "PATCH /api/admin/admins/3");
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({
      display_name: "مشرف الشحن",
      permissions: ["topups"],
    });
  });
});

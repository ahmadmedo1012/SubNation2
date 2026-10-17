/**
 * R158 (hooks lane) — the NotificationBell.tsx decomposition contract.
 *
 * The bell was an 825-line two-in-one: the notifications data machine
 * (the notifs/loadState atoms, the 60 s visible-tab poll, the
 * NOTIFICATION_NEW_EVENT / SOCKET_RESYNC_EVENT accelerators, the
 * fetch-sequence + latest-list refs, the new-notification toast gate
 * and the optimistic mark-read pair with exact rollback) AND the
 * open/close UI wiring + portal'd panel, all in one file. R158 split
 * it along that seam: presentation + dialog wiring
 * (components/layout/NotificationBell.tsx) + data machine
 * (@/hooks/useNotifications). NotificationPanel deliberately stays
 * IN-FILE — it is presentation (its own vw/resize + focus-management
 * effects render the dialog, they fetch nothing).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r136-r137
 * decomposition idiom — structural invariants a render test only
 * covers incidentally). The RENDER contract (byte-identical DOM, the
 * rollback + stale-poll ordering, the R153 tri-state, the R157
 * footer-link focus order + scroll-close) is already pinned by the
 * notification-bell-* render suites; this file guards the STRUCTURE
 * so the decomposition cannot silently regress:
 *
 *   1. size ceiling — the component stays presentation + wiring (it
 *      was 825 lines; the ceiling leaves room to grow without
 *      re-ballooning into the data-machine monolith);
 *   2. delegation — the bell consumes useNotifications and owns the
 *      open/close wiring itself (the R157 scroll-close + outside-click
 *      + Escape contracts stay right here, beside the setOpen state
 *      they guard);
 *   3. hook ownership — useNotifications owns the poll/loadState/
 *      mark-read machine: the atoms, the 60 s interval, the socket
 *      accelerators, the fetch-seq guard and the optimistic rollbacks;
 *   4. panel locality — NotificationPanel + TYPE_CONFIG stay in the
 *      component file (TYPE_CONFIG's export address is pinned by
 *      status-tokens.test.tsx).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const component = read("src/components/layout/NotificationBell.tsx");
const hook = read("src/hooks/useNotifications.ts");

describe("R158 (hooks lane) — NotificationBell stays presentation + dialog wiring", () => {
  it("components/layout/NotificationBell.tsx stays under the 700-line ceiling (was 825 at extraction)", () => {
    const lines = component.split("\n").length;
    expect(lines).toBeLessThan(700);
  });

  it("the bell delegates its data machine to useNotifications (deletion guard — a dropped import is a dead badge)", () => {
    expect(component).toContain('from "@/hooks/useNotifications";');
    expect(component).toContain(
      "const { notifs, unread, loadState, fetchAll, markAllRead, markRead } = useNotifications({",
    );
  });

  it("the open/close wiring stays in the component (the R157 scroll-close + outside-click + Escape contracts)", () => {
    // The three dismissal effects guard setOpen — the component's own
    // state; they must not drift into the data hook (which never knows
    // the panel is open).
    expect(component).toContain(
      "if (target?.closest?.('[data-notification-panel=\"1\"]')) return;",
    );
    expect(component).toContain(
      'window.addEventListener("scroll", onScroll, { passive: true, capture: true });',
    );
    expect(component).toContain('if (e.key === "Escape") setOpen(false);');
    // And the notification fetches never return to the component.
    expect(component).not.toContain('"/api/notifications"');
  });

  it("NotificationPanel + TYPE_CONFIG stay in-file (presentation — the status-tokens pin reads this address)", () => {
    expect(component).toContain("function NotificationPanel({");
    expect(component).toContain("export const TYPE_CONFIG");
  });
});

describe("R158 (hooks lane) — useNotifications owns the poll/loadState/mark-read machine", () => {
  it("the hook owns the list + tri-state atoms and the derived unread count", () => {
    expect(hook).toContain("const [notifs, setNotifs] = useState<Notif[]>([]);");
    expect(hook).toContain(
      'const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");',
    );
    expect(hook).toContain("const unread = notifs.filter((n) => !n.is_read).length;");
  });

  it("the hook owns the freshness machinery (60 s visible-tab poll + both socket accelerators + visibility gate)", () => {
    expect(hook).toContain("setInterval(() => void fetchAll(), 60_000);");
    expect(hook).toContain(
      "window.addEventListener(NOTIFICATION_NEW_EVENT, onSocketNotification);",
    );
    expect(hook).toContain("window.addEventListener(SOCKET_RESYNC_EVENT, onResync);");
    expect(hook).toContain('document.addEventListener("visibilitychange", onVisibility);');
    // The logout reset so a re-login starts clean.
    expect(hook).toContain("// Reset refs on logout so a re-login starts clean.");
  });

  it("the hook owns the ordering + rollback contracts (fetch-seq guard, latest-list mirror, optimistic mark-read pair)", () => {
    // 98-F7 (r97 F-10): only the LATEST request owns the state.
    expect(hook).toContain("const fetchSeqRef = useRef(0);");
    expect(hook).toContain("if (seq !== fetchSeqRef.current) return;");
    // The pre-optimistic snapshot for the exact rollback.
    expect(hook).toContain("const notifsRef = useRef<Notif[]>([]);");
    expect(hook).toContain('await customFetch("/api/notifications/read-all", {');
    expect(hook).toContain("await customFetch(`/api/notifications/${id}/read`, {");
  });

  it("the hook is a data machine, not a render unit — values + callbacks out, no JSX", () => {
    expect(hook).not.toMatch(/return\s*\(\s*</);
    expect(hook).not.toMatch(/from "lucide-react"|from "wouter"/);
  });
});

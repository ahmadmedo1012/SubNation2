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
 * (@/hooks/useNotifications). NotificationPanel deliberately stayed
 * IN-FILE through R166 — it is presentation (its own vw/resize +
 * focus-management effects render the dialog, they fetch nothing).
 *
 * R167 (layout decomposition — F13) superseded that locality: the bell
 * was STILL a 635-line two-in-one (trigger wiring + the whole portal'd
 * panel), so the panel moved verbatim to
 * components/layout/bell/NotificationPanel.tsx as a self-contained
 * feature component (the GlobalSearch R137 precedent — its vw state +
 * focus refs are overlay-local), with the per-item row (NotificationRow),
 * the footer link (PanelFooter) and the TYPE_CONFIG table (type-config)
 * in sibling extracts. The status-tokens import address survives via the
 * re-export. The seam this family guards is unchanged: the trigger keeps
 * wiring + chrome; the data machine stays in the hook; the presentation
 * extracts fetch nothing.
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
 *   4. presentation locality — NotificationPanel + TYPE_CONFIG live at
 *      their R167 extract addresses (bell/NotificationPanel.tsx +
 *      bell/type-config.ts), with the bell's module boundary re-exporting
 *      TYPE_CONFIG so the pinned status-tokens import address (the
 *      @/components/layout/NotificationBell specifier) still resolves
 *      (the NAV_SECTIONS re-export idiom). The R167 sibling family
 *      (layout-decomposition-r167.test.ts) pins the extract-side shape.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const component = read("src/components/layout/NotificationBell.tsx");
const hook = read("src/hooks/useNotifications.ts");
// R167: the presentation extracts the moved code now calls home.
const panel = read("src/components/layout/bell/NotificationPanel.tsx");
const typeConfig = read("src/components/layout/bell/type-config.ts");

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

  it("R167: NotificationPanel + TYPE_CONFIG live at their extract addresses (the bell re-exports the table — the status-tokens import specifier still resolves)", () => {
    // The bell's module boundary keeps TYPE_CONFIG reachable at the
    // pinned address (status-tokens.test.tsx + pages/notifications.tsx
    // import it from @/components/layout/NotificationBell) via the
    // NAV_SECTIONS re-export idiom; the real declaration moved verbatim
    // to the React-free data module.
    expect(component).toContain('export { TYPE_CONFIG } from "./bell/type-config";');
    expect(typeConfig).toContain("export const TYPE_CONFIG");
    // The panel moved verbatim as a feature component (GlobalSearch
    // precedent) and is consumed by the bell's portal mount.
    expect(panel).toContain("export function NotificationPanel({");
    expect(component).toContain('import { NotificationPanel } from "./bell/NotificationPanel";');
    // The panel fetches nothing — presentation only (the r158 seam).
    expect(panel).not.toContain('"/api/notifications"');
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

  it("the hook owns the freshness machinery (visible-tab poll + both socket accelerators + visibility gate)", () => {
    // R192 (Neon compute-quota incident): the cadence moved 60 s → 120 s
    // behind the named constant — the pin follows the constant (the
    // comment above it documents the why; the literal interval is no
    // longer duplicated at the two setInterval sites).
    expect(hook).toContain("const NOTIFICATION_POLL_INTERVAL_MS = 120_000;");
    expect(hook).toContain("setInterval(() => void fetchAll(), NOTIFICATION_POLL_INTERVAL_MS);");
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

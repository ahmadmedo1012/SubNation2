/**
 * R-140-f (r140 error lane) — error-boundary coverage + fallback-quality
 * pin suite.
 *
 * Three contracts, pinned so a future round cannot silently regress
 * them:
 *
 *   1. SEGMENT COVERAGE — every MONEY route (checkout / wallet+topup /
 *      cart / order-detail / loyalty) and the auth funnel (login /
 *      register) resolves to a withRouteBoundary-wrapped component in
 *      app/routes.tsx, while the app-level boundary around the public
 *      Switch stays mounted as the backstop for every other route.
 *      Source-scan (the r137 deletion-surface idiom: the route table is
 *      too heavy to render whole in jsdom).
 *
 *   2. FALLBACK QUALITY — the boundary's recovery screen rides the r139
 *      calm-error register (fetch-error-card's page scale): calm card
 *      frame, ONE red accent on the icon stage, role="alert", canonical
 *      Button CTAs (R116-S1 recipes), the retired pre-R116-S1 hand-roll
 *      absent. Source-scan + one render pin (Arabic copy + both CTAs).
 *
 *   3. THE SENTRY PATH — componentDidCatch still lazy-imports
 *      @sentry/react on the error path (mock-friendly SOURCE-scan pin —
 *      no SDK boot required) and ships the componentStack context; the
 *      resetKey machinery (98-F7) stays byte-identical.
 *
 * Plus the (d) interplay pin: the socket initializer — the LAST
 * defer-mounted lazy chrome block that sat ABOVE every boundary — now
 * rides its own fallback={null} guard, pinned by source AND by a
 * behavioral crash-containment render (a throwing SocketInitializer
 * must not escape to the React root).
 *
 * stripComments(): rationale comments NAME the retired strings, so the
 * negative pins scan comment-free source (the 139-c craft,
 * line-comments-first — none of these files carry `/*`-bearing string
 * literals; verified).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lazy, Suspense } from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DeferredSocketInitializer } from "@/app/app-shell";

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    // Static admin session: the socket deferral timer arms immediately.
    token: null,
    adminToken: "__boundary_test_admin__",
    setToken: vi.fn(),
    setAdminToken: vi.fn(),
    setAdminPermissions: vi.fn(),
  }),
}));

vi.mock("@/components/SocketInitializer", () => ({
  // R-140-f behavioral pin: a SocketInitializer whose render throws.
  SocketInitializer: () => {
    throw new Error("socket-render-boom-r140f");
  },
}));

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** Line-comments-first stripper (the 139-i lesson: block-first opens
 *  phantom comments; ordering pinned regardless). */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

const ROUTES = stripComments(read("src/app/routes.tsx"));
const SHELL = stripComments(read("src/app/app-shell.tsx"));
const BOUNDARY = stripComments(read("src/components/ErrorBoundary.tsx"));

vi.spyOn(console, "error").mockImplementation(() => {});

afterEach(() => {
  cleanup();
});

/** The money + auth segment set (task r140-f): five money paths — the
 *  topup funnel rides INSIDE the wallet page — plus the login/register
 *  auth funnel. Deliberately NOT every route: browsing surfaces keep
 *  the app-level boundary alone. */
const SEGMENT_GUARDED_ROUTES = [
  { path: "/login", page: "LoginPage" },
  { path: "/register", page: "RegisterPage" },
  { path: "/wallet", page: "WalletPage" },
  { path: "/cart", page: "CartPage" },
  { path: "/checkout", page: "CheckoutPage" },
  { path: "/orders/:orderCode", page: "OrderDetailPage" },
  { path: "/loyalty", page: "LoyaltyPage" },
] as const;

function Boom(): never {
  throw new Error("kaboom-r140f");
}

describe("R-140-f — money/auth route-segment boundaries (source-scan)", () => {
  it("every money + auth route resolves to its withRouteBoundary twin while the registration stays byte-identical", () => {
    for (const { path, page } of SEGMENT_GUARDED_ROUTES) {
      // The r137 deletion surface — the registration line is untouched…
      expect(ROUTES, path).toContain(`<Route path="${path}" component={${page}} />`);
      // …and the SAME public name now points at the guarded twin (the
      // lazy import is aliased to *Lazy and re-bound above the table).
      expect(ROUTES, path).toContain(`const ${page} = withRouteBoundary(${page}Lazy);`);
    }
  });

  it("exactly SEVEN segments are wrapped — no silent loss, no scope creep onto browsing routes", () => {
    // The HOC definition (`function withRouteBoundary<T extends …>`)
    // does not match `withRouteBoundary(` — only the call sites do.
    expect((ROUTES.match(/withRouteBoundary\(/g) ?? []).length).toBe(7);
    // Browsing surfaces stay on the app-level boundary alone.
    for (const bare of ["HomePage", "ProductPage", "CategoryPage", "OrdersPage", "SupportPage"]) {
      expect(ROUTES, bare).not.toContain(`withRouteBoundary(${bare}`);
    }
  });

  it("the wrapper is the 98-F7 contract at segment scope: ErrorBoundary + resetKey = live location", () => {
    expect(ROUTES).toContain("function withRouteBoundary");
    expect(ROUTES).toContain(
      "<ErrorBoundary resetKey={location}>\n        <Page {...props} />\n      </ErrorBoundary>",
    );
    // The live location (not a frozen route constant) resets the
    // segment boundary — /orders/:orderCode param changes reset too.
    // R140 central re-anchor: the generic moved from ComponentType<any>
    // to <P extends object> (the lint-baseline cleanup — no-explicit-any);
    // same wrapper, same contract, P carries the props inference.
    expect(ROUTES).toContain(
      "function GuardedPage(props: P) {\n    const [location] = useLocation();",
    );
  });

  it("the app-level boundary stays mounted as the backstop, OUTSIDE the Switch-level Suspense", () => {
    // Boundary-outside-Suspense order (R118-B2's verified interplay): a
    // lazy-payload rejection on an UNwrapped route still reaches the
    // app boundary — the segment guards are additive, not a replacement.
    expect(ROUTES).toContain(
      "<ErrorBoundary resetKey={location}>\n          <Suspense fallback={<RouteSuspenseFallback />}>",
    );
    // The chrome slim boundaries keep their shape (R118-B2).
    expect(ROUTES).toContain("<ErrorBoundary resetKey={location} fallback={null}>");
  });
});

describe("R-140-f — the fallback rides the r139 calm-error register (source-scan)", () => {
  it("calm card frame + the ONE red accent on the icon stage + role=alert", () => {
    // The family card (fetch-error-card's page scale): calm resting
    // border, the state signal concentrated in the icon stage.
    expect(BOUNDARY).toContain(
      'className="w-full max-w-sm text-center bg-card border border-border/60 rounded-2xl px-6 py-10 sm:px-8"',
    );
    expect(BOUNDARY).toContain("bg-status-error/8 border border-status-error/22");
    expect(BOUNDARY).toContain('className="w-8 h-8 text-status-error"');
    // R125 A6 B-8: an error screen is never silent to screen readers.
    expect(BOUNDARY).toContain('role="alert"');
    // Calm ink ladder: bold /80 headline (not a red wall) + muted body.
    expect(BOUNDARY).toContain("text-foreground/80");
    expect(BOUNDARY).toContain("text-muted-foreground leading-relaxed");
    // R120-B5: the viewport fill keeps the dvh convention.
    expect(BOUNDARY).toContain("min-h-[100dvh]");
  });

  it("canonical Button CTAs with REAL recovery actions (reload + home escape)", () => {
    expect(BOUNDARY).toContain('import { Button } from "@/components/ui/button";');
    // The R116-S1 page-primary CTA recipe: size="lg" + w-full sm:w-auto.
    expect(BOUNDARY).toContain('size="lg"');
    expect(BOUNDARY).toContain("w-full sm:w-auto");
    expect(BOUNDARY).toContain("window.location.reload()");
    expect(BOUNDARY).toContain('window.location.href = "/";');
    // The secondary twin rides the outline variant, not a hand-rolled
    // bg-secondary/60 wash.
    expect(BOUNDARY).toContain('variant="outline"');
  });

  it("the pre-R116-S1 hand-roll is retired (no panic styling on the crash screen)", () => {
    // Comment-stripped source: the retirement's own documentation cannot
    // false-fail these absence pins.
    expect(BOUNDARY).not.toContain("shadow-lg");
    expect(BOUNDARY).not.toContain("shadow-primary/20");
    expect(BOUNDARY).not.toContain("active:scale-95");
    expect(BOUNDARY).not.toContain("hover:bg-primary/90");
    expect(BOUNDARY).not.toContain("bg-secondary/60");
    expect(BOUNDARY).not.toContain("transition-all");
  });

  it("the Arabic recovery copy is verbatim (the hard rule)", () => {
    for (const copy of [
      "حدث خطأ غير متوقع",
      "نعتذر، حدث خطأ في هذه الصفحة.",
      "يرجى إعادة التحميل أو التواصل مع فريق الدعم.",
      "تفاصيل الخطأ (للمطورين)",
      "إعادة التحميل",
      "الرئيسية",
    ]) {
      expect(BOUNDARY, copy).toContain(copy);
    }
  });
});

describe("R-140-f — the fallback renders the calm card with both CTAs (render pin)", () => {
  it("a caught crash shows the announced card, the Arabic copy and the reload/home affordances", () => {
    render(
      <ErrorBoundary resetKey="/checkout">
        <Boom />
      </ErrorBoundary>,
    );

    // role="alert" (R125 A6 B-8) + the verbatim Arabic copy. The second
    // description line is joined across the <br /> — regex matchers
    // bridge the text-node normalization.
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();
    expect(screen.getByText(/نعتذر، حدث خطأ في هذه الصفحة\./)).toBeInTheDocument();
    expect(screen.getByText(/يرجى إعادة التحميل أو التواصل مع فريق الدعم\./)).toBeInTheDocument();
    // Both canonical recovery affordances render as real buttons.
    expect(screen.getByRole("button", { name: "إعادة التحميل" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "الرئيسية" })).toBeInTheDocument();
  });

  it("the slim-fallback contract is untouched: fallback={null} renders nothing (chrome degradation)", () => {
    const { container } = render(
      <ErrorBoundary resetKey="/wallet" fallback={null}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("R-140-f — the Sentry dynamic-import error path stays guarded (source-scan)", () => {
  it("componentDidCatch still lazy-imports @sentry/react and ships the componentStack context", () => {
    // Mock-friendly pin: the SDK is imported ON the error path only —
    // scanning the source proves the guard without booting Sentry.
    // B-3 (R142): the import chain now carries a .catch — the pin tracks
    // the multiline shape (import → then → capture, catch closes).
    expect(BOUNDARY).toContain('void import("@sentry/react")');
    expect(BOUNDARY).toContain(".then((Sentry) => {");
    expect(BOUNDARY).toContain("Sentry.captureException(error)");
    expect(BOUNDARY).toContain("componentStack");
    expect(BOUNDARY).toContain(".catch(() => {})");
  });

  it("the class API + reset machinery is byte-identical (98-F7 / R118-B2 contracts)", () => {
    expect(BOUNDARY).toContain("static getDerivedStateFromError(error: Error): State {");
    expect(BOUNDARY).toContain("componentDidCatch(error: Error, errorInfo: React.ErrorInfo)");
    expect(BOUNDARY).toContain("resetKey?: string | number;");
    expect(BOUNDARY).toContain("fallback?: ReactNode;");
    expect(BOUNDARY).toContain("if (this.props.fallback !== undefined) {");
  });
});

describe("R-140-f — lazy-failure interplay: the second chunk failure lands in the SEGMENT boundary (d)", () => {
  it("a lazy-payload rejection surfaces to the nearest boundary INSIDE the Suspense, not the app boundary", async () => {
    // The routes.tsx mount shape, minimized: app boundary → Switch-level
    // Suspense → segment boundary (withRouteBoundary's twin) → lazy page.
    // lazyWithRetry's first chunk failure reloads the page; the SECOND
    // rethrows from the lazy payload — this pin proves React 19 routes
    // that rejection to the INNER boundary, so a money page's chunk
    // outage is contained to its own segment.
    const RejectedPage = lazy(() => Promise.reject(new Error("chunk-load-boom-r140f")));

    render(
      <ErrorBoundary resetKey="/app-backstop">
        <Suspense fallback={<div data-testid="route-skeleton" />}>
          <ErrorBoundary resetKey="/checkout" fallback={<div data-testid="segment-caught" />}>
            <RejectedPage />
          </ErrorBoundary>
        </Suspense>
      </ErrorBoundary>,
    );

    // Suspension first: the Switch-level skeleton renders (an error
    // boundary never blocks suspension — it propagates through).
    expect(screen.getByTestId("route-skeleton")).toBeInTheDocument();

    // After the rejection settles, the NEAREST boundary wins: the
    // segment guard inside the Suspense catches it while the app-level
    // backstop stays pristine (its full-screen recovery page never
    // appears).
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("segment-caught")).toBeInTheDocument();
    expect(screen.queryByText("حدث خطأ غير متوقع")).not.toBeInTheDocument();
  });
});

describe("R-140-f — the socket initializer rides a boundary (the last bare lazy mount)", () => {
  it("app-shell wraps SocketInitializer in the fallback={null} guard, Toaster-style", () => {
    expect(SHELL).toContain(
      "<ErrorBoundary fallback={null}>\n      <Suspense fallback={null}>\n        <SocketInitializer />",
    );
    // Two slim chrome boundaries now: Toaster (R130 A5-F5) + socket.
    expect((SHELL.match(/<ErrorBoundary fallback=\{null\}>/g) ?? []).length).toBe(2);
  });

  it("a SocketInitializer render throw is CONTAINED — nothing escapes to the React root", async () => {
    vi.useFakeTimers();
    try {
      // The mocked module throws on render; before R-140-f this had no
      // boundary between it and the root (React 19 would unmount the
      // whole tree for an INVISIBLE block). Now: silent degradation.
      const { container } = render(<DeferredSocketInitializer />);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_500);
      });
      expect(container).toBeEmptyDOMElement();
      // And the crash never surfaced the full-screen recovery page.
      expect(screen.queryByText("حدث خطأ غير متوقع")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

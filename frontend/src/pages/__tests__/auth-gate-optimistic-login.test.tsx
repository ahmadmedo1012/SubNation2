/**
 * R127-L10 (B4 D3) — AuthGate optimistic login render.
 *
 * Live (B4 §A/§B): login-mobile was the worst run of the fleet (score
 * 66, TBT 621 ms, LCP 4,260 ms) because AuthGate held ALL paint behind
 * the /api/auth/probe cookie round-trip (0.6–0.9 s live) while the
 * login form carries ZERO session-dependent content (LoginPage and
 * AuthProviders render no token-dependent UI — verified in the lane's
 * source audit).
 *
 * The fix: on an exact-/login boot the gate renders `children`
 * optimistically while the probe is in flight; every other route keeps
 * the unchanged splash contract. These tests pin:
 *
 *   1. the isLoginBootPath truth table (the gate can never silently
 *      widen to other routes — the money pages must keep the splash —
 *      nor narrow past /login itself);
 *   2. the render behavior: children paint on a /login boot during
 *      `initializing` (query-string variants included — the form is
 *      identical with ?redirect=/?error=), the flat-background →
 *      splash sequence is preserved for non-login routes, and
 *   3. the probe-landing transition on /login does NOT remount the
 *      tree (same DOM node before/after `initializing` flips — the
 *      "no flash of wrong content" property is structural: the
 *      optimistic tree IS the post-probe tree).
 *
 * Harness: the export-for-test pattern (shapeForRoute /
 * DeferredSocketInitializer / IdleToaster) — AuthGate and the predicate
 * are exported from App.tsx; "@/lib/auth" is mocked at the module
 * boundary so the probe state is a test-controlled variable.
 */

import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate, isLoginBootPath } from "@/App";

// ── Module-boundary mock: auth state is a test variable ────────────────────

const authState = vi.hoisted(() => ({ initializing: true }));

vi.mock("@/lib/auth", () => ({
  // AuthGate destructures { initializing } only.
  useAuth: () => ({ initializing: authState.initializing }),
  // App.tsx imports it at module scope; never rendered in this suite.
  AuthProvider: () => null,
}));

function setUrl(path: string): void {
  window.history.pushState({}, "", path);
}

beforeEach(() => {
  authState.initializing = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1. The predicate truth table ────────────────────────────────────────────

describe("R127-L10 (B4 D3): isLoginBootPath", () => {
  describe('default deployment (routerBase = "")', () => {
    it("the exact login route passes", () => {
      expect(isLoginBootPath("/login", "")).toBe(true);
    });

    it("the money pages and every other route are gated out (splash contract preserved)", () => {
      expect(isLoginBootPath("/", "")).toBe(false);
      expect(isLoginBootPath("/checkout", "")).toBe(false);
      expect(isLoginBootPath("/wallet", "")).toBe(false);
      expect(isLoginBootPath("/orders", "")).toBe(false);
      expect(isLoginBootPath("/register", "")).toBe(false);
      expect(isLoginBootPath("/cart", "")).toBe(false);
      expect(isLoginBootPath("/product/netflix-1m", "")).toBe(false);
    });

    it("the admin login is a DIFFERENT surface — never passes", () => {
      expect(isLoginBootPath("/admin/login", "")).toBe(false);
      expect(isLoginBootPath("/admin", "")).toBe(false);
    });

    it("near-miss paths must not leak through a startsWith-style regression", () => {
      expect(isLoginBootPath("/login/extra", "")).toBe(false);
      expect(isLoginBootPath("/loginx", "")).toBe(false);
      expect(isLoginBootPath("//login", "")).toBe(false);
      expect(isLoginBootPath("login", "")).toBe(false);
    });
  });

  describe('based deployment (routerBase = "/sub")', () => {
    it("the based login route passes", () => {
      expect(isLoginBootPath("/sub/login", "/sub")).toBe(true);
    });

    it("the unbased /login under a base does NOT pass (it 404s in the router)", () => {
      expect(isLoginBootPath("/login", "/sub")).toBe(false);
      expect(isLoginBootPath("/sub/login", "")).toBe(false);
    });
  });
});

// ── 2. AuthGate render behavior ─────────────────────────────────────────────

describe("R127-L10 (B4 D3): AuthGate — optimistic /login render", () => {
  it("renders children DURING initializing on a /login boot (paint leaves the probe's critical path)", () => {
    setUrl("/login");

    render(
      <AuthGate>
        <div>LOGIN-CONTENT-MARKER</div>
      </AuthGate>,
    );

    expect(screen.getByText("LOGIN-CONTENT-MARKER")).toBeInTheDocument();
    // No splash surface — neither the flat background nor AppSplashScreen.
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("query-string variants of /login also render optimistically (the form is session-independent)", () => {
    setUrl("/login?redirect=/checkout&error=cancelled");

    render(
      <AuthGate>
        <div>LOGIN-CONTENT-MARKER</div>
      </AuthGate>,
    );

    expect(screen.getByText("LOGIN-CONTENT-MARKER")).toBeInTheDocument();
  });

  it("the probe landing does NOT remount the tree — the same DOM node survives the initializing flip", () => {
    setUrl("/login");

    const { rerender } = render(
      <AuthGate>
        <div>LOGIN-CONTENT-MARKER</div>
      </AuthGate>,
    );
    const before = screen.getByText("LOGIN-CONTENT-MARKER");

    authState.initializing = false;
    rerender(
      <AuthGate>
        <div>LOGIN-CONTENT-MARKER</div>
      </AuthGate>,
    );

    // Same node reference, still attached — the optimistic tree IS the
    // post-probe tree (children identity never changed), so there is
    // no unmount/remount flicker when the gate condition disappears.
    const after = screen.getByText("LOGIN-CONTENT-MARKER");
    expect(after).toBe(before);
    expect(before.isConnected).toBe(true);
  });
});

describe("R127-L10 (B4 D3): AuthGate — every other route keeps the splash contract (unchanged)", () => {
  it("a money page boot holds children behind the flat background, then the splash (probe pending)", async () => {
    setUrl("/checkout");

    const { container } = render(
      <AuthGate>
        <div>MONEY-PAGE-MARKER</div>
      </AuthGate>,
    );

    // Pre-threshold: flat background div, no route content.
    expect(screen.queryByText("MONEY-PAGE-MARKER")).not.toBeInTheDocument();
    expect(container.querySelector('div[aria-hidden="true"].bg-background')).toBeInTheDocument();

    // ≥250 ms: the branded splash appears (AppSplashScreen, role=status).
    expect(
      await screen.findByRole("status", { name: "جارٍ التحميل" }, { timeout: 2_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByText("MONEY-PAGE-MARKER")).not.toBeInTheDocument();
  });

  it("the home boot also stays gated (the optimistic branch is /login-ONLY)", () => {
    setUrl("/");

    render(
      <AuthGate>
        <div>HOME-MARKER</div>
      </AuthGate>,
    );

    expect(screen.queryByText("HOME-MARKER")).not.toBeInTheDocument();
  });

  it("once initializing clears, children render as before (the gate's normal contract)", () => {
    setUrl("/wallet");
    authState.initializing = false;

    render(
      <AuthGate>
        <div>WALLET-MARKER</div>
      </AuthGate>,
    );

    expect(screen.getByText("WALLET-MARKER")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});

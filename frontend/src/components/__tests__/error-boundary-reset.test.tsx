/**
 * 98-F7 (r97 F-14) — ErrorBoundary reset-by-resetKey tests.
 *
 * App.tsx mounts ONE boundary around the whole route Switch. The old
 * reset trigger was children identity — but AppRoutes mints a new
 * Switch element on every parent re-render (auth flip, theme, location
 * change), so the reset fired on UNRELATED re-renders while an actual
 * navigation to a healthy route could leave the boundary stuck showing
 * the previous route's error screen. The new contract: an explicit
 * `resetKey` (the route location) resets exactly on navigation; a
 * same-key re-render cannot clear the error; sites without a resetKey
 * keep the legacy children-identity fallback.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "@/components/ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom-route");
}

vi.spyOn(console, "error").mockImplementation(() => {});

describe("ErrorBoundary — reset by resetKey, not children identity (r97 F-14)", () => {
  it("resets the error screen when the resetKey (route) changes", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/wallet">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();

    // Navigate to a healthy route — same boundary, new key.
    rerender(
      <ErrorBoundary resetKey="/">
        <div>route-home</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("route-home")).toBeInTheDocument();
    expect(screen.queryByText("حدث خطأ غير متوقع")).not.toBeInTheDocument();
  });

  it("a same-key re-render with a new children element does NOT clear the error", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/wallet">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();

    // Unrelated parent re-render (auth/theme flip): fresh children
    // element, SAME route key — the boundary must stay on the error
    // screen instead of flickering into a still-broken render.
    rerender(
      <ErrorBoundary resetKey="/wallet">
        <div>re-rendered-children</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();
    expect(screen.queryByText("re-rendered-children")).not.toBeInTheDocument();
  });

  it("a re-crash after a reset re-enters the error state (no zombie reset)", () => {
    const { rerender } = render(
      <ErrorBoundary resetKey="/wallet">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();

    // Reset by navigating away…
    rerender(
      <ErrorBoundary resetKey="/">
        <div>route-home</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("route-home")).toBeInTheDocument();

    // …then navigate into a DIFFERENT crashing route.
    rerender(
      <ErrorBoundary resetKey="/orders">
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();
  });

  it("legacy fallback: without a resetKey, a children identity change still resets", () => {
    const { rerender } = render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("حدث خطأ غير متوقع")).toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <div>legacy-healthy</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("legacy-healthy")).toBeInTheDocument();
  });
});

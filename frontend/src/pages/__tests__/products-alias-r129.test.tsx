/**
 * R129-B1 (B1-2) — the /products alias route pin.
 *
 * A2-F3 (R128) added the conventional e-commerce URL's client redirect
 * (ProductsAliasRedirect → home, replace semantics) — but NO test pinned
 * it, so the route could be deleted silently. Pinned here BEHAVIORALLY:
 * the component really navigates to "/" with replaceState (not
 * pushState — the alias leaves no history pollution, back skips it),
 * and the ROUTE REGISTRATION is pinned by source-scan (the
 * storefront-r128-sweep class — App.tsx is too heavy to render whole in
 * jsdom, and the registration line is the deletion surface).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { Router } from "wouter";
import * as fs from "node:fs";
import * as path from "node:path";
import { ProductsAliasRedirect } from "../../App";

// R137 (2-b — pins follow the surface): App.tsx was decomposed into
// src/app/* modules; the route registrations moved to app/routes.tsx.
// The pin reads App.tsx ∪ app/routes.tsx — the assertions are unchanged.
const appSource = ["../../App.tsx", "../../app/routes.tsx"]
  .map((rel) => fs.readFileSync(path.resolve(import.meta.dirname, rel), "utf8"))
  .join("\n");

describe("R129-B1: /products alias (A2-F3) — registration + replace-navigation", () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
    // Start each case at the alias path (jsdom boots at "/").
    window.history.replaceState({}, "", "/products");
  });

  it("registers the /products route with ProductsAliasRedirect (deletion guard)", () => {
    expect(appSource).toContain('<Route path="/products" component={ProductsAliasRedirect} />');
    // The registration must NOT shadow the real param route below it.
    expect(appSource).toContain('<Route path="/product/:slug"');
  });

  it("navigates to home with replaceState — never a push (no history pollution)", () => {
    const replaceSpy = vi.spyOn(window.history, "replaceState");
    const pushSpy = vi.spyOn(window.history, "pushState");

    render(
      <Router>
        <ProductsAliasRedirect />
      </Router>,
    );

    expect(window.location.pathname).toBe("/");
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it("renders nothing (the alias is a pure redirect — no flash of content)", () => {
    const { container } = render(
      <Router>
        <ProductsAliasRedirect />
      </Router>,
    );
    expect(container.innerHTML).toBe("");
  });
});

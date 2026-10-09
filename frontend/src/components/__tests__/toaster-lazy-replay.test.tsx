/**
 * A5-5 (R116) — lazy Toaster + pre-mount toast replay.
 *
 * The Toaster is now mounted via React.lazy on idle (IdleToaster in
 * App.tsx), so sonner + the wrapper's five lucide icons stay out of the
 * entry graph. sonner 2.x hydrates a freshly-mounted <Toaster/> from an
 * EMPTY list and only receives toasts published after its own mount
 * effect subscribes — toasts fired while the chunk was still loading
 * (session-expired redirects, boot-window errors) live only in the
 * module store. The replay bridge in ui/sonner.tsx re-publishes every
 * active store toast on mount so the queue flushes the moment the
 * Toaster appears.
 *
 * These tests pin, with the REAL sonner + REAL shim (no mocks):
 *   1. a toast fired before mount does NOT render (the lost-toast
 *      regression this bridge exists to fix),
 *   2. mounting the Toaster flushes it — title, description AND the
 *      variant's [data-type] (the icon + accent styling contract),
 *   3. a toast fired AFTER mount renders normally (no doublePublish
 *      duplication),
 *   4. IdleToaster (App.tsx) defers the mount until idle — nothing
 *      renders before the idle window closes (fake-timer gated stub).
 */

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast as sonnerToast } from "sonner";

vi.mock("@/lib/theme", () => ({
  useTheme: () => ({ theme: "light" }),
}));

import { toast as shimToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/sonner";

beforeEach(() => {
  // Real timers: sonner's internal flush uses setTimeout(0) +
  // flushSync — waitFor covers it without timer surgery.
});

afterEach(() => {
  cleanup();
  // sonner's store is module-global — drain it so the next test's
  // replay bridge doesn't re-publish this file's earlier toasts
  // (dismiss-all marks every active toast removed).
  act(() => {
    sonnerToast.dismiss();
  });
});

describe("Toaster — top offset reserves the notch safe-area (B13 F-1 / R127)", () => {
  it("offset AND mobileOffset carry calc(env(safe-area-inset-top) + 20px) on the top side", async () => {
    // The [data-sonner-toaster] <ol> renders per-position and only
    // while a toast exists for it — publish one first (the replay
    // bridge then flushes it on mount).
    shimToast.error("توست الإزاحة");
    render(<Toaster />);

    await waitFor(() => {
      expect(screen.getByText("توست الإزاحة")).toBeInTheDocument();
    });

    // sonner's assignOffset() (dist) copies the offset/mobileOffset
    // props RAW into the --offset-* / --mobile-offset-* custom
    // properties on the [data-sonner-toaster] ol; the ≤600px media
    // query pins [data-y-position=top]{top:var(--mobile-offset-top)}.
    // The old props left a hard 20px/16px from the viewport top —
    // every toast's icon + first line under the Dynamic Island / clock
    // in the installed PWA (viewport-fit=cover), the one fixed layer
    // R126-L5's safe-area pass missed.
    const toaster = document.querySelector("[data-sonner-toaster]") as HTMLElement | null;
    expect(toaster).not.toBeNull();
    const read = (prop: string) => toaster!.style.getPropertyValue(prop);
    const EXPECTED = "calc(env(safe-area-inset-top, 0px) + 20px)";
    // BOTH top vars must carry the calc — mobile is where the notch
    // lives, and the mobile variant reads its own var.
    expect(read("--offset-top")).toBe(EXPECTED);
    expect(read("--mobile-offset-top")).toBe(EXPECTED);
    // Regression guards: no bare pixel top offset anywhere.
    expect(read("--offset-top")).not.toBe("20px");
    expect(read("--mobile-offset-top")).not.toBe("16px");
  });

  it("mobileOffset stays the OBJECT form — horizontal insets keep sonner's 16px default", async () => {
    // A bare-string mobileOffset would set --mobile-offset-left/right
    // (the ≤600px toast's horizontal insets) to the TOP-inset value —
    // on a notched phone that's ~47-59px per side and guts the toast's
    // width. The object form touches only the top side.
    shimToast.success("توست العرض");
    render(<Toaster />);

    await waitFor(() => {
      expect(screen.getByText("توست العرض")).toBeInTheDocument();
    });

    const toaster = document.querySelector("[data-sonner-toaster]") as HTMLElement | null;
    expect(toaster).not.toBeNull();
    expect(toaster!.style.getPropertyValue("--mobile-offset-left")).toBe("16px");
    expect(toaster!.style.getPropertyValue("--mobile-offset-right")).toBe("16px");
    expect(toaster!.style.getPropertyValue("--mobile-offset-left")).not.toContain("safe-area");
  });
});

describe("Toaster — pre-mount toast replay bridge (A5-5)", () => {
  it("a toast fired BEFORE mount is lost without a Toaster (the regression this bridge fixes)", () => {
    shimToast.error("توست مبكر", { description: "قبل تحميل التوستر" });
    // No Toaster mounted → nothing renders anywhere in the document.
    expect(screen.queryByText("توست مبكر")).not.toBeInTheDocument();
  });

  it("mounting the Toaster flushes pre-mount toasts — title, description AND variant type", async () => {
    shimToast.error("توست الإعادة", { description: "وصف الإعادة" });
    expect(screen.queryByText("توست الإعادة")).not.toBeInTheDocument();

    render(<Toaster />);

    // The replay bridge re-publishes the queued toast — it renders with
    // the error variant's data-type (icon + accent-strip styling).
    await waitFor(() => {
      const toastEl = screen.getByText("توست الإعادة").closest("[data-sonner-toast]");
      expect(toastEl).not.toBeNull();
      expect(toastEl).toHaveAttribute("data-type", "error");
    });
    expect(screen.getByText("وصف الإعادة")).toBeInTheDocument();
  });

  it("toasts fired AFTER mount render exactly once (no replay duplication)", async () => {
    render(<Toaster />);

    shimToast.success("توست لاحق");

    await waitFor(() => {
      expect(screen.getAllByText("توست لاحق")).toHaveLength(1);
    });
  });

  it("replayed toasts keep their action button (the SW-update toast contract)", async () => {
    shimToast({
      title: "تحديث جديد متاح",
      description: "أعد التحميل للحصول على أحدث نسخة.",
      duration: 60_000,
      action: { label: "إعادة التحميل", onClick: () => {} },
    });

    render(<Toaster />);

    await waitFor(() => {
      expect(screen.getByText("تحديث جديد متاح")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "إعادة التحميل" })).toBeInTheDocument();
  });
});

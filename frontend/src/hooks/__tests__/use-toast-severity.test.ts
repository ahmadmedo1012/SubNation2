/**
 * 94-C3 — toast severity-aware auto-dismiss (A3 P3-1).
 *
 * The shim previously passed a flat `duration: 4000` for every variant:
 * a long Arabic error message ("تعذّر إرسال الرمز…") vanished before it
 * could be read. Errors/warnings — the variants a user may need to act
 * on — now default to 8s; success/info keep the snappy 4s. Explicit
 * `duration` still wins for every variant (callers keep full control).
 *
 * Sonner is mocked at the module boundary so these tests assert the
 * OPTIONS the shim forwards, not Sonner's rendering.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => {
  const base = vi.fn();
  return {
    toast: Object.assign(base, {
      error: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      dismiss: vi.fn(),
    }),
  };
});

import { toast as sonnerToast } from "sonner";
import { toast } from "@/hooks/use-toast";

beforeEach(() => {
  vi.mocked(sonnerToast).mockClear();
  vi.mocked(sonnerToast.error).mockClear();
  vi.mocked(sonnerToast.success).mockClear();
  vi.mocked(sonnerToast.warning).mockClear();
  vi.mocked(sonnerToast.info).mockClear();
});

function optionsOf(mock: ReturnType<typeof vi.fn>): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1);
  return mock.mock.calls[0]![1] as Record<string, unknown>;
}

describe("toast() — severity-aware default duration (94-C3 / A3 P3-1)", () => {
  it("destructive (error) defaults to 8s", () => {
    toast({ title: "فشل الرفع", variant: "destructive" });
    expect(optionsOf(vi.mocked(sonnerToast.error))).toMatchObject({ duration: 8_000 });
  });

  it("warning defaults to 8s", () => {
    toast({ title: "تنبيه", variant: "warning" });
    expect(optionsOf(vi.mocked(sonnerToast.warning))).toMatchObject({ duration: 8_000 });
  });

  it("success defaults to 4s", () => {
    toast({ title: "تم", variant: "success" });
    expect(optionsOf(vi.mocked(sonnerToast.success))).toMatchObject({ duration: 4_000 });
  });

  it("info and the default variant keep 4s", () => {
    toast({ title: "معلومة", variant: "info" });
    expect(optionsOf(vi.mocked(sonnerToast.info))).toMatchObject({ duration: 4_000 });

    toast({ title: "عادي" });
    expect(optionsOf(vi.mocked(sonnerToast))).toMatchObject({ duration: 4_000 });
  });

  it("an explicit duration overrides the severity default", () => {
    toast({ title: "خطأ", variant: "destructive", duration: 2_000 });
    expect(optionsOf(vi.mocked(sonnerToast.error))).toMatchObject({ duration: 2_000 });

    toast({ title: "تم", variant: "success", duration: 10_000 });
    expect(optionsOf(vi.mocked(sonnerToast.success))).toMatchObject({ duration: 10_000 });
  });

  it("the convenience helpers route through the same severity mapping", () => {
    toast.error("خطأ");
    expect(optionsOf(vi.mocked(sonnerToast.error))).toMatchObject({ duration: 8_000 });
    toast.success("نجح");
    expect(optionsOf(vi.mocked(sonnerToast.success))).toMatchObject({ duration: 4_000 });
  });
});

describe("toast() — sonner option forwarding end-to-end (R118-B2 / A2 F-1)", () => {
  // R117 F-6 wired helperInput to CAPTURE the remaining sonner options,
  // but emit() still built a closed opts object — onDismiss / onAutoClose
  // / position / closeButton / className were silently dropped at the
  // last hop. R118-B2 forwards the remainder verbatim. These tests pin
  // the full path (helperInput → toast() → emit() → sonner).

  it("a sonner-idiomatic helper call forwards onDismiss / onAutoClose / position / closeButton", () => {
    const onDismiss = vi.fn();
    const onAutoClose = vi.fn();
    toast.error("خطأ فادح", {
      description: "الوصف",
      duration: 6_000,
      onDismiss,
      onAutoClose,
      position: "bottom-center",
      closeButton: true,
    });

    const opts = optionsOf(vi.mocked(sonnerToast.error));
    expect(opts).toMatchObject({
      description: "الوصف",
      duration: 6_000,
      position: "bottom-center",
      closeButton: true,
    });
    expect(opts.onDismiss).toBe(onDismiss);
    expect(opts.onAutoClose).toBe(onAutoClose);
  });

  it("plain toast() callers without extra options are unaffected (rest = {})", () => {
    toast({ title: "تم", description: "تم الحفظ", variant: "success" });

    // The closed-contract keys arrive exactly as before…
    expect(optionsOf(vi.mocked(sonnerToast.success))).toMatchObject({
      description: "تم الحفظ",
      duration: 4_000,
    });
    // …and nothing leaked into the options bag.
    const optsBag = vi.mocked(sonnerToast.success).mock.calls[0]![1] as Record<string, unknown>;
    expect(Object.keys(optsBag).sort()).toEqual(["action", "description", "duration", "id"]);
  });

  it("update() keeps the toast id (the replacement carries idOverride)", () => {
    const onDismiss = vi.fn();
    const handle = toast.warning("تحذير", { onDismiss, className: "wide-toast" });
    handle.update({ title: "تحديث", description: "جديد" });

    // The initial call rode sonnerToast.warning with the passthrough opts…
    expect(vi.mocked(sonnerToast.warning)).toHaveBeenCalledTimes(1);
    const initialOpts = vi.mocked(sonnerToast.warning).mock.calls[0]![1] as Record<string, unknown>;
    expect(initialOpts.onDismiss).toBe(onDismiss);
    expect(initialOpts.className).toBe("wide-toast");
    // …while the update (no variant on the replacement input) rides the
    // base sonnerToast with the SAME id so sonner replaces in place.
    expect(vi.mocked(sonnerToast)).toHaveBeenCalledTimes(1);
    const updateOpts = vi.mocked(sonnerToast).mock.calls[0]![1] as Record<string, unknown>;
    expect(updateOpts.id).toBe(handle.id);
    expect(updateOpts.description).toBe("جديد");
    // Forwarding is per-call, never sticky — the update's own options win
    // (the caller passed none here).
    expect(updateOpts.onDismiss).toBeUndefined();
  });
});

/**
 * 93-C7 / C-UX2 (A12 §11.1) — StatusBadge v2 tests.
 *
 * Covers the three additions the unification spec requires:
 *   1. the missing `purple` variant (token existed since round-92,
 *      the badge variant never did),
 *   2. the canonical STATUS_TONE semantic mapper (complete + every
 *      tone resolves to a token-riding class tuple, no raw hues),
 *   3. the size scale (xs/sm/md) used to retire the 6 hand-tuned
 *      per-page size permutations.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  STATUS_TONE,
  StatusBadge,
  statusBadgeVariants,
  TICKET_STATUSES,
  UNKNOWN_STATUS_TONE,
  type SemanticStatus,
} from "@/components/ui/status-badge";

// Raw Tailwind status-ish hues that bypass the token system (same
// regex the round-92 status-tokens test uses).
const RAW_HUE = /\b(emerald|blue|purple|yellow|amber|green|red|sky|indigo|orange|violet)-\d{3}\b/;

describe("StatusBadge v2 — purple variant + tone mapper + sizes (A12 §11.1)", () => {
  it("renders the purple variant on the --status-purple token", () => {
    render(<StatusBadge variant="purple">دعم</StatusBadge>);
    const badge = screen.getByText("دعم");
    expect(badge.className).toContain("bg-status-purple/12");
    expect(badge.className).toContain("text-status-purple");
    expect(badge.className).toContain("border-status-purple/28");
    expect(badge.className).not.toMatch(RAW_HUE);
  });

  it("STATUS_TONE maps every semantic status to a token-riding variant", () => {
    const semanticStatuses: SemanticStatus[] = [
      "pending",
      "processing",
      "completed",
      "delivered",
      "failed",
      "refunded",
      "approved",
      "rejected",
      "open",
      "in_progress",
      "closed",
      "credited",
      "active",
      "expired",
      "scheduled",
      "archived",
      "inactive",
      "ready",
      "qr_ready",
      "connecting",
      "disconnected",
      "new",
      "reviewing",
      "resolved",
      "confirmed_fraud",
      "false_positive",
      "escalated",
    ];
    for (const s of semanticStatuses) {
      const variant = STATUS_TONE[s];
      expect(variant, `status: ${s}`).toBeTruthy();
      // Every mapped tone resolves to real token classes — no raw hues.
      expect(statusBadgeVariants({ variant })).not.toMatch(RAW_HUE);
    }
  });

  it("tone spot-checks match the A12 spec table", () => {
    expect(STATUS_TONE.pending).toBe("warning");
    expect(STATUS_TONE.open).toBe("info");
    expect(STATUS_TONE.in_progress).toBe("warning");
    expect(STATUS_TONE.closed).toBe("neutral");
    expect(STATUS_TONE.approved).toBe("success");
    expect(STATUS_TONE.failed).toBe("error");
    expect(STATUS_TONE.confirmed_fraud).toBe("error");
    expect(STATUS_TONE.escalated).toBe("warning");
    expect(STATUS_TONE.disconnected).toBe("error");
    expect(STATUS_TONE.expired).toBe("warning");
    expect(STATUS_TONE.active).toBe("success");
    expect(STATUS_TONE.inactive).toBe("neutral");
  });

  it("unknown statuses fall back to the neutral tone (mirrors the old shim)", () => {
    expect(UNKNOWN_STATUS_TONE).toBe("neutral");
    expect(statusBadgeVariants({ variant: UNKNOWN_STATUS_TONE })).not.toMatch(RAW_HUE);
  });

  it("size scale renders distinct paddings for xs / sm / md", () => {
    const xs = statusBadgeVariants({ variant: "info", size: "xs" });
    const sm = statusBadgeVariants({ variant: "info", size: "sm" });
    const md = statusBadgeVariants({ variant: "info", size: "md" });
    expect(xs).toContain("text-[10px]");
    expect(sm).toContain("text-[11px]");
    expect(md).toContain("text-xs");
    expect(new Set([xs, sm, md]).size).toBe(3);
  });

  it("TICKET_STATUSES is the shared B1/B2 export (open / in_progress / closed)", () => {
    expect([...TICKET_STATUSES]).toEqual(["open", "in_progress", "closed"]);
    // Every ticket status resolves through the canonical mapper.
    for (const s of TICKET_STATUSES) {
      expect(STATUS_TONE[s]).toBeTruthy();
    }
  });

  it("renders with an icon inside the pill (aria-hidden)", () => {
    render(
      <StatusBadge variant="success" icon={() => <svg data-testid="icon" />}>
        نشط
      </StatusBadge>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});

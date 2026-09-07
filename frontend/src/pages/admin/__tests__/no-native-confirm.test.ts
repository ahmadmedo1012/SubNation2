/**
 * 93-C7 / C-UX3 + C-UX7 — native-dialog guard (A12 F-04).
 *
 * The last three raw browser dialogs in the admin (coupons delete
 * window.confirm, products bulk-archive window.confirm, enrichment
 * reject window.prompt) were replaced in this slice by useConfirm() /
 * AppDialog. This guard reads the 93-C7 owned files and fails if ANY
 * native confirm/prompt/prompt creeps back — the browser chrome
 * breaks theme/RTL/focus and (for window.prompt) reason semantics.
 *
 * Files owned by OTHER round-93 agents (C6: orders/users/topups/
 * promotions/system/alerts/admins/dashboard) are deliberately NOT
 * scanned — their status is documented in the worklog follow-ups.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const C7_OWNED_FILES = [
  "pages/admin/coupons.tsx",
  "pages/admin/products.tsx",
  "pages/admin/enrichment.tsx",
  "pages/admin/tickets.tsx",
  "pages/admin/risk.tsx",
  "pages/admin/risk-event.tsx",
  "pages/admin/security.tsx",
  "pages/admin/settings.tsx",
  "pages/admin/whatsapp.tsx",
  "pages/admin/pricing.tsx",
  "pages/admin/layout.tsx",
  "components/admin/InventoryUploadDialog.tsx",
  "components/admin/copilot/CopilotPanel.tsx",
  "components/admin/copilot/CopilotHistoryView.tsx",
  "components/admin/forecast/StockoutRiskPanel.tsx",
  "components/ui/app-dialog.tsx",
  "components/ui/status-badge.tsx",
];

const NATIVE_DIALOG = /\bwindow\s*\.\s*(confirm|prompt|alert)\s*\(/;

describe("93-C7 owned admin files — zero native browser dialogs (A12 F-04)", () => {
  it.each(C7_OWNED_FILES)("%s contains no window.confirm/prompt/alert", (rel) => {
    const text = readFileSync(resolve(process.cwd(), "src", rel), "utf8");
    expect(text, `${rel} must not call native dialogs`).not.toMatch(NATIVE_DIALOG);
  });
});

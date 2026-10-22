/**
 * R182 (§4) — enrichment operational-truth source contracts.
 *
 * The review panel's empty queue used to render ONE hard-coded hint
 * («اضبط ENRICHMENT_RUNNER_ENABLED=true على عامل الخادم») that (a)
 * conflated five distinct backend states (queue-clear / runner-disabled
 * / no-worker-tier / LLM-unconfigured / last-run-failed) and (b)
 * prescribed an action that cannot succeed in the current deployment —
 * no worker tier exists, and the WORKER_TIER gate fires FIRST. The fix
 * ships a backend status contract (GET /api/admin/enrichment/status,
 * pinned server-side in admin-enrichment-status-r182.test.ts) plus this
 * page's derived, state-aware diagnosis. These source pins keep the
 * page-side half from silently regressing (the r143 source-scan idiom:
 * readFileSync + stripComments + exact-string pins).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
// R182 (review #2): deriveEmptyStateHint is exported precisely so the
// DIAGNOSIS PRIORITY can be pinned behaviorally — the source-scan pins
// below cannot catch a branch reorder (the independent-review catch:
// the cap line must outrank the LLM line, mirroring the runner's own
// gate order, or the admin fixes the wrong blocker).
import { deriveEmptyStateHint, type StatusResponse } from "@/pages/admin/enrichment";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");

/** The r139 suite's comment stripper — rationale prose may NAME retired
 * strings without tripping the bans. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\*.*$/gm, "");
}

function hintFor(partial: Partial<StatusResponse>): string {
  const payload: StatusResponse = {
    worker_tier: true,
    runner_enabled: true,
    llm_configured: true,
    daily_token_cap: 50_000,
    last_run: null,
    ...partial,
  };
  const { container } = render(<div>{deriveEmptyStateHint(payload)}</div>);
  return container.textContent ?? "";
}

describe("R182 (§4) — behavioral diagnosis pins", () => {
  it("undefined status → the neutral copy", () => {
    const { container } = render(<div>{deriveEmptyStateHint(undefined)}</div>);
    expect(container.textContent).toContain("تُعرض حالة خط التوليد عند توفرها");
  });

  it("no worker tier → the WORKER_TIER truth (the production blocker), not the flag hint", () => {
    const text = hintFor({ worker_tier: false });
    expect(text).toContain("WORKER_TIER=true");
    expect(text).toContain("وحده لن يُشغّل الخط");
  });

  it("worker + disabled runner → the enable-flag hint", () => {
    const text = hintFor({ runner_enabled: false });
    expect(text).toContain("ENRICHMENT_RUNNER_ENABLED=true");
    expect(text).toContain("مفعّلة");
  });

  it("worker + enabled + cap ≤ 0 → the CAP line outranks the LLM line (the runner's gate order)", () => {
    // The exact independent-review catch: with worker+enabled+cap=0
    // (even with no key) the runner no-ops at the CAP — the diagnosis
    // must name ENRICHMENT_DAILY_TOKEN_CAP, NOT COPILOT_API_KEY.
    const text = hintFor({ daily_token_cap: 0, llm_configured: false });
    expect(text).toContain("ENRICHMENT_DAILY_TOKEN_CAP");
    expect(text).not.toContain("COPILOT_API_KEY");
  });

  it("worker + enabled + cap > 0 + no key → the LLM line", () => {
    const text = hintFor({ llm_configured: false });
    expect(text).toContain("COPILOT_API_KEY");
    expect(text).not.toContain("ENRICHMENT_DAILY_TOKEN_CAP");
  });

  it("all gates open + failed last run → the failure line with its reason", () => {
    const text = hintFor({
      last_run: {
        outcome: "failure",
        started_at: "2026-10-22T00:00:00Z",
        completed_at: "2026-10-22T00:01:00Z",
        drafts_generated: 0,
        failure_reason: "provider 502",
      },
    });
    expect(text).toContain("آخر تشغيل فشل");
    expect(text).toContain("provider 502");
  });

  it("all gates open + no failures → the genuine queue-clear line", () => {
    const text = hintFor({});
    expect(text).toContain("لا عقبات مُكتشفة");
  });
});

describe("R182 (§4) — the enrichment empty state tells the operational truth", () => {
  const src = stripComments(read("src/pages/admin/enrichment.tsx"));

  it("consumes the pipeline status contract (the five-state diagnosis input)", () => {
    expect(src).toContain("/api/admin/enrichment/status");
    // The EmptyState's description must be the DERIVED diagnosis — a
    // hard-coded JSX hint block is the regression this round removed.
    expect(src).toContain("description={deriveEmptyStateHint(statusQuery.data)}");
  });

  it("the diagnosis names the WORKER_TIER gate truth — the first gate, unprovisioned today", () => {
    // The old hint's prescribed action (flip the enable flag "on the
    // worker") cannot succeed while no worker tier exists; the worker
    // branch must keep naming that gate explicitly.
    expect(src).toContain("WORKER_TIER=true");
  });

  it("the diagnosis surfaces a failed last run with its recorded reason", () => {
    expect(src).toContain('outcome === "failure"');
    expect(src).toContain("failure_reason");
  });

  it("mutation errors route through getErrorMessage — no raw network English in the Arabic chip", () => {
    expect(src).toContain("getErrorMessage(e)");
    expect(src).not.toMatch(/onError: \(e: Error\) => setError\(e\.message\)/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * R186 (F-F2) — an all-LLM-calls-failed enrichment run is a FAILURE,
 * not a hollow success.
 *
 * The verified defect: a run where EVERY candidate's LLM call rejected
 * still fell through to markSuccess — outcome "success", 0 drafts,
 * null failure_reason, audit row "success" — while llm_configured was
 * env-presence only. This is the enrichment twin of the silently-dead
 * GA4 loader: the pipeline's operator surface said "healthy" about a
 * leg that never delivered anything.
 *
 * The fix under test: after the candidate loop, when
 * `candidates.length > 0 && draftsGenerated === 0 && skipped.error ===
 * candidates.length`, the orchestrator calls markFailure("all N LLM
 * calls failed") and returns outcome "failure" (the existing status
 * contract then renders the reason truthfully).
 *
 * Harness: collaborators mocked at the module boundary (the
 * publish.test.ts idiom — the unit under test is the orchestrator's
 * outcome classification, not the LLM transport or the run-store SQL).
 */

const { candidates } = vi.hoisted(() => ({
  /** The selector's return — two candidates by default. */
  candidates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../llm/llm-client", () => ({
  llmAvailable: () => true,
  llmChat: vi.fn(async () => {
    throw new Error("LLM HTTP 503: upstream unavailable (r186 pin)");
  }),
}));

vi.mock("../../llm/provider-config", () => ({
  getLlmProvider: () => ({
    providerId: "openrouter",
    baseUrl: "https://example.invalid/v1",
    apiKey: "test-key",
    model: "test-model",
    extraHeaders: {},
  }),
}));

vi.mock("../candidates", () => ({
  selectCandidates: vi.fn(async () => ({
    candidates: candidates.map((c) => ({ ...c })),
    skipped: {},
  })),
}));

vi.mock("../draft-store", () => ({
  insertDraft: vi.fn(async () => undefined),
  markInvalid: vi.fn(async () => undefined),
}));

vi.mock("../run-store", () => ({
  createInFlightRun: vi.fn(async () => ({ id: 77 })),
  markSuccess: vi.fn(async () => undefined),
  markFailure: vi.fn(async () => undefined),
}));

vi.mock("@workspace/db", () => ({
  auditLogsTable: {},
  db: { insert: () => ({ values: () => Promise.resolve() }) },
}));

import { runEnrichment } from "../enrichment.service";
import { llmChat } from "../../llm/llm-client";
import { markFailure, markSuccess } from "../run-store";

const markFailureMock = vi.mocked(markFailure);
const markSuccessMock = vi.mocked(markSuccess);
const llmChatMock = vi.mocked(llmChat);

function fakeCandidate(productId: number, productName: string) {
  return {
    productId,
    fieldName: "description",
    productName,
    category: "streaming",
    currentDescription: null,
    currentDescriptionLong: null,
    currentFaq: null,
    currentUsageTerms: null,
  };
}

const RUN_ARGS = { dailyTokenCap: 50_000, perRunCap: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  candidates.length = 0;
  // Default: every LLM call rejects (the llm-client module mock above);
  // the partial-success test overrides this per-intentText below.
  llmChatMock.mockImplementation(async () => {
    throw new Error("LLM HTTP 503: upstream unavailable (r186 pin)");
  });
});

describe("R186 (F-F2) — all LLM calls failed → the run is marked failure", () => {
  it("every candidate's LLM call rejects → markFailure with the truthful reason, NO markSuccess, outcome failure", async () => {
    candidates.push(
      fakeCandidate(1, "First Fixture Product"),
      fakeCandidate(2, "Second Fixture Product"),
    );

    const result = await runEnrichment(RUN_ARGS);

    expect(result.outcome).toBe("failure");
    expect(result.runId).toBe(77);
    expect(result.draftsGenerated).toBe(0);
    expect(result.productsSkipped).toEqual({ error: 2 });

    // The existing failure-path shape, mirrored: reason + partial counts.
    expect(markFailureMock).toHaveBeenCalledTimes(1);
    const [runId, reason, counts] = markFailureMock.mock.calls[0];
    expect(runId).toBe(77);
    expect(reason).toBe("all 2 LLM calls failed");
    expect(counts).toEqual({
      draftsGenerated: 0,
      draftsInvalid: 0,
      productsSkipped: { error: 2 },
      tokensSpent: 0,
      capReached: false,
    });

    // The hollow success is gone.
    expect(markSuccessMock).not.toHaveBeenCalled();
  });

  it("boundary guard: one failing + one SUCCEEDING call still succeeds — the branch fires only on all-failed", async () => {
    candidates.push(
      fakeCandidate(1, "Good Fixture Product"),
      fakeCandidate(2, "Bad Fixture Product"),
    );
    const validText =
      "هذا وصف عربي احترافي شامل لمنتج اشتراك رقمي مميز يغطي كافة الميزات والفوائد والمزايا الرئيسية للمستخدمين داخل المنصة الإلكترونية الحديثة.";
    llmChatMock.mockImplementation(async (args: { intentText: string }) => {
      if (args.intentText.includes("Bad Fixture Product")) {
        throw new Error("LLM HTTP 503: upstream unavailable (r186 pin)");
      }
      return {
        text: validText,
        toolUses: [],
        inputTokens: 10,
        outputTokens: 10,
        stoppedReason: "stop",
      };
    });

    const result = await runEnrichment(RUN_ARGS);

    expect(result.outcome).toBe("success");
    expect(result.draftsGenerated).toBe(1);
    expect(result.productsSkipped).toEqual({ error: 1 });
    expect(markSuccessMock).toHaveBeenCalledTimes(1);
    expect(markFailureMock).not.toHaveBeenCalled();
  });
});

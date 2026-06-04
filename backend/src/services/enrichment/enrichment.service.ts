/**
 * Enrichment orchestrator (012-arabic-catalog-enrichment, T024).
 *
 * Single entry point for the daily run. Composes:
 *   1. createInFlightRun()
 *   2. selectCandidates(perRunCap)  — single batched query
 *   3. per-candidate prompt → LLM call → output validator
 *   4. token-cap accounting between calls (research §R-5)
 *   5. insertDraft / markInvalid for each result
 *   6. markSuccess / markFailure on the run row
 *   7. write an audit_logs row per FR-RUN-004
 *
 * Never throws — all internal failures are swallowed and surfaced via
 * `markFailure`. FR-DRAFT-006 is enforced at the caller (the cron is
 * the only invoker; no synchronous request handler calls this).
 */

import { auditLogsTable, db } from "@workspace/db";
import { logger } from "../../lib/logger";
import { copilotChat, copilotLlmAvailable } from "../copilot/llm-client";
import { getCopilotProvider } from "../copilot/provider-config";
import { selectCandidates, type CandidateRow } from "./candidates";
import { insertDraft, markInvalid, type DraftField } from "./draft-store";
import { buildPrompt, tryParseFaq } from "./prompts";
import {
  createInFlightRun,
  markFailure,
  markSuccess,
  type RunCounts,
} from "./run-store";
import { validateDraft } from "./validator";

const TOKEN_CAP_SAFETY_MARGIN = 2000;

export interface RunArgs {
  dailyTokenCap: number;
  perRunCap: number;
}

export interface RunResult {
  runId: number | null;
  outcome: "success" | "failure" | "no_op";
  draftsGenerated: number;
  draftsInvalid: number;
  productsSkipped: Record<string, number>;
  tokensSpent: number;
  capReached: boolean;
}

export async function runEnrichment(args: RunArgs): Promise<RunResult> {
  if (args.dailyTokenCap <= 0) {
    logger.warn(
      { category: "enrichment.run", dailyTokenCap: args.dailyTokenCap },
      "[enrichment] daily token cap is zero — refusing to run (FR-RUN-002 / research §R-5)",
    );
    return {
      runId: null,
      outcome: "no_op",
      draftsGenerated: 0,
      draftsInvalid: 0,
      productsSkipped: {},
      tokensSpent: 0,
      capReached: false,
    };
  }
  if (!copilotLlmAvailable()) {
    logger.warn(
      { category: "enrichment.run" },
      "[enrichment] LLM provider not configured — refusing to run",
    );
    return {
      runId: null,
      outcome: "no_op",
      draftsGenerated: 0,
      draftsInvalid: 0,
      productsSkipped: {},
      tokensSpent: 0,
      capReached: false,
    };
  }

  let runId: number | null = null;
  const skipped: Record<string, number> = {};
  let draftsGenerated = 0;
  let draftsInvalid = 0;
  let tokensSpent = 0;
  let capReached = false;

  try {
    const run = await createInFlightRun({
      workerTier: process.env.WORKER_TIER_ID ?? null,
      dailyTokenCap: args.dailyTokenCap,
    });
    runId = run.id;

    const { candidates, skipped: selectorSkipped } = await selectCandidates(args.perRunCap);
    Object.assign(skipped, selectorSkipped as unknown as Record<string, number>);
    const provider = getCopilotProvider();

    for (const c of candidates) {
      // Token-cap check between candidates. We don't know the next call's
      // size; the safety margin (2000 tokens) keeps the cap a soft ceiling.
      if (tokensSpent + TOKEN_CAP_SAFETY_MARGIN >= args.dailyTokenCap) {
        capReached = true;
        logger.info(
          { category: "enrichment.run", runId, tokensSpent, cap: args.dailyTokenCap },
          "[enrichment] token cap reached; halting loop",
        );
        break;
      }

      const result = await draftOne(c, provider.model).catch((err) => {
        logger.warn(
          { err, productId: c.productId, field: c.fieldName, category: "enrichment.run" },
          "[enrichment] LLM call failed; counting as skip",
        );
        skipped.error = (skipped.error ?? 0) + 1;
        return null;
      });
      if (!result) continue;

      tokensSpent += result.inputTokens + result.outputTokens;

      if (result.kind === "valid") {
        await insertDraft({
          runId: run.id,
          productId: c.productId,
          fieldName: c.fieldName,
          state: "drafted",
          generatedText: result.generatedText,
          modelId: result.modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });
        draftsGenerated++;
      } else {
        await markInvalid({
          runId: run.id,
          productId: c.productId,
          fieldName: c.fieldName,
          generatedText: result.generatedText,
          modelId: result.modelId,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          validationErrors: { errors: result.errors },
        });
        draftsInvalid++;
      }
    }

    const counts: RunCounts = {
      draftsGenerated,
      draftsInvalid,
      productsSkipped: skipped,
      tokensSpent,
      capReached,
    };
    await markSuccess(run.id, counts);

    // FR-RUN-004 audit row.
    try {
      await db.insert(auditLogsTable).values({
        actorType: "system",
        actorId: null,
        action: "enrichment.run",
        targetType: "enrichment_run",
        targetId: run.id,
        metadata: JSON.stringify({
          outcome: "success",
          draftsGenerated,
          draftsInvalid,
          tokensSpent,
          capReached,
          productsSkipped: skipped,
        }),
      });
    } catch (err) {
      logger.warn({ err, category: "enrichment.run" }, "[enrichment] audit log insert failed");
    }

    logger.info(
      {
        category: "enrichment.run",
        runId: run.id,
        draftsGenerated,
        draftsInvalid,
        tokensSpent,
        capReached,
        productsSkipped: skipped,
      },
      `[enrichment] run complete — ${draftsGenerated} drafts, ${draftsInvalid} invalid, ${tokensSpent} tokens`,
    );

    return {
      runId: run.id,
      outcome: "success",
      draftsGenerated,
      draftsInvalid,
      productsSkipped: skipped,
      tokensSpent,
      capReached,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId, category: "enrichment.run" }, "[enrichment] run failed");
    if (runId !== null) {
      await markFailure(runId, reason, {
        draftsGenerated,
        draftsInvalid,
        productsSkipped: skipped,
        tokensSpent,
        capReached,
      }).catch(() => {});
    }
    return {
      runId,
      outcome: "failure",
      draftsGenerated,
      draftsInvalid,
      productsSkipped: skipped,
      tokensSpent,
      capReached,
    };
  }
}

interface ValidDraftResult {
  kind: "valid";
  generatedText: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
}

interface InvalidDraftResult {
  kind: "invalid";
  generatedText: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  errors: string[];
}

type DraftResult = ValidDraftResult | InvalidDraftResult;

async function draftOne(c: CandidateRow, modelId: string): Promise<DraftResult> {
  const prompt = buildPrompt(c.fieldName, {
    productId: c.productId,
    productName: c.productName,
    category: c.category,
    currentDescription: c.currentDescription,
    currentDescriptionLong: c.currentDescriptionLong,
    currentFaq: c.currentFaq,
    currentUsageTerms: c.currentUsageTerms,
  });

  // Plain prompt → completion. No tool catalog; toolHandler is unused
  // because we pass an empty tools array and rely on the model to return
  // text in `result.text`.
  const result = await copilotChat({
    systemText:
      "أنت مساعد كتابة محتوى عربي محترف لمنصة بيع الاشتراكات الرقمية SubNation. التزم بتعليمات المستخدم بدقة.",
    intentText: prompt,
    tools: [],
    toolHandler: async () => ({ error: "no tools" }),
    maxTokens: 2048,
  });

  const text = result.text.trim();
  let parsed: string | Array<{ question: string; answer: string }> = text;

  if (c.fieldName === "faq") {
    const arr = tryParseFaq(text);
    if (!arr) {
      return {
        kind: "invalid",
        generatedText: text,
        modelId,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        errors: ["faq response was not valid JSON of {question, answer}[]"],
      };
    }
    parsed = arr;
  }

  const validation = validateDraft(c.fieldName as DraftField, parsed);
  if (!validation.ok) {
    return {
      kind: "invalid",
      generatedText: text,
      modelId,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      errors: validation.errors,
    };
  }

  return {
    kind: "valid",
    generatedText: text,
    modelId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

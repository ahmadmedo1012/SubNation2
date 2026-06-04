# Phase 0 Research — Arabic Catalog Content Enrichment

**Feature**: 012-arabic-catalog-enrichment
**Date**: 2026-06-04
**Status**: complete

This document resolves every decision point that the spec deferred to design time. There are no `NEEDS CLARIFICATION` markers — each numbered research note (R-N) records a decision, the rationale, and the alternatives we rejected.

---

## R-1. Reuse the existing copilot LLM client vs introduce a separate transport

**Decision**: Reuse `backend/src/services/copilot/llm-client.ts`. The runner constructs a plain prompt → completion call (no tool catalog, no streaming) and consumes the same `{text, inputTokens, outputTokens}` contract.

**Rationale**: The copilot client already handles Anthropic SDK auth, retries, timeout, and (most importantly) emits the input/output token counts the daily-cap accountant needs. Adding a parallel transport would duplicate auth + retry logic and split the cost-tracking surface in two — bad for SC-004's "stay under 10% of ROI" commitment.

**Alternatives considered**:

- **Direct Anthropic SDK call from the runner**: rejected. Re-implements retry + token accounting. Drift between transports erodes auditability.
- **OpenRouter / NVIDIA NIM**: rejected for v1. The 010 copilot already uses Sonnet 4.6 via the existing client; adding a model-router decision here is out of scope. Revisit if pilot calibration argues for Haiku 4.5 to halve token spend (configurable; one-line change).

---

## R-2. Per-field prompts vs one mega-prompt per product

**Decision**: One LLM call per (product, field). Each call generates exactly one field; the runner makes up to three calls per product (description, description_long, faq) when all three are missing.

**Rationale**: Predictable token spend per call, predictable validation surface (the validator only checks one field's invariants per response), and predictable audit ("this token spend produced this draft for this field"). The mega-prompt alternative bundles fields into a single JSON-shaped response and forces the validator to handle all three fields — more code, more failure modes, less benefit.

**Alternatives considered**:

- **Single call with structured JSON output covering all missing fields**: rejected. Saves a few hundred tokens per product but makes failure handling much messier (one bad field invalidates the whole response). The audit story becomes "this draft might be partially good", which forces an admin to reason about which sub-fields to keep — defeating the panel UX.

---

## R-3. Admin panel layout

**Decision**: Dedicated page at `/admin/products/enrichment`, not a panel above the existing product list. Each row uses a side-by-side diff view (current state on the right column, proposed draft on the left, RTL-aware so "after" reads first in Arabic). Three actions per row: "تطبيق" (apply), "تعديل" (edit-then-apply), "رفض" (reject).

**Rationale**: The 011 forecast panel mounts above the product list because it's a list of *the same products* the admin is already scanning. Enrichment is a different mental mode — admins are *reviewing copy*, not *managing inventory*. A separate page lets the layout breathe (long descriptions need vertical space) and avoids cluttering `/admin/products`.

**Alternatives considered**:

- **Panel above the product list**: rejected. The diff view needs vertical space; cramming it above 50 product rows hurts both surfaces.
- **Modal overlay from the existing product list**: rejected. Modals interrupt scanning; admins reviewing 30 drafts in a session would burn out clicking-and-closing. A dedicated page enables keyboard-driven flow.

---

## R-4. Arabic-output validation: pure character ratio vs LLM judge

**Decision**: Pure character-class ratio. Count Arabic Unicode characters (`U+0600`–`U+06FF` + supplements) and total non-whitespace characters; reject when ratio < 70%. Plus length bounds per field (description: 50–1000, description_long: 300–8000, faq[].question: ≤ 300, faq[].answer: ≤ 500).

**Rationale**: Cheap (no extra LLM call), deterministic, defensible. The 70% threshold accommodates legitimate Latin tokens — product names ("Netflix"), URLs, brand names — without flagging them as non-Arabic. An LLM-judge alternative would double inference cost on every run for marginal accuracy.

**Alternatives considered**:

- **Ask the LLM to self-validate**: rejected. Doubles cost, adds a feedback loop where a bad model run validates itself.
- **Stricter ratio (e.g., 90%)**: rejected. Realistic Arabic product copy mixes brand names and English terminology; 90% rejects too many valid drafts.

---

## R-5. Token-cap enforcement: between calls vs mid-call abort

**Decision**: Check the cumulative `tokens_spent` between products. If `tokens_spent + safety_margin > daily_cap`, the loop exits. The safety margin (default 2000 tokens) accounts for the fact that we don't know the next call's response size in advance.

**Rationale**: Mid-call abort is impossible (the model has already streamed) and would waste tokens. Checking between calls is the standard pattern; the safety margin makes the cap a soft ceiling and avoids the "spent 5050 vs cap 5000" off-by-margin look.

**Alternatives considered**:

- **Hard cap with no margin**: rejected. The runner would always slightly exceed the cap, which makes audit confusing.
- **Predict the response size from the prompt**: rejected. Token-prediction heuristics for prompt → response are unreliable; a 2000-token margin is honest about the uncertainty.

---

## R-6. Rejection-suppression window: 14 days vs admin-tunable

**Decision**: Hard-coded 14-day suppression. After admin rejects a draft for (product, field), the runner does not generate another draft for that combination until 14 days have passed (`rejected_at + 14 days < NOW()`).

**Rationale**: Constants are easier to reason about during pilot calibration. 14 days is long enough that an admin who rejected a draft has either filled the field manually, refined the prompt template, or genuinely doesn't want enrichment for that product. Per-product or per-product-per-field tuning is a follow-up if pilot data argues for it.

**Alternatives considered**:

- **No suppression**: rejected. Burns tokens redrafting copy the admin already rejected.
- **Permanent suppression after one rejection**: rejected. Too sticky — operators need a graceful way to retry after fixing the prompt template.

---

## R-7. State machine for `enrichment_drafts`

**Decision**: Four states, one initial, two terminal, one error sink:

```text
                INSERT (cron)
                     |
                     v
              ┌─────────────┐
              │   drafted   │── admin apply ──▶ ┌──────────┐
              └──────┬──────┘                    │ published│ (terminal)
                     │ admin reject              └──────────┘
                     v
              ┌─────────────┐
              │   rejected  │ (terminal; suppression starts at rejected_at)
              └─────────────┘

         INSERT (cron, output failed validation)
                     |
                     v
              ┌─────────────────┐
              │  draft_invalid  │ (error sink; hidden from panel; cron retries
              └─────────────────┘  when suppression elapses)
```

`published` and `rejected` are terminal — application code (and the `state` CHECK constraint) refuse transitions out of them. `draft_invalid` is the validator's "we made a draft but it failed our own checks"; the panel never shows these but the runner counts them in metrics so prompt-template regressions are visible.

**Rationale**: Mirrors the 010 copilot preview state machine in shape, which the on-call rotation already understands. The `draft_invalid` separate state avoids deleting bad drafts (we want them in the audit trail for prompt-template tuning) but keeps them out of the admin's review queue.

---

## R-8. Cron schedule and tier discipline

**Decision**: Daily at 03:45 UTC on the existing `subnation-worker` tier. The runner short-circuits with a structured warn log if `process.env.WORKER_TIER !== "true"` OR `process.env.ENRICHMENT_RUNNER_ENABLED !== "true"` — same gate pattern as the 011 forecast runner.

The existing crons run at 00:00 (low-stock), 02:15 (forecast), 03:30 (forecast retention + risk retention), and every 5 minutes (copilot reaper). 03:45 lands cleanly between the retention sweep and any morning admin activity.

**Rationale**: Constitution §V scheduling rule. Reuses the same cron-tier-guard pattern the existing crons use.

**Alternatives considered**:

- **Run more often (every 4 hours)**: rejected. Enrichment is a backlog feature; once-a-day is plenty. Higher frequency multiplies token spend without proportional pilot-feedback gain.

---

## R-9. Retention

**Decision**: 90-day retention on `enrichment_drafts`. Daily purge at 04:00 UTC of rows where `created_at < NOW() - 90 days` AND `state IN ('published', 'rejected', 'draft_invalid')`. Drafts in `state='drafted'` are never auto-purged regardless of age — they're the admin's open queue.

`enrichment_runs` is retained 365 days for SC-004 monthly cost auditing.

**Rationale**: Matches the 003 + 011 retention windows. Keeping `state='drafted'` rows untouched protects an inattentive admin from losing work; 90 days of audit history is enough to back-test prompt-template changes.

---

## R-10. Performance

**Decision**: Single batched candidate query identifies eligible products in one round-trip. Each LLM call is sequential (we don't parallelize because we want a clean token-cap check between calls; parallelizing would require atomic token-cap accounting which adds complexity for marginal time savings).

Expected latency on 10k products with per-run cap = 50 and ~3s per LLM call: 50 × 3 = 150s, well under the 5-minute worker-tier budget.

---

**Status**: All decisions resolved. Ready for Phase 1 (data-model.md + contracts/).

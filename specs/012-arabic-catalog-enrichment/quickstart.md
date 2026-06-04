# Quickstart — Arabic Catalog Content Enrichment

**Feature**: 012-arabic-catalog-enrichment
**Audience**: pilot operator, on-call engineer
**Companions**: [spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md)

---

## 1. Activate the runner

The enrichment cron is OFF by default. To activate on staging or prod:

1. Confirm `WORKER_TIER=true` is set on the worker tier.
2. Set `ENRICHMENT_RUNNER_ENABLED=true` and (optionally) tune `ENRICHMENT_DAILY_TOKEN_CAP` (default 50_000) and `ENRICHMENT_PER_RUN_CAP` (default 50).
3. The cron fires daily at 03:45 UTC. The first run produces drafts within minutes; the admin panel surfaces them after the job completes.

To force an on-demand run during pilot:

```bash
pnpm --filter @workspace/api-server tsx src/jobs/enrichment-runner.ts
```

The runner enforces the same env gates whether scheduled or invoked manually.

---

## 2. Verify the run

```sql
SELECT id, started_at, completed_at, outcome,
       drafts_generated, drafts_invalid, tokens_spent,
       cap_reached, products_skipped
FROM enrichment_runs
ORDER BY started_at DESC
LIMIT 5;
```

A healthy run looks like:

```
 outcome | drafts_generated | drafts_invalid | tokens_spent | cap_reached
---------|-------------------|-----------------|---------------|-------------
 success | 18                | 1               | 28_400        | f
```

Three things to glance at:

- `outcome = success`.
- `tokens_spent` < `daily_token_cap` (or `cap_reached = true` if the cap saved you from runaway spend).
- `drafts_invalid` is the canary for prompt-template regression — > 5% of `drafts_generated + drafts_invalid` warrants review.

---

## 3. US1 — admin reviews the queue

Open `/admin/products/enrichment`. The list shows drafts in `state='drafted'` ordered by `created_at DESC`, paged at 25.

Each row offers:

- **تطبيق** (apply) — publishes the LLM's text as-is.
- **تعديل** (edit) — opens an inline editor with the LLM text; admin tunes copy and clicks publish; both `generated_text` and `final_text` are stored.
- **رفض** (reject) — optional reason; the cron's 14-day suppression window starts.

Apply and edit-and-apply both go through the existing low-risk catalog-edit service path so all the usual side effects (slug regeneration if applicable, sitemap cache bump, audit log row) happen. The audit row carries `action='enrichment.publish'`.

---

## 4. US3 — token cap

The runner stops drafting for the day once `tokens_spent + 2000 (safety margin) > ENRICHMENT_DAILY_TOKEN_CAP`. Verify on the run row:

```sql
SELECT tokens_spent, daily_token_cap, cap_reached
FROM enrichment_runs ORDER BY id DESC LIMIT 1;
```

If `cap_reached = true`, deferred candidates roll into the next day's run.

To temporarily disable enrichment without flipping the env flag:

```bash
# Edit system_settings / env to set ENRICHMENT_DAILY_TOKEN_CAP=0
# The runner refuses to start when cap is zero (research §R-5)
```

---

## 5. US4 — copilot integration

Open the AI Admin Copilot. Ask:

- "ما المنتجات التي تحتاج إلى مراجعة محتوى؟"
- "show me products with pending enrichment drafts"

The copilot calls `query_enrichment_drafts` and replies with rows + `panel_url` deep-links. Verify:

1. Every product mentioned matches a `enrichment_drafts WHERE state='drafted'` row.
2. The panel deep-link goes to `/admin/products/enrichment?focus=<draft_id>`.
3. An admin without the `inventory` scope sees the tool excluded from the model's catalog.

---

## 6. Operating shortcuts

| Need to…                                                  | Run                                                                                       |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Force a run now (dev/staging only)                        | `pnpm --filter @workspace/api-server tsx src/jobs/enrichment-runner.ts`                    |
| List the last 5 runs                                      | See §2 SQL.                                                                               |
| See pending queue size                                    | `SELECT COUNT(*) FROM enrichment_drafts WHERE state='drafted';`                           |
| See top failure reasons                                   | `SELECT validation_errors FROM enrichment_drafts WHERE state='draft_invalid' ORDER BY id DESC LIMIT 10;` |
| Check publish-vs-reject ratio (SC-003)                    | `SELECT state, COUNT(*) FROM enrichment_drafts WHERE created_at > NOW() - INTERVAL '14 days' GROUP BY state;` |
| Disable enrichment without redeploy                       | Set `ENRICHMENT_RUNNER_ENABLED=false` in worker env (next cron fires no-op).               |

---

## 7. Failure modes & runbook

| Symptom                                                  | Likely cause                                              | Action                                                                     |
| -------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------- |
| Pending queue grows unbounded                             | Admins not clearing drafts; SC-002 (review velocity)      | Triage with the existing admin team; consider raising the per-run cap     |
| `drafts_invalid` consistently > 10%                       | Prompt template regressed; LLM output failing validation  | Review `validation_errors` patterns, tune `services/enrichment/prompts.ts` |
| Publish-vs-reject ratio < 50% (SC-003 fail)               | Prompt template producing low-quality copy                | Same as above; consider A/B'ing the prompt against a smaller cap          |
| Customer purchase latency unchanged but spike on cron tier| Token cap too high                                         | Lower `ENRICHMENT_DAILY_TOKEN_CAP`; the cap is the single knob              |
| `outcome='failure'` repeatedly                            | LLM API down or auth failure                              | `failure_reason` column has the message; check `ANTHROPIC_API_KEY`          |

---

## 8. Decommission

If the pilot fails (SC-003 < 50%, SC-001 not improving) and the team retires the feature:

- [ ] Set `ENRICHMENT_RUNNER_ENABLED=false` in worker env. Cron is now a no-op.
- [ ] Hide the `/admin/products/enrichment` route mount and the sidebar link in `frontend/src/pages/admin/layout.tsx` (one-line conditional).
- [ ] Remove `query_enrichment_drafts` from the copilot's `READ_TOOLS` array.
- [ ] Leave `enrichment_drafts` and `enrichment_runs` in place for back-testing analysis; drop the tables only after a 30-day cool-down.

The schema is purely additive — no migration to roll back. Removing the feature is a deploy-flag flip.

---

**Status**: quickstart complete. Plan deliverables: plan.md ✅ research.md ✅ data-model.md ✅ contracts/ ✅ quickstart.md ✅. Ready for `/speckit-tasks`.

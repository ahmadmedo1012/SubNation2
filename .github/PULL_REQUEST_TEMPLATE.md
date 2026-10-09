## What does this PR change, and why?

<!-- One short paragraph: the problem + the fix. Link the issue if one exists. -->

## Gates run locally (tick what you ran — see CONTRIBUTING.md)

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm --filter @workspace/api-server exec vitest run` (backend suite)
- [ ] `pnpm --filter @workspace/subnation run test:run` (frontend suite)
- [ ] `pnpm build` (budget gate included)

Contract gates, when touched:

- [ ] `openapi.yaml` changed → ran `pnpm --filter @workspace/api-spec run codegen` and committed the regenerated clients
- [ ] Drizzle schema changed → migrations regenerated (never `db:push`)
- [ ] Money-adjacent code → money suite green + note referencing `docs/FINAL_MONEY_INVARIANTS.md`

## Evidence

<!-- Counts, command output, file:line, live probe, or screenshot — every
claim in the PR description should have its evidence here. -->

## Docs

- [ ] Docs updated if this change invalidates any claim in README / docs/ (house rules: `docs/README.md`)

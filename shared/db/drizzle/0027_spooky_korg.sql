-- R181: Drizzle 0027 — the mirror of boot stage V1-M36
-- (migrate.ts applyCopilotRemovalStage): the AI Admin Copilot is
-- permanently retired — UI, API, services, generated contracts, and
-- here the exclusive data model.
--
-- Same conventions as 0013/0016/0017/0018/0019/0020/0021/0022/0023/
-- 0026 (r110 idiom): the file as emitted by `drizzle-kit generate` is
-- DECLARATIVE-ONLY — nothing in the repo executes it at runtime (prod
-- schema flows exclusively through migrate.ts: V1-M36 probes + drops
-- the three tables at boot, plus the copilot.phases setting row and
-- the positively-identified copilot audit rows, which are data the
-- chain cannot express), and CI only regenerates + diffs.
--
-- The generated DROP statements carried CASCADE (drizzle-kit's
-- default when it cannot see the FK graph ahead of the drops). Hand-
-- hardened to the dependency order instead — NO CASCADE anywhere:
-- copilot_action_items first (its FK is the only dependent of
-- copilot_actions), then copilot_actions (its preview_id FK is the
-- only dependent of copilot_previews), then copilot_previews — every
-- DROP lands with zero dependents, so a plain DROP is exact, and a
-- partial application would fail loud rather than guess. `IF EXISTS`
-- keeps the file safe on a database the boot twin already converged
-- (and on fresh installs that never saw the tables).
DROP TABLE IF EXISTS "copilot_action_items";--> statement-breakpoint
DROP TABLE IF EXISTS "copilot_actions";--> statement-breakpoint
DROP TABLE IF EXISTS "copilot_previews";

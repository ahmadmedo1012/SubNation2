# Copilot Contracts

This directory contains the API and tool-catalog contracts for the AI Admin Copilot. The OpenAPI fragment in `openapi.copilot.yaml` will be merged into `shared/api-spec/openapi.yaml` during implementation; the tool catalog in `tool-catalog.md` is the authoritative list of LLM-callable functions and their argument schemas.

## Files

- **`openapi.copilot.yaml`** — Endpoint contracts for `/api/admin/copilot/*`. Drives Zod schemas in `shared/api-zod/src/copilot/` and React hooks regenerated into `shared/api-client-react/`.
- **`tool-catalog.md`** — The list of tools the LLM can call, their argument shapes, return shapes, permission scopes, and risk tiers. This is the boundary the model operates within.

## Contract invariants

1. Every endpoint requires `requireAdmin` (existing middleware).
2. Every endpoint enforces an admin-permission scope from `admin_users.permissions`.
3. Every endpoint enforces the per-admin copilot rate limit (30/min, 200/hour) BEFORE doing any work.
4. The `/confirm` and `/double-confirm` endpoints are the ONLY paths that mutate domain data via the copilot. The model never proposes execution.
5. All request/response bodies are validated by Zod schemas in `shared/api-zod/`. No endpoint accepts undeclared fields.
6. Error responses follow the existing `createErrorResponse` shape with stable `code` strings (e.g., `COPILOT_PREVIEW_EXPIRED`, `COPILOT_RATE_LIMITED`, `COPILOT_STALE_RECORD`, `COPILOT_HIGH_RISK_BLOCKED`).

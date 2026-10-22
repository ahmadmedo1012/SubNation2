# Contracts — Arabic Catalog Content Enrichment

**Feature**: 012-arabic-catalog-enrichment
**Companion**: [openapi.enrichment.yaml](./openapi.enrichment.yaml), [../data-model.md](../data-model.md)

## HTTP endpoints

| Method | Path                                       | Auth                                | Purpose                          |
| ------ | ------------------------------------------ | ----------------------------------- | -------------------------------- |
| GET    | `/api/admin/enrichment/list`               | `requireAdmin` + `inventory` scope  | Paged drafts list (panel)         |
| POST   | `/api/admin/enrichment/:id/publish`        | `requireAdmin` + `inventory` scope  | Apply a draft (US1)               |
| POST   | `/api/admin/enrichment/:id/reject`         | `requireAdmin` + `inventory` scope  | Reject a draft (US1)              |

(The historical second contract — the `query_enrichment_drafts` copilot tool that lived in `backend/src/services/copilot/tools/read.ts` — was retired in R181 with the AI Admin Copilot; the tool and its host directory no longer exist, and its contract section was removed from this file.)

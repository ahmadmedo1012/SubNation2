# Contracts — Arabic Catalog Content Enrichment

**Feature**: 012-arabic-catalog-enrichment
**Companion**: [openapi.enrichment.yaml](./openapi.enrichment.yaml), [../data-model.md](../data-model.md)

## HTTP endpoints

| Method | Path                                       | Auth                                | Purpose                          |
| ------ | ------------------------------------------ | ----------------------------------- | -------------------------------- |
| GET    | `/api/admin/enrichment/list`               | `requireAdmin` + `inventory` scope  | Paged drafts list (panel)         |
| POST   | `/api/admin/enrichment/:id/publish`        | `requireAdmin` + `inventory` scope  | Apply a draft (US1)               |
| POST   | `/api/admin/enrichment/:id/reject`         | `requireAdmin` + `inventory` scope  | Reject a draft (US1)              |

## Copilot tool — `query_enrichment_drafts`

Read-only LLM-callable tool. Lives in `backend/src/services/copilot/tools/read.ts` next to the existing `query_risk_events` and `forecast_demand` bridges. Required scope: `inventory`.

**Tool spec**:

```jsonc
{
  "type": "function",
  "function": {
    "name": "query_enrichment_drafts",
    "description": "Read pending enrichment drafts. Use to answer 'what products need content review?'. Cite product IDs verbatim — never invent.",
    "parameters": {
      "type": "object",
      "properties": {
        "state": {
          "type": "string",
          "enum": ["drafted", "published", "rejected"],
          "description": "Default 'drafted'."
        },
        "product_id": {
          "type": "integer",
          "description": "Single-product lookup."
        },
        "field_name": {
          "type": "string",
          "enum": ["description", "description_long", "faq"]
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Default 10."
        }
      },
      "additionalProperties": false
    }
  }
}
```

**Handler return shape**:

```jsonc
{
  "rows": [
    {
      "draft_id": 17,
      "product_id": 42,
      "product_name": "Premium Tier",
      "field_name": "description_long",
      "state": "drafted",
      "model_id": "claude-sonnet-4-6",
      "input_tokens": 280,
      "output_tokens": 1200,
      "created_at": "2026-06-04T03:45:00Z",
      "panel_url": "/admin/products/enrichment?focus=17"
    }
  ]
}
```

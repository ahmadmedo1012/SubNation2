# Tool Catalog

The LLM never emits free-text actions. The only way it can propose work is by calling one of the tools below with a JSON argument that matches the tool's Zod schema. **Execute tools are not exposed to the model** — execution is exclusively triggered by the human's POST to `/confirm` or `/double-confirm`.

The catalog is **filtered per request** by the admin's `admin_users.permissions` array. A tool the admin lacks scope for is absent from the request the model sees.

Argument schemas are defined as Zod in `shared/api-zod/src/copilot/tools/*.ts`. The shapes below are the design source.

---

## Read tools (Phase 1)

These tools fetch and explain. They never mutate. They are exposed to the model on `POST /ask` and on `POST /draft` (so a draft request can disambiguate by reading first).

### `search_products`

Find products matching simple filters.

```json
{
  "name": "search_products",
  "input_schema": {
    "type": "object",
    "properties": {
      "q":          { "type": "string", "description": "Free-text against name + description." },
      "category":   { "type": "string" },
      "status":     { "type": "string", "enum": ["active", "draft", "archived"] },
      "min_stock":  { "type": "integer", "minimum": 0 },
      "max_stock":  { "type": "integer", "minimum": 0 },
      "limit":      { "type": "integer", "minimum": 1, "maximum": 50, "default": 20 }
    },
    "additionalProperties": false
  }
}
```

**Returns**: `{ products: ProductSummary[] }`. **Permission**: `inventory` or `all`.

### `get_product`

Full product detail.

```json
{
  "name": "get_product",
  "input_schema": {
    "type": "object",
    "required": ["id"],
    "properties": { "id": { "type": "integer" } },
    "additionalProperties": false
  }
}
```

**Permission**: `inventory` or `all`.

### `list_low_stock`

```json
{
  "name": "list_low_stock",
  "input_schema": {
    "type": "object",
    "required": ["threshold"],
    "properties": {
      "threshold": { "type": "integer", "minimum": 0 },
      "category":  { "type": "string" }
    }
  }
}
```

**Permission**: `inventory` or `all`.

### `summarize_recent_changes`

Reads from `audit_logs` plus `copilot_actions`.

```json
{
  "name": "summarize_recent_changes",
  "input_schema": {
    "type": "object",
    "required": ["since_iso"],
    "properties": {
      "since_iso":   { "type": "string", "format": "date-time" },
      "actor_admin": { "type": "integer" },
      "limit":       { "type": "integer", "minimum": 1, "maximum": 100, "default": 50 }
    }
  }
}
```

**Permission**: `admins` or `all`.

### `find_anomalies`

Runs one of the four fixed heuristic checks (R-10 in research.md).

```json
{
  "name": "find_anomalies",
  "input_schema": {
    "type": "object",
    "required": ["kind"],
    "properties": {
      "kind":         { "type": "string", "enum": ["loss-making-price", "refund-cluster", "stock-spike", "discount-ratio"] },
      "window_hours": { "type": "integer", "minimum": 1, "maximum": 720, "default": 24 }
    }
  }
}
```

**Permission**: scope per kind — pricing/stock heuristics need `inventory`, refund-cluster needs `finance`, discount-ratio needs `inventory`.

---

## Draft tools (Phase 2+)

These propose a write. Calling one creates a `copilot_previews` row; the human still has to confirm. The model's tool call is **the draft**, not an execute.

### `draft_catalog_edit` (low risk)

Edits one product's content fields. No price, no cost, no stock, no status.

```json
{
  "name": "draft_catalog_edit",
  "input_schema": {
    "type": "object",
    "required": ["id", "fields"],
    "properties": {
      "id":     { "type": "integer" },
      "fields": {
        "type": "object",
        "additionalProperties": false,
        "minProperties": 1,
        "properties": {
          "name":             { "type": "string", "minLength": 1, "maxLength": 255 },
          "description":      { "type": "string", "maxLength": 5000 },
          "descriptionLong":  { "type": "string", "maxLength": 50000 },
          "faq": {
            "type": "array",
            "maxItems": 50,
            "items": {
              "type": "object",
              "required": ["question", "answer"],
              "properties": {
                "question": { "type": "string", "minLength": 1, "maxLength": 500 },
                "answer":   { "type": "string", "minLength": 1, "maxLength": 5000 }
              }
            }
          },
          "usageTerms": { "type": "string", "maxLength": 10000 },
          "imageUrl":   { "type": "string", "format": "uri", "maxLength": 1000 },
          "category":   { "type": "string", "maxLength": 100 }
        }
      }
    }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `low` (single-confirm).

### `draft_price_change` (high risk)

```json
{
  "name": "draft_price_change",
  "input_schema": {
    "type": "object",
    "required": ["id", "new_price"],
    "properties": {
      "id":        { "type": "integer" },
      "new_price": { "type": "string", "pattern": "^\\d+\\.\\d{2}$" }
    }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `high` (double-confirm).

### `draft_cost_change` (high risk)

Same shape as `draft_price_change` but writes `cost_price`.

### `draft_stock_change` (high risk)

```json
{
  "name": "draft_stock_change",
  "input_schema": {
    "type": "object",
    "required": ["product_id"],
    "oneOf": [
      { "required": ["delta"],   "properties": { "delta":  { "type": "integer", "minimum": -10000, "maximum": 10000 } } },
      { "required": ["set_to"],  "properties": { "set_to": { "type": "integer", "minimum": 0,      "maximum": 100000 } } }
    ],
    "properties": { "product_id": { "type": "integer" } }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `high`.

### `draft_status_change` (high risk)

```json
{
  "name": "draft_status_change",
  "input_schema": {
    "type": "object",
    "required": ["id", "action"],
    "properties": {
      "id":     { "type": "integer" },
      "action": { "type": "string", "enum": ["publish", "archive", "unarchive"] }
    }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `high`.

### `draft_bulk_price_change` (high risk)

```json
{
  "name": "draft_bulk_price_change",
  "input_schema": {
    "type": "object",
    "required": ["filter"],
    "oneOf": [
      { "required": ["percent"],  "properties": { "percent":  { "type": "number" } } },
      { "required": ["absolute"], "properties": { "absolute": { "type": "string", "pattern": "^-?\\d+\\.\\d{2}$" } } }
    ],
    "properties": {
      "filter": { "$ref": "#/$defs/ProductFilter" }
    }
  },
  "$defs": {
    "ProductFilter": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "category": { "type": "string" },
        "status":   { "type": "string", "enum": ["active", "draft", "archived"] },
        "search":   { "type": "string" },
        "ids":      { "type": "array", "items": { "type": "integer" }, "minItems": 1, "maxItems": 500 }
      }
    }
  }
}
```

The validator runs the filter at draft time and refuses with `code=BULK_OVER_CAP` if the matched set has more than 500 rows. **Permission**: `inventory` or `all`. **Risk**: `high`.

### `draft_bulk_status_change` (high risk)

```json
{
  "name": "draft_bulk_status_change",
  "input_schema": {
    "type": "object",
    "required": ["filter", "action"],
    "properties": {
      "filter": { "$ref": "#/$defs/ProductFilter" },
      "action": { "type": "string", "enum": ["archive", "unarchive"] }
    }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `high`.

### `draft_bulk_category_change` (high risk)

```json
{
  "name": "draft_bulk_category_change",
  "input_schema": {
    "type": "object",
    "required": ["filter", "new_category"],
    "properties": {
      "filter":       { "$ref": "#/$defs/ProductFilter" },
      "new_category": { "type": "string", "minLength": 1, "maxLength": 100 }
    }
  }
}
```

**Permission**: `inventory` or `all`. **Risk**: `high`.

### `draft_permission_change` (high risk)

```json
{
  "name": "draft_permission_change",
  "input_schema": {
    "type": "object",
    "required": ["admin_id", "permissions"],
    "properties": {
      "admin_id":    { "type": "integer" },
      "permissions": {
        "type": "array",
        "items": { "type": "string", "enum": ["all", "orders", "finance", "inventory", "support", "users", "admins", "settings"] },
        "uniqueItems": true,
        "maxItems": 8
      }
    }
  }
}
```

**Permission**: `admins` or `all`. **Risk**: `high`. The validator additionally rejects self-demotion to a state that would lock the admin out of the `admins` scope (anti-foot-gun guard).

### `draft_wallet_action` (no execute)

Wallet/refund commands are draft-only. The preview includes a `handoff.target_url` pointing into the existing wallet admin tooling; both `/confirm` and `/double-confirm` return 403 with that URL for any preview with `risk_tier="no_execute"`.

```json
{
  "name": "draft_wallet_action",
  "input_schema": {
    "type": "object",
    "required": ["kind", "user_id", "amount", "reason"],
    "properties": {
      "kind":    { "type": "string", "enum": ["credit", "debit", "refund_request"] },
      "user_id": { "type": "integer" },
      "amount":  { "type": "string", "pattern": "^\\d+\\.\\d{2}$" },
      "reason":  { "type": "string", "minLength": 5, "maxLength": 500 }
    }
  }
}
```

**Permission**: `finance` or `all`. **Risk**: `no_execute`.

---

## Refusal protocol

When the model attempts an action that the validator rejects (hallucinated field, rule violation, bulk over cap, missing context), the route returns a `RefusalResponse` (see `openapi.copilot.yaml`) with a stable code:

| Code | Meaning |
|---|---|
| `COPILOT_HALLUCINATED_FIELD` | Tool argument referenced a field that does not exist on the entity. |
| `COPILOT_RULE_VIOLATION` | Business rule violated (e.g., price below cost without override scope). |
| `COPILOT_BULK_OVER_CAP` | Filter matched more than 500 rows. |
| `COPILOT_AMBIGUOUS_INTENT` | Numeric ambiguity (10 = % vs currency) without clarifying context. |
| `COPILOT_OUT_OF_SCOPE` | Admin lacks the permission for this tool. |
| `COPILOT_MISSING_CONTEXT` | Required context (e.g., wallet user_id) absent. |

These codes are also the labels for the `copilot_safety_refusal_total{reason}` Prometheus counter.

/**
 * Risk DSL parser/validator (T036).
 *
 * The DSL described in `data-model.md` §2 — a small,
 * auditable expression language for risk rules. The shape is:
 *
 *   {
 *     type: 'and' | 'or',
 *     clauses: Array<{ field, operator, value }>,
 *     score_delta: number     // contribution when the rule fires
 *   }
 *
 * Operators (closed set, no arbitrary code execution):
 *   eq, ne, gt, gte, lt, lte, in, not_in,
 *   count_in_last_N_minutes, distinct_count_in_last_N_hours
 *
 * `field` is a dotted path against the scoring-time context
 * (`event.eventType`, `event.ipAddress`, `user.accountAgeDays`,
 * `user.recentFailedLogins`, etc.). Unknown fields evaluate to
 * `undefined` and never throw — a buggy rule must never block
 * the request path.
 */

export type DslOperator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "not_in"
  | "count_in_last_N_minutes"
  | "distinct_count_in_last_N_hours";

export interface DslClause {
  field: string;
  operator: DslOperator;
  value: unknown;
}

export interface DslExpression {
  type: "and" | "or";
  clauses: DslClause[];
  score_delta: number;
}

export interface DslValidationError {
  ok: false;
  reason: string;
  path?: string;
}

export interface DslValidationOk {
  ok: true;
  expression: DslExpression;
}

export type DslValidationResult = DslValidationOk | DslValidationError;

const ALLOWED_OPERATORS: ReadonlySet<DslOperator> = new Set<DslOperator>([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "not_in",
  "count_in_last_N_minutes",
  "distinct_count_in_last_N_hours",
]);

/**
 * Parse and validate a JSON expression coming from
 * `risk_rules.expression`. Returns a typed AST or a structured
 * error. Never throws.
 */
export function parseDsl(input: unknown): DslValidationResult {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, reason: "expression must be an object" };
  }
  const obj = input as Record<string, unknown>;

  if (obj.type !== "and" && obj.type !== "or") {
    return { ok: false, reason: "expression.type must be 'and' or 'or'", path: "type" };
  }

  if (!Array.isArray(obj.clauses) || obj.clauses.length === 0) {
    return {
      ok: false,
      reason: "expression.clauses must be a non-empty array",
      path: "clauses",
    };
  }

  const clauses: DslClause[] = [];
  for (let i = 0; i < obj.clauses.length; i++) {
    const c = obj.clauses[i];
    if (c === null || typeof c !== "object" || Array.isArray(c)) {
      return { ok: false, reason: "clause must be an object", path: `clauses[${i}]` };
    }
    const cl = c as Record<string, unknown>;
    if (typeof cl.field !== "string" || cl.field.length === 0) {
      return {
        ok: false,
        reason: "clause.field must be a non-empty string",
        path: `clauses[${i}].field`,
      };
    }
    if (typeof cl.operator !== "string" || !ALLOWED_OPERATORS.has(cl.operator as DslOperator)) {
      return {
        ok: false,
        reason: `clause.operator must be one of: ${[...ALLOWED_OPERATORS].join(", ")}`,
        path: `clauses[${i}].operator`,
      };
    }
    if (cl.value === undefined) {
      return {
        ok: false,
        reason: "clause.value is required",
        path: `clauses[${i}].value`,
      };
    }
    clauses.push({
      field: cl.field,
      operator: cl.operator as DslOperator,
      value: cl.value,
    });
  }

  if (typeof obj.score_delta !== "number" || !Number.isFinite(obj.score_delta)) {
    return {
      ok: false,
      reason: "expression.score_delta must be a finite number",
      path: "score_delta",
    };
  }
  if (obj.score_delta < 0 || obj.score_delta > 100) {
    return {
      ok: false,
      reason: "expression.score_delta must be in [0, 100]",
      path: "score_delta",
    };
  }

  return {
    ok: true,
    expression: {
      type: obj.type,
      clauses,
      score_delta: obj.score_delta,
    },
  };
}

/**
 * Read a dotted path from a context object. Returns `undefined`
 * for missing paths (never throws). Used by the rule evaluator
 * to look up values like `user.accountAgeDays`.
 */
export function readPath(context: unknown, path: string): unknown {
  const parts = path.split(".");
  let cur: unknown = context;
  for (const p of parts) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Evaluate a single DSL clause against a scoring context.
 * Returns a tri-state: true (matched), false (didn't match),
 * 'unknown' (the field was missing — neither match nor reject).
 *
 * The two count_/distinct_count_ operators delegate to the
 * caller-provided window resolver because they require a DB
 * read (they're not pure on the scoring context). Phase-1
 * rules use only the simple operators; the windowed ones
 * are stubbed and return 'unknown' if no resolver is given.
 */
export function evalClause(
  clause: DslClause,
  context: unknown,
  windowResolver?: (clause: DslClause, context: unknown) => Promise<number | undefined>,
): boolean | "unknown" | Promise<boolean | "unknown"> {
  const left = readPath(context, clause.field);

  switch (clause.operator) {
    case "eq":
      return left === undefined ? "unknown" : left === clause.value;
    case "ne":
      return left === undefined ? "unknown" : left !== clause.value;
    case "gt":
      return typeof left !== "number" || typeof clause.value !== "number"
        ? "unknown"
        : left > clause.value;
    case "gte":
      return typeof left !== "number" || typeof clause.value !== "number"
        ? "unknown"
        : left >= clause.value;
    case "lt":
      return typeof left !== "number" || typeof clause.value !== "number"
        ? "unknown"
        : left < clause.value;
    case "lte":
      return typeof left !== "number" || typeof clause.value !== "number"
        ? "unknown"
        : left <= clause.value;
    case "in":
      return Array.isArray(clause.value) ? clause.value.includes(left) : "unknown";
    case "not_in":
      return Array.isArray(clause.value) ? !clause.value.includes(left) : "unknown";
    case "count_in_last_N_minutes":
    case "distinct_count_in_last_N_hours": {
      if (!windowResolver) return "unknown";
      return (async () => {
        const got = await windowResolver(clause, context);
        if (got === undefined) return "unknown";
        const v = clause.value as { n?: number };
        if (typeof v?.n !== "number") return "unknown";
        return got >= v.n;
      })();
    }
  }
}

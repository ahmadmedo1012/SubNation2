/**
 * admin_request — universal admin tool (010-ai-admin-copilot follow-up).
 *
 * One tool to call any /api/admin/* endpoint the requesting admin already
 * has the right to use. Implementation: an in-process HTTP loopback to
 * 127.0.0.1:$PORT with the admin's existing JWT forwarded as a Bearer
 * token. The downstream endpoints run their own auth + scope + validation
 * + audit logic exactly as they do for a browser call, so:
 *
 *   - Constitution §I (Financial Integrity) is preserved: top-up
 *     approval still goes through topup.service.ts which writes the
 *     atomic ledger entry.
 *   - Constitution §III (Shared Contracts) is preserved: every endpoint
 *     still validates its body against its Zod schema.
 *   - Constitution §IV (Defense in Depth) is preserved: rate limits,
 *     CSRF (origin forwarding), and admin-permission gates all run.
 *
 * Path allowlist (defense-in-depth on top of the endpoints' own auth):
 *   - Must start with /api/admin/
 *   - Disallowed prefixes: /api/admin/auth/, /api/admin/copilot/
 *     (auth = login/2fa/password — copilot must not change identity;
 *      copilot/ = no self-recursion)
 *   - SEC-92-03 (round-92): also disallowed /api/admin/admins* (admin
 *     account create/patch/enable/disable/permissions) and
 *     /api/admin/settings* (auth-provider + system settings). The
 *     copilot must never be able to mint credentials or rewire the auth
 *     configuration — a single injected instruction must not be able to
 *     create a persistent backdoor admin.
 *
 * Method allowlist: GET, POST, PATCH, PUT, DELETE.
 *
 * SEC-92-03 mutation confirmation: POST/PATCH/PUT/DELETE calls do NOT
 * execute on the first invocation — they return a preview
 * ({requires_confirmation, preview:{wouldCall, method, path, bodySummary}})
 * and only execute when the SAME call is repeated with confirm: true.
 * GET calls execute directly (read-only).
 *
 * Response shaping: body is JSON-parsed (or treated as text if not JSON)
 * and capped at MAX_RESULT_BYTES so a runaway endpoint cannot blow the
 * model's context window.
 */

import type { Request } from "express";
import { logger } from "../../lib/logger";
import type { Tool } from "./llm-client";
import type { CopilotTool } from "./tools/read";

const ALLOWED_METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const DISALLOWED_PREFIXES = ["/api/admin/auth/", "/api/admin/copilot/"];
// SEC-92-03 denylist — identity/credential/config surfaces. Prefix match
// (no trailing slash) so every sub-path is covered: /api/admin/admins,
// /api/admin/admins/:id, /api/admin/admins/:id/permissions, /api/admin/settings,
// /api/admin/settings/:key, and the separately-mounted /api/admin/settings/auth/*
// (auth provider config) all land here.
const BLOCKED_PREFIXES = ["/api/admin/admins", "/api/admin/settings"];
const BLOCKED_PREFIX_MESSAGE =
  "هذا المسار محجوب عن Copilot لأسباب أمنية (إدارة حسابات الإدارة والإعدادات تتم يدويًا فقط)";
const ALLOWED_PREFIX = "/api/admin/";
const MAX_RESULT_BYTES = 12_000;
const REQUEST_TIMEOUT_MS = 20_000;
const PREVIEW_BODY_SUMMARY_CHARS = 600;

const adminRequestSpec: Tool = {
  type: "function",
  function: {
    name: "admin_request",
    description:
      "Call any admin API endpoint to read or change data — products, " +
      "orders, users, top-up requests, tickets, coupons, flash sales. " +
      "Acts as the requesting admin: same permissions, same validation, " +
      "same audit trail. Use this for ANYTHING the admin asks beyond the " +
      "dedicated tools (resolve_product, update_product, update_stock).\n\n" +
      "Common endpoints (all under /api/admin):\n" +
      "  Products       GET /products, GET /products/{id}, POST /products,\n" +
      "                 PATCH /products/{id}\n" +
      "  Orders         GET /orders, GET /orders/{orderCode},\n" +
      "                 PATCH /orders/{id}/status\n" +
      "  Users          GET /users, GET /users/{id}, PATCH /users/{id}\n" +
      "  Top-ups        GET /topups, POST /topups/{id}/approve,\n" +
      "                 POST /topups/{id}/reject\n" +
      "  Tickets        GET /tickets, GET /tickets/{id}, PATCH /tickets/{id},\n" +
      "                 POST /tickets/{id}/replies\n" +
      "  Coupons        GET /coupons, POST /coupons, PATCH /coupons/{id},\n" +
      "                 DELETE /coupons/{id}\n" +
      "  Flash sales    GET /flash-sales, POST /flash-sales,\n" +
      "                 PATCH /flash-sales/{id}, DELETE /flash-sales/{id}\n" +
      "  Stats          GET /stats, GET /chart-data\n" +
      "  Alerts         GET /alerts, PATCH /alerts/{id}\n" +
      "  Referrals      GET /referrals\n\n" +
      "BLOCKED (never call, even if asked): /api/admin/admins* and " +
      " /api/admin/settings* — admin account and settings management is " +
      "manual-only for security reasons.\n\n" +
      "MUTATIONS REQUIRE CONFIRMATION: for POST/PATCH/PUT/DELETE, the " +
      "first call returns a preview (requires_confirmation=true) and does " +
      "NOT execute. Show the preview to the admin; if they explicitly " +
      "approve, repeat the exact same call with confirm=true. Never set " +
      "confirm=true unless the admin has approved the previewed change " +
      "in this conversation. GET calls run directly.\n\n" +
      "If you don't know an endpoint's body shape, call GET first to inspect " +
      "an existing record. Numeric ids should be in the URL, not the body. " +
      "ALWAYS prefer the dedicated product tools (resolve_product, " +
      "update_product, update_stock) for product changes.",
    parameters: {
      type: "object",
      required: ["method", "path"],
      properties: {
        method: {
          type: "string",
          enum: ["GET", "POST", "PATCH", "PUT", "DELETE"],
        },
        path: {
          type: "string",
          description:
            "Endpoint path STARTING with /api/admin/, e.g. /api/admin/topups, /api/admin/orders/123/status",
        },
        body: {
          type: "object",
          description: "JSON body for POST/PATCH/PUT/DELETE. Omit for GET.",
          additionalProperties: true,
        },
        confirm: {
          type: "boolean",
          description:
            "Required=true for the SECOND call of any POST/PATCH/PUT/DELETE, " +
            "after the admin explicitly approved the preview returned by " +
            "the first call. Must be omitted/false otherwise.",
        },
      },
      additionalProperties: false,
    },
  },
};

export interface AdminRequestContext {
  /** The original Express request — we read cookies + headers from it. */
  req: Request;
}

interface AdminRequestResult {
  ok: boolean;
  status: number;
  body: unknown;
  truncated?: boolean;
}

export function isPathAllowed(path: string): { ok: true } | { ok: false; reason: string } {
  if (typeof path !== "string" || !path.startsWith(ALLOWED_PREFIX)) {
    return {
      ok: false,
      reason: `path must start with ${ALLOWED_PREFIX}`,
    };
  }
  // Re-normalize via URL FIRST — this both confirms the resulting
  // pathname still starts with ALLOWED_PREFIX (belt-and-braces against
  // normalization edge cases like percent-encoded traversal) and gives
  // us the clean pathname the traversal checks below must apply to.
  let normalized: string;
  try {
    normalized = new URL(path, "http://x").pathname;
  } catch {
    return { ok: false, reason: "path is not a valid URL pathname" };
  }
  // Defense-in-depth against path traversal: a path like
  // `/api/admin/../auth/login` passes the startsWith check, but the URL
  // constructor (used downstream by fetch()) normalizes `..` segments and
  // would land on /auth/login — bypassing the disallow list. Reject any
  // PATHNAME containing `..` segments or empty path components.
  //
  // R117 (A1-P5): the checks run on the URL-normalized PATHNAME only.
  // The A7-4 re-check feeds `pathname + search` through this function,
  // and a legitimate query string can legally contain `//` or `..`
  // (e.g. `?next=https://x//y`, `?from=../../docs`) — scanning the raw
  // input 400-ed those legal requests. The query never participates in
  // path routing, so traversal rules on it were pure false positives.
  if (normalized.includes("/../") || normalized.endsWith("/..") || normalized.includes("//")) {
    return {
      ok: false,
      reason: "path must not contain '..' segments or empty components",
    };
  }
  if (!normalized.startsWith(ALLOWED_PREFIX)) {
    return {
      ok: false,
      reason: `normalized path '${normalized}' falls outside ${ALLOWED_PREFIX}`,
    };
  }
  // SEC-92-03: the prefix lists below are checked against every
  // representation the path can take downstream. The URL constructor
  // does NOT decode percent-escapes in the pathname (it keeps
  // "/api/admin/admins%2F" as-is), but fetch() → Express WILL decode
  // them when routing — so a literal "%2F" could otherwise smuggle a
  // path past the denylist and still land on the blocked router.
  // Evaluate: (a) the URL-normalized form, (b) its percent-decoded
  // form, (c) the URL-normalized form of the decoded form.
  const candidates = new Set<string>([normalized]);
  try {
    const decoded = decodeURIComponent(normalized);
    candidates.add(decoded);
    candidates.add(new URL(decoded, "http://x").pathname);
  } catch {
    // Malformed percent-escapes — the raw normalized form above is the
    // only decodable representation; fetch would reject or keep it raw.
  }
  for (const candidate of candidates) {
    for (const prefix of DISALLOWED_PREFIXES) {
      if (candidate.startsWith(prefix)) {
        return {
          ok: false,
          reason: `path under ${prefix} is not allowed via admin_request`,
        };
      }
    }
    // SEC-92-03 denylist: identity/credential/config surfaces. The refusal
    // message is operator-facing Arabic — the same string the tool returns
    // to the model, so a super-admin reading the conversation sees WHY the
    // call was refused instead of a cryptic English code.
    for (const prefix of BLOCKED_PREFIXES) {
      if (candidate === prefix || candidate.startsWith(prefix + "/")) {
        return { ok: false, reason: BLOCKED_PREFIX_MESSAGE };
      }
    }
  }
  return { ok: true };
}

function getLoopbackBase(req: Request): string {
  const port = process.env.PORT ?? process.env.API_PORT ?? "8080";
  const proto = req.protocol === "https" ? "http" : "http"; // loopback is always http
  return `${proto}://127.0.0.1:${port}`;
}

function getAdminBearer(req: Request): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  const cookieToken = (req as { cookies?: Record<string, string | undefined> }).cookies
    ?.admin_token;
  return typeof cookieToken === "string" && cookieToken.length > 0 ? cookieToken : null;
}

export async function executeAdminRequest(
  input: Record<string, unknown>,
  ctx: AdminRequestContext,
): Promise<AdminRequestResult> {
  const method = String(input.method ?? "").toUpperCase();
  const path = String(input.path ?? "");
  const body = (input.body ?? null) as unknown;

  if (!ALLOWED_METHODS.has(method)) {
    return {
      ok: false,
      status: 400,
      body: { error: `method ${method} not allowed`, code: "COPILOT_BAD_METHOD" },
    };
  }
  const pathCheck = isPathAllowed(path);
  if (!pathCheck.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: pathCheck.reason, code: "COPILOT_PATH_BLOCKED" },
    };
  }
  // The check above already normalized; capture the canonical pathname +
  // QUERY STRING so the fetch() call uses it instead of the model-supplied
  // form. A7-4 (R116): the query was silently DROPPED — a GET like
  // /api/admin/topups?status=pending executed as /api/admin/topups (the
  // default list), so pagination/filters the model asked for (and showed
  // the admin in its answer) never reached the route. The combined
  // normalized form is re-checked against the allowlist — belt-and-braces
  // so a query smuggling a blocked prefix can't ride along.
  const safeUrl = new URL(path, "http://x");
  const safePath = `${safeUrl.pathname}${safeUrl.search}`;
  const combinedPathCheck = isPathAllowed(safePath);
  if (!combinedPathCheck.ok) {
    return {
      ok: false,
      status: 400,
      body: { error: combinedPathCheck.reason, code: "COPILOT_PATH_BLOCKED" },
    };
  }

  // ── SEC-92-03 mutation confirmation gate ────────────────────────────
  //
  // Mutations (POST/PATCH/PUT/DELETE) do NOT execute on the first call.
  // The first call returns a preview the model must relay to the admin;
  // only a repeat of the SAME call with confirm: true executes. This
  // breaks the single-shot indirect-prompt-injection chain (ticket /
  // product text instructing the model to silently POST /api/admin/...):
  // a silent execution now requires the model to make a second,
  // explicitly-flagged call after having been told to surface the
  // preview — observable in the tool_uses trace and counter to its
  // instructions. Read (GET) calls are unaffected.
  if (method !== "GET" && input.confirm !== true) {
    let bodySummary: string | null = null;
    if (body !== null && body !== undefined) {
      try {
        bodySummary = JSON.stringify(body).slice(0, PREVIEW_BODY_SUMMARY_CHARS);
      } catch {
        bodySummary = String(body).slice(0, PREVIEW_BODY_SUMMARY_CHARS);
      }
    }
    return {
      ok: false,
      status: 428, // Precondition Required — nothing was executed
      body: {
        error: "العملية تتطلب تأكيدًا صريحًا من المشرف قبل التنفيذ",
        code: "COPILOT_CONFIRMATION_REQUIRED",
        requires_confirmation: true,
        preview: {
          wouldCall: true,
          method,
          path: safePath,
          bodySummary,
        },
        hint:
          "لم يُنفَّذ شيء. اعرض ملخص العملية أعلاه على المشرف، وإذا وافق صراحةً " +
          "أعد نفس الاستدعاء (method/path/body) مع confirm=true لتنفيذها.",
      },
    };
  }

  const bearer = getAdminBearer(ctx.req);
  if (!bearer) {
    return {
      ok: false,
      status: 401,
      body: { error: "missing admin token", code: "COPILOT_NO_ADMIN_SESSION" },
    };
  }

  const url = `${getLoopbackBase(ctx.req)}${safePath}`;
  const correlationId =
    (ctx.req.headers["x-correlation-id"] as string | undefined) ?? `cp-internal-${Date.now()}`;

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let resp: Response;
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
      "X-Correlation-Id": correlationId,
      "X-Forwarded-By": "copilot-admin-request",
    };
    // Forward Origin so CSRF middleware (Origin/Referer check) accepts the
    // call. The original request already passed CSRF, so its origin is
    // trusted.
    if (ctx.req.headers.origin) headers.Origin = String(ctx.req.headers.origin);
    if (ctx.req.headers.referer) headers.Referer = String(ctx.req.headers.referer);

    if (method !== "GET" && body !== null && body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    resp = await fetch(url, {
      method,
      signal: ac.signal,
      headers,
      body:
        method !== "GET" && body !== null && body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    clearTimeout(timer);
    logger.warn(
      { err, url, method, correlationId },
      "copilot admin_request: loopback fetch failed",
    );
    return {
      ok: false,
      status: 502,
      body: {
        error: err instanceof Error ? err.message : "loopback fetch failed",
        code: "COPILOT_LOOPBACK_FAILED",
      },
    };
  } finally {
    clearTimeout(timer);
  }

  // Try JSON, fall back to text. Either way, cap the size before returning.
  const contentType = resp.headers.get("content-type") ?? "";
  let parsed: unknown;
  let truncated = false;
  try {
    if (contentType.includes("application/json")) {
      const txt = await resp.text();
      if (txt.length > MAX_RESULT_BYTES) truncated = true;
      const slice = truncated ? txt.slice(0, MAX_RESULT_BYTES) : txt;
      try {
        parsed = JSON.parse(slice) as unknown;
      } catch {
        parsed = { _raw: slice };
      }
    } else {
      const txt = await resp.text();
      if (txt.length > MAX_RESULT_BYTES) {
        truncated = true;
        parsed = { _text: txt.slice(0, MAX_RESULT_BYTES) };
      } else {
        parsed = { _text: txt };
      }
    }
  } catch (err) {
    parsed = {
      error: err instanceof Error ? err.message : "failed to read response body",
    };
  }

  return {
    ok: resp.ok,
    status: resp.status,
    body: parsed,
    ...(truncated ? { truncated: true } : {}),
  };
}

export const adminRequest: CopilotTool = {
  // Super-admin only — the endpoint-level auth still enforces per-route
  // scope, but exposing this tool to non-super admins gives the model too
  // many ways to discover endpoints they shouldn't be touching. Keep it
  // narrow until the audit story has been observed in production.
  requiredScope: "all",
  spec: adminRequestSpec,
  handler: async () => ({
    error: "must be invoked via the route's direct-execute path",
  }),
};

export function adminRequestToolForScopes(scopes: string[]): CopilotTool[] {
  if (!scopes.includes("all")) return [];
  return [adminRequest];
}

export function isAdminRequestToolName(name: string): boolean {
  return name === "admin_request";
}

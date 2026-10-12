/**
 * OpenWA gateway REST client — the transport/config half of the
 * services/openwa/ package (R136 BE-2 decomposition of
 * services/openwa.service.ts; the send path, settle gate and admin
 * session surface live in sibling modules, re-exported through the
 * openwa.service.ts facade).
 *
 * OWNED HERE:
 *   - env config readers (WHATSAPP_OTP_BASE_URL / _API_KEY / _SESSION /
 *     _AUTO_CREATE_SESSION)
 *   - the session wire types (SessionRecord / SessionStatus) + the
 *     transport result type (SendResult)
 *   - the authenticated fetch helpers (authHeaders / gatewayFetch /
 *     gatewayJson) and the X-API-Key contract
 *   - session bootstrap lookups (findSession / createAndStartSession)
 *   - the shared admin-wire validators (assertSessionId /
 *     normalizeSession) + WhatsAppGatewayError
 *
 * Wire format — matches the real OpenWA REST surface (Swagger:
 *   http://localhost:2785/api/docs):
 *
 *   Auth:  header `X-API-Key: <KEY>` on every request.
 *
 *   Bootstrap (read-only / one-shot):
 *     GET  {baseUrl}/api/sessions
 *     GET  {baseUrl}/api/sessions/{id}                    → 200 | 404
 *     POST {baseUrl}/api/sessions       body: { name }
 *     POST {baseUrl}/api/sessions/{id}/start
 *     GET  {baseUrl}/api/sessions/{id}/qr                 (operator-only)
 *
 *   Send:
 *     POST {baseUrl}/api/sessions/{id}/messages/send-text
 *       body: { chatId: "<E164>@c.us", text: "…" }       maxLength 4096
 *
 *   A session reports one of:
 *     created | initializing | qr_ready | authenticating | ready
 *     | disconnected | failed
 *   Only `ready` is sendable.
 */

interface GatewayAuthConfig {
  baseUrl: string;
  apiKey: string;
}

interface GatewayConfig extends GatewayAuthConfig {
  /** Either an existing session id (`sess_…`) or a session name. */
  sessionRef: string;
  autoCreate: boolean;
}

export type { GatewayAuthConfig, GatewayConfig };

export function readGatewayAuthConfig(): GatewayAuthConfig | null {
  const baseUrl = (process.env.WHATSAPP_OTP_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const apiKey = (process.env.WHATSAPP_OTP_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) return null;

  return { baseUrl, apiKey };
}

export function readGatewayConfig(): GatewayConfig | null {
  const auth = readGatewayAuthConfig();
  const sessionRef = (process.env.WHATSAPP_OTP_SESSION ?? "").trim();
  if (!auth || !sessionRef) return null;

  const autoCreateRaw = (process.env.WHATSAPP_OTP_AUTO_CREATE_SESSION ?? "").trim().toLowerCase();
  // Default ON. Only disable when the operator explicitly opts out.
  const autoCreate = !["0", "false", "no", "off"].includes(autoCreateRaw);

  return { ...auth, sessionRef, autoCreate };
}

export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "not_configured"
        | "session_not_found"
        | "session_not_ready"
        // 96-F1 (R96-A4 §1.3A): the session reports `ready` but is still
        // inside the post-link settle / warm-up window — dispatch is
        // gated, the caller should retry after `readyInMs`.
        | "session_settling"
        | "recipient_not_on_whatsapp"
        | "request_failed"
        | "non_ok_status";
      /** HTTP status when `reason === "non_ok_status"`. */
      status?: number;
      /** OpenWA session lifecycle state when `reason === "session_not_ready"`. */
      sessionStatus?: string;
      /** 96-F1: ms until the settle/warm-up window elapses (`reason === "session_settling"`). */
      readyInMs?: number;
    };

/** OpenWA session lifecycle states (from Swagger SessionResponseDto). */
export type SessionStatus =
  "created" | "initializing" | "qr_ready" | "authenticating" | "ready" | "disconnected" | "failed";

export interface SessionRecord {
  id: string;
  name: string;
  status: SessionStatus;
  /**
   * R104 (AG4-2): STABLE pairing identity (gateway exposes
   * creds.registrationId — minted at pairing, reused by every restore,
   * replaced only by a true re-pair). Preferred over lastReadyAt as the
   * epoch token: lastReadyAt is rewritten on EVERY connection open,
   * which made a routine boot-restore after an idle sleep look like a
   * re-pair and re-arm the full 45 s settle + warm-up gate on every
   * wake. Optional (older gateways omit it — falls back gracefully).
   */
  pairingId?: string;
  /**
   * 97-F3 (R97-WA-01): pairing-epoch token — the timestamp of the
   * CURRENT ready (gateway `publicView.lastReadyAt`). The gateway
   * rewrites it on every new connection open, so the SAME session id
   * (which survives loggedOut + re-pair) carries a NEW token after a
   * re-pair. Treated as an opaque string — see sessionPairingEpoch()
   * in ./settle-gate.ts. R104: used as the epoch ONLY when the gateway
   * does not expose pairingId (legacy shape).
   */
  lastReadyAt?: string;
  /** 97-F3 fallback epoch token when the gateway omits lastReadyAt
   * ("Timestamp of the CURRENT open" in publicView). */
  connectedAt?: string;
}

const REQUEST_TIMEOUT_MS = 8_000;

export function authHeaders(config: GatewayAuthConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-API-Key": config.apiKey,
  };
}

export async function gatewayFetch(
  config: GatewayAuthConfig,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(`${config.baseUrl}${path}`, {
    ...init,
    headers: { ...authHeaders(config), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Treat the configured session ref as a session name only when it
 * satisfies the OpenWA `CreateSessionDto.name` constraint
 * (alphanumeric + hyphens, length 3-50). Anything else is either an
 * id we haven't seen before or a misconfiguration — in both cases we
 * refuse to auto-create.
 */
const SESSION_NAME_RE = /^[A-Za-z0-9-]{3,50}$/;
export function looksLikeValidSessionName(value: string): boolean {
  return SESSION_NAME_RE.test(value);
}

export async function findSession(config: GatewayConfig): Promise<SessionRecord | null> {
  // 1) Try the configured ref as an id (works for both `sess_…`-prefixed
  //    examples in the docs AND plain UUIDs the live API actually emits).
  const direct = await gatewayFetch(
    config,
    `/api/sessions/${encodeURIComponent(config.sessionRef)}`,
  );
  if (direct.ok) {
    return (await direct.json()) as SessionRecord;
  }
  if (direct.status !== 404) {
    throw new Error(`session_lookup_${direct.status}`);
  }

  // 2) Fall back to listing and matching by name. The live API does not
  //    accept names in the {id} path, so this is the only way to resolve
  //    a name-style configuration.
  const list = await gatewayFetch(config, "/api/sessions");
  if (!list.ok) throw new Error(`session_list_${list.status}`);
  const sessions = (await list.json()) as SessionRecord[];
  return sessions.find((s) => s.name === config.sessionRef) ?? null;
}

export async function createAndStartSession(config: GatewayConfig): Promise<SessionRecord> {
  const createRes = await gatewayFetch(config, "/api/sessions", {
    method: "POST",
    body: JSON.stringify({ name: config.sessionRef }),
  });
  if (!createRes.ok) {
    throw new Error(`session_create_${createRes.status}`);
  }
  const created = (await createRes.json()) as SessionRecord;

  // Best-effort start. If the session is already starting from a previous
  // run, the API typically responds 2xx with the current status; we don't
  // hard-fail here.
  await gatewayFetch(config, `/api/sessions/${encodeURIComponent(created.id)}/start`, {
    method: "POST",
  }).catch(() => undefined);

  // Re-fetch to surface the current status (will usually be qr_ready or
  // initializing — operator must scan via the dashboard).
  const after = await gatewayFetch(config, `/api/sessions/${encodeURIComponent(created.id)}`);
  if (after.ok) {
    return (await after.json()) as SessionRecord;
  }
  return created;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared admin-wire validators + the gateway error type
// ─────────────────────────────────────────────────────────────────────────────

/** Safe subset exposed to the admin session-management surface. */
export interface WhatsAppSessionRecord {
  id: string;
  name: string;
  status: string;
}

export class WhatsAppGatewayError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "WhatsAppGatewayError";
  }
}

export function sessionPath(sessionId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}`;
}

export function assertSessionId(sessionId: string): string {
  const value = sessionId.trim();
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(value)) {
    throw new WhatsAppGatewayError("invalid_session_id", 400);
  }
  return value;
}

export function normalizeSession(value: unknown): WhatsAppSessionRecord {
  if (!value || typeof value !== "object") {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    typeof candidate.name !== "string" ||
    typeof candidate.status !== "string"
  ) {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
  return { id: candidate.id, name: candidate.name, status: candidate.status };
}

export async function gatewayJson<T>(
  config: GatewayAuthConfig,
  path: string,
  init?: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await gatewayFetch(config, path, init);
  } catch {
    throw new WhatsAppGatewayError("gateway_request_failed", 502);
  }
  if (!response.ok) {
    throw new WhatsAppGatewayError("gateway_request_failed", response.status);
  }
  try {
    return (await response.json()) as T;
  } catch {
    throw new WhatsAppGatewayError("invalid_gateway_response", 502);
  }
}

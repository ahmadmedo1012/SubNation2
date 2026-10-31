export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
  /**
   * 96-F3 (R96 M3): per-request network timeout in milliseconds.
   *
   * Defaults to {@link DEFAULT_REQUEST_TIMEOUT_MS} (20 s). Pass `0` to
   * disable the timeout entirely (e.g. a deliberately long-running
   * upload). The timeout is implemented with `AbortSignal.timeout()`
   * and merged with any caller-provided `init.signal` via
   * `AbortSignal.any()` when both exist — whichever aborts first wins,
   * so a caller cancellation (React Query unmount) still aborts
   * immediately and is propagated unchanged.
   */
  timeoutMs?: number;
};

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

/**
 * Optional 401 observer — 93-C6 / F-07 (round-93): lets a host app
 * react to authorization failures without wrapping every fetch. The
 * shared client itself stays navigation/toast-free (it is also bundled
 * by React-Native hosts with no router); the web app registers
 * lib/admin-session's handler from useAdminHeaders.
 *
 * Invoked for EVERY 401 (including storefront endpoints) BEFORE the
 * ApiError is thrown — the registered callback decides by URL whether
 * it is its business. The error still propagates to React Query /
 * callers unchanged.
 */
export type UnauthorizedHandler = (info: { url: string; method: string }) => void;

let _unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Register (or clear) the global 401 observer. Only one handler is
 * kept — the last registration wins, matching setAuthTokenGetter.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  _unauthorizedHandler = handler;
}

// ── 96-F3 (R96 M5 + A4 §3.1): additive observer registry ──────────────────
//
// The single slot above is owned by the ADMIN session handler
// (frontend lib/admin-session via useAdminHeaders — last registration
// wins, and every admin page re-registers it on mount). A storefront
// (user-session) handler cannot live in that slot: mounting any admin
// page would clobber it and silently kill storefront 401 handling for
// the rest of the session.
//
// `addUnauthorizedHandler` registers PERMANENT observers that coexist
// with the single-slot handler: every 401 notifies the additive list
// (registration order) AND the single slot. Each handler decides by URL
// whether the failure is its business — the user-session router
// ignores /api/admin/* and delegates to admin-session; admin-session's
// own handler ignores everything else. Dedupe windows on both sides
// make a double-dispatch (additive router + single-slot both seeing an
// admin URL) side-effect-free.
const _unauthorizedHandlers: UnauthorizedHandler[] = [];

/**
 * Register an additional 401 observer that cannot be clobbered by
 * `setUnauthorizedHandler` registrations. Returns an unsubscribe
 * function. Errors thrown by an observer are swallowed — an observer
 * must never break the request pipeline.
 */
export function addUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  _unauthorizedHandlers.push(handler);
  return () => {
    const index = _unauthorizedHandlers.indexOf(handler);
    if (index !== -1) _unauthorizedHandlers.splice(index, 1);
  };
}

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 *
 * NOTE: This function should never be used in web applications where session
 * token cookies are automatically associated with API calls by the browser.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
    (mediaType.startsWith("text/") ||
      mediaType === "application/xml" ||
      mediaType === "text/xml" ||
      mediaType.endsWith("+xml") ||
      mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;

  constructor(response: Response, data: T | null, requestInfo: { method: string; url: string }) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

// ── 96-F3 (R96 M3): default request timeout ──────────────────────────────
//
// A request that lands on a dead NAT mapping / cold-starting free-tier
// server used to hang for minutes: TanStack stayed `pending` (endless
// skeletons, disabled "جارٍ…" money buttons) with no signal that the
// request was dead. 20 s covers every legitimate backend operation
// that goes through this client (DB statements are capped at 15 s
// server-side; the long WhatsApp OTP flows use raw fetch, not this
// client) while bounding the pathological case.
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

// ── 2026-09-20 (free-infrastructure round): cold-start aware retry ────────
//
// Render Free is ALLOWED to sleep now (all keep-alive removed). The
// backend binds its port FIRST and answers 503 with a recognizable
// "starting" payload while migrations/bootstrap run — see server.ts's
// early-bind readiness gate:
//
//     /api/healthz*  → 503 {"status":"starting"}
//     every /api/*   → 503 {"error":"الخدمة قيد التشغيل، أعد المحاولة بعد لحظات", …}
//
// The gate rejects requests BEFORE routing (nothing executed — a retry
// is side-effect-free even for POST), so this client transparently
// retries a gated 503 up to 3 times with 1.5 s / 3 s / 5 s backoff
// instead of surfacing an error card to a user who just woke the
// service. The caller's timeout budget (timeoutMs, default 20 s)
// remains the TOTAL budget across attempts — a cold start that
// outlasts it still fails honestly with the existing Arabic
// network-error mapping. Business 503s (inventory maintenance, rate
// limits…) do NOT match the marker and are never retried.
const BOOT_GATE_RETRY_DELAYS_MS: readonly number[] = [1_500, 3_000, 5_000];

/**
 * Dedicated budget once the boot-gate marker is SEEN. The marker is
 * definitive proof the request was never routed (nothing executed),
 * so waiting for the gate to open is strictly safe — and a cold
 * Render+Neon wake can legitimately take ~30 s. Without this, the
 * general 20 s budget would surface an error to a user whose request
 * would have succeeded a few seconds later.
 */
const BOOT_GATE_TOTAL_BUDGET_MS = 45_000;

/** The gate's exact Arabic marker — a needle only the boot gate emits. */
const BOOT_GATE_MARKER_TEXT = "قيد التشغيل";

function isBootGateResponse(status: number, data: unknown): boolean {
  if (status !== 503) return false;
  if (!data || typeof data !== "object") return false;
  const record = data as Record<string, unknown>;
  if (record["status"] === "starting") return true;
  return (
    typeof record["error"] === "string" &&
    (record["error"] as string).includes(BOOT_GATE_MARKER_TEXT)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type AbortSignalStatics = {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

function abortSignalStatics(): AbortSignalStatics {
  // Feature-detect: some runtimes (React Native polyfills, old
  // Safari) lack the static helpers. Everything degrades to the
  // pre-96-F3 behavior (no timeout) rather than throwing.
  if (typeof AbortSignal === "undefined") return {};
  return AbortSignal as unknown as AbortSignalStatics;
}

/**
 * Compute the effective request signal for a fetch:
 *
 *   - timeoutMs <= 0                     → caller signal alone (or none)
 *   - no caller signal                   → timeout signal
 *   - caller signal + AbortSignal.any    → merged (first abort wins)
 *   - caller signal, no AbortSignal.any  → caller signal alone (the
 *     timeout is dropped — aborting the caller's cancellation would
 *     break React Query's own unmount cancellation semantics)
 */
function resolveRequestSignal(
  callerSignal: AbortSignal | null | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; timeoutSignal: AbortSignal | undefined } {
  if (timeoutMs <= 0) return { signal: callerSignal ?? undefined, timeoutSignal: undefined };

  const statics = abortSignalStatics();
  if (typeof statics.timeout !== "function") {
    return { signal: callerSignal ?? undefined, timeoutSignal: undefined };
  }

  const timeoutSignal = statics.timeout(timeoutMs);
  if (!callerSignal) return { signal: timeoutSignal, timeoutSignal };
  if (typeof statics.any !== "function") {
    return { signal: callerSignal, timeoutSignal: undefined };
  }

  return { signal: statics.any([callerSignal, timeoutSignal]), timeoutSignal };
}

/**
 * True when OUR timeout fired (as opposed to a caller-initiated
 * cancellation). Signal state is authoritative: the timeout signal
 * aborted while the caller's did not. A caller cancellation (the
 * caller signal IS aborted) always propagates unchanged so React
 * Query's unmount/cancel semantics stay intact.
 */
function isOurTimeoutAbort(
  callerSignal: AbortSignal | null | undefined,
  timeoutSignal: AbortSignal | undefined,
): boolean {
  if (!timeoutSignal || !timeoutSignal.aborted) return false;
  if (callerSignal && callerSignal.aborted) return false;
  return true;
}

/**
 * Map a timeout abort onto the shape the web app's existing
 * network-error path recognizes. lib/errors.ts (getErrorMessage)
 * keys its Arabic «تعذّر الاتصال بالخدمة» branch off the exact browser
 * network-failure messages ("Failed to fetch" / "Load failed"), so a
 * raw `DOMException: signal timed out` would leak English into
 * Arabic toasts. Throwing the canonical network-error TypeError keeps
 * every existing caller mapping intact; the original TimeoutError is
 * preserved as `cause` for Sentry/console diagnostics. The ApiError
 * contract is untouched — timeouts never produce an ApiError (there
 * is no response to wrap).
 */
function toNetworkErrorShape(error: unknown): TypeError {
  return new TypeError("Failed to fetch", { cause: error });
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType = responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            'Use responseType "json" or "text" instead.',
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  const {
    responseType = "auto",
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    headers: headersInit,
    ...init
  } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);

  if (typeof init.body === "string" && !headers.has("content-type") && looksLikeJson(init.body)) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  // Round-3 (8-f §1): ~18 call sites pass `token ? \`Bearer ${token}\` : ""`,
  // which leaves an EMPTY Authorization header — `headers.has()` is then
  // true, so the registered getter could never take over. Treat an
  // empty/whitespace header as absent: delete it so the getter wins
  // and logged-out requests stop shipping a junk header at all.
  const explicitAuth = headers.get("authorization");
  if (explicitAuth !== null && explicitAuth.trim() === "") {
    headers.delete("authorization");
  }
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };

  // 2026-09-20: the caller timeout is the TOTAL budget across attempts
  // (backoffs included) — UPGRADED exactly ONCE, at the first boot-gate
  // sighting, to the dedicated gate budget (see BOOT_GATE_TOTAL_BUDGET_MS).
  // Re-upgrading per retry would push the deadline forever and retry
  // without end — the activation flag is the guard.
  let deadlineAt = timeoutMs > 0 ? Date.now() + timeoutMs : null;
  let gateBudgetActivated = false;
  let gateResponseRef: ApiError | null = null;

  for (let attempt = 0; ; attempt++) {
    // Remaining budget for THIS attempt. When a retry exhausted the
    // deadline, fail with the last gate response (honest 503 ApiError)
    // instead of issuing an untimed request — resolveRequestSignal
    // installs NO timeout when timeoutMs <= 0.
    const remainingMs = deadlineAt !== null ? deadlineAt - Date.now() : 0;
    if (attempt > 0 && deadlineAt !== null && remainingMs <= 0) {
      throw (
        gateResponseRef ??
        new TypeError("Failed to fetch", {
          cause: new Error("request budget exhausted during cold-start retry"),
        })
      );
    }
    const effectiveTimeoutMs = deadlineAt !== null ? Math.max(1, remainingMs) : 0;

    // 96-F3 (R96 M3): timeout merged with the caller's signal.
    // `timeoutSignal` is retained so the catch boundary can distinguish
    // OUR timeout from a caller cancellation.
    const { signal: effectiveSignal, timeoutSignal } = resolveRequestSignal(
      init.signal,
      effectiveTimeoutMs,
    );

    try {
      const response = await fetch(input, { ...init, signal: effectiveSignal, method, headers });

      if (!response.ok) {
        // 93-C6 / F-07 + 96-F3: notify the host app BEFORE building/
        // throwing the ApiError — the error itself still propagates
        // unchanged so query error states (isError → error cards) keep
        // working. The additive list (96-F3) fires first, then the
        // single-slot handler; both are individually guarded.
        if (response.status === 401) {
          for (const handler of [..._unauthorizedHandlers]) {
            try {
              handler({ url: requestInfo.url, method });
            } catch {
              // An observer must never break the request pipeline.
            }
          }
          if (_unauthorizedHandler) {
            try {
              _unauthorizedHandler({ url: requestInfo.url, method });
            } catch {
              // An observer must never break the request pipeline.
            }
          }
        }
        const errorData = await parseErrorBody(response, method);

        // 2026-09-20 cold-start aware retry: the backend's boot gate
        // answered — nothing executed server-side (the gate middleware
        // rejects BEFORE routing), so a retry is side-effect-free even
        // for POST. Backoff (escalating 1.5 s / 3 s, then steady 5 s)
        // and re-issue while budget remains — the loop-top deadline
        // check is the sole terminator, so a 30 s cold boot rides out
        // inside the dedicated 45 s gate budget instead of erroring.
        if (isBootGateResponse(response.status, errorData)) {
          gateResponseRef = new ApiError(response, errorData, requestInfo);
          // First gate sighting ONLY: the waiting game is provably safe —
          // extend the budget to the dedicated gate window (once; a
          // per-retry upgrade would push the deadline forever).
          if (!gateBudgetActivated) {
            gateBudgetActivated = true;
            const gateDeadline = Date.now() + BOOT_GATE_TOTAL_BUDGET_MS;
            if (deadlineAt === null || gateDeadline > deadlineAt) deadlineAt = gateDeadline;
          }
          const delay =
            BOOT_GATE_RETRY_DELAYS_MS[Math.min(attempt, BOOT_GATE_RETRY_DELAYS_MS.length - 1)];
          await sleep(delay);
          continue;
        }

        throw new ApiError(response, errorData, requestInfo);
      }

      // Body reads are inside the try on purpose: the timeout signal
      // aborts in-flight body streaming too, and that rejection must
      // land in the same Arabic network-error mapping.
      return (await parseSuccessBody(response, responseType, requestInfo)) as T;
    } catch (error) {
      // A retry `continue` never lands here (no throw) — only real
      // fetch / timeout / caller-cancel errors do.
      if (isOurTimeoutAbort(init.signal, timeoutSignal)) {
        throw toNetworkErrorShape(error);
      }
      throw error;
    }
  }
}

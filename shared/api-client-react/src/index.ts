export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  // 96-F3 (R96 M5 + A4 §3.1): additive 401 observer — coexists with the
  // single-slot handler so the storefront session router can register
  // without being clobbered by admin-page re-registrations.
  addUnauthorizedHandler,
  customFetch,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from "./custom-fetch";
export type { AuthTokenGetter, ApiError, UnauthorizedHandler } from "./custom-fetch";

export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  setUnauthorizedHandler,
  customFetch,
} from "./custom-fetch";
export type { AuthTokenGetter, ApiError, UnauthorizedHandler } from "./custom-fetch";

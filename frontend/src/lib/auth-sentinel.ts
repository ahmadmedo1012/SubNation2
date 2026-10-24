/**
 * The cookie-session sentinel constant — hoisted here (R186 H-F6) from
 * lib/auth.tsx, which still re-exports it for API compat.
 *
 * Why a dedicated leaf module: lib/auth-token-holder.ts needs the exact
 * same constant for its bearer filter but CANNOT import it from
 * lib/auth.tsx (auth.tsx imports the holder — an import cycle), so the
 * literal used to be privately re-declared there. Nothing pinned the
 * two definitions together; one-sided drift would silently ship
 * `Authorization: Bearer __cookie_session__` on every cookie-auth
 * request. Both modules now import this cycle-free leaf (parity pinned
 * by auth-sentinel-parity-r186).
 *
 * Sentinel value placed in `token` state when the user is authenticated
 * via the httpOnly `auth_token` cookie but the actual JWT is not
 * accessible to JavaScript (which is the desired security property).
 *
 * Effects:
 *   - `!!token` checks across the codebase resolve truthy (so
 *     `enabled: !!token`, `if (token) ...`, etc. work unchanged).
 *   - `Authorization: Bearer ${token}` headers send a useless string,
 *     but the backend's `requireUser` middleware reads `req.cookies.
 *     auth_token` FIRST and ignores invalid Authorization headers, so
 *     this is harmless. (verified in middlewares/requireUser.ts)
 *   - 98-F3 (R98 backend round — mirror of R97-02): the session-mint
 *     routes (POST /api/auth/firebase/session, /firebase/refresh,
 *     /whatsapp/verify, /telegram, /telegram/webapp) no longer return
 *     the raw JWT in the body — they return THIS sentinel string in the
 *     `token` field (the httpOnly cookie is the sole session
 *     transport). Every real sign-in therefore ALSO lands here:
 *     WhatsAppPhoneSignIn / AuthProviders / telegram-callback /
 *     use-telegram-webapp-auto-login call `setToken(data.token)` and
 *     store the sentinel, exactly like auth.tsx's boot probe. No raw
 *     user JWT is reachable from JS memory anymore (the admin surface
 *     closed the same gap in R97-02).
 */
export const COOKIE_AUTH_SENTINEL = "__cookie_session__";

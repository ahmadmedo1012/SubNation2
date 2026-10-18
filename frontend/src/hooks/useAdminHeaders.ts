import { useEffect, useMemo } from "react";
import { setUnauthorizedHandler } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { handleAdminUnauthorized, setAdminSessionMirror } from "@/lib/admin-session";

/**
 * Build the standard admin Authorization headers map.
 *
 * Replaces the previously-duplicated inline construction
 *   const headers = { Authorization: adminToken ? `Bearer ${adminToken}` : "" }
 * (and three variants of it) that lived in 10 different admin pages.
 * Centralizes the logic so:
 *
 *   - Behavior is consistent: the Authorization header is OMITTED entirely
 *     when adminToken is null/empty (instead of emitting an empty-value
 *     header, which some servers parse as "present but malformed" and
 *     return 400 instead of 401).
 *
 *   - The Memo identity is stable across renders for the same token,
 *     which lets useEffect dep arrays reference `headers` without
 *     triggering refetch loops.
 *
 *   - Future header additions (e.g. an X-Admin-Trace correlation id)
 *     land in one place.
 *
 * 93-C6 / F-07 (round-93, A5 S-3): this hook is additionally the
 * integration point for the global session-expiry handler — every
 * admin page already calls it, so mounting any admin page (a) mirrors
 * "an admin session exists" into lib/admin-session and (b) installs
 * that handler as customFetch's 401 observer exactly once. A cookie
 * that expires mid-work now produces ONE «انتهت الجلسة» toast + a
 * soft redirect to /admin/login instead of per-page "retry" errors.
 *
 * @example
 *   const headers = useAdminHeaders();             // GET requests
 *   const headers = useAdminHeaders({ json: true }); // POST/PATCH/DELETE with body
 *
 *   await fetch("/api/admin/topups", { headers });
 */
export function useAdminHeaders(opts: { json?: boolean } = {}): Record<string, string> {
  const { adminToken, setAdminToken } = useAuth();
  const wantJson = !!opts.json;
  const headers = useMemo(() => {
    const h: Record<string, string> = {};
    if (adminToken) {
      h.Authorization = `Bearer ${adminToken}`;
    }
    if (wantJson) {
      h["Content-Type"] = "application/json";
    }
    return h;
  }, [adminToken, wantJson]);

  // Mirror the session state + install the clear callback (stable —
  // setAdminToken is a useCallback with no deps inside AuthProvider).
  useEffect(() => {
    setAdminSessionMirror(!!adminToken, adminToken ? () => setAdminToken(null) : null);
  }, [adminToken, setAdminToken]);

  // Install the customFetch 401 observer once per page load (module
  // flag — the handler is module-level, not per-component).
  useEffect(() => {
    setUnauthorizedHandler(({ url }) => {
      handleAdminUnauthorized(url);
    });
  }, []);

  return headers;
}

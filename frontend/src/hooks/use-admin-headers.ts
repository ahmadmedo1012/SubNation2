import { useMemo } from "react";
import { useAuth } from "@/lib/auth";

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
 * @example
 *   const headers = useAdminHeaders();             // GET requests
 *   const headers = useAdminHeaders({ json: true }); // POST/PATCH/DELETE with body
 *
 *   await fetch("/api/admin/topups", { headers });
 */
export function useAdminHeaders(opts: { json?: boolean } = {}): Record<string, string> {
  const { adminToken } = useAuth();
  const wantJson = !!opts.json;
  return useMemo(() => {
    const h: Record<string, string> = {};
    if (adminToken) {
      h.Authorization = `Bearer ${adminToken}`;
    }
    if (wantJson) {
      h["Content-Type"] = "application/json";
    }
    return h;
  }, [adminToken, wantJson]);
}

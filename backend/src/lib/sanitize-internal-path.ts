/**
 * R154 (P2) — backend twin of the frontend's sanitizeInternalPath
 * (frontend/src/lib/utils.ts): a `?redirect=`-style target is only ever
 * honored when it is
 *   • slash-prefixed (never a scheme/host),
 *   • not protocol-relative (`//` — the open-redirect escape hatch),
 *   • bounded in length (defensive cap).
 * Returns path + search so the result is always a RELATIVE target the
 * post-login bounce can navigate to; null for anything else.
 *
 * The frontend variant resolves against window.location.origin — on the
 * server there is no window, and the origin check reduces to exactly the
 * two structural rules above (a slash-prefixed, non-protocol-relative
 * string cannot carry an authority), which is the same guarantee
 * login.tsx's ?redirect= sanitizer has relied on since R123.
 */
export function sanitizeInternalPath(target: string | null | undefined): string | null {
  if (typeof target !== "string" || target.length === 0) return null;
  if (target.length > 500) return null;
  if (!target.startsWith("/") || target.startsWith("//")) return null;
  try {
    const url = new URL(target, "https://subnation.internal");
    if (url.origin !== "https://subnation.internal") return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}

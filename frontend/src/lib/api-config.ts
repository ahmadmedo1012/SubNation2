/**
 * Runtime API configuration for split deployments.
 *
 * The frontend historically used relative `/api` requests because Render
 * served the SPA and Express from one origin. Vercel serves the SPA now, so
 * those legacy calls must be resolved to the Render origin as well. Keeping
 * this compatibility layer at the browser boundary lets older feature code
 * continue to use relative API paths without silently calling Vercel itself.
 */

function normalizeOrigin(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export function getApiBaseUrl(): string {
  return (
    normalizeOrigin(import.meta.env.VITE_API_BASE_URL) ||
    normalizeOrigin(import.meta.env.VITE_API_URL)
  );
}

export function getSocketUrl(): string {
  return normalizeOrigin(import.meta.env.VITE_SOCKET_URL) || getApiBaseUrl();
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  if (!base || !path.startsWith("/") || path.startsWith("//")) return path;
  return `${base}${path}`;
}

let fetchPatched = false;

/**
 * Preserve the existing relative-fetch call sites while the UI is hosted on
 * a different origin. Only `/api` requests are rewritten; assets and third-
 * party requests retain native browser behavior.
 */
export function installApiFetchBridge(): void {
  if (fetchPatched || typeof window === "undefined") return;
  const base = getApiBaseUrl();
  if (!base) return;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const isApiPath = rawUrl === "/api" || rawUrl.startsWith("/api/");
    if (!isApiPath) return nativeFetch(input, init);

    const absoluteUrl = apiUrl(rawUrl);
    const credentials = init?.credentials ?? "include";
    if (input instanceof Request) {
      return nativeFetch(new Request(absoluteUrl, input), { ...init, credentials });
    }
    return nativeFetch(absoluteUrl, { ...init, credentials });
  };

  fetchPatched = true;
}

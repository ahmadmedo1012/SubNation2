/**
 * Runtime API configuration for split deployments.
 *
 * The frontend historically used relative `/api` requests because one
 * origin served both the SPA and Express (the pre-split Render era). During
 * the Vercel→Render split the SPA lived on a different origin, so those
 * legacy calls had to be resolved to the API origin. The split stack is
 * RETIRED (single-origin production: the build-time vars stay EMPTY and
 * every call is relative again) — this compatibility layer remains so older
 * feature code keeps working unchanged on any deployment shape.
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
    const rawUrl =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
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

import { logger } from "./logger";

/**
 * R163 — Bing IndexNow notifications for meaningful catalog changes.
 *
 * The protocol (indexnow.org, verified R163-R3): a site owns a key; the
 * key file lives at `https://<host>/<key>.txt` (body = exactly the key);
 * URL submissions go to `https://api.indexnow.org/indexnow?url=<encoded>&key=<key>`
 * and fan out to every participating engine (Bing, Yandex, Seznam,
 * Naver, Yep, Internet Archive, Amazonbot). NO Bing Webmaster Tools
 * registration is required — the key file is the only verification.
 * 200 = received, 202 = received pending key validation; neither
 * promises indexing (we never claim otherwise).
 *
 * Env-gated and fully inert without configuration: when INDEXNOW_KEY is
 * unset or malformed the notify functions return without touching the
 * network and the key-file route never mounts. The key lives in Coolify
 * env config — never in this repo (secret-scan discipline).
 *
 * Debounce: ≥5 minutes per URL (the engines' own guidance is to submit
 * meaningful changes only; the throttle map bounds repeated admin saves).
 */

const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const DEBOUNCE_MS = 5 * 60 * 1000;
/** key: 8–128 chars of [A-Za-z0-9-] (the live API's 422 settles the format). */
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/;
/** Parallel submissions capped; a burst of product saves must not stack. */
const FETCH_TIMEOUT_MS = 5_000;

/** The last submission per absolute URL — the debounce state. */
const lastSent = new Map<string, number>();

/**
 * The configured key, or null when IndexNow is off. Validated ONCE per
 * call (cheap) so tests and runtime share the same gate.
 */
export function indexNowKey(): string | null {
  const raw = process.env.INDEXNOW_KEY?.trim() ?? "";
  return KEY_RE.test(raw) ? raw : null;
}

/** True when the key-file route should mount (boot-time decision). */
export function indexNowConfigured(): boolean {
  return indexNowKey() !== null;
}

/** The canonical origin notifications build absolute URLs from. */
function notificationOrigin(): string {
  return (process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "");
}

/**
 * Submit ONE URL to IndexNow (single-URL GET — the engines' documented
 * preference over batches). Fire-and-forget: never throws, never blocks
 * the caller; rejections land in the warn log with the bounded status.
 */
export function notifyIndexNow(path: string): void {
  const key = indexNowKey();
  if (!key) return;
  const url = `${notificationOrigin()}${path.startsWith("/") ? path : `/${path}`}`;

  const now = Date.now();
  const last = lastSent.get(url) ?? 0;
  if (now - last < DEBOUNCE_MS) return;
  // Set the timestamp BEFORE the fetch: a failed submission does not
  // retry-hammer within the window; the next change re-pings normally.
  lastSent.set(url, now);
  // Bound the map (admin churn on a large catalog must not grow it
  // forever; 10k paths is far beyond the live 45-product catalog).
  if (lastSent.size > 10_000) lastSent.clear();

  const apiUrl = `${INDEXNOW_ENDPOINT}?url=${encodeURIComponent(url)}&key=${encodeURIComponent(key)}`;
  void fetch(apiUrl, { method: "GET", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then((res) => {
      // 202 = received, key validation pending (normal on first use) —
      // a success-class response, not a rejection worth logging.
      if (!res.ok && res.status !== 202) {
        logger.warn(
          { status: res.status, category: "indexnow" },
          "IndexNow submission rejected (see https://indexnow.org/documentation — 4xx classes mean key-file or URL-host mismatch)",
        );
      }
    })
    .catch((err: unknown) => {
      logger.warn({ err, category: "indexnow" }, "IndexNow submission failed (network)");
    });
}

/**
 * The catalog-change notification set for ONE product: its PDP plus the
 * category landing that renders it (both genuinely change when the
 * product does). Passed the fields the caller already holds — no extra
 * DB read at the call sites that have the row in hand.
 */
export function notifyProductChanged(slug: string, category?: string | null): void {
  notifyIndexNow(`/product/${slug}`);
  if (category) notifyIndexNow(`/category/${category}`);
}

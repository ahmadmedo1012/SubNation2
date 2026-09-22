/**
 * Pricing configuration — the SINGLE SOURCE OF TRUTH for catalog pricing.
 *
 * ── The official retail pricing rule (operator directive, 2026-09-20) ──────
 *
 *   1 USD  = 10 LYD              (exchange rate, `pricing.usd_to_lyd`)
 *   Markup = 100%                (gross margin,      `pricing.markup_percent`)
 *
 *   Selling Price USD = Cost USD × (1 + markup/100)      → cost × 2
 *   Selling Price LYD = Selling Price USD × rate         → × 10
 *
 *   Examples (defaults): $1 → 20 LYD · $5 → 100 LYD · $7.50 → 150 LYD
 *
 * ── Where this is used (exhaustively) ─────────────────────────────────────
 *   - The catalog import script (writes variant.price_lyd at import time)
 *   - Admin variant create/edit endpoints (recompute on every write)
 *   - Admin bulk price recompute endpoint (operator changes rate/markup
 *     then recomputes the whole catalog with one action)
 *   - Admin pricing calculator (margin simulation — display only)
 *
 * ── Storage & override contract ───────────────────────────────────────────
 *   Defaults are compiled in (DEFAULT_USD_TO_LYD, DEFAULT_MARKUP_PERCENT) so
 *   a fresh database prices correctly with zero setup. The operator can
 *   override both via system_settings rows (admin settings UI); overrides
 *   are cached in-process for `SETTINGS_TTL_MS` (60s) — pricing reads ride
 *   the catalog's 60s edge-cache window, so a stale-but-consistent view is
 *   acceptable, and the cache degrades to defaults only when the settings
 *   table is unreadable (never throws).
 *
 *   The rule is enforced at WRITE time: `price_lyd` on a variant is always
 *   the output of computeRetailLYD() with the then-current config. Reads
 *   (catalog, checkout) use the stored price — the customer-facing number
 *   is stable and auditable, and a config change only propagates when the
 *   operator explicitly recomputes.
 */
import { eq } from "drizzle-orm";
import { db, systemSettingsTable } from "@workspace/db";

// ── Defaults (the operator's official numbers) ─────────────────────────────

export const DEFAULT_USD_TO_LYD = 10;
export const DEFAULT_MARKUP_PERCENT = 100;

export const SETTING_KEY_USD_TO_LYD = "pricing.usd_to_lyd";
export const SETTING_KEY_MARKUP_PERCENT = "pricing.markup_percent";

/** In-process cache lifetime — matches the catalog's 60s edge window. */
const SETTINGS_TTL_MS = 60_000;

export interface PricingConfig {
  /** LYD per 1 USD. e.g. 10 */
  usdToLyd: number;
  /** Gross margin percent applied on cost. e.g. 100 (=> cost × 2) */
  markupPercent: number;
}

// ── Pure math (unit-testable without a database) ───────────────────────────

/**
 * The one formula. cost USD → retail LYD, rounded to cents (2 decimals)
 * with the same half-up idiom (Math.round — NOT banker's rounding: an
 * exact half cent goes up, e.g. 0.125 → 0.13) used across the money
 * pipeline (cart.tsx roundToCents / wallet rounding).
 *
 * $3.99 × (1+100/100) × 10 = 79.80 LYD
 * $5    × 2 × 10           = 100.00 LYD
 */
export function computeRetailLYD(costUsd: number, config: PricingConfig): number {
  return round2(costUsd * (1 + config.markupPercent / 100) * config.usdToLyd);
}

/** Selling price in USD (before the LYD conversion) — admin display only. */
export function computeRetailUSD(costUsd: number, config: PricingConfig): number {
  return round2(costUsd * (1 + config.markupPercent / 100));
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ── Settings-backed config (cache + safe fallback) ─────────────────────────

interface CacheEntry {
  config: PricingConfig;
  expiresAt: number;
}

let cache: CacheEntry | null = null;
let inFlight: Promise<PricingConfig> | null = null;

function parsePositiveNumber(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

/**
 * Effective config: system_settings overrides on top of the compiled
 * defaults. Never throws — a settings read failure logs and falls back
 * to defaults so pricing endpoints stay available.
 */
export async function getPricingConfig(): Promise<PricingConfig> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.config;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let config: PricingConfig = {
      usdToLyd: DEFAULT_USD_TO_LYD,
      markupPercent: DEFAULT_MARKUP_PERCENT,
    };
    try {
      const [rateRow, markupRow] = await Promise.all([
        db
          .select({ value: systemSettingsTable.value })
          .from(systemSettingsTable)
          .where(eq(systemSettingsTable.key, SETTING_KEY_USD_TO_LYD))
          .limit(1),
        db
          .select({ value: systemSettingsTable.value })
          .from(systemSettingsTable)
          .where(eq(systemSettingsTable.key, SETTING_KEY_MARKUP_PERCENT))
          .limit(1),
      ]);
      const rate = parsePositiveNumber(JSON.parse(rateRow[0]?.value ?? "null"));
      const markup = parsePositiveNumber(JSON.parse(markupRow[0]?.value ?? "null"));
      if (rate !== null) config = { ...config, usdToLyd: rate };
      if (markup !== null) config = { ...config, markupPercent: markup };
    } catch {
      // fall back to defaults — see docblock.
    }
    cache = { config, expiresAt: Date.now() + SETTINGS_TTL_MS };
    return config;
  })();

  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/**
 * Persist an override (admin settings UI). Values are validated here so
 * every writer goes through the same guard: positive, finite, and within
 * sane bounds (rate 0.1–1000; markup 0–10,000%).
 */
export async function savePricingConfig(
  patch: Partial<Pick<PricingConfig, "usdToLyd" | "markupPercent">>,
): Promise<PricingConfig> {
  const current = await getPricingConfig();
  const next: PricingConfig = { ...current };

  if (patch.usdToLyd !== undefined) {
    if (!Number.isFinite(patch.usdToLyd) || patch.usdToLyd < 0.1 || patch.usdToLyd > 1000) {
      throw new Error("INVALID_USD_TO_LYD");
    }
    next.usdToLyd = round2(patch.usdToLyd);
  }
  if (patch.markupPercent !== undefined) {
    if (
      !Number.isFinite(patch.markupPercent) ||
      patch.markupPercent < 0 ||
      patch.markupPercent > 10_000
    ) {
      throw new Error("INVALID_MARKUP_PERCENT");
    }
    next.markupPercent = round2(patch.markupPercent);
  }

  await db
    .insert(systemSettingsTable)
    .values({ key: SETTING_KEY_USD_TO_LYD, value: JSON.stringify(next.usdToLyd) })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: JSON.stringify(next.usdToLyd), updatedAt: new Date() },
    });
  await db
    .insert(systemSettingsTable)
    .values({ key: SETTING_KEY_MARKUP_PERCENT, value: JSON.stringify(next.markupPercent) })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: JSON.stringify(next.markupPercent), updatedAt: new Date() },
    });

  cache = { config: next, expiresAt: Date.now() + SETTINGS_TTL_MS };
  return next;
}

/** Test hook — drop the in-process cache between test cases. */
export function __resetPricingConfigCache(): void {
  cache = null;
  inFlight = null;
}

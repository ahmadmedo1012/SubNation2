/**
 * Fulfillment provider registry (R102).
 *
 * Resolves the active provider ONCE per purchase from the deployment-level
 * switch `FULFILLMENT_PROVIDER` (render.yaml env). Default: "manual" —
 * today's entire fulfillment model, and the fail-safe for any unknown or
 * missing value (an operator typo can never produce a null provider and
 * break checkout — the worst case is the current behavior).
 *
 * Deliberately NOT a system_settings key: the provider choice changes the
 * fulfillment SEMANTICS of the money path (which tables are written, what
 * a retry means) — that is a deployment concern, not a runtime setting a
 * dashboard flip should be able to change mid-flight.
 *
 * New providers register here and ONLY here — checkout, refund, and the
 * DTO layer stay provider-agnostic.
 */

import { logger } from "../../lib/logger";
import { manualProvider } from "./manual.provider";
import type { FulfillmentProvider } from "./types";

const PROVIDERS: ReadonlyMap<string, FulfillmentProvider> = new Map([
  ["manual", manualProvider],
]);

/** Unknown/missing → manual (fail-safe to current behavior), with one loud log. */
export function getFulfillmentProvider(): FulfillmentProvider {
  const requested = (process.env.FULFILLMENT_PROVIDER ?? "manual").trim().toLowerCase();
  const provider = PROVIDERS.get(requested);
  if (!provider) {
    // Unknown provider id: fail-safe to manual. One warn per process per
    // id (no log spam on a hot money path) — the operator sees it in the
    // boot log and Render dashboard.
    logger.warn(
      { category: "monitoring", requested },
      `[providers] FULFILLMENT_PROVIDER='${requested}' is not registered — falling back to 'manual' (current behavior). Registered: [${[...PROVIDERS.keys()].join(", ")}]`,
    );
    return manualProvider;
  }
  return provider;
}

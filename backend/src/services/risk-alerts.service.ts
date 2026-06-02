/**
 * Risk-alerts wrapper (T012).
 *
 * Bridges critical risk events to the existing
 * `admin_alerts` infrastructure (Telegram bot + Discord
 * webhook via the existing `ALERTING_ENABLED` /
 * `DISCORD_WEBHOOK_URL` envs). Per spec §6.4 the alert
 * payload includes:
 *   - userId
 *   - eventType
 *   - top contributing features (Phase-3; empty in Phase 1/2)
 *   - one-click link to the investigation view
 *
 * No new alert channel is introduced (Constitution: defense
 * in depth via existing controls). Failures here do NOT
 * fail the scoring path — caller treats this as fire-and-
 * forget.
 */

import { db, adminAlertsTable } from "@workspace/db";

import { logger } from "../lib/logger";
import {
  recordAlertDelivery,
  recordAlertSent,
  riskAlertDeliveryFailedTotal,
} from "../lib/risk-metrics";
import { alertingService, type AlertEvent } from "./alerting.service";

export interface CriticalAlertInput {
  riskEventId: number;
  userId: number | null;
  eventType: string;
  score: number;
  level: "critical";
  topFeatures?: Array<{ feature: string; shap: number; description: string }> | null;
}

const APP_ORIGIN = (process.env.APP_ORIGIN ?? "").replace(/\/+$/, "");

function buildInvestigationUrl(riskEventId: number): string {
  if (APP_ORIGIN) return `${APP_ORIGIN}/admin/risk/events/${riskEventId}`;
  return `/admin/risk/events/${riskEventId}`;
}

/**
 * Send a critical alert. Non-blocking from the caller's
 * perspective: the caller awaits this promise but a delivery
 * failure does not propagate (we log + emit a metric and
 * resolve normally). The scoring path must never fail because
 * Telegram/Discord is down.
 */
export async function sendCriticalRiskAlert(input: CriticalAlertInput): Promise<void> {
  const startedAt = process.hrtime.bigint();
  const investigationUrl = buildInvestigationUrl(input.riskEventId);

  // 1. Persist a row in admin_alerts (always tries — the
  //    DB is the durable channel; Telegram/Discord are
  //    best-effort).
  try {
    await db.insert(adminAlertsTable).values({
      type: "risk",
      title: `Critical risk: ${input.eventType} (score ${input.score})`,
      message: JSON.stringify({
        riskEventId: input.riskEventId,
        userId: input.userId,
        eventType: input.eventType,
        score: input.score,
        topFeatures: input.topFeatures ?? [],
        investigationUrl,
      }),
    });
  } catch (err) {
    logger.warn(
      { err, riskEventId: input.riskEventId, category: "risk-alerts" },
      "[risk-alerts] admin_alerts insert failed",
    );
  }

  // 2. Best-effort dispatch to Telegram + Discord via the
  //    existing alerting service.
  try {
    const event: AlertEvent = {
      rule: "risk_critical_event",
      severity: "critical",
      value: input.score,
      threshold: 85,
      firedAt: new Date().toISOString(),
      labels: {
        rule: "risk_critical_event",
        severity: "critical",
        event_type: input.eventType,
        user_id: input.userId === null ? "anonymous" : String(input.userId),
      },
      dedupKey: `risk_critical|${input.riskEventId}`,
      summary: [
        `Critical risk event scored ${input.score}/100.`,
        `Event: ${input.eventType}`,
        `User: ${input.userId ?? "anonymous"}`,
        `Investigate: ${investigationUrl}`,
      ].join("\n"),
      runbookUrl: `${APP_ORIGIN}/docs/OPERATIONS_RUNBOOK.md#risk`,
    };
    const results = await alertingService.dispatchAlert(event);
    for (const r of results) {
      if (r.outcome === "delivered") {
        recordAlertSent(r.channel, "critical");
      } else if (r.outcome === "failed") {
        riskAlertDeliveryFailedTotal.inc({ channel: r.channel });
        logger.warn(
          { channel: r.channel, riskEventId: input.riskEventId, category: "risk-alerts" },
          "[risk-alerts] dispatch failed for channel",
        );
      }
    }
  } catch (err) {
    logger.warn(
      { err, riskEventId: input.riskEventId, category: "risk-alerts" },
      "[risk-alerts] dispatch threw — swallowed (scoring path must not fail)",
    );
  }

  const durationSec = Number(process.hrtime.bigint() - startedAt) / 1e9;
  recordAlertDelivery("aggregate", durationSec);
}

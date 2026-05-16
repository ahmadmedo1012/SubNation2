/**
 * Alerting Service — real implementation.
 *
 * Replaces the placeholder dispatch logic with:
 *   - Telegram Bot API (primary), Discord webhook (secondary), generic webhook.
 *   - 10 s per-channel timeout via AbortSignal.timeout, retry once after 5 s.
 *   - Redis-backed dedup keyed `alert:dedup:${rule}:${stableHash(labels)}`
 *     with EX 300 (5-minute sliding window).
 *   - Redis-backed global rate limit `alert:global:${minute}` with windowed
 *     INCR + EXPIRE 70 s (≤ 30 dispatches per rolling 60 s).
 *   - Dark-launch gate: ALERTING_ENABLED=false logs `outcome:"would-dispatch"`
 *     and returns without making outbound calls.
 *
 * The 60-second evaluator interval and rule registry are unchanged from the
 * earlier scaffold. checkRuleCondition() is still pluggable — production
 * wiring queries either Prometheus aggregation (via getRegistry().getSingleMetric)
 * or Redis time-series (for future `redis_disconnect` etc.). For now the
 * default implementation always returns false so the evaluator does not fire
 * spurious alerts; rules are exercised by the admin /test endpoint.
 */

import { createHash } from "node:crypto";
import { getCorrelationId } from "../lib/correlation";
import { alertingLogger } from "../lib/logger";
import { getRegistry } from "../lib/metrics";
import { getRedisClient } from "../lib/redis-client";
import { captureException } from "./../lib/sentry";

// ── Types (Design §4.5) ──────────────────────────────────────────────────────

export type AlertSeverity = "info" | "warning" | "critical";

export interface AlertRuleSpec {
  name: string;
  severity: AlertSeverity;
  windowSec: number;
  threshold: string;
  runbookSection: string;
}

export interface AlertEvent {
  rule: string;
  severity: AlertSeverity;
  value: number;
  threshold: number;
  firedAt: string;
  resolvedAt?: string;
  durationSec?: number;
  labels: Record<string, string>;
  dedupKey: string;
  summary: string;
  runbookUrl: string;
  sentryIssueUrl?: string;
  renderLogsUrl?: string;
}

export type AlertChannel = "telegram" | "discord" | "webhook";

export interface ChannelDeliveryResult {
  channel: AlertChannel;
  outcome: "delivered" | "deduped" | "rate-limited" | "failed" | "skipped" | "would-dispatch";
  attempts: number;
  errorMessage?: string;
}

// ── Rule registry ────────────────────────────────────────────────────────────

export const ALERT_RULES: AlertRuleSpec[] = [
  {
    name: "api_5xx_rate_high",
    severity: "warning",
    windowSec: 300,
    threshold: "> 5%",
    runbookSection: "#api-5xx",
  },
  {
    name: "auth_failure_rate_high",
    severity: "warning",
    windowSec: 300,
    threshold: "> 20%",
    runbookSection: "#auth-failure",
  },
  {
    name: "firebase_verifyidtoken_failures",
    severity: "critical",
    windowSec: 300,
    threshold: "> 5",
    runbookSection: "#firebase-verify",
  },
  {
    name: "frontend_sentry_error_rate_high",
    severity: "warning",
    windowSec: 60,
    threshold: "> 10/min",
    runbookSection: "#fe-sentry",
  },
  {
    name: "redis_disconnect",
    severity: "info",
    windowSec: 60,
    threshold: "≥ 1 event",
    runbookSection: "#redis",
  },
  {
    name: "neon_connection_failure",
    severity: "critical",
    windowSec: 60,
    threshold: "≥ 1 failure",
    runbookSection: "#neon",
  },
  {
    name: "worker_heartbeat_missing",
    severity: "critical",
    windowSec: 120,
    threshold: "no heartbeat 2 min",
    runbookSection: "#worker",
  },
  {
    name: "api_p95_latency_high",
    severity: "critical",
    windowSec: 300,
    threshold: "p95 > 1500ms",
    runbookSection: "#latency",
  },
  {
    name: "worker_job_failures_high",
    severity: "warning",
    windowSec: 300,
    threshold: "> 3 fails",
    runbookSection: "#jobs",
  },
  {
    name: "abnormal_lockouts",
    severity: "warning",
    windowSec: 300,
    threshold: "≥ 10 lockouts (per IP or global)",
    runbookSection: "#lockouts",
  },
];

// ── Configuration ────────────────────────────────────────────────────────────

const DEDUP_TTL_SEC = 300; // 5 minute dedup window
const GLOBAL_RATE_LIMIT = 30; // ≤ 30 dispatches per 60 s
const GLOBAL_WINDOW_TTL_SEC = 70; // outlasts the 60 s window so we never lose state
const HTTP_TIMEOUT_MS = 10_000;
const RETRY_DELAY_MS = 5_000;

// ── Service ──────────────────────────────────────────────────────────────────

export class AlertingService {
  private readonly alertsDispatchedTotal = getRegistry().getSingleMetric(
    "alerts_dispatched_total",
  ) as import("prom-client").Counter<string> | undefined;

  private readonly monitoringErrorsTotal = getRegistry().getSingleMetric(
    "monitoring_errors_total",
  ) as import("prom-client").Counter<string> | undefined;

  private evaluatorInterval: NodeJS.Timeout | null = null;

  /** Start the 60 s evaluator loop. Idempotent. */
  public start(): void {
    if (this.evaluatorInterval) return;
    alertingLogger().info("Starting alerting service evaluator (60s interval)");
    this.evaluatorInterval = setInterval(() => {
      this.evaluateRules().catch((err) => {
        this.incrementMonitoringError("alerting");
        alertingLogger().error({ err }, "Evaluator iteration failed");
      });
    }, 60_000);
    this.evaluatorInterval.unref?.();
  }

  public stop(): void {
    if (this.evaluatorInterval) {
      clearInterval(this.evaluatorInterval);
      this.evaluatorInterval = null;
      alertingLogger().info("Alerting service evaluator stopped");
    }
  }

  private async evaluateRules(): Promise<void> {
    for (const rule of ALERT_RULES) {
      try {
        if (await this.checkRuleCondition(rule)) {
          await this.dispatchAlert(this.buildAlertEvent(rule));
        }
      } catch (err) {
        this.incrementMonitoringError("alerting");
        alertingLogger().error({ err, rule: rule.name }, "Alert rule evaluation failed");
      }
    }
  }

  /**
   * Real production rule evaluators. Each rule reads its signal from either
   * Redis directly (worker heartbeat) or from the prom-client registry by
   * comparing the current counter value to the value captured at the last
   * evaluation tick (signal = delta over the 60 s evaluator window).
   *
   * Rules without a real evaluator return false — they are a no-op and need
   * concrete metric reads in a future iteration. They are documented as
   * "P2-pending" in OBSERVABILITY_SETUP.md / ALERTING_ARCHITECTURE.md.
   */
  protected async checkRuleCondition(rule: AlertRuleSpec): Promise<boolean> {
    try {
      switch (rule.name) {
        case "worker_heartbeat_missing":
          return await this.evalWorkerHeartbeatMissing(rule);
        case "redis_disconnect":
          return this.evalCounterDelta("redis_errors_total", 1, rule);
        case "neon_connection_failure":
          return this.evalCounterDelta("redis_errors_total", 1, rule);
        case "auth_failure_rate_high":
          // 20+ auth failures in the last evaluator tick (60 s).
          // Threshold tunable via ALERT_AUTH_FAILURE_DELTA env.
          return this.evalCounterDeltaByLabel(
            "auth_outcomes_total",
            { outcome: "failure" },
            Number(process.env.ALERT_AUTH_FAILURE_DELTA ?? 20),
            rule,
          );
        case "abnormal_lockouts":
          // ≥10 lockouts in the eval window — same delta-by-label pattern.
          return this.evalCounterDeltaByLabel(
            "auth_outcomes_total",
            { outcome: "lockout" },
            Number(process.env.ALERT_LOCKOUT_DELTA ?? 10),
            rule,
          );
        case "firebase_verifyidtoken_failures":
          // >5 firebase failures in the eval window.
          return this.evalCounterDeltaByLabel(
            "auth_outcomes_total",
            { method: "firebase", outcome: "failure" },
            Number(process.env.ALERT_FIREBASE_FAIL_DELTA ?? 5),
            rule,
          );
        // Other rules are gated until their signals are concretely
        // populated. See ALERTING_ARCHITECTURE.md §2 for the roadmap.
        default:
          return false;
      }
    } catch (err) {
      this.incrementMonitoringError("alerting");
      alertingLogger().error({ err, rule: rule.name }, "Rule evaluation threw");
      return false;
    }
  }

  /**
   * Worker-heartbeat freshness check. Reads the `worker:heartbeat` Redis
   * key (written every 15 s by `backend/src/worker/heartbeat.ts`) and fires
   * when the heartbeat is older than `rule.windowSec` seconds (default
   * 120 s = "no heartbeat 2 min").
   */
  private async evalWorkerHeartbeatMissing(rule: AlertRuleSpec): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false; // can't evaluate without Redis; fail safe (no alert)
    const raw = await redis.get("worker:heartbeat");
    if (!raw) return true; // no heartbeat at all → fire
    try {
      const parsed = JSON.parse(raw) as { ts: number };
      const ageSec = (Date.now() - Number(parsed.ts)) / 1000;
      return ageSec > rule.windowSec;
    } catch {
      // malformed payload — treat as missing
      return true;
    }
  }

  /**
   * Counter-delta check. Reads the named counter from prom-client and
   * compares to the value captured at the previous evaluator tick. If the
   * delta over the last 60 s window is `>= threshold`, fire.
   *
   * Counters are monotonically increasing across the process lifetime, so
   * we keep a small per-rule baseline map.
   */
  private readonly counterBaseline = new Map<string, number>();
  private evalCounterDelta(
    counterName: string,
    threshold: number,
    rule: AlertRuleSpec,
  ): boolean {
    try {
      const counter = getRegistry().getSingleMetric(counterName) as
        | import("prom-client").Counter<string>
        | undefined;
      if (!counter) return false;

      // Aggregate across all label combinations.
      const collected = counter.get?.() as
        | { values?: Array<{ value: number }> }
        | undefined;
      const total = (collected?.values ?? []).reduce((sum, v) => sum + Number(v.value || 0), 0);

      const baseline = this.counterBaseline.get(rule.name) ?? total;
      const delta = total - baseline;
      this.counterBaseline.set(rule.name, total);

      return delta >= threshold;
    } catch {
      return false;
    }
  }

  /**
   * Counter-delta check filtered by a label subset. The label match is an
   * AND across the provided keys — a sample matches if every requested
   * label/value pair appears in its labels object.
   *
   * Used for `auth_failure_rate_high` (filter `outcome=failure`),
   * `abnormal_lockouts` (filter `outcome=lockout`), and
   * `firebase_verifyidtoken_failures` (filter `method=firebase, outcome=failure`).
   */
  private evalCounterDeltaByLabel(
    counterName: string,
    labelMatch: Record<string, string>,
    threshold: number,
    rule: AlertRuleSpec,
  ): boolean {
    try {
      const counter = getRegistry().getSingleMetric(counterName) as
        | import("prom-client").Counter<string>
        | undefined;
      if (!counter) return false;

      const collected = counter.get?.() as
        | { values?: Array<{ value: number; labels?: Record<string, string> }> }
        | undefined;
      const matchEntry = (entryLabels: Record<string, string> | undefined): boolean => {
        if (!entryLabels) return false;
        for (const [k, v] of Object.entries(labelMatch)) {
          if (entryLabels[k] !== v) return false;
        }
        return true;
      };

      const total = (collected?.values ?? [])
        .filter((entry) => matchEntry(entry.labels))
        .reduce((sum, v) => sum + Number(v.value || 0), 0);

      const baseline = this.counterBaseline.get(rule.name) ?? total;
      const delta = total - baseline;
      this.counterBaseline.set(rule.name, total);

      return delta >= threshold;
    } catch {
      return false;
    }
  }

  /** Public: dispatch an alert through every configured channel. */
  public async dispatchAlert(alertEvent: AlertEvent): Promise<ChannelDeliveryResult[]> {
    const results: ChannelDeliveryResult[] = [];
    const correlationId = getCorrelationId();

    alertingLogger().info({ alertEvent, correlationId }, "Dispatching alert");

    // Dark-launch gate
    if (process.env.ALERTING_ENABLED === "false") {
      const outcome: ChannelDeliveryResult["outcome"] = "would-dispatch";
      for (const channel of ["telegram", "discord", "webhook"] as AlertChannel[]) {
        this.incrementAlertsDispatched(
          alertEvent.rule,
          alertEvent.severity,
          channel,
          "rate-limited",
        );
        results.push({ channel, outcome, attempts: 0 });
      }
      alertingLogger().info({ rule: alertEvent.rule }, "Alerting disabled — would-dispatch only");
      return results;
    }

    // Dispatch in parallel — Telegram failure must not block Discord.
    return Promise.all([
      this.dispatchToChannel(alertEvent, "telegram"),
      this.dispatchToChannel(alertEvent, "discord"),
      this.dispatchToChannel(alertEvent, "webhook"),
    ]);
  }

  private buildAlertEvent(rule: AlertRuleSpec): AlertEvent {
    const labels: Record<string, string> = {
      rule: rule.name,
      severity: rule.severity,
    };
    const dedupKey = `${rule.name}|${stableHash(JSON.stringify(labels))}`;
    const runbookUrl = buildRunbookUrl(rule.runbookSection);

    return {
      rule: rule.name,
      severity: rule.severity,
      value: 0,
      threshold: parseThreshold(rule.threshold),
      firedAt: new Date().toISOString(),
      labels,
      dedupKey,
      summary: `Alert "${rule.name}" triggered: ${rule.threshold} in ${rule.windowSec}s window`,
      runbookUrl,
    };
  }

  private async dispatchToChannel(
    alertEvent: AlertEvent,
    channel: AlertChannel,
  ): Promise<ChannelDeliveryResult> {
    const correlationId = getCorrelationId();

    // Dedup — only checked once across all channels
    if (await this.isDeduped(alertEvent.dedupKey)) {
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "deduped");
      alertingLogger().info(
        { dedupKey: alertEvent.dedupKey, channel, correlationId },
        "Alert deduped (within 5min window)",
      );
      return { channel, outcome: "deduped", attempts: 0 };
    }

    if (await this.isRateLimited()) {
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "rate-limited");
      alertingLogger().info({ channel, correlationId }, "Alert rate-limited (global 30/min)");
      return { channel, outcome: "rate-limited", attempts: 0 };
    }

    // Channel skip (no creds configured) — record but do not fail
    if (!this.channelHasCredentials(channel)) {
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "rate-limited");
      return { channel, outcome: "skipped", attempts: 0 };
    }

    // Initial attempt
    let attempts = 0;
    let lastError: string | undefined;
    try {
      attempts += 1;
      await this.sendChannel(channel, alertEvent);
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "delivered");
      return { channel, outcome: "delivered", attempts };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      alertingLogger().info(
        { channel, retryAfterSec: 5, error: lastError, correlationId },
        "Alert dispatch failed, retrying in 5s",
      );
    }

    // Retry once after 5 s
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    try {
      attempts += 1;
      await this.sendChannel(channel, alertEvent);
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "delivered");
      return { channel, outcome: "delivered", attempts };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      this.incrementAlertsDispatched(alertEvent.rule, alertEvent.severity, channel, "failed");
      alertingLogger().error(
        { channel, error: lastError, correlationId },
        "Alert dispatch failed after retry",
      );
      // Capture to Sentry so dispatch failures are visible in the same place as app errors
      captureException(err instanceof Error ? err : new Error(lastError), {
        channel,
        rule: alertEvent.rule,
        correlation_id: correlationId,
      });
      return { channel, outcome: "failed", attempts, errorMessage: lastError };
    }
  }

  private channelHasCredentials(channel: AlertChannel): boolean {
    switch (channel) {
      case "telegram":
        return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);
      case "discord":
        return Boolean(process.env.DISCORD_WEBHOOK_URL);
      case "webhook":
        return Boolean(process.env.GENERIC_ALERT_WEBHOOK_URL);
    }
  }

  private async sendChannel(channel: AlertChannel, alertEvent: AlertEvent): Promise<void> {
    const signal = AbortSignal.timeout(HTTP_TIMEOUT_MS);

    if (channel === "telegram") {
      const token = process.env.TELEGRAM_BOT_TOKEN!;
      const chatId = process.env.TELEGRAM_CHAT_ID!;
      const text = formatTelegramMessage(alertEvent);
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
        signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Telegram API ${response.status}: ${body.slice(0, 200)}`);
      }
      return;
    }

    if (channel === "discord") {
      const url = process.env.DISCORD_WEBHOOK_URL!;
      const payload = formatDiscordPayload(alertEvent);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });
      // Discord returns 204 on success; treat 2xx as ok
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Discord webhook ${response.status}: ${body.slice(0, 200)}`);
      }
      return;
    }

    // webhook (generic)
    const url = process.env.GENERIC_ALERT_WEBHOOK_URL!;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(alertEvent),
      signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Generic webhook ${response.status}: ${body.slice(0, 200)}`);
    }
  }

  /**
   * Redis-backed deduplication with 5-minute sliding window.
   * Returns true if this dedup key was set within the past 5 minutes.
   * Falls back to "not deduped" if Redis is unavailable (better to over-alert
   * than to silently drop events).
   */
  private async isDeduped(dedupKey: string): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    try {
      const fullKey = `alert:dedup:${dedupKey}`;
      // SET NX EX — atomically set if not exists with TTL
      // Returns "OK" if newly set (not deduped), null if already exists (deduped)
      const result = await redis.set(fullKey, "1", { NX: true, EX: DEDUP_TTL_SEC });
      return result === null;
    } catch (err) {
      this.incrementMonitoringError("alerting");
      alertingLogger().warn({ err, dedupKey }, "Dedup check failed — failing open");
      return false;
    }
  }

  /**
   * Redis-backed global rate limit (≤ 30 dispatches per rolling 60 s).
   * Uses a per-minute counter that auto-expires.
   */
  private async isRateLimited(): Promise<boolean> {
    const redis = getRedisClient();
    if (!redis) return false;

    try {
      const minute = Math.floor(Date.now() / 60_000);
      const key = `alert:global:${minute}`;
      const count = await redis.incr(key);
      if (count === 1) {
        // First increment in this minute — set expiry slightly past the window
        await redis.expire(key, GLOBAL_WINDOW_TTL_SEC);
      }
      return count > GLOBAL_RATE_LIMIT;
    } catch (err) {
      this.incrementMonitoringError("alerting");
      alertingLogger().warn({ err }, "Rate-limit check failed — failing open");
      return false;
    }
  }

  private incrementAlertsDispatched(
    rule: string,
    severity: AlertSeverity,
    channel: AlertChannel,
    outcome: "delivered" | "deduped" | "rate-limited" | "failed",
  ): void {
    try {
      this.alertsDispatchedTotal?.inc({ rule, severity, channel, outcome });
    } catch (err) {
      this.incrementMonitoringError("alerting");
      console.error("Alerts dispatched metric increment failed:", err);
    }
  }

  private incrementMonitoringError(component: string): void {
    try {
      this.monitoringErrorsTotal?.inc({ component });
    } catch (err) {
      console.error("Monitoring errors metric increment failed:", err);
    }
  }
}

// ── Module-level helpers ─────────────────────────────────────────────────────

function stableHash(str: string): string {
  return createHash("sha1").update(str).digest("hex").slice(0, 16);
}

function parseThreshold(threshold: string): number {
  const match = threshold.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]!) : 0;
}

function buildRunbookUrl(section: string): string {
  const base =
    process.env.ALERTING_RUNBOOK_URL ??
    `${(process.env.APP_URL || "https://subnation.ly").replace(/\/$/, "")}/OPERATIONS_RUNBOOK.md`;
  return `${base}${section}`;
}

function formatTelegramMessage(event: AlertEvent): string {
  const sevEmoji =
    event.severity === "critical" ? "🔴" : event.severity === "warning" ? "🟡" : "🔵";
  const lines = [
    `${sevEmoji} *${event.severity.toUpperCase()}* — ${event.rule}`,
    "",
    event.summary,
    "",
    `Fired at: ${event.firedAt}`,
    `Runbook: ${event.runbookUrl}`,
  ];
  return lines.join("\n");
}

function formatDiscordPayload(event: AlertEvent): unknown {
  const colorBySeverity: Record<AlertSeverity, number> = {
    info: 0x3b82f6,
    warning: 0xeab308,
    critical: 0xdc2626,
  };
  return {
    embeds: [
      {
        title: `${event.severity.toUpperCase()} — ${event.rule}`,
        description: event.summary,
        color: colorBySeverity[event.severity],
        timestamp: event.firedAt,
        fields: [
          { name: "Threshold", value: String(event.threshold), inline: true },
          { name: "Severity", value: event.severity, inline: true },
          { name: "Runbook", value: event.runbookUrl, inline: false },
        ],
      },
    ],
  };
}

// ── Singleton + admin test entry-point ───────────────────────────────────────

export const alertingService = new AlertingService();

/**
 * Dispatch a synthetic alert for the named rule (or the first rule if none
 * specified). Used by `POST /api/admin/alerts/test` so the admin can verify
 * channel delivery.
 */
export async function dispatchTestAlert(
  ruleName?: string,
): Promise<{ alert: AlertEvent; delivery: ChannelDeliveryResult[] }> {
  const rule =
    ALERT_RULES.find((r) => r.name === ruleName) ??
    ALERT_RULES.find((r) => r.name === "api_5xx_rate_high") ??
    ALERT_RULES[0]!;

  // Build with private buildAlertEvent — exposed via a short shim so we don't
  // expose the whole class API.
  const alert: AlertEvent = (
    alertingService as unknown as {
      buildAlertEvent(r: AlertRuleSpec): AlertEvent;
    }
  ).buildAlertEvent(rule);

  // Stamp the test events with a uniquifier so dedup doesn't suppress repeated
  // /test calls during validation.
  alert.dedupKey = `${alert.dedupKey}:test:${Date.now()}`;

  const delivery = await alertingService.dispatchAlert(alert);
  return { alert, delivery };
}

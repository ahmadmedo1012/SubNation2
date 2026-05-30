import { describe, expect, it } from "vitest";
import {
  ALERT_RULES,
  buildRunbookUrl,
  formatDiscordPayload,
  formatTelegramMessage,
  redactSensitive,
  type AlertEvent,
} from "../alerting.service";

function eventFor(ruleName: string, summary: string): AlertEvent {
  const rule = ALERT_RULES.find((r) => r.name === ruleName)!;
  return {
    rule: rule.name,
    severity: rule.severity,
    value: 1,
    threshold: 1,
    firedAt: new Date().toISOString(),
    labels: { rule: rule.name, severity: rule.severity },
    dedupKey: `${rule.name}|test`,
    summary,
    runbookUrl: buildRunbookUrl(rule.runbookSection),
  };
}

describe("redactSensitive", () => {
  it("masks postgres/redis connection strings", () => {
    const out = redactSensitive("db down: postgresql://user:p4ss@ep-x.neon.tech/db?sslmode=require");
    expect(out).not.toContain("p4ss");
    expect(out).not.toContain("neon.tech");
    expect(out).toContain("[REDACTED:conn-string]");
  });

  it("masks JWTs and Bearer tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjQyfQ.s3cr3tSignatureXYZ123";
    expect(redactSensitive(`token ${jwt}`)).toContain("[REDACTED:jwt]");
    expect(redactSensitive("Authorization: Bearer abcDEF123456789")).toContain("[REDACTED:bearer]");
  });

  it("masks telegram bot tokens and secret key=value pairs", () => {
    expect(redactSensitive("bot 123456789:AAFakeTokenValue_thatislongenough123456")).toContain(
      "[REDACTED:telegram-token]",
    );
    expect(redactSensitive("SESSION_SECRET=supersecretvalue123")).toContain("[REDACTED:secret-kv]");
    expect(redactSensitive('"password": "hunter2hunter2"')).toContain("[REDACTED:secret-kv]");
  });

  it("masks wallet/balance figures", () => {
    const out = redactSensitive("user wallet_balance=1500.00 lifetime_spend=9999.99");
    expect(out).not.toContain("1500.00");
    expect(out).not.toContain("9999.99");
    expect(out).toContain("[REDACTED:wallet]");
  });

  it("leaves clean operational text untouched", () => {
    const clean = 'Alert "neon_connection_failure" triggered: >= 1 failure in 60s window';
    expect(redactSensitive(clean)).toBe(clean);
  });
});

describe("runbook correlation", () => {
  it("every rule's runbook URL points at OPERATIONS_RUNBOOK.md with its section anchor", () => {
    for (const rule of ALERT_RULES) {
      const url = buildRunbookUrl(rule.runbookSection);
      expect(url).toContain("OPERATIONS_RUNBOOK.md");
      expect(url.endsWith(rule.runbookSection)).toBe(true);
    }
  });
});

describe("critical alert payloads (simulated DB disconnect)", () => {
  it("telegram payload carries severity, rule, summary, and the #neon runbook link", () => {
    const event = eventFor("neon_connection_failure", "Neon connection failed (>= 1 failure)");
    const text = formatTelegramMessage(event);
    expect(text).toContain("CRITICAL");
    expect(text).toContain("neon_connection_failure");
    expect(text).toContain("Neon connection failed");
    expect(text).toContain("OPERATIONS_RUNBOOK.md#neon");
  });

  it("redacts a secret accidentally folded into the summary — telegram + discord", () => {
    const leaky = "Neon down: postgresql://admin:leakedpw@ep.neon.tech/db";
    const event = eventFor("neon_connection_failure", leaky);

    const tg = formatTelegramMessage(event);
    expect(tg).not.toContain("leakedpw");
    expect(tg).toContain("[REDACTED:conn-string]");

    const dc = formatDiscordPayload(event) as { embeds: Array<{ description: string }> };
    expect(dc.embeds[0].description).not.toContain("leakedpw");
    expect(dc.embeds[0].description).toContain("[REDACTED:conn-string]");
  });
});

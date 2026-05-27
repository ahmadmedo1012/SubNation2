import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import {
  signTelegramFixture,
  signTelegramWebAppFixture,
  TELEGRAM_AUTH_FRESHNESS_SEC,
  TELEGRAM_WEBAPP_FRESHNESS_SEC,
  verifyTelegramAuth,
  verifyTelegramWebAppData,
} from "../telegram-auth";

const BOT_TOKEN = "1234567890:AAH-test-bot-token-not-real-do-not-reuse";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

describe("verifyTelegramAuth", () => {
  describe("happy paths", () => {
    it("accepts a valid, fresh payload", () => {
      const auth_date = nowSec();
      const payload = signTelegramFixture(
        {
          id: 987654321,
          first_name: "Ahmed",
          last_name: "Hassan",
          username: "ahmed_test",
          photo_url: "https://t.me/i/userpic/abc.jpg",
          auth_date,
        },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fields.id).toBe("987654321");
        expect(result.fields.first_name).toBe("Ahmed");
        expect(result.fields.last_name).toBe("Hassan");
        expect(result.fields.username).toBe("ahmed_test");
        expect(result.fields.photo_url).toBe("https://t.me/i/userpic/abc.jpg");
        expect(result.fields.auth_date).toBe(String(auth_date));
        expect(result.fields.hash).toBe(payload.hash);
      }
    });

    it("accepts a payload with only required fields (no name/photo)", () => {
      const payload = signTelegramFixture(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fields.first_name).toBeUndefined();
        expect(result.fields.username).toBeUndefined();
      }
    });

    it("ignores a passed-in referralCode field — verification still succeeds", () => {
      // The frontend POSTs `referralCode` alongside the widget data.
      // verifyTelegramAuth must EXCLUDE referralCode from the
      // check-string, otherwise the hash check would fail every time
      // a referral is supplied.
      const auth_date = nowSec();
      const payload = signTelegramFixture(
        { id: 123, auth_date },
        BOT_TOKEN,
      );
      const withReferral = { ...payload, referralCode: "FRIEND01" };

      const result = verifyTelegramAuth(withReferral, BOT_TOKEN);

      expect(result.ok).toBe(true);
    });
  });

  describe("signature failures", () => {
    it("rejects a payload signed with a different bot token", () => {
      const payload = signTelegramFixture(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, "0000000:wrong-token");

      expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });

    it("rejects a payload where any verified field was tampered with", () => {
      const payload = signTelegramFixture(
        { id: 1, first_name: "Ahmed", auth_date: nowSec() },
        BOT_TOKEN,
      );
      const tampered = { ...payload, id: "2" }; // change id, keep hash

      const result = verifyTelegramAuth(tampered, BOT_TOKEN);

      expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });

    it("rejects a payload with a corrupted hash", () => {
      const payload = signTelegramFixture(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );
      const corrupted = {
        ...payload,
        hash: "0".repeat(payload.hash.length),
      };

      const result = verifyTelegramAuth(corrupted, BOT_TOKEN);

      expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });

    it("rejects a payload with a non-hex hash", () => {
      const result = verifyTelegramAuth(
        { id: 1, auth_date: nowSec(), hash: "not-a-hex-string-at-all" },
        BOT_TOKEN,
      );

      expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });
  });

  describe("missing-field failures", () => {
    it("rejects null / undefined / non-object", () => {
      expect(verifyTelegramAuth(null, BOT_TOKEN)).toEqual({
        ok: false,
        reason: "missing_hash",
      });
      expect(verifyTelegramAuth(undefined, BOT_TOKEN)).toEqual({
        ok: false,
        reason: "missing_hash",
      });
    });

    it("rejects a payload with no hash", () => {
      const result = verifyTelegramAuth(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );

      expect(result).toEqual({ ok: false, reason: "missing_hash" });
    });

    it("rejects a payload with no id", () => {
      const result = verifyTelegramAuth(
        { auth_date: nowSec(), hash: "abcd" },
        BOT_TOKEN,
      );

      expect(result).toEqual({ ok: false, reason: "missing_id" });
    });

    it("rejects an empty bot token", () => {
      const payload = signTelegramFixture(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, "");

      expect(result).toEqual({ ok: false, reason: "bad_signature" });
    });
  });

  describe("freshness window", () => {
    it("accepts a payload exactly at the boundary (now - freshness)", () => {
      const now = 2_000_000_000; // fixed virtual time for determinism
      const payload = signTelegramFixture(
        { id: 1, auth_date: now - TELEGRAM_AUTH_FRESHNESS_SEC },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN, { nowSec: now });

      expect(result.ok).toBe(true);
    });

    it("rejects a payload one second past the boundary", () => {
      const now = 2_000_000_000;
      const payload = signTelegramFixture(
        { id: 1, auth_date: now - TELEGRAM_AUTH_FRESHNESS_SEC - 1 },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN, { nowSec: now });

      expect(result).toEqual({ ok: false, reason: "stale_auth_date" });
    });

    it("rejects a payload with auth_date=0", () => {
      const now = 2_000_000_000;
      const payload = signTelegramFixture({ id: 1, auth_date: 0 }, BOT_TOKEN);

      const result = verifyTelegramAuth(payload, BOT_TOKEN, { nowSec: now });

      expect(result).toEqual({ ok: false, reason: "stale_auth_date" });
    });

    it("rejects a payload with non-numeric auth_date", () => {
      const payload = signTelegramFixture(
        { id: 1, auth_date: "yesterday" },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN);

      expect(result).toEqual({ ok: false, reason: "stale_auth_date" });
    });

    it("respects a custom freshnessSec override (test convenience)", () => {
      const now = 2_000_000_000;
      // 1 hour ago — well past the default 30-minute window.
      const payload = signTelegramFixture(
        { id: 1, auth_date: now - 3600 },
        BOT_TOKEN,
      );

      // Default window — should reject.
      expect(verifyTelegramAuth(payload, BOT_TOKEN, { nowSec: now })).toEqual({
        ok: false,
        reason: "stale_auth_date",
      });

      // Custom 2-hour window — should accept.
      const result = verifyTelegramAuth(payload, BOT_TOKEN, {
        nowSec: now,
        freshnessSec: 7200,
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("type coercion / robustness", () => {
    it("coerces numeric id to string in the fields output", () => {
      const payload = signTelegramFixture(
        { id: 42, auth_date: nowSec() },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Stored as string for the `users.telegram_id varchar(255)` column.
        expect(typeof result.fields.id).toBe("string");
        expect(result.fields.id).toBe("42");
      }
    });

    it("does not include null/undefined optional fields in the output", () => {
      const auth_date = nowSec();
      // Only required fields signed.
      const payload = signTelegramFixture(
        { id: 1, auth_date },
        BOT_TOKEN,
      );

      const result = verifyTelegramAuth(payload, BOT_TOKEN);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.fields.first_name).toBeUndefined();
        expect(result.fields.photo_url).toBeUndefined();
      }
    });
  });
});

describe("verifyTelegramWebAppData", () => {
  describe("happy paths", () => {
    it("accepts a fresh, well-formed initData payload", () => {
      const auth_date = nowSec();
      const initData = signTelegramWebAppFixture(
        {
          user: {
            id: 987654321,
            first_name: "Ahmed",
            username: "ahmed_test",
            photo_url: "https://t.me/i/userpic/abc.jpg",
          },
          auth_date,
          query_id: "AAHdF6IQAAAAAN0XohBOKJjL",
        },
        BOT_TOKEN,
      );

      const result = verifyTelegramWebAppData(initData, BOT_TOKEN);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.user.id).toBe("987654321");
        expect(result.user.first_name).toBe("Ahmed");
        expect(result.user.username).toBe("ahmed_test");
        expect(result.auth_date).toBe(String(auth_date));
      }
    });

    it("normalises numeric ids to strings (matches users.telegram_id column)", () => {
      const initData = signTelegramWebAppFixture(
        { user: { id: 123 }, auth_date: nowSec() },
        BOT_TOKEN,
      );
      const result = verifyTelegramWebAppData(initData, BOT_TOKEN);
      expect(result.ok).toBe(true);
      if (result.ok) expect(typeof result.user.id).toBe("string");
    });
  });

  describe("failure modes", () => {
    it("rejects a missing initData", () => {
      const result = verifyTelegramWebAppData("", BOT_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_init_data");
    });

    it("rejects when the hash is missing", () => {
      const initData = "user=%7B%22id%22%3A1%7D&auth_date=" + nowSec();
      const result = verifyTelegramWebAppData(initData, BOT_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_hash");
    });

    it("rejects when the user field is missing", () => {
      // Hand-build a payload with a valid hash but no `user` field.
      const params = new URLSearchParams();
      params.set("auth_date", String(nowSec()));
      const keys = Array.from(params.keys()).sort();
      const checkString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");
      // Reproduce the WebApp secret derivation from the impl.
      const secretKey = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
      const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");
      params.set("hash", hash);
      const result = verifyTelegramWebAppData(params.toString(), BOT_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("missing_user");
    });

    it("rejects a tampered hash", () => {
      const initData = signTelegramWebAppFixture(
        { user: { id: 1 }, auth_date: nowSec() },
        BOT_TOKEN,
      );
      const tampered = initData.replace(/hash=[a-f0-9]+/, "hash=" + "0".repeat(64));
      const result = verifyTelegramWebAppData(tampered, BOT_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("bad_signature");
    });

    it("rejects a payload signed with a different bot token", () => {
      const initData = signTelegramWebAppFixture(
        { user: { id: 1 }, auth_date: nowSec() },
        BOT_TOKEN,
      );
      const result = verifyTelegramWebAppData(initData, "9999999999:other-bot-token");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("bad_signature");
    });

    it("rejects a stale auth_date past the freshness window", () => {
      const auth_date = nowSec() - (TELEGRAM_WEBAPP_FRESHNESS_SEC + 5);
      const initData = signTelegramWebAppFixture(
        { user: { id: 1 }, auth_date },
        BOT_TOKEN,
      );
      const result = verifyTelegramWebAppData(initData, BOT_TOKEN);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("stale_auth_date");
    });
  });

  describe("algorithm correctness", () => {
    it("rejects a Login-Widget-signed payload (proves the WebApp key swap is correct)", () => {
      // The Login Widget uses secretKey = SHA256(botToken).
      // The Mini App  uses secretKey = HMAC_SHA256("WebAppData", botToken).
      // A widget-signed payload MUST NOT verify as a WebApp payload.
      const widgetPayload = signTelegramFixture(
        { id: 1, auth_date: nowSec() },
        BOT_TOKEN,
      );
      const widgetAsInitData = new URLSearchParams(
        Object.entries(widgetPayload).map(([k, v]) => [k, String(v)]),
      ).toString();
      const result = verifyTelegramWebAppData(widgetAsInitData, BOT_TOKEN);
      expect(result.ok).toBe(false);
    });

    it("does not advertise the standalone TELEGRAM_AUTH_FRESHNESS_SEC for WebApp", () => {
      // Sanity: the two windows are independent constants.
      expect(TELEGRAM_WEBAPP_FRESHNESS_SEC).toBeGreaterThan(TELEGRAM_AUTH_FRESHNESS_SEC);
    });
  });
});

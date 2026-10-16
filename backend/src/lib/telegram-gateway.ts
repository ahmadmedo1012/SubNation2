/**
 * Telegram Bot API helpers for the approval-gateway webhook.
 *
 * Ported from the smart-menu implementation (src/lib/telegram-api.ts),
 * adapted to Express. Every call is timeout-guarded and never throws —
 * Telegram delivery failures must not break app request flows.
 *
 * R153 (Priority 2 hardening): apiCall now inspects BOTH the HTTP status
 * AND the Telegram JSON body. Telegram can answer HTTP 200 with
 * {ok:false, error_code, description} (e.g. "message is not modified",
 * "query is too old and response timeout expired") — the previous
 * version logged only network-level failures and treated every HTTP 200
 * as success, so a silently-failed card edit or callback answer was
 * indistinguishable from a delivered one. Failures are now classified:
 *
 *   - BENIGN   ("message is not modified" / "query is too old…") — the
 *     edit was already applied by a concurrent delivery (a Telegram
 *     webhook retry or an operator double-tap), or the callback answer
 *     window expired while another delivery had already answered it.
 *     These are the idempotent-collision fingerprints: the desired state
 *     was reached, just not by this call. Logged at debug — they are
 *     expected under normal retries, and warning on them would train
 *     operators to ignore the warn channel.
 *   - FAILURE  (anything else: bad token, chat not found, message too
 *     long, parse errors) — logged at warn with the method + error_code
 *     + description, so a failed money-card update is observable without
 *     ever rolling back or re-crediting the committed transaction.
 */
import { logger } from "./logger";

/**
 * Telegram's documented responses for calls whose effect already happened
 * (or whose answer window closed) before this call landed. Substrings, not
 * exact matches — Telegram phrases vary slightly across API revisions.
 */
const BENIGN_ERROR_PATTERNS = ["message is not modified", "query is too old", "QUERY_ID_INVALID"];

function isBenignTelegramError(description: string): boolean {
  return BENIGN_ERROR_PATTERNS.some((p) => description.includes(p));
}

interface TelegramApiBody {
  ok?: boolean;
  error_code?: number;
  description?: string;
}

async function apiCall(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // R153: parse the body — the HTTP layer alone cannot tell a delivered
    // call from a rejected one (200 + {ok:false} is Telegram's documented
    // error shape). json() failure falls through to the HTTP-status check.
    const apiBody = (await response.json().catch(() => null)) as TelegramApiBody | null;

    if (!response.ok) {
      logger.warn(
        {
          method,
          status: response.status,
          description: apiBody?.description,
          category: "telegram",
        },
        "[telegram-gateway] api call rejected (http)",
      );
      return;
    }
    if (apiBody?.ok === false) {
      const description = apiBody.description ?? "unknown description";
      if (isBenignTelegramError(description)) {
        logger.debug(
          { method, error_code: apiBody.error_code, description, category: "telegram" },
          "[telegram-gateway] api call benign collision (already applied by a concurrent delivery)",
        );
      } else {
        logger.warn(
          { method, error_code: apiBody.error_code, description, category: "telegram" },
          "[telegram-gateway] api call rejected (telegram ok:false)",
        );
      }
      return;
    }
    logger.debug({ method, category: "telegram" }, "[telegram-gateway] api call ok");
  } catch (err) {
    logger.warn({ err, method }, "[telegram-gateway] api call failed");
  } finally {
    clearTimeout(timeout);
  }
}

export async function editMessageReplyMarkup(
  botToken: string,
  chatId: number,
  messageId: number,
): Promise<void> {
  await apiCall(botToken, "editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function editMessageText(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  await apiCall(botToken, "editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
  });
}

export async function answerCallbackQuery(
  botToken: string,
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  await apiCall(botToken, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text, show_alert: showAlert } : {}),
  });
}

export function getBotToken(): string | null {
  return (process.env.TELEGRAM_BOT_TOKEN ?? "").trim() || null;
}

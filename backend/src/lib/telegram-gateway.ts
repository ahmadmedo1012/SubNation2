/**
 * Telegram Bot API helpers for the approval-gateway webhook.
 *
 * Ported from the smart-menu implementation (src/lib/telegram-api.ts),
 * adapted to Express. Every call is timeout-guarded and never throws —
 * Telegram delivery failures must not break app request flows.
 */
import { logger } from "./logger";

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
}

async function apiCall(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
): Promise<Response | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    return await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    logger.warn({ err, method }, "[telegram-gateway] api call failed");
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Coerce numeric-looking strings to numbers (Telegram expects numeric IDs). */
function normalizeChatId(chatId: number | string): number | string {
  return typeof chatId === "string" && /^-?\d+$/.test(chatId) ? Number(chatId) : chatId;
}

export interface InlineButton {
  text: string;
  callbackData: string;
}

export async function sendMessageWithKeyboard(
  botToken: string,
  chatId: number | string,
  text: string,
  buttons: InlineButton[][],
): Promise<TelegramMessage | null> {
  try {
    const res = await apiCall(botToken, "sendMessage", {
      chat_id: normalizeChatId(chatId),
      text,
      reply_markup: {
        inline_keyboard: buttons.map((row) =>
          row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
        ),
      },
    });
    if (!res || !res.ok) {
      const err = res ? await res.text().catch(() => "") : "aborted";
      logger.warn({ chatId, err: err.slice(0, 300) }, "[telegram-gateway] sendMessage failed");
      return null;
    }
    return (await res.json()) as TelegramMessage;
  } catch (err) {
    logger.warn({ err }, "[telegram-gateway] sendMessage threw");
    return null;
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

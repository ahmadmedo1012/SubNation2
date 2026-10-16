/**
 * Telegram pending-topup card identity store + settlement (R153).
 *
 * THE PROBLEM THIS MODULE CLOSES: the operator chat receives ONE pending
 * card per manual topup («طلب شحن جديد … ⏳ بانتظار الموافقة» with the
 * ✅/❌ inline buttons). When the topup was finalized through the ADMIN
 * WEBSITE (or the automated gateway path), the website had no way to edit
 * that card — the buttons stayed live until SOMEONE tapped one and hit the
 * stale branch. The production report that opened R153 ("operator presses
 * Approve, gets «تمت معالجة هذا الطلب مسبقاً»") is partly operators
 * tapping exactly those stale buttons.
 *
 * THE MECHANISM: when notifyNewTopup dispatches the pending card, the
 * sendMessage response's message_id is captured here, keyed by topup id
 * (TTL 30d — far beyond any topup's operator-relevant lifetime). When
 * TopupService.approve/reject commits from ANY path, settleTopupCard
 * loads the identity, claims the key (GET+DEL — idempotent under racing
 * callers), appends the outcome line to the stored card text and strips
 * the keyboard. The Telegram webhook's own edits (same final text, from
 * cq.message.text) remain as the immediate path; whichever call lands
 * second gets Telegram's benign "message is not modified" — classified
 * benign by lib/telegram-gateway.ts.
 *
 * FAILURE SEMANTICS (same family as every other Telegram concern):
 * Redis unavailable / key expired / Bot API failure → skip or warn, never
 * throw, never touch money. The webhook's truthful stale-branch remains
 * the safety net for any card this best-effort path misses.
 */
import { getRedisClient, withRedisCommandTimeout } from "./redis-client";
import { logger } from "./logger";
import { editMessageReplyMarkup, editMessageText, getBotToken } from "./telegram-gateway";

const KEY_PREFIX = "tg:topupcard:";
/** 30 days — a pending card older than this is unactionable anyway. */
const TTL_SECONDS = 30 * 24 * 60 * 60;

interface StoredCard {
  chatId: number;
  messageId: number;
  /** The exact card text as sent (settlement appends the outcome line). */
  text: string;
}

/**
 * Record a freshly-delivered pending card's identity. Best-effort: a miss
 * here only means the website path cannot proactively settle that card —
 * the webhook's stale-button branch still answers truthfully on a late tap.
 */
export async function recordTopupCard(
  topupId: number,
  chatId: number,
  messageId: number,
  text: string,
): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  try {
    await withRedisCommandTimeout("tg_topupcard_set", () =>
      client.set(
        KEY_PREFIX + topupId,
        JSON.stringify({ chatId, messageId, text } satisfies StoredCard),
        {
          EX: TTL_SECONDS,
        },
      ),
    );
  } catch (err) {
    logger.warn(
      { err, topupId, category: "telegram" },
      "[telegram-cards] record failed (card will settle only via the webhook stale branch)",
    );
  }
}

/**
 * Finalize the pending card for a topup: append the outcome line + strip
 * the keyboard. Fire-and-forget from the service's post-tx notification
 * section — a Telegram UI failure here must never propagate to the money
 * path that already committed.
 */
export async function settleTopupCard(topupId: number, outcomeLine: string): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  let raw: string | null = null;
  try {
    raw = await withRedisCommandTimeout("tg_topupcard_get", () => client.get(KEY_PREFIX + topupId));
  } catch (err) {
    logger.warn({ err, topupId, category: "telegram" }, "[telegram-cards] identity read failed");
    return;
  }
  if (!raw) return;

  // Claim-then-edit: racing settlers (the Telegram webhook's own edits +
  // this call) are idempotent by construction — the DEL loser skips. The
  // webhook path does not delete the key, so its benign double-edit is
  // absorbed by the gateway's not-modified classification; the DEL claim
  // guards against two service-side settles (e.g. a webhook retry whose
  // first delivery already settled).
  try {
    const deleted = await withRedisCommandTimeout("tg_topupcard_del", () =>
      client.del(KEY_PREFIX + topupId),
    );
    if (deleted !== 1) return;
  } catch (err) {
    logger.warn({ err, topupId, category: "telegram" }, "[telegram-cards] identity claim failed");
    return;
  }

  const botToken = getBotToken();
  if (!botToken) return;

  let card: StoredCard;
  try {
    card = JSON.parse(raw) as StoredCard;
  } catch {
    logger.warn({ topupId, category: "telegram" }, "[telegram-cards] stored card malformed");
    return;
  }
  if (
    typeof card.chatId !== "number" ||
    typeof card.messageId !== "number" ||
    typeof card.text !== "string"
  ) {
    logger.warn({ topupId, category: "telegram" }, "[telegram-cards] stored card shape invalid");
    return;
  }

  await editMessageText(botToken, card.chatId, card.messageId, card.text + outcomeLine);
  await editMessageReplyMarkup(botToken, card.chatId, card.messageId);
  logger.info(
    { topupId, messageId: card.messageId, category: "telegram" },
    "[telegram-cards] pending card settled (outcome stamped, keyboard stripped)",
  );
}

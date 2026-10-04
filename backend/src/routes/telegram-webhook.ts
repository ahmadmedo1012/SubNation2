/**
 * Telegram approval webhook — port of the smart-menu pattern, wired to
 * SubNation's wallet-topup approval flow.
 *
 * Mounted at /api/webhook/telegram (the "/api/webhook" prefix is already in
 * app.ts's CSRF skip list — Telegram cannot send Origin headers).
 *
 * Security gates, in order:
 *   1. Shared secret header (x-telegram-bot-api-secret-token) must match
 *      TELEGRAM_WEBHOOK_SECRET (constant-time compare).
 *   2. Callback actions require the tapping Telegram account to be in the
 *      TELEGRAM_ADMIN_IDS allowlist. Without this, ANY group member could
 *      move money.
 *
 * callback_data contract:  "topup_app:<id>" | "topup_rej:<id>"
 *
 * Bootstrap: sending plain "/start" to the bot replies with your numeric
 * chat/user IDs so they can be added to TELEGRAM_ADMIN_IDS.
 */
import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, walletTopupsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  answerCallbackQuery,
  editMessageReplyMarkup,
  editMessageText,
  getBotToken,
} from "../lib/telegram-gateway";

const router = Router();

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface TelegramUpdate {
  message?: {
    text?: string;
    chat?: { id: number; username?: string; type?: string };
    from?: { id: number; username?: string };
  };
  callback_query?: {
    id: string;
    from: { id: number; username?: string };
    message?: { chat: { id: number }; message_id: number; text?: string };
    data?: string;
  };
}

/** TELEGRAM_ADMIN_IDS allowlist (comma-separated numeric ids). */
function getAdminTelegramIds(): number[] {
  return (process.env.TELEGRAM_ADMIN_IDS ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/**
 * F2 (R98-A6, 98-F5): the /start bootstrap reply is the ONE awaited Telegram
 * call in this route — every sibling call goes through telegram-gateway's
 * 10 s AbortController, but this raw fetch had no timeout, so a slow
 * Telegram held the webhook handler open until httpServer.requestTimeout
 * (60 s) destroyed the socket; Telegram then registered a failed delivery
 * and re-posted the same update onto the endpoint that must stay cheap.
 *
 * Same 10 s AbortController + clearTimeout idiom as lib/telegram-gateway.ts
 * apiCall. The .catch stays — the reply is best-effort and must never
 * 5xx the webhook ack. Exported for tests (parseTopupCallback precedent).
 */
export async function replyWithStartIds(
  botToken: string,
  chatId: number,
  fromId?: number,
): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text:
          `مرحباً! 👋\n\nمعرّف المحادثة: \`${chatId}\`\n` +
          (fromId ? `معرّفك الشخصي: \`${fromId}\`\n` : "") +
          `\nأضف المعرّف الشخصي إلى متغير TELEGRAM_ADMIN_IDS للسماح بالموافقة/الرفض من هنا.`,
        parse_mode: "Markdown",
      }),
      signal: controller.signal,
    }).catch(() => undefined);
  } finally {
    clearTimeout(timeout);
  }
}

/** Pure parser (exported for tests): returns action+topupId or null. */
export function parseTopupCallback(
  data: string | undefined,
): { action: "approve" | "reject"; topupId: number } | null {
  if (!data) return null;
  const m = /^topup_(app|rej):(\d+)$/.exec(data);
  if (!m) return null;
  const id = Number(m[2]);
  if (!Number.isFinite(id) || id <= 0) return null;
  return { action: m[1] === "app" ? "approve" : "reject", topupId: id };
}

async function handleCallbackQuery(
  cq: NonNullable<TelegramUpdate["callback_query"]>,
): Promise<void> {
  const botToken = getBotToken();
  if (!botToken) return;

  // Gate: only allowlisted Telegram accounts may execute admin actions.
  const adminIds = getAdminTelegramIds();
  if (!adminIds.includes(cq.from.id)) {
    logger.warn(
      { fromId: cq.from.id, data: cq.data },
      "[telegram-webhook] unauthorized callback attempt",
    );
    await answerCallbackQuery(
      botToken,
      cq.id,
      "عذراً، لا تمتلك الصلاحية لتنفيذ هذا الإجراء.",
      true,
    );
    return;
  }

  const parsed = parseTopupCallback(cq.data);
  if (!parsed) {
    await answerCallbackQuery(botToken, cq.id, "بيانات غير صالحة", true);
    return;
  }
  const { action, topupId } = parsed;

  // Load + verify still pending BEFORE mutating (the service re-checks too).
  const [topup] = await db
    .select({ status: walletTopupsTable.status })
    .from(walletTopupsTable)
    .where(eq(walletTopupsTable.id, topupId))
    .limit(1);

  let outcomeLine: string;
  if (!topup) {
    await answerCallbackQuery(botToken, cq.id, "الطلب غير موجود", true);
    return;
  }
  if (topup.status !== "pending") {
    await answerCallbackQuery(botToken, cq.id, "تمت معالجة هذا الطلب مسبقاً", true);
    // Strip stale keyboard so the stale button can't be tapped again.
    if (cq.message?.chat?.id && cq.message?.message_id) {
      await editMessageReplyMarkup(botToken, cq.message.chat.id, cq.message.message_id);
    }
    return;
  }

  const actorTag = cq.from.username ? `@${cq.from.username}` : `tg:${cq.from.id}`;
  try {
    if (action === "approve") {
      await import("../services/topup.service").then((m) =>
        // A4-04 (R116): the Telegram actor rides reviewed_by too — the
        // operator-facing queue attributes webhook approvals to the
        // tapping operator, not just the note text.
        m.TopupService.approve(topupId, `موافقة عبر تليقرام بواسطة ${actorTag}`, actorTag),
      );
      outcomeLine = `\n\n✅ الحالة: تمت الموافقة بواسطة ${actorTag}`;
    } else {
      await import("../services/topup.service").then((m) =>
        m.TopupService.reject(topupId, `رفض عبر تليقرام بواسطة ${actorTag}`, actorTag),
      );
      outcomeLine = `\n\n❌ الحالة: تم الرفض بواسطة ${actorTag}`;
    }
  } catch (err) {
    logger.warn({ err, topupId }, "[telegram-webhook] action failed");
    await answerCallbackQuery(botToken, cq.id, "فشل تنفيذ الإجراء، حاول مجدداً", true);
    return;
  }

  // Update the tapped message: strip keyboard + append a status line to the
  // ORIGINAL text (Telegram includes message.text in callback queries).
  if (cq.message?.chat?.id && cq.message?.message_id) {
    await editMessageReplyMarkup(botToken, cq.message.chat.id, cq.message.message_id);
    if (typeof cq.message.text === "string") {
      await editMessageText(
        botToken,
        cq.message.chat.id,
        cq.message.message_id,
        cq.message.text + outcomeLine,
      );
    }
  }
  await answerCallbackQuery(
    botToken,
    cq.id,
    action === "approve" ? "✅ تمت الموافقة وإضافة الرصيد" : "❌ تم رفض الطلب",
  );

  logger.info({ topupId, action, actor: actorTag }, "[telegram-webhook] topup decision executed");
}

router.post("/telegram", async (req, res) => {
  const expectedSecret = (process.env.TELEGRAM_WEBHOOK_SECRET ?? "").trim();
  if (!expectedSecret) {
    logger.warn("[telegram-webhook] TELEGRAM_WEBHOOK_SECRET not set");
    res.status(503).json({ ok: false });
    return;
  }
  const incoming = req.header("x-telegram-bot-api-secret-token") ?? "";
  if (!incoming || !timingSafeEqualStrings(incoming, expectedSecret)) {
    res.status(403).json({ ok: false });
    return;
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!String(contentType).includes("application/json")) {
    // setWebhook probes / non-JSON pings — ack so Telegram stops retrying.
    res.json({ ok: true });
    return;
  }

  try {
    const update = req.body as TelegramUpdate;

    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
      res.json({ ok: true });
      return;
    }

    // Plain messages: reply to /start with the sender's IDs (bootstrap for
    // building the TELEGRAM_ADMIN_IDS allowlist). F2: routed through the
    // timeout-guarded helper so a slow Telegram can no longer pin this
    // handler for the full 60 s requestTimeout.
    const chatId = update.message?.chat?.id;
    const fromId = update.message?.from?.id;
    if (chatId && update.message?.text === "/start") {
      const botToken = getBotToken();
      if (botToken) {
        await replyWithStartIds(botToken, chatId, fromId);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err }, "[telegram-webhook] update processing error");
    // Always 200 — Telegram retries non-200s aggressively.
    res.json({ ok: true });
  }
});

export { router as telegramWebhookRouter };

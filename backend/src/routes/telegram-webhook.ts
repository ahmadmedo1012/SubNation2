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
import { writeAuditLog } from "../lib/audit";
import type { Request } from "express";
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
  req: Request,
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
  // R153: the pre-check now also reads the reviewer attribution so the
  // already-processed branch can say WHAT happened and WHO did it — the
  // old single "تمت معالجة هذا الطلب مسبقاً" toast left an operator who
  // tapped a stale button unable to tell an approved topup from a rejected
  // one (the production report that opened this round).
  let topup: { status: string; reviewedBy: string | null } | undefined;
  try {
    [topup] = await db
      .select({
        status: walletTopupsTable.status,
        reviewedBy: walletTopupsTable.reviewedBy,
      })
      .from(walletTopupsTable)
      .where(eq(walletTopupsTable.id, topupId))
      .limit(1);
  } catch (err) {
    // E-F5 (R186): a transient DB blip on this pre-check used to escape
    // handleCallbackQuery into the route's catch-all — the tap was acked
    // 200 (correct: Telegram retries non-200s aggressively) but the
    // operator's toast never fired, so the tap silently vanished. Same
    // answer-the-tapper idiom as the action catch below.
    logger.warn({ err, topupId }, "[telegram-webhook] pre-check read failed");
    await answerCallbackQuery(botToken, cq.id, "فشل تنفيذ الإجراء، حاول مجدداً", true);
    return;
  }

  if (!topup) {
    await answerCallbackQuery(botToken, cq.id, "الطلب غير موجود", true);
    return;
  }
  if (topup.status !== "pending") {
    // R153: truthful, state-specific feedback replaces the ambiguous
    // catch-all. Three production paths land here: (1) the operator
    // approved on the WEBSITE — the pending card's buttons stay live
    // because the site path has no message identity to edit them; (2) a
    // Telegram retry re-delivered a callback whose first delivery
    // already committed; (3) an impatient double-tap arrived after the
    // first tap committed. In every one of them the operator deserves to
    // know the topup's true terminal state, not a shrug.
    const by = topup.reviewedBy ? ` بواسطة ${topup.reviewedBy}` : "";
    await answerCallbackQuery(
      botToken,
      cq.id,
      topup.status === "approved" ? `هذا الطلب معتمد بالفعل${by}` : `هذا الطلب مرفوض بالفعل${by}`,
      true,
    );
    // Strip stale keyboard so the dead button can't be tapped again, and
    // stamp the final state on the card text itself (R153: previously only
    // the keyboard vanished — the card kept reading «⏳ بانتظار الموافقة»,
    // inviting the next operator to tap a button that was no longer there).
    // Idempotent: if a prior delivery already appended an outcome line the
    // text is left untouched (the gateway classifies the Telegram "message
    // is not modified" collision as benign).
    if (cq.message?.chat?.id && cq.message?.message_id) {
      if (typeof cq.message.text === "string" && !cq.message.text.includes("الحالة: تمت")) {
        await editMessageText(
          botToken,
          cq.message.chat.id,
          cq.message.message_id,
          cq.message.text +
            (topup.status === "approved"
              ? `\n\n✅ الحالة: تمت الموافقة${by}`
              : `\n\n❌ الحالة: تم الرفض${by}`),
        );
      }
      await editMessageReplyMarkup(botToken, cq.message.chat.id, cq.message.message_id);
    }
    return;
  }

  const actorTag = cq.from.username ? `@${cq.from.username}` : `tg:${cq.from.id}`;
  let outcomeLine: string;
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
    // R153: a ServiceError carries an operator-appropriate Arabic verdict
    // from the money state machine itself (duplicate reference, changed
    // balance, lost race). Surfacing it verbatim replaces the old generic
    // "فشل تنفيذ الإجراء، حاول مجدداً" — which was factually WRONG for the
    // 409 race-loser case: a concurrent delivery (double-tap, Telegram
    // retry, website race) had already committed the approval, and the
    // toast told the operator the operation FAILED and invited another
    // tap. For that specific 409 the state is re-read so the toast says
    // the truthful terminal state instead.
    const { ServiceError } = await import("../services/topup.service");
    let message = "فشل تنفيذ الإجراء، حاول مجدداً";
    if (err instanceof ServiceError) {
      message = err.message;
      if (err.message.includes("تمت معالجته مسبقاً")) {
        // E-F5 (R186): the re-read shares the pre-check's exposure — a
        // throw here would skip the answer below and swallow the toast.
        try {
          const [fresh] = await db
            .select({ status: walletTopupsTable.status, reviewedBy: walletTopupsTable.reviewedBy })
            .from(walletTopupsTable)
            .where(eq(walletTopupsTable.id, topupId))
            .limit(1);
          if (fresh && fresh.status !== "pending") {
            const by = fresh.reviewedBy ? ` بواسطة ${fresh.reviewedBy}` : "";
            message =
              fresh.status === "approved"
                ? `هذا الطلب معتمد بالفعل${by}`
                : `هذا الطلب مرفوض بالفعل${by}`;
          }
        } catch (readErr) {
          logger.warn({ err: readErr, topupId }, "[telegram-webhook] state re-read failed");
        }
      }
    } else {
      logger.warn({ err, topupId }, "[telegram-webhook] action failed");
    }
    await answerCallbackQuery(botToken, cq.id, message, true);
    return;
  }

  // R153: answer the tapper FIRST, immediately after the money transaction
  // commits — BEFORE the card edits. The old order (edits → answer) let up
  // to 30 s of sequential Bot-API edit timeouts (10 s each) sit between the
  // committed credit and the operator's only transient feedback signal;
  // on a slow delivery that window bred double-taps and Telegram re-delivery
  // retries, both of which landed on the committed row and answered with the
  // ambiguous "already processed" — the exact production symptom this round
  // opened with. The durable card state rides the edits below; if those
  // fail the money and topup state remain correct and the failure is
  // observable in the logs (telegram-gateway R153 classification).
  await answerCallbackQuery(
    botToken,
    cq.id,
    action === "approve" ? "✅ تمت الموافقة وإضافة الرصيد" : "❌ تم رفض الطلب",
  );

  // B11-F1 (R127): the audit row this money path lacked. The admin-UI
  // route writes topup.approve/topup.reject rows (admin/topups.ts:159/196)
  // — but a Telegram-tapped approval credited a wallet with NO
  // audit_logs row, so the R127-L5 audit-trail tab (and any incident
  // review) was blind to every webhook decision. Same fire-and-forget
  // writeAuditLog idiom as the other money writers (best-effort, never
  // blocks the operation); the row identifies the Telegram actor in
  // metadata (actorId stays null — the tapper is allowlisted in
  // TELEGRAM_ADMIN_IDS, not necessarily a console admin account) and
  // the IP is the webhook delivery request's (Telegram's edge), which
  // is the honest source for this path.
  void writeAuditLog(
    req,
    action === "approve" ? "topup.approve" : "topup.reject",
    "topup",
    topupId,
    {
      source: "telegram_webhook",
      actor: actorTag,
      from_id: cq.from.id,
    },
  );

  // Update the tapped message: strip keyboard + append a status line to the
  // ORIGINAL text (Telegram includes message.text in callback queries).
  // R153: these edits run AFTER the callback answer — they are the durable
  // record, not the feedback signal (see the answer-first comment above).
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
      await handleCallbackQuery(update.callback_query, req);
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

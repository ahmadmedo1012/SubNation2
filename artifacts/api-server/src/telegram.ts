const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export function isTelegramConfigured(): boolean {
  return !!(BOT_TOKEN && CHAT_ID);
}

export async function sendTelegramMessage(text: string): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {
  }
}

export function notifyNewUser(phone: string, hadReferral: boolean): void {
  const msg = `🆕 <b>مستخدم جديد</b>\nرقم الهاتف: <code>${phone}</code>${hadReferral ? "\n✅ سجّل عبر إحالة" : ""}`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyNewTopup(phone: string, amount: number, network: string): void {
  const netLabel = network === "madar" ? "مدار" : "ليبيانا";
  const msg = `💰 <b>طلب شحن جديد</b>\nالمستخدم: <code>${phone}</code>\nالمبلغ: <b>${amount.toFixed(2)} د.ل</b>\nالشبكة: ${netLabel}\n\n⏳ بانتظار الموافقة`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyTopupApproved(phone: string, amount: number): void {
  const msg = `✅ <b>شحن موافق عليه</b>\nالمستخدم: <code>${phone}</code>\nالمبلغ: <b>${amount.toFixed(2)} د.ل</b>`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyTopupRejected(phone: string, amount: number): void {
  const msg = `❌ <b>شحن مرفوض</b>\nالمستخدم: <code>${phone}</code>\nالمبلغ: <b>${amount.toFixed(2)} د.ل</b>`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyNewOrder(phone: string, productName: string, amount: number): void {
  const msg = `🛒 <b>طلب جديد</b>\nالمستخدم: <code>${phone}</code>\nالمنتج: <b>${productName}</b>\nالمبلغ: <b>${amount.toFixed(2)} د.ل</b>`;
  sendTelegramMessage(msg).catch(() => {});
}

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

export function notifyPasswordResetRequest(phone: string, code: string): void {
  const msg = `🔑 <b>طلب إعادة تعيين كلمة المرور</b>\n\nالهاتف: <code>${phone}</code>\nكود التحقق: <b>${code}</b>\n⏳ ينتهي خلال 30 دقيقة\n\n<i>أرسل هذا الكود للمستخدم عبر أي وسيلة تواصل.</i>`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyCouponMaxedOut(code: string, maxUses: number): void {
  const msg = `🎟️ <b>كوبون استُنفد بالكامل</b>\n\nالرمز: <code>${code}</code>\nتم استخدامه <b>${maxUses} مرة</b> (الحد الأقصى)\n\nℹ️ الكوبون لا يزال نشطاً ولكنه لن يقبل استخدامات جديدة.`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyCouponExpiringSoon(code: string, expiresAt: Date, hoursLeft: number): void {
  const timeLabel = hoursLeft <= 1 ? "أقل من ساعة" : `${Math.floor(hoursLeft)} ساعة`;
  const dateStr = expiresAt.toLocaleDateString("ar-LY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const msg = `⏰ <b>كوبون يوشك على الانتهاء</b>\n\nالرمز: <code>${code}</code>\nينتهي خلال: <b>${timeLabel}</b>\nوقت الانتهاء: ${dateStr}\n\nيمكنك تمديده أو إيقافه من لوحة الإدارة.`;
  sendTelegramMessage(msg).catch(() => {});
}

export function notifyLowStock(productName: string, stockCount: number): void {
  const urgency = stockCount === 0 ? "🚨 <b>نفاد المخزون</b>" : "⚠️ <b>مخزون منخفض</b>";
  const countStr = stockCount === 0 ? "لا توجد وحدات متبقية" : `${stockCount} وحدة فقط`;
  const msg = `${urgency}\n\nالمنتج: <b>${productName}</b>\nالمتوفر: ${countStr}\n\nيرجى إضافة مخزون جديد في أقرب وقت.`;
  sendTelegramMessage(msg).catch(() => {});
}

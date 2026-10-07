> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r94/A4-services.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# A4 — تفتيش خدمات الخلفية (backend/src/services) — الجولة 94

**الوكيل:** A4 (أعمق مدقق منطق أعمال) · **النوع:** فحص قراءة فقط — لم يُعدَّل أي سطر كود.
**التاريخ:** 2026-09-08 · **القاعدة:** commit الجولة 93 (subnation.ly live).
**المنهجية:** تتبع سطر-بسطر للمعاملات المالية (checkout → refund → topup → adjustment → loyalty → referral)، ثم كل خدمة مساندة (whatsapp-otp، openwa، firebase-auth، risk، alerting، copilot، enrichment، forecast)، مع تتبع المتصلين (routes) وschema قاعدة البيانات والاختبارات.

**ممنوع إعادة الإبلاغ (تم التحقق من إصلاحها فعليًا ولم يُعاد رصدها):** بوابة INVENTORY_CORRUPT 503 fail-closed (checkout.service.ts:213-240) ✅، فك تشفير delivered_* في formatOrder/wallet/admin ✅، V1-M10 دلتا موقّعة للاسترجاع ✅، تسلسل payment_reference/23505 في approve ✅، بطلال بيانات الاسترجاع + استرداد النقاط ✅، lockout/2FA/replay تلغرام ✅.

---

## ملخص سلامة المال (الموجب)

مسار الشراء/الاسترجاع/الشحن/التعديل مفحوص بالكامل ومحصّن إلى حد عالٍ:
- **checkout**: معاملة واحدة تُغلق (مطالبة مخزون FOR UPDATE SKIP LOCKED مرتّبة + CAS ثلاثي الأعمدة على users + زيادة كوبون atomic-with-check + ledger داخل tx + بوابات INVALID_PRICE/STALE_FLASH_SALE/COUPON_EXHAUSTED).
- **refund**: CAS كامل write-set + قلب حالة محروس + إبطال بيانات التسليم + ledger ذرّي + تنبيه بعد الالتزام.
- **topup.approve**: قفل استشاري حسب المرجع + فحص تكرار داخل tx + الفهرس الفريد V1-M9 + CAS الرصيد + فحص التزامن المرجعي B2-04 + dedup مركّب F-03.
- **adjustment / convert-points**: حدود numeric(10,2) + CAS + ledger.
- ترتيب الأقفال عبر المسارات الأربعة **بلا دورة deadlock** (inventory/topups/orders صفوف متقاطعة، وusers يُكتب دائمًا بـ compare-and-set).
- كل استدعاء خارجي (تلغرام/واتساب/LLM/تنبيهات) يحمل timeout (5s/8s/10s) ولا يحجب مسار المال؛ notify/createNotification يبتلع الأخطاء.
- لا تبعيات دائرية بين الخدمات (socket/notify عبر dynamic import).
- N+1: لا شيء في مسارات الطلبات؛ الحلقات التسلسلية (bulk-refund، forecast، enrichment) مقصودة وموثقة (cron-side).

النتائج التالية هي الثغرات المتبقية.

---

## النتائج

### F1 — [P2] طبقة تنفيذ قرار المخاطر (soft/hard block) كود ميت: غير مركّبة في أي مسار

**ملف:سطر:** `backend/src/middlewares/risk-soft-block.ts:46` و `backend/src/middlewares/risk-hard-block.ts:36` — الدالتان مُعرَّفتان ومُصدَّرتان لكن **لا يوجد أي استيراد أو تركيب لهما في كامل الـ backend** (rg على `riskSoftBlockMiddleware|riskHardBlockMiddleware` يُرجع تعريفيهما فقط؛ `app.ts` لا يركّبهما، وكذلك `routes/index.ts`).

**دليل مقتبس** — قرار الحجب يُتّخذ ويُخزَّن لكن لا أحد ينفّذه:
```ts
// risk-scoring.service.ts:248-253
if (input.level === "high") {
  if (input.autoBlockEnabled.softBlock && input.confidence >= 0.7) return "soft_block";
  ...
// risk-soft-block.ts:94-97  (المنفّذ الذي لا يُستدعى أبدًا)
// Force re-auth via the existing flow: invalidate
// sessions for this user. The next request returns 401
await db.delete(sessionsTable).where(eq(sessionsTable.userId, userId));
```

**الأثر (سيناريو ملموس):** المشغّل يفعّل `RISK_PIPELINE_ENABLED=true` ويشاهد في `/admin/risk` أحداثًا بعلامة `actionTaken=soft_block` (مثال: مستخدم يقدّم 3 طلبات شحن متزامنة بنفس المُرسِل — إشارة احتيال). الاعتقاد التشغيلي أن المستخدم سيُجبَر على إعادة المصادقة/يُمنع. في الواقع: **المستخدم نفسه يكمل الشراء (`POST /api/orders`) وتحويل النقاط (`/loyalty/convert-points`) دون أي احتكاك**. كذلك لا يوجد أي عمود حظر للمستخدم في `users` (لا isActive/banned) — أي أن مفهوم "مستخدم محظور يشتري" ليس له نقطة إنفاذ أصلًا. فشل صامت لضابط أمن موثّق في المواصفة (T011).

**الإصلاح الدقيق:** تركيب `riskHardBlockMiddleware()` بعد `requireUser` على مسارات المال (`/api/orders` POST، `/api/wallet/topups` POST، `/loyalty/convert-points`)، و`riskSoftBlockMiddleware()` عامًّا بعد طبقة المصادقة في app.ts. إن لم يكن الربط مقصودًا هذه الجولة فحذف الملفين + تحويل decideAction إلى `alert` فقط، وإلا فهذا غرض security-control-dead-code يجب أن يظهر في تقرير الامتثال.

---

### F2 — [P2] تسجيل الإحالة عبر قناة WhatsApp لا ينشئ صف referral_events → مكافأة المُحيل (+50 نقطة) لا تُمنح أبدًا — فشل صامت

**ملف:سطر:** `backend/src/services/whatsapp-otp.service.ts:393-411` (findOrCreateWhatsAppUser) — مقابل `backend/src/services/topup.service.ts:315-321` (المستهلك الوحيد للحدث).

**دليل مقتبس** — الإنشاء (WhatsApp) بلا صف حدث:
```ts
// whatsapp-otp.service.ts:393-411 — user + bonus + ledger فقط
const [created] = await db.transaction(async (tx) => {
  const [u] = await tx
    .insert(usersTable)
    .values({ phone, phoneVerified: true, ..., referredBy: referredById,
              walletBalance: referredById ? "5.00" : "0.00", ... })
  if (referredById) await insertReferralSignupLedger(tx as unknown as typeof db, u.id);
  return [u];
});
// ⛔ لا يوجد أي insert(referralEventsTable) في المسار كله
```
والقناتان الأخريان تُنشئانه: `routes/auth-settings.ts:439-443` (تلغرام) و`services/firebase-auth.service.ts:487-492` (فايربيز):
```ts
await db.insert(referralEventsTable)
  .values({ referrerId: referredById, refereeId: created.id, status: "pending" })
  .onConflictDoNothing();
```
بينما منح النقاط عند أول شحن **يشترط** وجود الصف:
```ts
// topup.service.ts:315-330
if (user.referredBy) {
  const [existingCredit] = await tx
    .select().from(referralEventsTable)
    .where(eq(referralEventsTable.refereeId, user.id)).limit(1);
  if (existingCredit && existingCredit.status === "pending") { /* +50 للمُحيل */ }
```

**الأثر (سيناريو ملموس):** مستخدم يفتح `subnation.ly/register?ref=CODE` ويسجّل عبر WhatsApp OTP (القناة الحية Phase-1): يُمنح الـ 5 د.ل ترحيبية فورًا (مع ledger)، لكن `referredBy` بلا صف حدث. عند اعتماد أول شحن للمُحال يبحث approve عن الحدث → غير موجود → **المُحيل لا يستلم الـ 50 نقطة (0.50 د.ل قابلة للتحويل إلى رصيد) الموعودة، بلا خطأ ولا تنبيه ولا عدّاد في /admin/referrals** — عمليًا وعد الإحالة مكسور حصريًا على هذه القناة، مع تناقض لواجهة "pending: 0" رغم أن user.referredBy مُعبّأ.

**الإصلاح الدقيق:** داخل نفس معاملة إنشاء المستخدم في findOrCreateWhatsAppUser أضف:
```ts
if (referredById) {
  await tx.insert(referralEventsTable)
    .values({ referrerId: referredById, refereeId: u.id, status: "pending" })
    .onConflictDoNothing();
}
```
(المرآة الحرفية لمسار firebase-auth) — وأضف اختبارًا يحاكي تسجيل WhatsApp بكود إحالة ثم approve لشحن ويقّطع منح 50 نقطة للمُحيل.

---

### F3 — [P2] مسار bulk-status يسمح failed/pending → completed فيسلّح طلبات لم تُدفع مقابل استرجاعها لاحقًا (سكة نقود عبر أدمن)

**ملف:سطر:** `backend/src/routes/admin/orders.ts:246-249` (الفرع غير refund).

**دليل مقتبس:**
```ts
// الحارس الوحيد يمنع الانطلاق من 'refunded' فقط:
const flippedRows = await db
  .update(ordersTable)
  .set({ status: status as any })   // status ∈ {pending, completed, failed}
  .where(sql`id = ANY(${numIds}) AND ${ordersTable.status} <> 'refunded'`)
  .returning({ id: ordersTable.id, userId: ordersTable.userId });
```
وRefundService يسترد `orders.amount` لأي طلب status="completed" (refund.service.ts:112-120, 140).

**الأثر (سيناريو ملموس):** checkout هو المنشئ الوحيد للطلبات وحالة إدخاله دائمًا "completed" مع خصم فعلي — لكن الطلبات التراثية/مَنشوءة يدويًا بحالة pending/failed تحمل amountًا دون أي خصم مقابل. أدمن (أو جلسة أدمن مسرّبة — الأدمن الوحيد ما زال بلا TOTP بحسب سجل العمل) ينفّذ:
1. `PATCH /admin/orders/bulk-status { ids:[X], status:"completed" }` → الطلب الفاشل يصبح "completed" (الحارس `<> 'refunded'` يمرّ).
2. `PATCH /admin/orders/bulk-status { ids:[X], status:"refunded" }` → RefundService يُقيّد `amount` للمحفظة + صف ledger نوع refund.

النتيجة: **ائتمان نقدي بلا خصم شراء مقابل** — مجموع wallet_ledger للمستخدم يعطي رصيدًا أعلى من أي مصدر حقيقي (انكسار المبدأ الدستوري I)، دون أن يرمي أي مكوّن خطأً. إصلاح r4 F-1 أغلق refunded→completed لكنه ترك failed→completed→refunded مفتوحًا.

**الإصلاح الدقيق:** في الفرع غير refund ارفض `status === "completed"` كهدف يدوي مطلقًا (`checkout` هو الخالق الشرعي الوحيد لهذه الحالة)، وقصر الانتقالات على pending↔failed؛ أو اشترط قبل السماح بالـ completed وجود صف wallet_ledger نوع purchase بـ referenceId=order.id قبل أي استرجاع لاحق. أضف اختبارًا: طلب failed → محاولة completed → يجب أن 400.

---

### F4 — [P3] checkout يثق بصف المنتج المقروء قبل المعاملة: لا إعادة فحص للسعر/isActive/isArchived داخل tx (فجوة تكافؤ مع STALE_FLASH_SALE)

**ملف:سطر:** `backend/src/services/checkout.service.ts:88-98` (قراءة خارج tx) مقابل الحرّاس داخل tx: فلاش 176-193، كوبون 305-321، مخزون 202-248.

**دليل مقتبس:** حارس الفلاش داخل tx موجود، وحارس المنتج نفسه لا:
```ts
if (pricing.flashSale) {
  const [saleRow] = await tx.select({...}).from(flashSalesTable)
    .where(eq(flashSalesTable.id, pricing.flashSale.id)).limit(1);
  ...
  if (saleStale) throw new Error("STALE_FLASH_SALE");
}
// ⛔ لا مقابل لـ productsTable: لا إعادة قراءة price/isActive/isArchived
```

**الأثر (سيناريو ملموس):** الأدمن يرفع سعر المنتج من 10 إلى 20 (أو يؤرشفه) لحظة أن حاسبة تسعير المشتري قرأت 10 وفتحت tx. المشتري يُخصم 10 ويتسلّم السلعة بالسعر القديم (خسارة هامش)، أو يشتري منتجًا مؤرشفًا للتوّ (بيع مُدرج-خارج-الكتالوج). نافذة التنفيذ = بين computePricing والالتزام (عشرات الملّي ثوانٍ، تتمدد تحت الحمل). نفس صنف الثغرة الذي أصلحه B2-06 للفلاش والكوبون — الصف الأول في السلسلة (المنتج ذاته) بقي بلا حارس.

**الإصلاح الدقيق:** داخل tx أعد قراءة `productsTable.price/isActive/isArchived` برمز المنتج وأضف:
```ts
if (!row || !row.isActive || row.isArchived || parseFloat(String(row.price)) !== listPrice)
  throw new Error("PRODUCT_STALE");
```
و map إلى 409-retryable تمامًا كـ STALE_FLASH_SALE (أعد المحاولة بالسعر الحالي).

---

### F5 — [P3] createApprovedTopup (بوابة الشحن الآلي) بلا أي من حرّاس التحقق التي لدى approve() — فخ كود ميت

**ملف:سطر:** `backend/src/services/topup.service.ts:33-110`.

**دليل مقتبس:** التوقيع يستقبل amount مباشرة بلا أي تحقق:
```ts
static async createApprovedTopup(userId: number, amount: number, provider: string, ref: string) {
  const [user] = await db.select().from(usersTable)...
  const topup = await db.transaction(async (tx) => {
    const [t] = await tx.insert(walletTopupsTable).values({
      userId, amount: String(amount), ..., status: "approved", ...
```
لا `assertFiniteAmount`، لا حدّ أعلى، لا قفل استشاري على المرجع، لا فحص تكرار داخل tx، والـ catch الخارجي لا يمرّ عبر `isDuplicatePaymentReferenceViolation` (المستخدم فقط في approve:365-378).

**الأثر (سيناريو ملموس):** لا مُستدعٍ إنتاجيًا اليوم (اختبارات فقط) — لكن أول webhook بوابة دفع يوصَل بهذا المسار يستقبل: `amount=-50` → **خصم محفظة موسوم topup** (ledger متّسق عدديًا، دلالته معكوسة)؛ `amount=Infinity` → "Infinity" يرفضه numeric بـ 500 خام للبوابة؛ وإعادة محاولة البوابة لنفس المرجع تصطدم بفهرس V1-M9 كـ 23505 **غير مصنَّف** → 500 → إعادة محاولة بلا نهاية. علاوة على ذلك فشل CAS الرصيد يرمي 409 للبوابة دون أي مسار تعويض — الدفع مُحصَّل لدى المزود والمحفظة لم تُشحن بلا أثر إداري.

**الإصلاح الدقيق:** إما حذف الدالة حتى وجود البوابة، أو تصفيحها بنفس بطارية H6/B2-02: تحقق finiteness/حدود (0.01..10,000)، إدراج guard التكرار داخل tx مع advisory lock على المرجع، وتغليف catch بـ isDuplicatePaymentReferenceViolation، و(إن بقيت) تسجيل تنبيه أدمن عند فشل الـ 409 بعد الدفع.

---

### F6 — [P3] سباق استهلاك OTP: UPDATE الإبطال غير محروس بـ consumedAt IS NULL — تحقق متزامن مزدوج

**ملف:سطر:** `backend/src/services/whatsapp-otp.service.ts:326-329`.

**دليل مقتبس:**
```ts
// Successful verify — consume the row (replay protection) then
// finds-or-creates the user.
await db
  .update(whatsappOtpsTable)
  .set({ consumedAt: new Date() })
  .where(eq(whatsappOtpsTable.id, row.id));   // ⛔ لا isNull(consumedAt) ولا فحص rows
```
بينما كاتب attempts المجاور محروس بعناية (300-311: increment ذرّي + قفل القبضة الثانية بـ isNull).

**الأثر (سيناريو ملموس):** طلبان متزامنان `POST /api/auth/whatsapp/verify` بنفس الرمز الصحيح: كلاهما يجتاز SELECT (الصف غير مستهلك)، كلاهما يجتاز HMAC، كلاهما يكتب consumedAt، كلاهما يصدر جلسة. لهاتف موجود: رمزان JWT لنفس المستخدم (تسامح). **لهاتف جديد (تسجيل)**: كلا الطلبين يدخل findOrCreateWhatsAppUser → كلاهما يقرأ "لا مستخدم" → كلاهما INSERT → الثاني يفشل على `users.phone UNIQUE` بـ 23505 غير مصنّف → 500 «حدث خطأ، حاول مجدداً» للعميل، مع أن الأول نجح وأصدر tokenًا — تجربة تسجيل مكسورة عند double-submit (نمط شائع في شبكات ليبيا المتذبذبة). الحماية من replay التسلسلية سليمة؛ المتزامنة مكسورة.

**الإصلاح الدقيق:**
```ts
const consumed = await db
  .update(whatsappOtpsTable)
  .set({ consumedAt: new Date() })
  .where(and(eq(whatsappOtpsTable.id, row.id), isNull(whatsappOtpsTable.consumedAt)))
  .returning({ id: whatsappOtpsTable.id });
if (consumed.length !== 1) return { ok: false, reason: "consumed" };
```
(ملاحظة شقيقة بلا رقم مستقل: عدّاد الإرسال في startOts:103-139 SELECT-ثم-قرار — إرسالات متزامنة قد تتجاوز OTP_HOURLY_LIMIT قبل الالتزام؛ أثرها تكلفة رسائل فقط، ويُستحسن تحويلها إلى عدّ Redis INCR أو قفل استشاري.)

---

### F7 — [P3] بيانات التسليم من نوع "كود" تُخزَّن وتُسلَّم نصًا صريحًا (عدم تكافؤ التشفير: كلمة المرور GCM والكود نص)

**ملف:سطر:** `backend/src/routes/admin/products.ts:444-459` (نوع code) و`:485-486` (csv: كلمة المرور تُشفَّر، extraDetails لا)؛ التسليم عبر `checkout.service.ts:353`.

**دليل مقتبس:**
```ts
// admin/products.ts:444-459 — kind: "code"
} else if (e?.kind === "code") {
  ...
  items.push({ accountEmail: null, accountPassword: null, extraDetails: code }); // ⛔ نص صريح
}
// :485 — password يُشفَّر بينما extra يبقى نصًا
accountPassword: encrypt(parts[1].trim()),
extraDetails: parts[2]?.trim() || null,
```
وrefund.service.ts:209-213 يوثّق أن هذا العمود **هو** المُنتَج المُباع: «for code-only inventory, checkout stores the delivered CODE in that column».

**الأثر (سيناريو ملموس):** نسخة احتياطية/DB dump من leaked backup تُخرج كل أكواد المخزون غير المباعة (قيمتها البيعية الكاملة) نصًا صريحًا، بينما كلمات المرور محمية AES-256-GCM — نفس الكيان المالي بحمايتين مختلفتين حسب الصيغة. البوابة R93-DATA تمرّر النص الصريح كـ deliverable بالتصميم (safeDecrypt pass-through)، فلا يوجد أي مكان يعترض.

**الإصلاح الدقيق:** `extraDetails: encrypt(code)` عند الإدراج في المسارين (kind=code وcsv الثلاثي) — البنية (isEncrypted/safeDecrypt) تتسامح مع الشكلين فلا حاجة لترحيل؛ نفس أسلوب تمريرة H2/V1-M7 بدون backfill.

---

### F8 — [P3] تنبيه coupon_maxed + تلغرام يُطلقان داخل معاملة الشراء قبل الالتزام (إنذار كاذب عند rollback + كتم 24 ساعة للتنبيه الحقيقي)

**ملف:سطر:** `backend/src/services/checkout.service.ts:322-329`.

**دليل مقتبس:**
```ts
if (appliedCoupon.maxUses !== null && newUsedCount >= appliedCoupon.maxUses) {
  notifyCouponMaxedOut(appliedCoupon.code, appliedCoupon.maxUses);   // داخل tx، غير منتظر
  logAdminAlert("coupon_maxed", `كوبون استُنفد: ${appliedCoupon.code}`, ...);
}
```
في حين أن refund.service.ts:271-276 يؤسّس المبدأ المعاكس صراحةً: «Emitted AFTER the tx commits (a pre-commit emission would survive a rollback as a false positive…)».

**الأثر (سيناريو ملموس):** فشلُ أي عبارة لاحقة في tx (فشل insert الـ ledger، تصادم orderCode — انظر F9) يُرجع usedCount إلى ما قبل الزيادة، لكن الأدمن استلم بطاقة تلغرام وصفًا "كوبون استُنفد"، **ومفتاح dedupe في logAdminAlert يكتم التنبيه الحقيقي لاحقًا 24 ساعة** (نفس صنف انكماش التنبيه الذي أصلحته رصدة 93-A6 لـ stockWatcher). إرباك تشغيلي على مسار حساس للمال، بلا أثر رقمي على الأرصدة.

**الإصلاح الدقيق:** انسخ نمط RefundService: علم `couponMaxedOut` يُضبط داخل tx، والإرسالان (notifyCouponMaxedOut + logAdminAlert) بعد نجاح المعاملة في النطاق الخارجي للـ catch.

---

### F9 — [P3] مفاتيح orderCode بفضاء 32-بت — تصادم UNIQUE غير معالج يرمي 500 خام على مسار الشراء

**ملف:سطر:** `backend/src/lib/crypto.ts:45-47` + القيد `orders.orderCode UNIQUE` (`shared/db/src/schema/orders.ts:29`).

**دليل مقتبس:**
```ts
export function generateOrderCode(): string {
  return "SN" + randomBytes(4).toString("hex").toUpperCase();   // 2^32 فقط
}
```
وخرائط أخطاء tx في checkout.service.ts:379-420 لا تعالج 23505 (unique_violation).

**الأثر (سيناريو ملموس):** بحساب المفارقة: عند ~10,000 طلب احتمال ≥ تصادم واحد ≈ 1.2%، وعند 65,000 طلب ≈ 40%. أول تصادم: INSERT الطلب يفشل بـ 23505 → خارج كل الفروع → `throw err` → 500 «حدث خطأ» للمشتري (المحفظة لم تُخصم — tx تراجعت، سليم ماليًا لكن التجربة مكسورة)، وإعادة المحاولة من الواجهة بمفتاح idempotency جديد تنجح. يتفاقم مع backfill/اختبارات الإنتاج التي تستهلك فضاء المفاتيح.

**الإصلاح الدقيق:** رفع العشوائية إلى `randomBytes(8)` (فضاء 64-بت — احتمال الإهمال عند أي حجم واقعي)، أو التقاط 23505 داخل tx وإعادة توليد الكود مرة واحدة قبل الفشل.

---

### F10 — [P3] الوسيط idempotency يمرّر الطلبات الخالية من المفتاح على كل مسارات المال — «المرحلة الانتقالية» صبحت دائمة

**ملف:سطر:** `backend/src/middlewares/idempotency.ts:125-135`.

**دليل مقتبس:**
```ts
if (!userKey || typeof userKey !== "string" || userKey.length < 8) {
  // Phase-1 transitional path (see file header). Log so ops can
  // measure ...; tighten to 400 once the UI is updated.
  logger.warn({ route: routeKey, path: req.path, ... },
    "mutation arrived without Idempotency-Key — pass-through; ...");
  next();
  return;
}
```
الواجهة **أرسلت** المفتاح فعلًا (`frontend/src/pages/checkout.tsx:277` — `headers: { "Idempotency-Key": generateIdempotencyKey() }`) لكن التشديد لم ينفَّذ.

**الأثر (سيناريو ملموس):** المسارات المالية تُقيَّد فقط لعملاء الواجهة الملتزمين. سكربت/عميل API قديم/double-fire شبكي بلا ترويسة يمرّ مرورًا حرًّا: topup-approve وrefund محميان حالةً (409 عند التكرار)، لكن `POST /api/orders` بلا مفتاح وبلا حارس حالة — **طلبان متتاليان = وحدتا شراء وخصمان** (كل واحد معاملة شراء مشروعة شكلًا). أثر مالي حقيقي محدود بضعف النقر غير المقصود عبر عملاء غير الواجهة.

**الإصلاح الدقيق:** بما أن الواجهة ترسل المفتاح منذ V4: اجعل المفتاح **إلزاميًا** على routeKey's المال فقط (`orders.create`, `admin.topups.approve`, `admin.users.patch`, `admin.orders.bulk-status`) → 400 برسالة عربية «معرف العملية (Idempotency-Key) مطلوب»؛ أبقِ المرور الحر للمسارات غير المالية.

---

## ما فُحص وثبت سليمًا (للدفاع عنه في المراجعة)

| المحور | الحكم | الدليل المكثف |
|---|---|---|
| SELECT-then-UPDATE بلا قفل | ✅ لا يوجد في مسارات المال — كل كتابة CAS أو atomic-with-check أو guard حالة | checkout:271-280, refund:171-186, topup:286-297, adjustment:188-192, loyalty:140-152 |
| floating-point في المبالغ | ✅ كل الكتابات `toFixed(2)` + تخزين numeric(10,2) نصيًا؛ `toNumber`/`parseFloat` للقراءة فقط مع فحب finiteness في المسارات الحاسمة | numeric.ts:17-26, adjustment:86-92, checkout:123-130 |
| تقريب الخصم vs الاسترجاع | ✅ refund يرد `orders.amount` (المدفوع الفعلي بعد الكوبون/الفلاش) — لا انحراف | refund.service.ts:19-25,120 |
| كوبون × فلاش معًا | ✅ computePricing يطبّق النسبة على basePrice بعد الفلاش، final ≥ 0 محروس (INVALID_PRICE fail-closed + create-side <100%) | pricing.ts:214, checkout:123-130, coupons.ts:181-189 |
| ازدواج موافقة شحن | ✅ advisory lock حسب المرجع + re-check داخل tx + فهرس فريد جزئي + guard حالة | topup.service.ts:149-159, 251-258 |
| ازدواج استرجاع | ✅ قلب الحالة المحروس هو الحارس؛ refunded طرفية (bulk-status يرفض العودة) | refund:191-198, admin/orders.ts:234-240 |
| آخر وحدة × طلبان متزامنان | ✅ FOR UPDATE SKIP LOCKED + ORDER BY id + UPDATE ... WHERE isSold=false | checkout.service.ts:202-248 |
| منتج مؤرشف عبر API | ✅ فلتر isActive/isArchived عند القراءة | checkout:91-97 |
| كوبون منتهٍ بثانية | ✅ إعادة التحقق expires_at داخل tx (مُصلَح 92 — لم يُعد رصده) | checkout:305-321 |
| حدود الشحن/التعديل/النقاط | ✅ (0.01..10,000] شحن، ±99,999,999.99 تعديل مع فحص الرصيد الناتج، نقاط أدمن ≤ 10M | wallet.ts:144-148, adjustment:86,186, admin/users.ts:163-169 |
| whatsapp-otp تشفير | ✅ HMAC-SHA256 مُقيد (code:phone:purpose) + timingSafeEqual + CSPRNG + attempts ذرّي + hard-consume | lib/whatsapp-otp.ts كامل |
| بوابة واتساب معزولة | ✅ not_configured/session_not_* → gateway_disabled → 503 برسالة عربية؛ لا fallback صامت | whatsapp-otp.service.ts:174-195, auth-whatsapp.ts:35-41 |
| تلغرام/واتساب يحجبان المال | ✅ كلها fire-and-forget + timeout (5s/8s/10s) | telegram.ts:54, openwa:155, alerting:146 |
| N+1 في مسارات الطلب | ✅ لا شيء؛ الحلقات المتسلسلة (bulk refund / cron) مقصودة وموثقة | admin/orders.ts:166-169, forecast.service.ts:71 |
| تبعيات دائرية | ✅ لا شيء بين الخدمات؛ socket/notify عبر dynamic import | مسح استيرادات كل الخدمات |

---

## اختبارات المنطقة (services/__tests__): 16 ملفًا تثبّت المسارات الحرجة (استرجاع/سباقات/تشفير/dedup) — الفجوات: لا اختبار لـ F1 (لعدم وجود الكود الحي أصلًا)، ولا اختبار لإحالة WhatsApp (F2)، ولا لانتقال failed→completed (F3).

## الإحصاء
- **ملفات services مفحوصة:** 18 ملف خدمة رئيسي + فرعي (checkout, refund, topup, adjustment, whatsapp-otp, openwa, firebase-auth, alerting, risk-scoring, risk-config-cache, risk-rules, risk-alerts, copilot×5, enrichment, forecast) — قراءة كاملة للأربعة المالية + otp، وقراءة موسعة للبقية.
- **ملفات مساندة:** 12 (ledger, pricing, numeric, whatsapp-otp-lib, loyalty-tiers, encryption, crypto, session, risk-emit, telegram, notify, alertLogger).
- **routes/middlewares متتبَّعة:** 15 + app.ts.
- **schema مفحوص:** 7 جداول.
- **النتائج:** 0×P0، 0×P1، 3×P2 (F1–F3)، 7×P3 (F4–F10).

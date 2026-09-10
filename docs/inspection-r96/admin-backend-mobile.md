# تفتيش R96-A5 — لوحة الأدمن على الجوال + كفاءة الخلفي لشبكات الجوال

**الوكيل:** R96-A5 (تشخيص قراءة فقط — لم يُعدَّل أي ملف كود)
**المنطقة:** `frontend/src/pages/admin/**` + `frontend/src/lib/socket.ts` + `App.tsx` (QueryClient) + `shared/api-client-react/src/custom-fetch.ts` + `backend/src/app.ts` + `backend/src/lib/socket.ts` + `backend/src/routes/{products,orders,wallet,notifications}.ts` + `backend/src/routes/admin/{orders,topups,users,products,stats,alerts,auth}.ts` + `backend/src/services/topup.service.ts` + `backend/src/middlewares/idempotency.ts` + `shared/db/src/index.ts` + `vercel.json` / `render.yaml` + `frontend|backend/src/instrument.ts`.
**المنهج:** قراءة سطرية كاملة للملفات المحورية، تتبّع أنماط الجوال (390px) عبر كل صفحات الأدمن، ومحاكاة سيناريوهات شبكة الجوال (انقطاع، تنقل WiFi→خلوي، فقدان الاستجابة بعد التنفيذ) على مسارات المال.

**مستثنى (مُصلَح في جولات 92–94 وتم التحقق منه هنا):** جدول الطلبات/المستخدمين/المخاطر لها نسخ بطاقات `md:hidden` (orders.tsx:1087, users.tsx:909, risk.tsx:332) و`overflow-x-auto` للطاولات المكتبية (orders.tsx:892, users.tsx:812, risk.tsx:276) — coupons/referrals صفوف flex→grid متجاوبة (coupons.tsx:507, referrals.tsx:418)؛ الحوارات bottom-sheet مع حراسة `!loading` عند الإغلاق أثناء الإرسال (topups.tsx:152, 244)؛ حوار تعديل المستخدم رُحّل إلى AppDialog مع `dismissable={!saving}` (users.tsx:592-599)؛ خطأ التحميل ≠ فراغ كاذب في orders/users/topups/products/risk/promotions؛ الترقيم «تحميل المزيد» لطلبات/شحن الأدمن؛ QueryClient مضبوط للجوال (retry:1, staleTime 60s, refetchOnWindowFocus/Reconnect false — App.tsx:179-199)؛ منع سباقات البحث الشامل بـAbortController (layout.tsx:273-313)؛ letter-spacing العربي أُصلح (94-C2)؛ الحدود: كل مسارات القوائم مقيدة (products≤500, orders/topups/users≤200, alerts≤200, notifications=40)؛ لا يوجد N+1 (all SQL aggregation/joins)؛ ضغط gzip + ETag قوي + cache-control صحيح؛ Sentry منقّى PII.
**أثر ذلك:** ما تبقّى من مشاكل «الجوال البنيوية» على الواجهة قليل ومحدود — الحجم الأكبر للنتائج انتقل إلى **سلوك الشبكة المتقطعة** (socket/timeout/idempotency) وهو ما تركز عليه هذه الجولة.

---

## جدول الملخص

| #   | الخطورة | المنطقة  | العنوان                                                                                           | الموضع                                                              |
| --- | ------- | -------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| M1  | P1      | شبكة     | عميل Socket.io يتوقف نهائيًا بعد 5 محاولات — لا شيء يبعثه                                         | frontend/src/lib/socket.ts:38                                       |
| M2  | P1      | مال      | POST /api/wallet/topups بلا idempotency إطلاقًا (إرسال + خلفي)                                    | backend/src/routes/wallet.ts:120                                    |
| M3  | P1      | شبكة     | لا مهلة زمنية لأي طلب API في الواجهة (customFetch + raw fetch بلا signal)                         | shared/api-client-react/src/custom-fetch.ts:387                     |
| M4  | P2      | مال      | checkout: فشل الشبكة بعد نجاح جزئي يُبقي الوحدات المشتراة في السلة — إعادة المحاولة تشتريها مرتين | frontend/src/pages/checkout.tsx:364-371, 450-458                    |
| M5  | P2      | شبكة     | لا إعادة مزامنة بيانات عند reconnect (الأحداث الفائتة غير مرئية حتى 5 دقائق)                      | frontend/src/lib/socket.ts:13-29 + App.tsx:196                      |
| M6  | P2      | جوال     | حقول TOTP بلا inputMode="numeric" (كيبورد حروف على أندرويد لرمز 6 أرقام)                          | admin/login.tsx:147-159 + admin/settings.tsx:426-433                |
| M7  | P2      | جوال/PII | بطاقات الطلبات على الجوال تُظهر بيانات التسليم نصًا صريحًا بلا قناع ولا زر نسخ                    | admin/orders.tsx:1136-1154                                          |
| M8  | P2      | جوال     | محرر المخزون المضمّن: أهداف لمس 18px + اختصارات كيبورد فقط (Enter/Esc)                            | admin/products.tsx:135-163                                          |
| M9  | P2      | جوال     | زرا «تأكيد أرشفة/إلغاء» المتجاوران (أيقونتان ~28px بمسافة 4px) لفعل تدميري                        | admin/products.tsx:1041-1071                                        |
| M10 | P2      | خلفي     | قوائم الأدمن تفكّ التشفير وتشحن بيانات التسليم لكل صف (حتى 600 عملية GCM لكل تحديث)               | backend/src/routes/admin/orders.ts:106-108 + routes/wallet.ts:90-96 |
| M11 | P3      | شبكة     | risk.tsx يستقصي كل 30 ث بلا `refetchIntervalInBackground:false` — تبويب خامل يستهلك بيانات الجوال | admin/risk.tsx:95                                                   |
| M12 | P3      | جوال     | أزرار الشريط العلوي ~28px (همبرغر/بحث/سمة/تحديث)                                                  | admin/layout.tsx:843-903                                            |
| M13 | P3      | جوال     | تلميحات لوحة المفاتيح (↑↓/↵/⌘K) تُعرض على الأجهزة اللمسية بلا مكافئ                               | admin/layout.tsx:536-555                                            |
| M14 | P3      | مال      | `loyalty_points`: min="0" لا يمنع كتابة سالب (يُرسل -5) — فجوة r94 P3-13 ما زالت حية              | admin/users.tsx:712-719                                             |
| M15 | P3      | خلفي     | /admin/alerts/new يجلب آخر 50 ثم يرشّح بـJS بدل WHERE id > since                                  | backend/src/routes/admin/alerts.ts:83-93                            |
| M16 | P3      | مراقبة   | Sentry Replay onError=1.0 — كل خطأ شبكة جوال يرفع تسجيلًا عبر نفس الشبكة المتعثرة                 | frontend/src/instrument.ts:93                                       |
| M17 | P3      | خلفي     | لا مهلة HTTP على مستوى المسار (Node الافتراضية دقائق؛ DB وحدها محدودة بـ15 ث)                     | backend/src/app.ts (لا middleware timeout)                          |
| M18 | P3      | جوال     | أخطاء 2FA توست فقط بينما أخطاء كلمة المرور inline — عدم اتساق في نفس النموذج (r94 P3-12)          | admin/login.tsx:54-77                                               |

**الأعداد:** P0: 0 · P1: 3 · P2: 7 · P3: 8 — **18 نتيجة**.

---

## P1 — نتائج حرجة

### M1) عميل Socket.io يتوقف عن المحاولة نهائيًا بعد 5 محاولات — القناة اللحظية تموت لبقية الجلسة

**الموضع:** `frontend/src/lib/socket.ts:36-47`

```ts
socket = io(socketUrl || undefined, {
  autoConnect: false,
  reconnectionAttempts: 5,
  withCredentials: true,
});
```

**الدليل:** لا يوجد أي مستمع `reconnect_failed` ولا `window.addEventListener("online")` ولا `visibilitychange` يلامس السوكت (rg: صفر مطابقات عدا web-vitals وNotificationBell). السوكت singleton على مستوى الوحدة (`let socket: Socket | null`)، و`connectSocket()` تُستدعى فقط عند تغيّر `userId`/`adminToken` (use-socket.ts:143, SocketInitializer.tsx:111). بخلفية socket.io الافتراضية (delay 1s ×2 مضاعفة + عشوائية)، 5 محاولات ≈ 31 ثانية من المحاولة ثم استسلام دائم.

**سيناريو الجوال:** مشغّل يفتح طابور الشحن من هاتفه؛ دخول مصعد/نفق لـ45 ثانية أو تنقل WiFi→خلوي → المدير يستنفد المحاولات ويسقط. عند عودة الشبكة **لا شيء يعيد الاتصال**: لا تحديثات `admin-stats-update` (إبطال فوري للطلبات/الشحن/المستخدمين)، لا `admin-alert-new`، لا toasts التنبيهات. اللوحة تتراجع صامتة إلى دوران 5 دقائق (layout.tsx:590, topups.tsx:437, orders.tsx:197) دون أي مؤشر للمشغّل أن الوضع «لحظي» أم «متجمد» — طابور مال يبدو محدّثًا وهو كذلك منذ دقائق.

**الإصلاح المقترح:**

1. احذف سقف `reconnectionAttempts` (اتركه Infinity مع `reconnectionDelayMax: 10_000`).
2. أضف `socket.on("connect", ...)` موجودًا فعلًا — وسّعه ليطلق إبطال استعلامات المال مرة واحدة عند إعادة الاتصال التي أعقبت انقطاعًا (انظر M5).
3. أضف `window.addEventListener("online", () => socket.connect())` + `visibilitychange` (عند العودة للواجهة) — بعث السوكت إن لم يكن متصلًا.

---

### M2) POST /api/wallet/topups — مسار مال بلا idempotency من الطرفين

**الموضع الخلفي:** `backend/src/routes/wallet.ts:120`

```ts
router.post("/topups", requireUser, riskSoftBlockGuardMiddleware(), async (req, res) => {
```

(قارن بـ`routes/orders.ts:108-112` الذي يركّب `idempotency({ routeKey: "orders.create" })` — هنا لا شيء.)
**الموضع الأمامي:** `frontend/src/pages/wallet.tsx` — rg: لا استيراد لـ`generateIdempotencyKey` في الملف كله (المستوردون فقط checkout + admin orders/referrals/users/topups). الحارس الوحيد `disabled={submitting || topupMutation.isPending}` (wallet.tsx:1000, 1123) — يمنع النقر المزدوج لا إعادة الإرسال الشبكية.

**الحواجز الموجودة ولا تكفي:**

- `MAX_PENDING=3` مع advisory lock (wallet.ts:191-235) — يمنع ما بعد 3 طلبات معلقة، أي يسمح بثلاث نسخ مكررة لنفس التحويل.
- dedup الموافقة في `TopupService.approve` يعمل **فقط عند وجود payment_reference غير فارغ** — topup.service.ts:208-213: _"Empty/null references carry no dedup signal and are allowed"_، وحقل المرجع اختياري في الواجهة (wallet-submit.test.tsx:126 «omits payment_reference when the user left it blank (optional field)»).

**سيناريو الجوال (أسوأ مسار مالي متبقٍّ):** مشترٍ على 3G ضعيف يضغط «إرسال» → الطلب يصل ويُدرج pending → الاستجابة تضيع → الواجهة تعرض خطأ الشبكة → المستخدم يعيد الإرسال (مفتاح… لا يوجد أصلًا) → صفّا pending متطابقان **بلا مرجع** → المشغّل يوافق على الاثنين (كل واحد يجتاز حارس status `pending`) → **إيداع مزدوج لنفس التحويل**. checkout محميًا بالمفتاح لكل وحدة؛ هذا المسار هو نظيره غير المحمي.

**الإصلاح المقترح:**

1. خلفيًا: ركّب `idempotency({ routeKey: "wallet.topups.create" })` بعد `requireUser` (نفس نمط orders.ts:112 — الـsubject هو userId تلقائيًا).
2. أماميًا: أرسل `Idempotency-Key: generateIdempotencyKey()` لكل إرسال منطقي (نمط checkout.tsx:359) — مفتاح واحد يثبت على «هذا النموذج» حتى يرى المستخدم نتيجته أو يغيّر القيم.
3. (اختياري تعزيزي) اجعل composite soft-dedup في الموافقة يغطي الطلبات عديمة المرجع (نفس المستخدم + نفس المبلغ + نفس sender_phone خلال نافذة قصيرة) بطلب تأكيد من المشغّل.

---

### M3) لا مهلة زمنية لأي طلب API في الواجهة — الطلبات قد تتدلى لدقائق

**الموضع:** `shared/api-client-react/src/custom-fetch.ts:387`

```ts
const response = await fetch(input, { ...init, method, headers });
```

لا `signal` افتراضي ولا AbortSignal.timeout — وكل الـraw fetch في صفحات الأدمن كذلك بلا signal (layout.tsx:654 poller، risk.tsx:91/104، security.tsx، coupons.tsx:83، topups approve POSTs...). الخلفي يحدّد استعلامات DB بـ15 ث (`shared/db/src/index.ts:57-82` statement_timeout) لكن لا مهلة HTTP للمسار؛ Node الافتراضي `requestTimeout` = 300 ث.

**سيناريو الجوال:** NAT mapping ميت أو بداية باردة لـRender → الطلب يعلّق في الهواء دقائق. TanStack Query يبقى `pending` (skeleton بلا نهاية)؛ أزرار المال تعرض «جارٍ...» معطّلة بلا أي إشارة أن الطلب ميت — والمشغّل على هاتفه لا يستطيع تمييز «بطء» من «انقطاع». مع `retry: 1` (App.tsx:186) المحاولة الوحيدة الثانية تبدأ بعد انتهاء الأولى فقط — أي ضعفُ المدة الكاملة.

**الإصلاح المقترح:** في customFetch: مهلة افتراضية `AbortSignal.timeout(20_000)` تُدمج مع أي signal يمرره المتصل (إن وُجد) عبر `AbortSignal.any`؛ وفي queryFn للصفحات: `signal: context.signal` (يدمجها TanStack مع إلغاء إلغاء التركيب). ابدأ بالمسارات الحية (طلبات/شحن/تنبيهات) ثم عمّم.

---

## P2 — نتائج مهمة

### M4) checkout: فشل الشبكة بعد نجاح جزئي يُبقي الوحدات المشحونة في السلة — «إعادة المحاولة» تعيد شراءها

**الموضع:** `frontend/src/pages/checkout.tsx:364-371` + `450-458`

```ts
} catch (e) {
  if (!isHttpApiError(e)) {
    // Network-level failure: this unit's server state is UNKNOWN ...
    throw e;   // ⇒ يقفز إلى الـcatch الخارجي متجاوزًا خطوة مزامنة السلة
```

التعليق يدّعي أن تخطي المزامنة يمنع إعادة الشراء — المنطق معكوس: تخطي المزامنة يعني أن الوحدات التي **نجحت** فعليًا (وتلقت مفاتيح idempotency مستهلكة) تبقى في السلة، و`created` يُهمل عند إعادة الرسم. عند إعادة المحاولة يُسكّ مفتاح **جديد** لكل وحدة (checkout.tsx:348-359) ⇒ الخادم يعاملها وحدات جديدة ⇒ خصم مزدوج. الـcatch الخارجي يحدّث الرصيد/قائمة الطلبات (450-458) فيرى المستخدم الطلب الناجح في «آخر الطلبات» — لكن لا شيء يخبره صراحة أن السلة ما زالت تحوي وحدات مدفوعة.

**سيناريو الجوال:** سلة 3 وحدات؛ الوحدة 1 تنجح ثم تنقطع الشبكة أثناء الوحدة 2 → رسالة خطأ + السلة كما هي (3 وحدات) → المستخدم يضغط «تأكيد الطلب» مجددًا → الوحدة 1 تُشترى مرة ثانية بمفتاح جديد.

**الإصلاح المقترح:** احتفظ بمفتاح كل وحدة حتى تُحسم نتيجتها (خريطة `productId→key` في الحالة أو sessionStorage؛ عند إعادة المحاولة **أعد استخدام** المفتاح نفسه — replay الخادم يعيد الطلب الأصلي بلا خصم جديد)، أو — كحد أدنى — بعد فشل شبكي أعِد جلب قائمة الطلبات وطالب المستخدم بإزالة الوحدات الظاهرة فيها قبل السماح بإعادة الإرسال (banner صريح: «طلبات هذه الوحدات نُفِّذت بالفعل»).

### M5) لا إعادة مزامنة عند reconnect — الأحداث الفائتة أثناء الانقطاع غير مرئية حتى الدورة التالية

**الموضع:** `frontend/src/lib/socket.ts:13-29` — معالج `connect` يعيد الانضمام للغرف فقط؛ + `App.tsx:189-196` (`refetchOnReconnect: false` — قرار موثق لتجنب عواصف الاتصال).
**الأثر مع M1/M3:** حتى في السيناريو الذي ينجح فيه reconnect: طلب رُفض/شحن اعتُمد أثناء 60 ثانية انقطاع لن يظهر في أي مكان حتى (أ) إعادة تركيب الاستعلام عند التنقل بعد انقضاء staleTime 60 ث، أو (ب) دورة 5 دقائق، أو (ج) حدث لاحق على السوكت. المشغّل الذي يحدّق في الصفحة نفسها يرى حالة قديمة بصمت.
**الإصلاح المقترح:** في `connectSocket/connectAdminSocket`: عند إطلاق `connect` **بعد انقطاع موثّق** (علم `wasDisconnected` يُرفع في `disconnect`) أطلق حدثًا (`SOCKET_RESYNC_EVENT`) يستمع له SocketInitializer فيبطل مرة واحدة استعلامات `[ "/api/admin/stats" | orders | topups | users ]` — دفعة واحدة لكل reconnect لا لكل استعلام: يحقق الهدف دون عاصفة الاتصال التي تخشاها التعليقات.

### M6) حقول TOTP بلا inputMode="numeric" — كيبورد الحروف لرمز من 6 أرقام

**الموضع:** `frontend/src/pages/admin/login.tsx:147-159` و`frontend/src/pages/admin/settings.tsx:426-433` — كلاهما `type="text"`؛ login فيه `autoComplete="one-time-code"` (يفيد الإكمال التلقائي لـSMS OTP فقط لا لـTOTP من تطبيق المصادقة) وsettings بلا حتى ذلك.
**سيناريو الجوال:** على أندرويد يفتح كيبورد QWERTY كاملًا؛ المشغّل يبدّل إلى الرقمي يدويًا عند **كل دخول** للوحة من الهاتف — احتكاك يومي على أهم بوابة أمنية، وزيادة أخطاء الإدخال (وتستنفد محاولات 2FA).
**الإصلاح:** أضف `inputMode="numeric"` + `pattern="[0-9]*"` لكليهما (+`autoComplete="one-time-code"` في settings). سطر واحد لكل موضع.

### M7) بطاقات الطلبات على الجوال: بيانات التسليم نصًا صريحًا بلا قناع ولا نسخ

**الموضع:** `frontend/src/pages/admin/orders.tsx:1136-1154` — توسيع بطاقة order على الهاتف يعرض `delivered_email`/`delivered_password` بخط mono صريح؛ لا CopyButton (بينما صفوف الشحن لديها CopyButton لكل قيمة — topups.tsx:1053-1083) ولا قناع إظهار-بنقرة (متجر العميل لديه النمط). r94 P3-14 سجّل غياب القناع للنسخة المكتبية — النسخة الجوالة أخطر (كتف-على-الكتف في مكان عام) وأشد حاجة للنسخ (استحالة نسخ كلمة مرور طويلة يدويًا من شاشة هاتف).
**الإصلاح:** قناع افتراضي `••••••` + زر عين للإظهار + CopyButton بنمط topups — على النسختين الجوالة والمكتبية.

### M8) محرر المخزون المضمّن: أهداف لمس 18px واختصارات كيبورد لا وجود لها على اللمس

**الموضع:** `frontend/src/pages/admin/products.tsx:135-163` — input `w-16 h-6` (24px) وزرا حفظ/إلغاء `p-0.5` بأيقونات `w-3.5` (≈18px) متجاوران بفارق `gap-1`؛ الحفظ/الإلغاء عبر Enter/Escape فقط (سطرا 141-144). يُعرض داخل بطاقات الجوال أيضًا (سطر 992-1000 — نفس المكوّن InlineStockEdit).
**سيناريو الجوال:** تصحيح مخزون منتج من الهاتف: إصبع بالغ يضغط زر ✅ 18px — miss متكرر يضرب زر ✕ (إلغاء) أو input؛ لا يمكن الاعتماد على Enter لأنه غير موجود. فعل **بيانات/مال** (المخزون يغذي البيع) بأهداف دون ثلث الحد الأدنى الموصى به (44px).
**الإصلاح:** على الجوال (`md:hidden` أو دائمًا): صف أزرار `h-9` بنص عربي («حفظ»/«إلغاء») + `gap-2` + input `h-9` — أو تحويل التحرير إلى InventoryUploadDialog المصير (ناضج ومُختبر).

### M9) زرا «تأكيد الأرشفة/إلغاء» المتجاوران — فعل تدميري بأيقونتين ~28px

**الموضع:** `frontend/src/pages/admin/products.tsx:1041-1071` — بعد الضغط على سلة المهملات تظهر بدلها زرّا Archive/X (`h-8 px-2` بأيقونات w-3) بفارق `gap-1`. على هاتف، انزلاق الإبهام 4px يحوّل «إلغاء» إلى **أرشفة المنتج** (قابلة للتراجع فقط عبر قاعدة البيانات — الأرشفة terminal في UI المنتجات).
**الإصلاح:** استخدم `useConfirm()` الموجود أصلًا في نفس الصفحة للـbulk (سطر 192-194) لتأكيد الأرشفة المفردة أيضًا — حوار بمعاينة اسم المنتج وأزرار 44px+، أو أضف نصًا + min-w وgap للزرين.

### M10) قوائم الأدمن تُفكّ التشفير وتشحن بيانات التسليم لكل صف — ثقل CPU وPII على كل تحديث

**الموضع:** `backend/src/routes/admin/orders.ts:106-108`

```ts
delivered_email: safeDecrypt(r.order.deliveredEmail),
delivered_password: safeDecrypt(r.order.deliveredPassword),
delivered_extra_details: safeDecrypt(r.order.deliveredExtraDetails),
```

حتى 200 صف × 3 حقول = **600 عملية AES-GCM لكل استجابة**، وكل استدعاء يُشحن كلمة المرور/البريد عبر الشبكة لكل الصفوف حتى دون توسيع أي صف. المسار يُستدعى عند: التحميل، دورة 5 دقائق، وكل إبطال `admin-stats-update` (SocketInitializer.tsx:79-82 — يُطلق مع كل موافقة/رفض شحن وتحديث حالة جماعي). نفس النمط في `routes/wallet.ts:90-96` (5 طلبات × 3 حقول لكل جلب محفظة). مع gzip يهبط الحجم لكن يبقى PII كاملًا في كل payload.
**سيناريو الجوال:** مشغّل على شبكة خلوية يفتح الطلبات → مئات الكيلوبايتات من بيانات اعتماد لم يطلبهاا + زمن خادم (CPU) مضاعف في كل refresh — وأي TLS misconfiguration مستقبلية تكشف كل creds القائمة دفعة واحدة.
**الإصلاح:** أزل حقول التسليم من استجابة القائمة (أو خلف `?include=credentials=1`) ودع توسيع الصف يجلب `GET /api/admin/orders/:id/credentials` عند الطلب — تخفيف payload الشبكي، CPU الخادم، وسطح PII في آن واحد. (حافظ على `no-store` الموجود.)

---

## P3 — تحسينات دقيقة

11. **M11) risk.tsx:95** — `refetchInterval: 30_000` بلا `refetchIntervalInBackground: false` (كل الاستقصاءات الأخرى تضبطه false — orders.tsx:198, products.tsx:213, alerts.tsx:209...). مشغّل يترك تبويب مراقبة المخاطر مفتوحًا على هاتفه → استقصاء 2/دقيقة على بيانات الجوال طالما التبويب حي. سطر واحد.
12. **M12) layout.tsx:843-903** — أزرار topbar (همبرغر/بحث/سمة/تحديث) `p-1.5` بأيقونات w-4 → ≈28×28px. دون حد 44px لكن متجمعة وقريبة من حافة الشاشة (أصعب منطقة للإصبع). اعتبر `p-2` + `w-5` icons.
13. **M13) layout.tsx:536-555** — تذييل البحث الشامل يَعِد ↑↓/↵/esc/⌘K على الجوال أيضًا (بلا تلميح لمسي مكافئ ولا مفتاح تشغيل لمسي). إما إخفاء kbd hints تحت `hidden sm:flex` أو إضافة زر إغلاق مرئي (موجود عبر النقر على الخلفية فقط).
14. **M14) users.tsx:712-719** — `loyalty_points` بـ`min="0"` فقط؛ `parseInt("-5")=-5` يُرسل (المحفظة مُتحقق منها client-side، النقاط لا — r94 P3-13 باقٍ). clamp في handleSave: `Math.max(0, parseInt(...)||0)`.
15. **M15) backend/src/routes/admin/alerts.ts:83-93** — `/new?since=` يجلب `getAdminAlerts(50)` ثم `filter(a => a.id > sinceId)` في JS. استقصاء كل 5 دقائق من كل صفحة أدمن مفتوحة. دفعه لـSQL: `WHERE id > sinceId ORDER BY id DESC LIMIT 20`.
16. **M16) frontend/src/instrument.ts:93** — `replaysOnErrorSampleRate: 1.0`: كل خطأ JS (ومنها أخطاء الشبكة) على جوال يرفع Session Replay عبر نفس الشبكة المتعثرة. maskAllText مفعّل (لا PII نصي) لكن الكلفة عالية بلا داعٍ على الجوال. اعتبر 0.5 أو تصفية حسب `navigator.connection`.
17. **M17) backend/src/app.ts** — لا middleware مهلة على مستوى الطلب (مثل `express-timeout-handler` أو ضبط `server.requestTimeout/headersTimeout` صراحة). DB محدودة 15 ث (R4) والطلبات الخارجية لها AbortSignal.timeout(10s) — لكن أي انتظار غير DB (copilot LLM طويل مثلًا) بلا سقف HTTP صريح. توثيق/ضبط `requestTimeout=60s` يغلق الفجوة.
18. **M18) admin/login.tsx:54-77** — أخطاء verify-2FA تظهر **توست** بينما أخطاء كلمة المرور inline (نفس النموذج، تجربتان مختلفتان) + `await res.json()` قبل فحص ok (unsafe parse — r94 P3-12 باقٍ). وحده `verify2FA` raw-fetch بلا `r.ok` guard في صفحة الدخول كلها.

---

## ما تم التحقق منه سليمًا (تثبيتًا لعدم التدهور — لا تُعِد تدقيقه)

- **الهيكل الجوال (390px):** drawer خارج-القماش `w-[min(18rem,85vw)]` بدلالات dialog + ESC (layout.tsx:819-837)؛ `safe-area-inset-bottom` في الحاوية (layout.tsx:907)؛ كل صفحات القوائم ببطاقات `md:hidden` أو صفوف متجاوبة؛ أشرطة الأفعال الجماعية `flex-wrap`؛ الحوارات bottom-sheet على الجوال (`items-end sm:items-center` — topups.tsx:148).
- **المال في الأدمن:** Idempotency-Key لكل نقرة (topups approve/reject/bulk، users PATCH، referrals credit، orders bulk-status) + `Idempotent-Replayed` replay؛ تأكيد بمعاينة مبلغ؛ حراسة ازدواج النقر processingId؛ رفض 207 بأسباب عربية؛ refunds عبر RefundService بحارس status + ledger داخل tx.
- **الخلفي للجوال:** gzip compression (app.ts:326)؛ ETag قوي (app.ts:283)؛ `Cache-Control` صحيح المصفوفة (products: `s-maxage=60, SWR=300`؛ orders/wallet/cart/notifications/admin-auth: `no-store`؛ auth/me: `private, max-age=30`؛ SEO: `public, max-age=300`)؛ Vercel assets `immutable 1y` + HTML `no-cache`؛ حدود الأجسام 1mb (app.ts:608)؛ rate limits (auth 10/15min يشمل admin login + verify-2fa؛ anon 600/min مع مراعاة CGNAT الليبي — app.ts:427-431؛ user 1200/min؛ coupons 10/min)؛ statement_timeout 15s + keepalives (shared/db/src/index.ts)؛ stats مخزّنة 30s (admin/stats.ts:36)؛ لا N+1 (تجميع SQL + joins)؛ كل القوائم مقيدة الصفوف.
- **Socket.IO الخلفي:** مصادقة handshake (origin + JWT مزدوج + رفض temp-token 2FA) + إعادة تحقق DB كل 5 دقائق مع قطع الغرف الملغاة؛ ping 25s/timeout 20s/connectTimeout 30s صراحة؛ maxHttpBufferSize 64KB؛ redis adapter (lib/socket.ts:558-594).
- **Sentry:** خلفي 10% traces مع استبعاد المسارات الصاخبة + تعقيم PII عميق قبل الإرسال (lib/sentry.ts:319+)؛ أمامي 10% traces/replay مع maskAllText + blockAllMedia.
- **charts:** ResponsiveContainer بارتفاعات ثابتة (160/120)؛ حالة فارغة صريحة لمخطط الكوبونات (dashboard.tsx:696-701)؛ أعمدة الرسوم تُخفى عند `chartData.length === 0` (dashboard.tsx:852) — لا crash مع 0 نقاط؛ الحِمل lazy-chunked.

## خطة الإصلاح المقترحة (الأولوية بالترتيب)

1. **M2** (idempotency للشحن — أعلى قيمة/أقل جهد: middleware + هيدر)
2. **M1 + M5** (سوكت لا يستسلم + resync عند العودة — نفس الملف تقريبًا)
3. **M3** (مهلة افتراضية في customFetch)
4. **M6** (inputMode — سطران)
5. **M4** (إعادة استخدام مفتاح الوحدة عند إعادة المحاولة بعد فشل شبكي)
6. بقية P2 (M7-M10) ثم P3 حسب الطلب.

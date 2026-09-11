# الجولة 97 — أعمق تدقيق E2E لقناة WhatsApp/OpenWA OTP (R97-A5)

**الوكيل:** R97-A5 (تشخيص فقط — صفر تعديلات على المصدر، صفر كوميتات)
**النطاق:** المسار الكامل للـOTP من زر الواجهة حتى هاتف المستخدم:
`WhatsAppPhoneSignIn.tsx → /api/auth/whatsapp/start → whatsapp-otp.service → openwa.service (settle gate + warm-up + retry) → openwa-gateway (index.ts / lib.ts / persist.ts / dashboard*.ts) → Baileys → WhatsApp`
**الحالة الحيّة لحظة الفحص** (تحقق مباشر read-only ضد البوابة والخلفي):

- `GET /healthz` → `{ok:true, sessions:1, ready:0, dashboard:true}`
- `GET /api/sessions` → `sess_cjAv55GlDZIA7Exl` / `subnation-otp` / **status `qr_ready`** / createdAt `2026-09-09T02:33:18Z` / lastReadyAt `2026-09-10T17:24:40Z` (قديم — من الاقتران الميت) / lastDeliveryStatus `"2"` / accountDigits `218910089975` / persistAgeMs ≈ 118 ثانية **أثناء qr_ready** (دليل حي على WA-02 أدناه)
- `GET /api/auth/providers` (الخلفي) → `whatsapp_enabled:true, whatsapp_status:"qr_ready"` — صادق ✓
- `GET /api/sessions/:id/delivery-log` → رسالتا OTP بتاريخ 2026-09-22:02 و23:31 إلى `218914460503`، timeline كلٍّ منهما: `3` (DELIVERY_ACK بعد ~4 ث) ثم **رجوع إلى `2`** بتوقيت واحد مطابق `2026-09-10T14:32:38` (لحظة إبطال الاقتران) — دليل حي على WA-04.

---

## المنهجية

1. قُرئ `worklog.md` (جولات 95–96 + R97-A2/A3) و`docs/inspection-r97/security-redteam.md` كاملًا لاستبعاد المُبلَّغ (R97-04/05 الخاصة بالبوابة لن تُعاد صياغتها إلا بالإضافات الجديدة فقط).
2. قُرئ سطرًا-سطرًا: `backend/src/services/openwa.service.ts` (1201 سطر) · `whatsapp-otp.service.ts` · `lib/whatsapp-otp.ts` · `lib/crypto.ts (normalizeLibyanPhone)` · `routes/auth-whatsapp.ts` · `routes/auth-settings.ts (whatsapp_status)` · `routes/admin/diagnostics.ts (whatsapp/*)` · `server.ts (warm-up wiring)` · `jobs/cron.ts (prune)` · `services/alerting.service.ts (ALERT_RULES)` · `frontend WhatsAppPhoneSignIn.tsx + use-public-auth-providers.ts + login.tsx + pages/admin/whatsapp.tsx`.
3. قُرئ مستودع `openwa-gateway` كاملًا: `src/index.ts` (975) · `lib.ts` · `persist.ts` · `dashboard.ts` · `dashboard-routes.ts` · `dashboard-html.ts` · `tests/lib.test.mjs` · `Dockerfile/package.json` — وتحقق أن `dist/` مبني من نفس المصدر (mtime متطابق + مطابقة مقاطع `loggedOut/keep-alive`).
4. **تحديد دلالات حالات التسليم من البروتوكول نفسه**: من `node_modules/@whiskeysockets/baileys/WAProto/WAProto.proto:4397-4404` — enum `WebMessageInfo.Status`:
   `0=ERROR · 1=PENDING · 2=SERVER_ACK · 3=DELIVERY_ACK · 4=READ · 5=PLAYED`
   إذن `lastDeliveryStatus:"2"` = **وصلت خادم WhatsApp ولم يُؤكَّد وصولها لهاتف المستلم بعد** — ليست حالة سيئة بذاتها، لكنها ليست دليل تسليم.
5. فحوص حيّة read-only فقط: `GET /healthz` · `GET /api/sessions` · `GET /api/sessions/:id/delivery-log` · `GET /api/auth/providers`. لم تُرسل رسائل، لم تُطلب pair-codes، لم تُمس جلسات.
6. تتبّع سيناريوهات: إعادة اقتران بنفس معرف الجلسة، إقلاع البوابة، إعادة نشر الخلفي، موت الجلسة 3am، تعدد الجلسات مستقبلًا.

**الحصيلة:** 12 نتيجة (2×P1 · 5×P2 · 5×P3) + قسم «مؤكد سليم» + إجابات مباشرة على أسئلة التكليف الثمانية + مخطط انتقال الحالات.

---

## النتائج

### 🔴 [P1] R97-WA-01 — بوابة settle + warm-up «لمرة واحدة لكل معرف جلسة»: إعادة الاقتران بنفس المعرف تتجاوزهما كليًا — نفس فئة حادثة «Waiting for this message» الإنتاجية

- **أين (الخلفي):** `backend/src/services/openwa.service.ts`
  - `:270-272` — `recordReadySince` تعيد الطابع الزمني **المعروف مسبقًا** بلا أي كشف لإعادة اقتران:
    ```ts
    const known = sessionReadySince.get(session.id);
    if (known !== undefined) return known;
    ```
  - `:239-243` — `sessionReadySince`/`dispatchReady` مفاتيحها معرف الجلسة فقط.
  - `:255-258` — `isWarmupOk` يقرأ `dispatchReady` الذي **يبقى true** من الاقتران القديم.
  - `:278-291` — مرآة Redis تتبنّى طابع الاقتران **القديم** عند الإقلاع البارد (TTL 7 أيام) → التجاوز ينجو حتى من إعادة نشر الخلفي (شريط أن Redis موجود).
- **أين (البوابة — السبب):** `openwa-gateway/src/index.ts:379-395` — معالج `loggedOut` يمحو creds محليًا وفي DB لكنه **يُبقي نفس صف RuntimeSession ونفس المعرف**؛ إعادة الاقتران تتم عبر `POST /start` على نفس المعرف.
- **الدليل الحي:** الجلسة الحالية `sess_cjAv55GlDZIA7Exl` — `createdAt 2026-09-09T02:33` وقبل الإبطال كانت ready، والآن `qr_ready` **بنفس المعرف** — أي أن أول ready قادم سيُعلن تحت معرف سبق أن سُجّلت له حالة settle/dispatchReady في الخلفي.
- **السيناريو (الحالة الشائعة):** إبطال اقتران 3am (من هاتف المشغّل) → مشغّل يعيد الربط من اللوحة 9am → الخلفي **لم يُعِد الإقلاع** (لا أحد ينشر الخلفي لمجرد إعادة ربط واتساب) → `sessionReadySince[sess_x]` = طابع قديم ⇒ `settled=true` فورًا، و`dispatchReady[sess_x]=true` ⇒ `warmed=true` → أول OTP بعد الربط مباشرة يدخل نافذة توزيع المفاتيح غير المكتملة → «Waiting for this message» مجددًا. **الإصلاح ثلاثي الطبقات يعمل تمامًا لكل الحالات إلا الحالة التي حدثت فعلًا في الإنتاج (re-pair).**
- **لماذا لم تنفجر الآن؟** حظ مزدوج: الخلفي أُعيد نشره للتو (WHATSAPP_OTP_OPERATOR_E164) فمسح الذاكرة، وREDIS_URL غائب في الإنتاج (نتيجة R97-A3) فلا مرآة قديمة تُتبنّى. أي أن إعادة الاقتران الجارية هذه المرة ستمر عبر النافذة — **بالصدفة لا بالتصميم**.
- **الإصلاح (إشارة أقوى متاحة فعلًا على السلك):** البوابة تكشف `lastReadyAt`/`connectedAt` في `publicView` (index.ts:97-98, 138-142) لكن `SessionRecord` في الخلفي يهملهما (`openwa.service.ts:448-452`). اجعل `recordReadySince` يقارن: إذا `lastReadyAt` الوارد أحدث من المعروف بهامش > دقيقة ⇒ اعتبارها اقترانًا جديدًا ⇒ امسح النافذة و`dispatchReady` وأعد الجدولة. بديل أبسط: تتبّع آخر status مُشاهد؛ الانتقال غير-ready→ready بعد أن كان ready ⇒ re-arm. بديل بوابة-فقط: تصفير `lastReadyAt/accountDigits/connectedAt` عند loggedOut (يرمم أيضًا WA-02).

### 🔴 [P1] R97-WA-02 — البوابة تخزّن بيانات اعتماد **نصف-مربوطة** أثناء qr_ready لأن `rs.lastReadyAt` لا يُصفَّر عند loggedOut — نفس الانحدار الذي بُني باب «لا تحفظ قبل الاتصال» لمنعه، ومدعوم بأدلة حيّة الآن

- **أين:** `openwa-gateway/src/index.ts`
  - `:379-395` — loggedOut: `rs.status="failed"` + مسح مجلد creds ومحوه من DB — **لكن دون تصفير `rs.lastReadyAt` / `accountDigits` / `accountLidDigits` / `connectedAt` / `lastDeliveryStatus` / `deliveryLog`**.
  - `:211-215` و`:259-262` — باب الحفظ `if (rs.lastReadyAt) scheduleSave(...)` — يمر الآن لأن `lastReadyAt` **قديم وغير مُصفَّر**.
  - `:323-331` — أثناء محاولة pair-code، `creds.update` يطلق `persistSnapshot()` ⇒ كتابة creds **interim** إلى Neon.
- **الدليل الحي (لحظة الفحص):** الجلسة `qr_ready` مع `persistAgeMs=117840` (~دقيقتان) — أي أن `openwa_sessions` (الذي كان 0 صفوف بعد المسح) **يُملأ الآن بـcreds نصف-مربوطة**. التعليق الأصلي في `:325-328` يصف عاقبة هذا بالضبط: «كل إقلاع لاحق يستعيد بيانات اعتماد أبطلتها WhatsApp».
- **السيناريو:** مشغّل يطلب pair-code ثم يتأخر في إدخاله على الهاتف؛ البوابة تُعاد تشغيلها (نشر/spin-down رغم keep-alive) → boot auto-restore (`:911-933`) يستعيد الـblob الـinterim إلى المجلد → `useMultiFileAuthState` يقرؤه → حلقة اتصال/رفض محتملة (وأسوأها: الحالة ready القديمة المعروضة بلوحة الأدمن مع هوية «Ahmed Radwan/218910089975» بينما الجلسة فعليًا غير مربوطة — مضلل بصريًا أيضًا).
- **الإصلاح:** عند `loggedOut`: صفّر الحقول المذكورة + `rs.deliveryLog = []`، وبذلك يعود باب «لا تحفظ قبل إثبات الاتصال» صارمًا كما صُمم.

### 🟠 [P2] R97-WA-03 — «ready» = اتصال Baileys «open» فقط (بلا إشارة app-state sync)، ونجاح warm-up = HTTP 200 من المحرك لا ack تسليم — وdelivery-log الموجود لهذا الغرض غير موصول في الخلفي

- **أين:** `index.ts:350-371` (`connection:"open"` → ready فورًا) · `openwa.service.ts:341-381` (`runWarmupCycle` يقلب `dispatchReady` عند `result.ok` — و`engineSend` يعيد ok لحظة نجاح `sendMessage` = تشفير+تسليم للخادم، لا تسليمًا للهاتف) · `index.ts:880-882` — تعليق البوابة يقول «the OTP backend polls this [delivery-log] to verify an OTP actually reached the device» — **غير صحيح: صفر استدعاءات لـ/delivery-log في كل خلفي SubNation** (grep موثق).
- **السيناريو:** هاتف المستخدم بلا إنترنت/أعاد تثبيت واتساب/LID غير محلول ⇒ الرسالة تُشفر وتذهب للخادم (200 ok) ⇒ الخلفي يخزّن صف OTP ويعيد 200 للمستخدم «افحص واتساب» — والرسالة لن تظهر. لا أحد يراقب انتقال الحالة إلى `3`.
- **الإصلاح المقترح:** (أ) warm-up يقوي نفسه: بعد إرسال self-check، استطلع `/delivery-log` حتى يصبح `lastStatus >= "2"` (SERVER_ACK) أو `"3"` لمعرف الرسالة خلال مهلة ~10 ث قبل قلب `dispatchReady` — عندها تكون الجاهزية **إثباتًا end-to-end** لا timer؛ (ب) إشارات Baileys الأقوى المتاحة في `connection.update`: `isOnline`/`receivedPendingNotifications` — يمكن رفض ready قبلها؛ (ج) وصل استطلاع ack اختياري في مسار OTP (تحسين لاحق).
- **تقييم WHATSAPP_OTP_SETTLE_MS=45s تجريبيًا (سؤال التكليف):** مع تفعيل warm-up (المشغّل الآن مضبوط) تصبح مدة settle **ثانوية** — الـself-check هو البوابة التجريبية الحقيقية. الأدلة الحية: DELIVERY_ACK خلال ~4 ث على جلسة دافئة (delivery-log)، وتصميم r96 يقتبس 10–30 ث لانتشار مفاتيح pair-code. 45s كأرضية + إثبات تسليم = تركيبة سليمة لبيئة ليبيا؛ **بدون** operator E164 تظل 45s مؤقتًا أعمى بلا دليل.

### 🟠 [P2] R97-WA-04 — خط زمن التسليم غير رتيب والحالة قد «ترجع» من 3 إلى 2 (مدعوم حيًّا)، و`delivery` في استجابة send-text هي حالة الرسالة **السابقة**

- **أين:** `lib.ts:107-115` (`mergeDeliveryTimeline` يُلحق أي تغيير بلا حراسة رتابة) · `index.ts:282-321` (معالج `messages.update` يعيّن `lastDeliveryStatus` لآخر قيمة مهما كانت) · `index.ts:857` — استجابة send-text تضم `delivery: rs.lastDeliveryStatus ?? "pending"` وهي حالة **الرسالة السابقة** لا الحالية (اسم حقل مضلل).
- **الدليل الحي:** كلا رسالتي 09-09 تريان `3` بعد ~4 ث ثم `2` بتوقيت واحد `2026-09-10T14:32:38` (دفعة re-ack عند لحظة الإبطال) — أي أن `lastDeliveryStatus:"2"` التي رآها المشغّل هي **انحدار** من تسليم مُثبت، لا «تعثر إرسال».
- **الإجابة النظامية لسؤال «1/2/3»**: من `WAProto.proto` (أعلاه): `1=PENDING · 2=SERVER_ACK (وصلت الخادم) · 3=DELIVERY_ACK (وصلت الهاتف)`. `"2"` ليست سيئة — لكن يجب ألا تُقرأ كتسليم. تسميات لوحة البوابة (`dashboard-html.ts:240`) **صحيحة**: `2='وصلت للخادم' · 3='تم التسليم'`.
- **الإصلاح:** رتابة في الدمج (سلم الحالات؛ لا تُلحق إلا قيمة أعلى)، أو اجعل `lastDeliveryStatus = max(timeline)` — وأعد تسمية/احذف حقل `delivery` في استجابة send-text. السجل نفسه محدود (ring buffer 25/جلسة، ذاكرة فقط، لا نمو) ✓.

### 🟠 [P2] R97-WA-05 — كل نشر للخلفي يعيد فتح نافذة settle 45 ث + warm-up (بلا Redis — شكل الإنتاج الحالي)، وwhatsapp_status يُبلغ «settling» بغير صدق لجلسة مربوطة منذ أيام

- **أين:** `openwa.service.ts:274-295` — المرآة تُكتب فقط عند وجود Redis؛ مع غيابه (R97-A3: REDIS_URL غير موجود في بيئة Render الحالية) كل إقلاع خلفي يسجّل `readySince=now` ⇒ 45 ث «settling» + إعادة self-check قبل أي OTP. مع Redis: يُتبنّى الطابع المشترك (`:278-285`) فيمر settled فورًا، ويبقى فقط رسالة self-check واحدة لكل نشر (dispatchReady ذاكرة فقط — غير معكوس في Redis).
- **الأثر:** بعد كل deploy: نافذة ~45–60 ث تكون فيها القناة معلنة «settling» وأول مستخدم يحصل 503 + auto-retry (يُحل تلقائيًا — لكنه ضجيج غير ضروري ورسالة واحدة زائدة للمشغّل).
- **الإصلاح:** عكس `dispatchReady` في Redis أيضًا (`openwa:warmed:{sessionId}` بـTTL 6h مواكب لإيقاع warm-up)، والأهم: **إعادة REDIS_URL** (تُحيي أيضًا schedulers المعطلة — R97-A3).

### 🟠 [P2] R97-WA-06 — لا أي مراقبة/تنبيه لموت قناة WhatsApp: حادثة 3am لا ي noticesها أحد (إجابة سؤال «من يلاحظ؟»)

- **أين:** `services/alerting.service.ts:68-137` — `ALERT_RULES` الثمانية (api_5xx/auth_failure/firebase/fe-sentry/redis/neon/worker_heartbeat/p95/job_failures/lockouts) — **لا قاعدة WhatsApp إطلاقًا**؛ `alertLogger`/`stockWatcher` لا يلمسون البوابة؛ `getWhatsAppGatewayReadiness` يُستدعى فقط من `/api/auth/providers` (بمبادرة المستخدم) ولوحة الأدمن. لا أحد يقرأ حالة البوابة دوريًا.
- **السيناريو:** loggedOut 3am → status=failed لساعات → المستخدمون يرون «قيد الربط مؤقتاً» ويحصلون 503، وحلقة warm-up كل 6h تسجل warn وتنسى — **بلا صف alert، بلا Telegram، بلا Sentry**. هذه بالضبط الحادثة الحية: الاقتران أُبطل ولم يكتشف ذلك إلا فحص بشري.
- **التصميم المقترح للمراقبة المفقودة:** ticker كل 5 دقائق (داخل warm-up loop الموجود أصلًا أو job مستقل): `whatsapp_status ∉ {ready, settling}` لمدة > 15 دقيقة ⇒ alert severity=critical بقناة Telegram «قناة WhatsApp OTP غير جاهزة (status=failed/qr_ready منذ X) — تتطلب إعادة اقتران من لوحة الأدمن»؛ و`status=null` (بوابة غير قابلة للوصول) > 5 دقائق ⇒ warning. مع dedupe 1h. (البنية كلها جاهزة: alerting channels + admin_alerts.)

### 🟠 [P2] R97-WA-07 — persist.ts: تشفير creds بمفتاح مزدوج الاستخدام + salt ثابت عام + لا مسار تدوير + لا قفل تعدد نسخ (توسيع R97-05 بزوايا جديدة)

- **أين:** `openwa-gateway/src/persist.ts:23-25` — `scryptSync(API_KEY, "openwa-gateway-creds-v1", 32)` (salt ثابت في المستودع؛ المفتاح نفسه مفتاح HTTP) · `:34-41,138-148` — فشل فك التشفير بعد تدوير المفتاح ⇒ `loadCreds` → null ⇒ «يستأنف fresh» **بصمت**: فقدان الجلسة كلها بلا تمييز عن «لم تُربط قط» (لا `v2:` prefix ولا إعادة تشفير عند القراءة) · `:113-125` — `flushNow` يبتلع الأخطاء (log فقط): فشل flush الإيقاف غير مرئي (خسارة ≤300ms من signal state بسبب write-through السريع — محدودة) · لا `pg advisory lock`: نسختا Render (نشر متداخل قديم+جديد) تستعيدان نفس الاسم ⇒ كلاهما يفتح Baileys بنفس creds (multi-device يسمح ~4 أجهزة — يبقى الاثنان متصلين!) وupsert الأخير-يكسب يراكم snapshots متضاربة.
- **الإصلاح:** `OPENWA_CREDENTIALS_KEY` مستقل + إصدارات (`v2:`) مع إعادة تشفير عند القراءة + `pg_try_advisory_lock(hashtext(name))` حول restore/save + كشف `persistAgeMs` متقادم في `/healthz`.

### 🟡 [P3] R97-WA-08 — سلسلة الصدق للواجهة: failed/disconnected/qr_ready تُعرض جميعها بنفس تلميح «قيد الربط مؤقتاً»، والحالة تُجلب مرة واحدة عند التحميل (لا polling)

- **أين:** `WhatsAppPhoneSignIn.tsx:414-426` (تلميح واحد مشترك لكل حالة ≠ ready ≠ settling) · `use-public-auth-providers.ts:47-72` — جلب واحد عند mount بلا refetch؛ تعليق `openwa.service.ts:947-949` «the /api/auth/providers poll drives it» **غير دقيق** — لا يوجد poll، فقط جلب عند كل mount لصفحة الدخول.
- **الأثر الحالي:** خلال qr_ready الحالية يرى المستخدم «قناة WhatsApp قيد الربط مؤقتاً — يمكنك المحاولة، أو استخدم Google / Telegram الآن» (مقبول)، والمحاولة تعطي 503 whatsapp_not_paired. لكن **failed** (حالة دائمة تتطلب مشغّلًا) تُعرض بنفس صياغة «مؤقتاً» — كذب لطيف؛ و**null** (بوابة غير قابلة للوصول) لا تعرض أي تلميذ إطلاقًا والمحاولة تظهر «تعذّر إرسال الرمز عبر WhatsApp» كخطأ عام.
- **الإصلاح:** تمايز صياغة failed («القناة متوقفة مؤقتًا ويجري العمل على استعادتها») + polling كل 30–60 ث في صفحات الدخول (النقطة الخلفية مخبأة 30 ث أصلًا — رخيصة).

### 🟡 [P3] R97-WA-09 — pair-code: بلا rate-limit لكل جلسة/رقم، ولا يُرفض عند status=ready؛ ويحجب عرض QR (سلوك مقصود لكن غير موثق)

- **أين:** `index.ts:710-729` — تحقق رقم فقط (10–15 خانة) ثم `requestPairingCode`؛ `rs.qrString=undefined` (يخفي QR). مسار اللوحة `dashboard-routes.ts:206-223` كذلك بلا تحديد. طلب الرمز على جلسة ready: Baileys يرمي عادة (→ 500/502 «تعذر إصدار رمز الربط») — سلوك غير معرف بدل رفض صريح. صيغة الرمز: 8 حروف من Baileys (GTH9S4AK المرصودة) ✓. مسار الأدمن الخلفي: requireAdmin + writeAuditLog ✓.
- **الإصلاح:** رفض صريح 409 عند `status==="ready"` («الجلسة مربوطة») + حد 5 pair-codes/ساعة/جلسة (حماية من استنزافWhatsApp).

### 🟡 [P3] R97-WA-10 — `GET /api/sessions/:id/qr` (JSON) يعيد سلسلة QR **الخام** لحامل المفتاح أثناء الإقران (استيلاء على الحساب) — اللوحة تعيد صورة فقط (صحيح)

- **أين:** `index.ts:678-679` — `{ ..., qr: rs.qrString, qrImage }`. الخلفي يستهلك `qrImage` فقط (`openwa.service.ts:1130-1141`). امتداد مباشر لـR97-04 (A2): أزِل حقل `qr` الخام من JSON — بذلك تختزل سطح «مفتاح مسرّب = استيلاء على حساب واتساب» إلى مسار اللوحة المحمي بكوكي+قفل.

### 🟡 [P3] R97-WA-11 — تعدد الجلسات مستقبلًا: البنية الجوهرية جاهزة، لكن OTP routing وwarm-up والكاشات كلها أحادية-جلسة بالتصميم

- **أين:** `openwa.service.ts` — bookkeeping بالفعل per-session (Maps: `:239-243`) ✓، لكن: `readySessionCache` (`:159`) و`readinessCache` (`:907`) خانة واحدة عالمية (تبديد متبادل عند تعدد الجلسات = thrash بلا كسر صحة — TTL 30 ث يحصر الضرر)؛ `runWarmupCycle:349` `findSession(config)` يسخّن **الجلسة المضبوطة فقط**؛ `sendWhatsAppMessage` لا يعرف توجيهًا إلا WHATSAPP_OTP_SESSION. إدارة الأدمن (list/create/start/pair/delete) متعددة بالفعل. الحالة `authenticating` موجودة في النوع/الواجهات لكن **المحرك لا يضعها أبدًا** (قيمة ميتة — انتقالها الفعلي يظل qr_ready حتى open).
- **الأثر:** إضافة جلسة ثانية لن «تكسر» شيئًا — ستعمل كقناة إدارة فقط بلا OTP ولا warm-up ولا probe. المطلوب عند التفعيل الفعلي: config عبارة عن قائمة + توجيه (round-robin/failover) + warm-up لكل جلسة + probes لكل جلسة (الكاشات المفردة ستحتاج Map).

### 🟡 [P3] R97-WA-12 — فجوات توثيق/env صغرى

- `config/env.example:211-229` لا يذكر `WHATSAPP_OTP_SETTLE_MS` ولا `WHATSAPP_OTP_OPERATOR_E164` (موثقان في رأس openwa.service.ts فقط) — المشغّل الذي يقرأ env.example لا يعلم بوجودهما.
- README البوابة لا يوثق `PERSISTENCE_URL` / `RENDER_EXTERNAL_URL` (شرط keep-alive) / `DASHBOARD_USERNAME/PASSWORD/SESSION_SECRET` / `OPENWA_SELF_SEND_LID` — متغيرات تشغيلية حاسمة غير مرئية للمشغّل الجديد.
- قالب الرسالة (سؤال 5): نص ثابت حرفيًا (whatsapp-otp.service.ts:185) — المتغير الوحيد `${code}` (أرقام فقط) ⇒ **لا حقن مستخدم، لا relay phishing عبر القالب** ✓؛ يتضمن الصلاحية («صالح لمدة 5 دقائق») والتحذير («لا تشارك هذا الرمز») ✓؛ الطول ~90 حرفًا — سطح الـSMS-bombing محكوم بـcooldown 60ث + 5/ساعة/رقم + 20/15د/IP، مع فجوة R97-03 (تعداد recipient_not_on_whatsapp) ما زالت مفتوحة (A2).

---

## مخطط انتقال الحالات (gateway → backend → frontend)

```
┌─────────────────────── Baileys / openwa-gateway ───────────────────────┐
│ created ──start()──► initializing ──qr──► qr_ready ──open──► ready      │
│    ▲                                        │                           │
│    │              (pair-code يُصدر هنا؛ يخفي QR)                          │
│ ready ──close(عادي)──► disconnected ──5s auto-restart──► ready (نفس id)│
│ ready ──close(loggedOut)──► failed + مسح creds (نفس id! → WA-01/WA-02) │
│ إقلاع العملية ──boot auto-restore──► sess id جديد (nanoid) → ready      │
│ (الحالة authenticating: معرَّفة في النوع لكن لا يضعها المحرك إطلاقًا)     │
└─────────────────────────────────────────────────────────────────────────┘
                                  │ publicView{status,lastReadyAt,connectedAt,…}
┌───────────────────── backend openwa.service (probe/send) ───────────────┐
│ status≠ready ⇒ whatsapp_status = <raw status>  (qr_ready/failed/…)      │
│ status=ready ⇒ recordReadySince (mem + Redis SETNX 7d):                 │
│   نافذة 45s باقية أو !dispatchReady ⇒ settling + readyInSec             │
│   منتهية + warm-up-ok (self-check مُسلَّم) ⇒ ready                       │
│ بوابة غير قابلة للوصول/5xx ⇒ status=null (مجهول — لا ready كاذب) ✓      │
└─────────────────────────────────────────────────────────────────────────┘
                                  │ GET /api/auth/providers (كاش 30ث)
┌────────────────────────── frontend (login/register) ────────────────────┐
│ "ready"                        ⇒ لا تلميح؛ الزر يعمل؛ 200 + expires_at  │
│ "settling"                     ⇒ «ربطت للتو — تُهيَّأ الآن…» + عند المحاولة│
│                                   503 whatsapp_settling + Retry-After    │
│                                   + auto-retry×2 ثم زر يدوي (لا cooldown)│
│ "qr_ready" (الحالة الآن)       ⇒ «قيد الربط مؤقتاً — يمكنك المحاولة…»    │
│ "created"/"initializing"/      ⇒ نفس التلميح المشترك؛                   │
│ "authenticating"/"disconnected"   المحاولة ⇒ 503 whatsapp_not_paired     │
│                                   «غير مربوطة مؤقتاً، جاري استعادة…»     │
│ "failed"                       ⇒ نفس التلميح «مؤقتاً» (غير صادق — دائم) │
│ null                           ⇒ لا تلميح إطلاقًا؛ المحاولة ⇒ 502        │
│                                   «تعذّر إرسال الرمز عبر WhatsApp»       │
│ الجلب: مرة واحدة عند mount (لا polling) — WA-08                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## إجابات مباشرة على أسئلة التكليف الثمانية

1. **Settle gate:** لكل جلسة (Map) لا عالمي ✓؛ جاهزية mid-settle ⇒ انتظار محدود 20s داخل الطلب ثم إعادة فحص ثم 503 settling بـreadyInMs (المسار سليم). `dispatchReady` عند إعادة تشغيل **البوابة**: يبقى كما هو (معرف جديد فيجدّد الكتابة لأن findSession يحل بالاسم — سلوك صحيح متحفظ)؛ عند **إعادة الاقتران بنفس المعرف**: لا يُصفَّر — **الخلل R97-WA-01**. الإشارة الأقوى المتاحة: `lastReadyAt/connectedAt` مكشوفة ويُهملها الخلفي؛ وack التسليم للـself-check (WA-03). 45s: كافية كأرضية مع warm-up كدليل تجريبي (أدلة حية: DELIVERY_ACK ~4ث على قناة دافئة)؛ بلا operator E164 تظل مؤقتًا أعمى.
2. **Warm-up:** نص ثابت `WARMUP_TEXT` (لا نص اعتباطي، لا user input)؛ لا يعيد ضبط settle (لا يمس `sessionReadySince`)؛ qr_ready ⇒ `runWarmupCycle` يخرج بصمت (`:357`) بلا أخطاء؛ مع رقم المشغّل المضاف الآن: self-chat عبر LID (`resolveSendJid` يكشف target==accountDigits). **الأول لا ينتظر 6h**: `scheduleInitialWarmup` يُطلق عند `readySince+45s` — لكن جدولته تتطلب مَن يستدعي `recordReadySince` (probe providers عند mount صفحة الدخول أو محاولة OTP)؛ بلا أي زائر تبقى أول تهيئة معلقة حتى tick الـ6h. فشل self-check يعاد جدولته مع أول probe تالٍ (حارس pending يُحذف بعد الفشل) — self-healing ✓.
3. **Retry:** المحاولات مستقلة فعلًا (POST جديد ⇒ `sendMessage` جديد ⇒ messageId جديد لكل محاولة). يُعاد على: `request_failed` (شبكة/timeout) و`non_ok_status ≥ 500` فقط؛ 4xx/409/`recipient_not_on_whatsapp`/`session_settling` fail-fast ✓. مضاعفة خطر «Waiting»: محدودة — 200 لا يُعاد (الرسالة غير القابلة للفك تعيد 200 فلا retry)، والمتبقي احتمال timeout-بعد-تسليم ⇒ رسالتان بنفس الرمز (غير مؤذٍ). إعادة `ensureSession` بين المحاولات سليمة.
4. **البوابة:** الحالات 0–5 من proto (أعلاه)؛ `"2"` = وصلت الخادم — ليست سيئة لكنها ليست تسليمًا، والحية منها **انحدار** (WA-04). السجل bounded (25، ذاكرة فقط) ✓. persist: WA-07. keep-alive (index.ts:895-909): self-ping كل 4 دقائق إلى `RENDER_EXTERNAL_URL/healthz` عبر راوتر Render ⇒ **يبقي العملية كلها (ومن ثم سوكت واتساب) حيّة**، وليس HTTP فقط — مثبت حيًا (نفس العملية منذ 09-09 02:33). boot auto-restore ضد HTTP-create: `findByName` قبل الإنشاء + `if (findByName(name)) continue` عند الاستعادة — السباق مُدار (409 conflict) ✓. send-text LID/PN: التوجيه عبر LID **للإرسال الذاتي فقط**؛ المستلمون العاديون بالـPN jid — ملاحظة مستقبلية: preflight `onWhatsApp` يعيد صيغتي jid والبوابة تهمل LID للمستلم (احتمال تعثر مستقبلي مع هجرة LID-first — التقاطه من نتيجة preflight أقوى). pair-code: WA-09. dashboard: كوكي HMAC موقّع + TTL 12h + timing-safe ✓؛ lockout صحيح (نافذة 15د/5 محاولات/قفل 15د + sweep) ✓؛ XFF الأخير (مقاوم للتزوير على Render) ✓؛ QR للوحة صورة فقط ✓ (الخام في JSON — WA-10).
5. **القالب:** ثابت، code فقط، صلاحية 5 دقائق داخل النص، بلا interpolation — انظر WA-12.
6. **سلسلة الصدق:** الجدول/المخطط أعلاه — أكذوبتان لطيفتان: failed≈«مؤقتاً»، وnull بلا تلميح؛ خلال qr_ready الحالية: تلميح «قيد الربط مؤقتاً» + 503 عند المحاولة (صادق في الجوهر).
7. **التعافي 3am:** انقطاع عابر ⇒ auto-reconnect 5s + flushNow فوري ✓؛ إقلاع بوابة ⇒ auto-restore + settle جديدة (~45–60ث تعافٍ ذاتي) ✓؛ إبطال pairing ⇒ **لا شيء تلقائي** — status failed، تلميح مضلل، بلا تنبيه (WA-06) — المطلوب: alert عند `whatsapp_status ∉ {ready,settling}` > 15 دقيقة (critical) وnull > 5 دقائق (warning)، عبر قنوات alerting الجاهزة. ملاحظة موازية: cron تنظيف whatsapp_otps (job 3، :15 ساعيًا) معطّل فعليًا مع schedulers (R97-A3) — 5 صفوف >24h شاهدة.
8. **تعدد الجلسات:** WA-11 — bookkeeping جاهز؛ routing/warm-up/caches أحادية؛ authenticating قيمة ميتة.

---

## ما فُحص ووُجد سليمًا (رصيد — لا تعد إعادة فحصه)

1. **تعيين key timing-safe** في البوابة (`index.ts:442-453`) ولوحة القفل بتوقيت ثابت للبيانات (`dashboard.ts:134-142`) + تصفير المحاولات عند النجاح + sweep دوري للخريطة.
2. **لا OTP في السجلات:** openwa.service يسجل chatId+status فقط ولا يقرأ جسم الخطأ (`:779-784`)؛ تعليق صريح بالنية.
3. **write-through persistence للـsignal state** (300ms على كل keys.set/del + upsert فوري) — إصلاح جولة-6 حي في dist ✓، مع باب «لا حفظ قبل ready» (المنقوص فقط عند re-pair — WA-02).
4. **SIGTERM flush** بميزانية 4s + حارس double-flush + uncaughtException لا يُسقط العملية.
5. **تكافؤ جدول openwa_sessions** بين boot SQL للبوابة وdrizzle schema الخلفي (name/creds/updated_at) — لا drop عرضي.
6. **keep-alive self-ping** عبر الراوتر العام (وليس localhost) — تصميم صحيح للـfree tier، مثبت حيًا (uptime ~2 أيام).
7. **CSRF gate للوحة** (Origin host==Host، لا-Origin يُسمح للسيرفر-سيرفر) + CSP صارمة + no-store + X-Frame DENY.
8. **normalizeLibyanPhone / buildChatId:** انهيار كل الصيغ (+218/00218/09x) إلى شكل واحد `218<9digits>@c.us` — لا تضاعف محاولات بمتغيرات الرقم.
9. **عقد 503 settling كاملًا** (route + Retry-After + details.retry_after_sec + النص الحرفي) مثبت باختبار `auth-whatsapp-settling.test.ts`، والعميل يطابقه (auto-retry×2، لا cooldown يُحرق) — مثبت أيضًا في bundle الحي (R97-A1).
10. **openwa-settle-gate.test.ts (474 سطرًا)** يغطي A–F (نافذة/estimates/تخزين Redis/migration/إعادة 5xx/4xx) — الاختبارات تطابق الكود الحي.

---

## ترتيب الإصلاح المقترح

1. **R97-WA-01** (تصفير/إعادة تسلّح settle+warm عند كشف re-pair عبر `lastReadyAt`) — سطر واحد تقريبًا في `recordReadySince` + تصفير حقول loggedOut في البوابة (يقفل WA-02 معه).
2. **R97-WA-06** (ticker حالة + alert) — أغلق «من يلاحظ موت القناة» نهائيًا.
3. **R97-WA-03** (قلب dispatchReady فقط عند ack ≥ SERVER_ACK لمعرف رسالة الـself-check) — يجعل الجاهزية إثباتًا لا مؤقتًا.
4. **R97-WA-04 + WA-05 + WA-07** دفعة صيانة بوابة (رتابة timeline، عكس warmed في Redis/إعادة REDIS_URL، مفتاح creds مستقل + advisory lock).
5. **P3 دفعة:** تمايز تلميح failed + polling الحالة، رفض pair-code عند ready، إزالة `qr` الخام، env.example/README.

**ملاحظة ختامية:** الإصلاح ثلاثي الطبقات (96-F1) سليم هندسيًا ومختبرًا جيدًا — لكنه بُني حول افتراض أن «الجلسة تُربط مرة». أول موقف حقيقي بعد النشر (إبطال + إعادة اقتران بنفس المعرف) كشف أن الطبقات الثلاث كلها ترتبط بمعرف لا يتغير — الحادثة الحية كانت اختبارًا مباشرًا فشل فيه التصميم لولا إعادة نشر الخلفي المتزامنة (حظ). الإصلاحات المقترحة كلها موضعية وصغيرة.

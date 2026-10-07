> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r97/security-redteam.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# الجولة 97 — أعمق تدقيق Red-Team أمني للخلفي + تكامل بوابة OpenWA

**الوكيل:** R97-A2 (مدقق أمن فريق أحمر — تشخيص فقط، صفر تعديلات على الكود)
**النطاق:** `backend/src/**` (الخلفي كاملًا) + `frontend/src/lib/{auth,admin-session}.tsx` و`hooks/use-admin-headers.ts` (سطح التوكنات) + مستودع `openwa-gateway` كاملًا (مصدر + dist) + `render.yaml` / `vercel.json` / `package.json`.
**نمذجة الخصم:** مهاجم يمتلك معرفة كاملة بالكود (white-box) ووصول شبكي مباشر إلى `subnation.ly` **وإلى `subnation2.onrender.com`** (النطاق الأصلي متروك مفتوحًا عمدًا — app.ts:308-312) بدون Cloudflare.

**الاستبعاد المسبق (مُصلَح في جولات 31–96 وتم التحقق منه حيًّا في الكود):** بوابة CSRF بنمط exact-origin + fail-closed (app.ts:648-769) · إبطال جلسات المستخدم عبر sessions rows (H1) · probe يستشير الجلسة (93-A1 S2) · replay تلغرام بنافذة TTL ≥ freshness (93-A1 S3) · رفض temp-token في كل البوابات (V1-CRITICAL) · rows جلسات الأدمن + الإبطال عند logout/change-password (A8-01) · قفل login بمفتاح username+IP (A8-03) · TTL رمز 2FA المؤقت 10 دقائق (A8-05) · إلزام كلمة المرور عند تعطيل 2FA (93-C2/S5) · تثبيت `algorithms:["HS256"]` (A8-08) · اشتقاق مفتاح HMAC للـOTP عن SESSION_SECRET (A8-07) · atomic increment للكوبون مع فحص commit-time (F-006/B2-05) · SKIP LOCKED للمخزون (H4) · deliverability gate (R93-DATA) · idempotency_keys متينة داخل tx (F10) · dedup مرجع الدفع + advisory locks + الفهرس الفريد الجزئي (B2-02) · تشفير delivered_password (H2) · cardinality محدود لمقاييس cwv (SEC-92-05) · ترقيم IP عبر last-XFF في البوابة والسجلات (SEC1/P1-1, H11) · settle gate + warm-up لقناة WhatsApp (96-F1).

---

## المنهجية

قُرئ سطرًا-سطرًا: `app.ts` (986 سطرًا)، `routes/{auth,auth-whatsapp,auth-settings,wallet,orders,products,support,notifications,loyalty,coupons,cart,cwv,telegram-webhook,health,metrics,seo,index}.ts`، `routes/admin/{auth,index,users,topups,orders,diagnostics,admins}.ts`، `middlewares/{requireUser,requireAdmin,idempotency,cloudflareClientIp,risk-soft-block}.ts`، `lib/{jwt,session,session-liveness,admin-session,lockout,socket,telegram-auth,telegram-replay,whatsapp-otp,crypto,encryption,origins,cookie-options,idempotency,audit,auth-activity,sentry,env,http}.ts`، `services/{whatsapp-otp,openwa,checkout,topup,refund,adjustment,firebase-auth}.service.ts`، `server.ts` + مستودع openwa-gateway كاملًا (`index.ts` 976 سطرًا، `dashboard.ts`، `dashboard-routes.ts`، `persist.ts`) + مسح grep شامل (raw SQL، exec/spawn، dangerouslySetInnerHTML، XFF/CF headers، أسرار). اختبارات موجودة (`__tests__`) استُخدمت كأدلة على النوايا، مع قراءة الكود الحي هي المرجع.

**الحصيلة:** 6 نتائج جديدة (1×P1، 5×P2) + 7 تحصينات P3 + جرد كامل للـrate limiters ومصفوفات CSRF/CORS/cookies + قسم «مؤكد سليم» يمنع إعادة الاكتشاف.

---

## النتائج الجديدة

### 🔴 [P1] R97-01 — تجاوز قفل تسجيل دخول الأدمن عبر تزوير `CF-Connecting-IP`: المفتاح يُقرأ من الهيدر الخام متجاوزًا تحقق H11

- **أين:** `backend/src/routes/admin/auth.ts:54-58`
  ```ts
  const clientIp =
    (typeof req.headers["cf-connecting-ip"] === "string" && req.headers["cf-connecting-ip"]) ||
    req.ip ||
    "unknown";
  const lockoutKey = `admin:${username}:${clientIp}`;
  ```
- **الدليل المضاد:** الـmiddleware `cloudflareClientIp.ts:182-211` (H11) يثق بـ`CF-Connecting-IP` **فقط** عندما يكون النظير الأيمن في XFF داخل نطاقات Cloudflare المنشورة، ثم يعيد كتابة `req.ip` — لكن هذا المسار يقرأ الهيدر **خامًا** مباشرة، فتجاوز كل حماية H11. النطاق الأصلي `subnation2.onrender.com` متروك قابلًا للوصول عمدًا (app.ts:308-312)، والاتصال المباشر بـRender يمرر أي هيدر يضعه المهاجم.
- **سيناريو الهجوم:** مهاجم يضرب `subnation2.onrender.com/api/admin/login` مباشرة مع هيدر `CF-Connecting-IP: <قيمة عشوائية جديدة لكل طلب>` → مفتاح القفل `admin:${username}:${عشوائي}` جديد كل مرة → **قفل 5 محاولات/15 دقيقة لا يُفعَّل أبدًا** → brute force لكلمة مرور الأدمن بلا سقف من طبقة lockout. الطبقة المتبقية هي `authLimiter` (10/15د/IP — app.ts:777) وهي مُقاومة للتزوير لأنها تُقيد على `req.ip` المصحح، لكنها تُهزَّم بتدوير IPs (botnet / بروكسيات سكنية): 100 IP = 1000 تخمين/15د ≈ 96 ألف/يوم ضد كلمة المرور الوحيدة. المكافأة: جلسة أدمن بصلاحيات مالية كاملة (اعتماد شحن، استرجاع، إنشاء أدمن). أثر جانبي: نفس `clientIp` يُخزَّن في `admin_sessions.ipAddress` (auth.ts:118-123) → تلوث جنائي لسجلات الجلسات بقيم اختارها المهاجم.
- **لماذا لم يُبلَّغ سابقًا:** A8-03 (r94) كان عن مفتاح username-only؛ إصلاحه أدخل قراءة الهيدر الخام — الانحدار وُلد من الإصلاح نفسه.
- **الإصلاح (سطر واحد):** استخدم `req.ip ?? "unknown"` (بعد مرور `cloudflareClientIp` — وهو مُركَّب مبكرًا في app.ts:294 قبل كل المسارات) بدل قراءة الهيدر الخام. أضف اختبارًا يثبت أن اتصالًا مباشرًا بهيدر مزوّع لا يبدّل مفتاح القفل.

### 🟠 [P2] R97-02 — JWT الأدمن الحقيقي ما زال يُعاد في جسم استجابة /login و/verify-2fa ويعيش في ذاكرة JS (بقايا A8-02 غير المُنفَّذة)

- **أين:** `backend/src/routes/admin/auth.ts:125-130` و`:209-214` (`return res.json({ token, … })`) · `frontend/src/lib/auth.tsx:110-112` (`setAdminToken(realJwt)`) · `frontend/src/hooks/use-admin-headers.ts:45-47` (`Authorization: Bearer ${adminToken}` مع كل نداء) · `lib/socket.ts:199` (توكن المصافحة `auth.adminToken`).
- **سيناريو الهجوم:** أي XSS مستقبلي (رغم CSP الحالية الصارمة)، أو إضافة متصفح خبيثة، أو DevTools على جهاز مشترك يقرأ الرمز من ذاكرة React — الكوكي httpOnly يفقد قيمته كطبقة حماية على هذا السطح. ر95 وثّقت التوصية («أوقف إرجاع token من /login») لكن فقط A8-01 (صفوف الجلسات) نُفِّذ. التخفيف الحالي: الرمز قابل للإبطال عبر sid (يقلل العمر الافتراضي للمسروق حتى «انتباه المشغّل») — لكن التسريب اللحظي يبقى ممكنًا طوال الجلسة.
- **ملاحظة موازية:** نفس النمط على سطح **المستخدم**: `/api/auth/firebase/session` (auth.ts:518-524) و`/firebase/refresh` (:615-618) و`/api/auth/whatsapp/verify` (auth-whatsapp.ts:229-232) كلها تعيد `token` في الجسم، والواجهة تخزنه في الذاكرة (auth.tsx:61-63). العمر 30 يومًا مع إبطال بصفوف الجلسات.
- **الإصلاح:** أوقف إرجاع `token` من /login و/verify-2fa — الواجهة تعمل بالكوكي (requireAdmin/requireUser يقرآن الكوكي أولًا: requireAdmin.ts:34، requireUser.ts:31). إن كان مسار Bearer مطلوبًا لعملاء API غير المتصفحين فليكن توكنًا منفصلًا قصير العمر قابلًا للإبطال. للمستخدم: اجعل الجسم يعيد فقط شكل المستخدم ودع الواجهة تعتمد الـsentinel + الكوكي (آلية الـprobe جاهزة أصلًا).

### 🟠 [P2] R97-03 — بروب «هل الرقم على WhatsApp؟» بلا استهلاك cooldown: تعداد أرقام ليبية كامل بلا حد لكل رقم

- **أين:** `backend/src/services/whatsapp-otp.service.ts:122-162` (فحص cooldown/hourly يعتمد حصريًا على صفوف `whatsapp_otps`) · الصف يُنشأ **بعد** نجاح الإرسال فقط (`:253-255`) · الفشل بسبب `recipient_not_on_whatsapp` يُعاد قبل أي صف (`openwa.service.ts:864-872` preflight عبر `contacts/check`).
- **السيناريو:** مهاجم يرسل `POST /api/auth/whatsapp/start` بأرقام 218-91..94 عشوائية: الرقم غير المسجَّل في WhatsApp → 400 `recipient_not_on_whatsapp` **بدون إنشاء صف** → لا cooldown ولا hourly cap لذلك الرقم إطلاقًا → الحد الوحيد هو `whatsappStartAuthLimiter` 20/15د/**IP** (app.ts:519-528) الذي يُهزَّم بتدوير IPs (نفس تقنية R97-01). النتيجة: خريطة «أي الأرقام الليبية مسجّلة في WhatsApp» — وقود مباشر لقوائم phishing واحتيال مستهدف عبر واتساب نفسه. كل استدعاء أيضًا يصل البوابة ويستهلك `onWhatsApp` lookup (استنزاف تشغيلي للجلسة).
- **الإصلاح:** سجّل محاولات الفشل التسليمي في جدول خفيف (phone, created_at) واستهلك منه الـcooldown، أو قيّد `recipient_not_on_whatsapp`/`invalid_phone` بـrate limiter مركّب (phone+IP) — أو أنشئ الصف بحالة `failed_delivery` قبل الإرسال مع عدم احتسابه في hourly_limit الفعلي لكن احتسابه في cooldown.

### 🟠 [P2] R97-04 — بوابة OpenWA: `/api` بلا أي rate limiting وبلا IP allow-list — مفتاح API هو الحاجز الوحيد لقناة relay نصية كاملة

- **أين:** `openwa-gateway/src/index.ts:588-591` (`app.use("/api", requireKey)` — لا limiter بعده إطلاقًا) · `:442-453` (requireKey: timing-safe لكن بلا سقف محاولات) · `:843-859` (`POST /messages/send-text` يقبل **نصًا وchatId عشوائيين** من أي حامل للمفتاح).
- **التحقق الأساسي (إجابة سؤال التكليف):** الخلفي SubNation **لا يمكنه** إساءة إرسال نص اعتباطي — `sendWhatsAppMessage` مستدعًى من مكان واحد فقط (`whatsapp-otp.service.ts:167`) بنص قالب ثابت (الرمز وحده المتغيّر، `:185`)، و`buildChatId` يفرض الصيغة `218<9 أرقام>@c.us` من `normalizeLibyanPhone` (أشكال +218/00218/09x كلها تنهار لصيغة واحدة — لا تضاعف محاولات بمتغيرات الرقم). خطر الـrelay ينحصر في **تسريب المفتاح** أو ضربه مباشرة.
- **السيناريو:** أي تسريب لـ`WHATSAPP_OTP_API_KEY` (من بيئة Render لأي من الخدمتين، أو logs، أو جهاز مشغّل) = قناة SMS-bombing/phishing بلا أي حد: نص عربي اعتباطي «من SubNation» لأي رقم في العالم، من غير مرور بأي cooldown للهاتف (تلك تعيش في SubNation فقط). كذلك: تخمين المفتاح بلا قفل/سقف محاولات (مكلف عمليًا إن كان عشوائيًا 32+، لكنه بلا كلفة دفاعية)، و`GET /api/sessions/:id/qr` يعيد سلسلة QR الخام لحامل المفتاح = **استيلاء على حساب الواتساب نفسه** إن أُمسكت أثناء الإقران، و`/messages/test` يرسل نصًا ثابتًا لأي وجهة.
- **الإصلاح (defense-in-depth داخل البوابة):** (1) rate limiter لكل chatId (مثلًا 5 رسائل/ساعة لكل وجهة، باستثناء رقم المشغّل) + سقف عالمي/دقيقة لكل IP؛ (2) قفل تدريجي بعد N مفتاح خاطئ؛ (3) إن أمكن: IP allow-list لمنفذ خروج Render للخلفي (أو تبني private service / shared secret إضافي بالمصادقة المتبادلة)؛ (4) لا تُعد سلسلة QR الخام في استجابة JSON — صورة فقط (كما تفعل لوحة /dash).

### 🟠 [P2] R97-05 — `OPENWA_API_KEY` نقطة فشل وحيدة مزدوجة الاستخدام: مصادقة HTTP **و**مفتاح تشفير بيانات اعتماد حساب الواتساب

- **أين:** `openwa-gateway/src/persist.ts:19-25` — `scryptSync(API_KEY, "openwa-gateway-creds-v1", 32)` مفتاح AES-256-GCM لعمود `openwa_sessions.creds` (blob يحوي **كل** مفاتيح الجلسة/sender-keys/prekeys لحساب واتساب المشغّل) · نفس المفتاح يُستخدم موازٍ في `dashboard.ts:34-48` لاشتقاق سر كوكي اللوحة.
- **السيناريو:** تسريب المفتاح الواحد (احتمال حادثة بيئة Render موثّق تاريخيًا — round-5 محق DATABASE_URL بـAPI PUT) يعني فورًا: (أ) relay كامل (R97-04) و(ب) فك تشفير الـblob من أي dump لقاعدة Neon (الجدول في نفس قاعدة الإنتاج) وإعادة تركيب الجلسة على أي خادم Baileys = **انتحال كامل لحساب واتساب المشغّل** بلا مسح QR. لا يوجد مسار تدوير مستقل (تدوير المفتاح يستلغي الجلسات؟ لا — يجب أيضًا إعادة اشتقاق مفاتيح التشفير).
- **الإصلاح:** متغير مستقل `OPENWA_CREDENTIALS_KEY` (يُشتق منه مفتاح التشفير) منفصل عن مفتاح HTTP، مع دعم إصدارات مفاتيح (`v2:` prefix) لنافذة تدوير. نفس المبدأ لـ`DASHBOARD_SESSION_SECRET` (اليوم falls back إلى اشتقاق من نفس المفتاح).

### 🟠 [P2] R97-06 — Socket.IO بلا حد اتصالات: لا handshake rate-limit ولا سقف sockets لكل هوية

- **أين:** `backend/src/lib/socket.ts:555-582` (initSocket: ping/timeout و maxHttpBufferSize 64KB فقط — لا limiter) · `:597-655` (بوابة المصادقة ترفض بلا توكن، لكن الرفض بلا كلفة حدّية) · `:490-498` (لكن socket مقبول = مؤقّت إعادة تحقق 5 دقائق + غرفة).
- **السيناريو:** (أ) مهاجم مجهول من Origin مسموح: ملايين handshakes فاشلة — كل واحدة HMAC verify (رخيص) لكن FDs/TLS/CPU — /socket.io **خارج** نطاق `apiLimiter`/`userLimiter` (تُركَّب على `/api` فقط) فلا أي سقف. (ب) مهاجم **بموكن مستخدم سليم**: يفتح آلاف الاتصالات المتزامنة — كل اتصال يستحق probe DB عند المصافحة + مؤقّتًا كل 5 دقائق + عضوية غرفة → استنزاف memory/FD وضغط DB (كل socket يعمل probe عند join events أيضًا). لا يوجد `maxConnections` أو فصل عند تجاوز سقف لكل userId.
- **الإصلاح:** (1) express-rate-limit على مسار `/socket.io/` (IP-keyed، 30/دقيقة) — نفس `makeRateLimitStore`؛ (2) سقف اتصالات لكل هوية (مثلًا 5) مع فصل الأقدم عند التجاوز؛ (3) عدّاد Prometheus للاتصالات المرفوضة بالحد.

---

## تحصينات P3

### [P3] R97-07 — Timing oracle يكشف وجود اسم مستخدم الأدمن

- **أين:** `backend/src/routes/admin/auth.ts:73-98` — اسم غير موجود يعيد 401 فورًا **بدون** argon2؛ الموجود يكلّف ~100-300ms (argon2id 64MiB). قياس زمن الاستجابة يميّز الحالتين ويؤكد صحة username الأدمن (نصف السر).
- **الإصلاح:** نفّذ `verifyPassword(password, DUMMY_HASH)` عند عدم وجود الصف (نمط(dummy-verify) الموحد)، أو أبطئ الرد الاعتباطي للفرع السريع.

### [P3] R97-08 — `/api/metrics` لا يفحص صف admin_sessions (ثغرة إبطال A8-01 الجزئية)

- **أين:** `backend/src/routes/metrics.ts:30-59` — يتحقق من JWT + isTemp فقط بلا `isValidAdminSession(sid)`؛ رمز أُبطل بـlogout يبقى مقبولًا حتى 8 ساعات على تلسكوب Prometheus (اسماء المضيفات، أرقام cwv، سلاسل أخطاء Sentry).
- **الإصلاح:** أضف فحص sid كما في requireAdmin:89 (مسار METRICS_ADMIN_TOKEN الثابت لا يتأثر).

### [P3] R97-09 — قفل verify-2FA مفتاحه adminId فقط = زر DoS بعيد ضد مشغّل حقيقي

- **أين:** `backend/src/routes/admin/auth.ts:176` (`admin-2fa:${admin.id}`). مهاجم يملك كلمة المرور (temp_token صالح 10 دقائق — يمكن تجديده بإعادة login) يقفل تحدي TOTP للـadmin الحقيقي بـ5 رموز خاطئة كل 15 دقيقة — إلى الأبد — بينما صاحب الحساب عاجز عن إكمال الدخول (تجميد طابور المال). المقايضة موثقة (منع brute force الموزّع) لكن اتجاه التوافر مهمل.
- **الإصلاح:** مفتاح مركّب `admin-2fa:${adminId}:${/24 من IP}` مع سقف عالمي أعلى لكل adminId (نفس توصية A8-03 الأصلية المطبقة على password login).

### [P3] R97-10 — `createUserSession` يصدر توكنًا «ميتًا» عند فشل إدراج صف الجلسة

- **أين:** `backend/src/lib/session.ts:40-57` (insert best-effort — التعليق يفترض أن التوكن يبقى صالحًا) بينما `session-liveness.ts:34-51` + `requireUser.ts:52-70` يرفضان التوكن لأن الصف غير موجود → دخول «ناجح» يعقبه 401 على كل طلب (probe يعيد authenticated:false). الاتجاه آمن (fail-closed) لكنه تناقض توفّر: المستخدم عالق بلا جلسة عملية حتى انتهاء 30 يومًا من عمر الرمز في المتصفح؟ لا — الكوكي يُرسل لكنه يرفض دائمًا.
- **الإصلاح:** أعد محاولة الإدراج مرة، وفشلها = فشل الدخول (500) بدل توكن ميت؛ أو اجعل `isSessionRowLive` يميّز «الصف غائب لأن الإنشاء فشل مؤخرًا» عبر ذاكرة مؤقتة قصيرة للتوكنات الصادرة.

### [P3] R97-11 — فرع `?token=` التراثي في auth-callback ما زال يقبل توكنًا محقونًا عبر رابط مصنوع

- **أين:** `frontend/src/pages/auth-callback.tsx:45-55` — A8-06 (r94) اقتُصر على تنظيف URL بـ`replaceState` بعد القراءة؛ الحقن الذاتي للجلسة (session injection عبر رابط خبيث يفتح جلسة المهاجم عند الضحية في نفس المتصفح) ما زال ممكنًا نظريًا. لا تصعيد صلاحيات (التوكن يعرّف هوية المهاجم نفسها) لكنه مسار تنظيف مخطط أصلًا.
- **الإصلاح:** احذف الفرع — مسار الكوكي حي منذ F-010 وكل القنوات تستخدمه.

### [P3] R97-12 — الكوبونات بلا سقف استرداد لكل مستخدم

- **أين:** `backend/src/routes/coupons.ts:91-174` + `checkout.service.ts:393-441` — `maxUses` عالمي فقط؛ مستخدم واحد يستطيع استهلاك كل حصص كوبون عام بشراء متكرر (السباق نفسه مُغلق بالـatomic increment — الشكوى الوحيدة عدالة التوزيع). إن كان الكوبون موجهًا «للعملاء الجدد» فلا آلية تفرض ذلك.
- **الإصلاح:** جدول `coupon_redemptions(user_id, coupon_id)` بقيد فريد عند الحاجة لأشكال «مرة لكل عميل».

### [P3] R97-13 — ملاحظات حدّية صغرى

1. **`userLimiter` = 1200/دقيقة/user** (app.ts:468-490) — سخيّ جدًا؛ يكفي سحب 200 طلب/طلب صفحة لكنه يسمح لمستخدم مسيء بمليوني طلب/يوم على نقاط النهاية الرخيصة. أي «طلبات مسيئة من هوية سليمة» يحتاج حدًا أدق لكل مسار (الفتح موجود فقط للكوبونات/التذاكر).
2. **`apiLimiter.skip`** يستثني `/assets/` و`/static/` بمسار **mount-relative** تحت `/api` (app.ts:451-458) — لا مسارات كهذه تحت /api أصلًا (كود ميت لا أكثر).
3. **`csrfAllowedOrigins` fallback في غير الإنتاج** يشمل localhost فقط والإنتاج fail-fast — سليم. لكن `getConfiguredOrigins()` يُستدعى مرتين (app.ts:43 و62) — تجميلي.
4. **legacy tokens بلا sessionId** (requireUser.ts:82-89) تظل مقبولة حتى 30 يومًا — نافذة إlegacy مفتوحة منذ توحيد الجلسات؛ لو مرّ أكثر من 30 يومًا على النشر يمكن رفضها بلا أثر.
5. **express-rate-limit fail-open عند انهيار Redis إلى MemoryStore** أحادي النسخة (موثق R2 مقصود) — متعدد النسخ غير موجود اليوم (نسخة واحدة) فالمخاطرة نظرية.

---

## جرد الـRate Limiters الكامل (كما طلبت المهمة)

| المسار                                | النافذة | الحد         | المفتاح             | ملاحظات                                                                |
| ------------------------------------- | ------- | ------------ | ------------------- | ---------------------------------------------------------------------- |
| `POST /api/auth/firebase/session`     | 15 د    | 10           | IP (req.ip المصحح)  | app.ts:773، counts successes أيضًا                                     |
| `POST /api/auth/firebase/refresh`     | 15 د    | 10           | IP                  | app.ts:776                                                             |
| `POST /api/admin/login`               | 15 د    | 10           | IP                  | app.ts:777 — لكن lockout داخلي قابل للتجاوز (R97-01)                   |
| `POST /api/admin/login/verify-2fa`    | 15 د    | 10           | IP                  | app.ts:778 — lockout داخلي على adminId (R97-09)                        |
| `POST /api/auth/telegram` (+callback) | 15 د    | 10           | IP                  | app.ts:782-783                                                         |
| `POST /api/auth/whatsapp/start`       | 15 د    | 20           | IP                  | app.ts:791 — CGNAT mitigation؛ بلا حد لكل رقم عند فشل التسليم (R97-03) |
| `POST /api/auth/whatsapp/verify`      | 15 د    | 10           | IP                  | app.ts:792                                                             |
| `POST /api/coupons/validate`          | 1 د     | 10           | userId أو /56 IPv6  | app.ts:795 — منع تعداد الكوبونات                                       |
| كل `/api/*` (مجهول)                   | 1 د     | 600          | IP (ipKeyGenerator) | app.ts:424-466 — يتخطى المصادق عليهم                                   |
| كل `/api/*` (مصادق)                   | 1 د     | 1200         | `u:${userId}`       | app.ts:468-490                                                         |
| `POST /api/support/tickets`           | 1 س     | 5            | userId              | support.ts:98-101                                                      |
| `POST /api/support/tickets/:id/reply` | 1 س     | 30           | userId              | support.ts:198-206                                                     |
| `POST /api/cwv` (beacon)              | 1 د     | 30           | sessionId (عميلي!)  | cwv.ts:134-156 — قابل للدوران لكن cardinality محدود                    |
| Copilot                               | —       | —            | داخلي               | lib/copilot/rate-limit.ts (خارج نطاق هذه الجولة)                       |
| **`/socket.io/*`**                    | —       | **لا شيء**   | —                   | **R97-06**                                                             |
| **openwa-gateway `/api/*`**           | —       | **لا شيء**   | —                   | **R97-04**                                                             |
| openwa-gateway `/login` (لوحة)        | 15 د    | 5 → قفل 15 د | آخر XFF (صحيح)      | dashboard.ts:94-131 — مُحصَّنة r95 ✓                                   |

**نقاط غالية بلا حماية خاصة (مغطاة فقط بالـ600/د IP):** `GET /api/products` (بحث ILIKE `%x%` + subqueries — سقف 500 صف + كاش حافة 60ث — مقبول) · `GET /api/auth/providers` (probes البوابة — كاش 30ث داخل الخدمة) · `GET /api/orders?limit=200` (safeDecrypt لكل صف — محدود بالمستخدم) · `GET /api/healthz/summary` (كاش 15ث) — كلها ضمن تقدير مقبول.

---

## مصفوفة CSRF (تغطية البوابة)

- البوابة (`createCsrfGate`, app.ts:648-769): POST/PUT/DELETE/PATCH تحت **exact origin/referer comparison** (scheme+host عبر URL parsing — لا startsWith) + رفض «كوكي بلا Origin وReferer» + fail-closed إنتاجيًا + boot assertion SEC-92-01.
- **الاستثناءات الموثقة:** `/api/auth/firebase/session`, `/api/auth/firebase/refresh` (الـID-token الموقّع هو المصادقة الحقيقية — Origin إضافي)، `/api/cwv` (sendBeacon)، `/api/webhook/*` (توقيع Telegram secret timing-safe — telegram-webhook.ts:166-177)، `/health`.
- **مسارات الجولة 95/96 الجديدة كلها داخل البوابة:** `/api/auth/whatsapp/start` و`/verify` ✓ · `/api/wallet/topups` (idempotency مركّب 96-F1) ✓ · `/api/orders` ✓ · كل admin mutations ✓. لم أجد مسارًا حالة-تغييريًا واحدًا خارج البوابة بلا مبرر توقيعي.
- ملاحظة دقيقة: الاستثناء يُفحص بـ`startsWith` (app.ts:676) — مسار مثل `/api/auth/firebase/session-evil` سيتخطى البوابة؛ لا يوجد route كهذا اليوم (توثيق تحصيني فقط، قيّده بالمساواة التامة).
- SameSite=None (render.yaml `AUTH_COOKIE_SAMESITE=none`) + البوابة = الترتيب الصحيح الوحيد الممكن — مُتحقق منه سلوكيًا في اختبار csrf-gate.test.ts.

## مصفوفة CORS/Headers/Cookies

- **CORS:** قائمة `APP_ORIGINS/FRONTEND_ORIGINS/VERCEL_FRONTEND_ORIGIN` (origins.ts) — بلا Origin (نداء سيرفر-سيرفر) مسموح بـcredentials: true (app.ts:329-352) — مقصود للـprobe من نفس الأصل؛ قائمة فارغة في الإنتاج = رفض. socket.io بنفس القائمة + credentials (socket.ts:558-563).
- **Headers:** helmet كامل — CSP صارمة (default-src 'self'، بدون trusted-types لسبب Firebase الموثق، script-srcAttrs مضبوطة)، HSTS 2y+preload، COOP same-origin-allow-popups، COEP معطّل (مبرر Firebase)، X-Frame-Options sameorigin، nosniff، Referrer-Policy strict-origin-when-cross-origin، Permissions-Policy default-deny (app.ts:143-266). البوابة المستقلة: X-Frame DENY + CSP default-src 'none' + no-store للديناميكي (gateway index.ts:467-484) ✓.
- **Cookies:** `auth_token` و`admin_token` — httpOnly + Secure(prod) + SameSite(None(prod)/Lax(dev)) + path=/ (cookie-options.ts) في كل مسارات الإصدار (firebase session/refresh:514,611 · whatsapp verify:225 · admin login:124,208) والمسح يطابق نفس الخصائص (logout:81-86,123-128,159-164 — **إصلاح مهم سليم**: المسح يمرر نفس sameSite كي ينجح فعليًا). كوكي اللوحة: httpOnly/Lax/Secure/12h موقّع HMAC (dashboard.ts:81-90).
- **Cache-Control على المصادق عليه:** wallet/notifications = `no-store` (wallet.ts:24-27, notifications.ts:12-15) · /me و/probe = `private, max-age=30` · admin probe = `no-store` (admin/auth.ts:235) · الكتالوج العام = public/s-maxage — كلها صحيحة. **استثناء**: `GET /api/auth/sessions` (قائمة الأجهزة+IPs) بلا Cache-Control صريح — يُخزَّن في HTTP cache العادي؟ لا توجد Set-Cookie ولا تعليمات — Express الافتراضي بدون Cache-Control يعني heuristic caching محتمل؛ يُستحسن `private, no-store`. (توثيقي، منخفض).

---

## ما فُحص ووُجد سليمًا (رصيد مُعتمد — لا تعد إعادة فحصه)

1. **IDOR/ملكية أفقية = صفر ثغرات:** كل مسارات المستخدم مقيّدة بـuserId (orders.ts:89,291 · wallet.ts:56,112 · support.ts:165,218 · notifications.ts:23,59 · loyalty.ts:39 · auth sessions:761) — والـ404 الصامت لغير المملوك. حذف جلسة مستخدم آخر = 404. revoke/:id في support كذلك.
2. **SQL injection = صفر:** كل الاستعلامات drizzle مع parameterized bindings؛ `sql\`\``لا يحتوي أي interp لمستخدم مباشر؛`sql.raw()`فقط بثوابت (migrate.ts/jobs) ولا يمس مدخلات. البحث`ILIKE ${"%"+search+"%"}` مرتبط parameter (products.ts:68).
3. **ReDoS = صفر جديد:** كل regexes المستخدم مضبوطة (UUID_V4_RE، SESSION_NAME_RE، E164، LOCKY prefixes)؛ لا `new RegExp` على مدخلات في الخلفي (نتيجتان في tests فقط).
4. **XSS الواجهة:** صفر dangerouslySetInnerHTML (مسح r94 مؤكد بإعادة المسح). صفحة OG الديناميكية في app.ts:878-907 تهرب &,<,>," — كافٍ لأن القيم داخل سمات بعلامات تنصيص مزدوجة.
5. **OTP WhatsApp:** entropy `randomInt` CSPRNG (10^6)، HMAC مقيّد بـ(code,phone,purpose) بمفتاح مشتق (A8-07 مُنفَّذ: getServerSecret — whatsapp-otp.service.ts:40-61)، `timingSafeEqual` (whatsapp-otp.ts:83-92)، TTL 5 د server-side في verifyOtpPure (لا اعتماد على العميل)، سقف 5 محاولات/رمح بزيادة SQL ذرّية + hard-consume، consume guarded `isNull(consumedAt)` (F6)، إصدار sessionId جديد دائمًا (لا session fixation)، الإجابة لا تعيد الرمز أبدًا (expires_at فقط).
6. **Telegram:** hash HMAC بنمطين صحيحين (widget: SHA256(botToken) / WebApp: HMAC(botToken,"WebAppData")) + freshness 30د/24س + replay store بـTTL ≥ freshness مع fallback ذاكرة مقيدة (telegram-replay.ts) + رسائل خطأ موحّدة لا تفرّق signature/replay (منع enumeration).
7. **Firebase:** `verifyIdToken(checkRevoked)` عند الدخول والتجديد + فحص aud مزدوج صريح + رفض phone-provider نهائي (auth.ts:460-470) + linking بموافقة one-shot token (F-003).
8. **مسارات المال:** checkout يعيد حساب السعر خادميًا بالكامل (العميل يرسل product_id+coupon فقط) + بوابات STALE داخل tx (منتج/عرض/كوبون) + INVALID_PRICE fail-closed + CAS على walletBalance+points+lifetimeSpend + idempotency متينة داخل tx (scoped `u{userId}:{key}` — لا يمكن لمستخدم آخر التنبؤ/إعادة استخدام مفتاح غيره) + ledger داخل كل tx. Topup: advisory locks + partial unique index + composite dedup + CAS. Refund: status-guarded + CAS + revocation للنقاط. Adjustment: سقف 10M نقطة + note إلزامي. تحويل النقاط: مضاعفات + CAS. ملاحظة عشرية: كل الكتابات `toFixed(2)` إلى numeric(10,2) — لا float arithmetic منفرد (المقارنات فقط على القيم المقروءة) — سليم.
9. **Webhook Telegram:** secret ثابت الزمن + TELEGRAM_ADMIN_IDS قبل أي حركة مال + إزالة keyboard قديمة.
10. **الأسرار:** لا أسرار في الكود (gitleaks في CI + إصلاح fixtures r96) · render.yaml sync:false · env.ts يحمي متغيرات البيئة الموجودة من .env · pino يقصّ query-string · Sentry: beforeSend + deepSanitize + قبل-الإرسال (sentry.ts) · أخطاء API عربية عامة بلا stack/SQL/مسارات (app.ts:951-983) — `logger.error` يسجل الخطأ كاملًا داخليًا فقط.
11. **التبعيات (backend):** كلها محدثة ولا CVEs معروفة مؤثرة: express ^5، socket.io ^4.8.3، helmet ^8.1، jsonwebtoken ^9.0.3 (مع pinning HS256 في الكود)، express-rate-limit ^8.4.1، firebase-admin ^13.6، otplib ^13.4، zod (catalog)، redis ^5، drizzle-orm، argon2 ^0.44 (Argon2id بمعاملات OWASP) · البوابة: express ^4.21.2، baileys ^6.7.9 (fork غير رسمي — مخاطرة تشغيلية عند كسر بروتوكول واتساب لا CVE). لا pg مباشر في الخلفي (عبر workspace/db). `esbuild` dev-only.
12. **الخادم:** boot gate (server.ts:58-79) لا يخدم خلال الترحيلات · graceful shutdown بمهلة · healthz عام بلا تفاصيل وsummary حالة-فقط.

---

## ترتيب الإصلاح المقترح

1. **R97-01** (سطر واحد: `req.ip` بدل الهيدر الخام في قفل admin login) — أعلى عائد فوري؛ يغلق تجاوزًا فعليًا لضبط أمني موثق.
2. **R97-04 + R97-05** (بوابة OpenWA: rate limit لكل وجهة + قفل مفاتيح + مفتاح تشفير مستقل) — يقلّص «نقطة الفشل الوحيدة» إلى مكونين مستقلين.
3. **R97-02** (إيقاف إرجاع التوكن في جسم login للأدمن) — إغلاق سطح القراءة من JS.
4. **R97-03** (استهلاك cooldown لمحاولات التسليم الفاشلة) — يغلق تعداد الأرقام.
5. **R97-06** (حد اتصالات socket.io) — ثم P3 دفعة واحدة (dummy-verify، sid في metrics، مفتاح 2FA مركّب، توكن ميت، حذف فرع ?token=، سقف كوبون لكل مستخدم، `Cache-Control` لقائمة الأجهزة).

**ملاحظة ختامية:** الخلفي في أعلى درجات النضج الأمني التي رأيتها في هذا المشروع — كل إصلاحات الجولات 31–96 حية ومطابقة للتقارير (تحقق مباشر بالكود لا بالوثائق). النتائج الجديدة تتركز في **الحواف بين الأنظمة** (هيدر IP الخام مقابل الـmiddleware، حدود تعيش في طبقة بينما الخدمة في أخرى، مفتاح واحد يخدم ثلاثة أغراض) — وهو النمط المتوقع حين يكون كل مكوّن صلبًا بذاته.

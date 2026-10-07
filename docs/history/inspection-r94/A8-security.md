> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r94/A8-security.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# A8 — تفتيش محيط الأمان (الجولة 94)

**الوكيل:** A8 (مدقق أمان الفريق الأحمر) · **الوضع:** قراءة فقط، صفر تعديلات على الكود
**النطاق:** `backend/src/middlewares/**` + `lib/{jwt,session,session-liveness,socket,encryption,crypto,whatsapp-otp,lockout,cookie-options,origins,rate-limit-store,telegram-auth,telegram-replay,firebase-admin,auth-activity,permissions,audit}` + إعداد Socket.IO (`lib/socket.ts`، `server.ts`) + `routes/{auth,auth-whatsapp,auth-settings,telegram-webhook}` + `routes/admin/{auth,index,stats,metrics-adjacent}` + CORS/CSRF/حدود المعدل في `app.ts` + إدارة الأسرار (process.env/.env/git) + فحص شامل XSS/SQL/exec/IDOR/prototype-pollution عبر الواجهة والخلفية.

**الملفات المفحوصة:** 52 (33 قراءة كاملة خلفية + 3 واجهة + 16 فحصًا موجّهًا بـgrep/قراءة جزئية) + مسح grep شامل للواجهة والخلفية.

**تم استبعاد عمدًا (مُصلَح في جولات 31–93 أو من نطاق زملاء الجولة 94):** إبطال جلسة socket (مصافحة+دوري 93-A1 S1)، probe يستشير الجلسة (S2)، replay تلغرام ≥24س (S3)، 2FA بكلمة مرور عند التعطيل (S5)، redaction متداخل (93-A1 S7)، بوابة مكافأة الإحالة (F-16)، تسجيل خروج خادمي للمستخدمين، CSP/helmet، تنظيف الجلسات، dedupe تنبيهات، انتهاء جلسة أدمن → إعادة دخول (93-C6)، middlewares‏ risk-soft/hard-block الميتة (A4-F1)، سباق استهلاك OTP/500 (A4-F6)، failed→completed للأدمن (A4-F3).

---

## ما هو قوي بالفعل (موثّق لأغراض الامتناع عن إعادة الاكتشاف)

- **JWT admin مستقل** عن سر المستخدم مع fail-fast إنتاجي (`lib/jwt.ts:55-101`)، وحجب رمز 2FA المؤقت في كل بوابات التحقق الثلاث (`requireAdmin.ts:53`، `socket.ts:204`، `metrics.ts:55`).
- **Socket.IO بخمس طبقات**: قائمة أصول، تحقق توكن، liveness من DB (مصافحة + كل 5 دقائق)، auto-join خادمي (لا ثقة بحمولة العميل)، سقف بافر 64KB (`lib/socket.ts`).
- **بوابة CSRF ممتازة**: مقارنة scheme+host عبر URL (لا startsWith)، فرع «كوكي بلا Origin/Referer = عدائي»، fail-closed إنتاجيًا + assert إقلاعي (SEC-92-01) — ضرورية لأن الإنتاج يستخدم SameSite=None.
- **`cloudflareClientIp`** يثق بـ CF-Connecting-IP فقط عندما يكون النظير الأيمن في XFF داخل نطاقات Cloudflare المنشورة (H11) — انتحال IP عبر onrender.com مقطوع.
- **Webhook تلغرام**: سر مشترك ثابت الزمن + قائمة TELEGRAM_ADMIN_IDS قبل أي حركة مال + فحص pending قبل التنفيذ + إزالة لوحة المفاتيح القديمة.
- **OTP واتساب**: HMAC مقيد بـ(رمز، هاتف، غرض)، timingSafeEqual، سقف 5 محاولات/رمز بزيادة SQL ذرّية، cooldown 60ث، 5/ساعة، أرقام ليبية فقط (91-94).
- **Firebase**: تحقق SDK مع `checkRevoked` عند الدخول + فحص `aud` مزدوج صريح ضد FIREBASE_PROJECT_ID (`firebase-auth.service.ts:138-171`).
- **لا مفاتيح افتراضية في الكود، لا .env في git، لا XSS sinks في الواجهة (صفر dangerouslySetInnerHTML/innerHTML)، لا exec/spawn، لا بناء SQL خام من مدخلات، لا upload خادمي (CSV يُفكك في العميل)، encodeURIComponent لكل معرفات جلسات OpenWA، قيود جسم 1MB + 64KB socket.**

---

## النتائج

### [P2] A8-01 — لا إبطال خادمي لرموز الأدمن: تسجيل الخروج وتغيير كلمة المرور لا يقتلان admin_token مسروقًا (حتى 8 ساعات)

- **أين:** `backend/src/routes/admin/auth.ts:284-289` (logout = clearCookie فقط) · `:304-373` (change-password يصرّح «Does NOT clear the existing session») · `backend/src/lib/jwt.ts:130-140` (8h، عديم الحالة) · `middlewares/requireAdmin.ts:64-90` (الفحص الوحيد: is_active).
- **الدليل:**
  ```ts
  // admin/auth.ts:286
  res.clearCookie(ADMIN_COOKIE_NAME, { ...ADMIN_COOKIE_OPTIONS, maxAge: undefined });
  // لا حذف لصف/رمز — الرمز المسروق يستمر
  ```
- **سيناريو الهجوم:** مهاجم يستخرج JWT الأدمن (انظر A8-02 — الرمز موجود في جسم استجابة /login وفي ذاكرة JS ويرسل Bearer مع كل طلب). عند الساعة T+1 يلاحظ المشرف عمليات موافقة غريبة على الشحن، فيضغط «تسجيل الخروج» بل ويغيّر كلمة المرور — **لا يحدث شيء للرمز المسروق**: يواصل المهاجم صلاحيات مالية كاملة (اعتماد شحن، استرجاع، إنشاء أدمن) حتى انتهاء الـ8 ساعات. الطرق الوحيدة للقتل: `is_active=false` (يعطّل الحساب كليًا) أو تدوير ADMIN_JWT_SECRET (يسجّل خروج كل الأدمنية). للجانب المستخدم حلّ هذا منذ H1 (sessions rows) — سطح الأدمن لم يحصل عليه قط.
- **الإصلاح:** جدول `admin_sessions` (sessionId في حمولة الرمز + فحص في requireAdmin بذاكرة 60ث كما في `lib/session-liveness.ts`)؛ حذف الصف في logout/change-password/2fa-disable؛ توسيع `verifySocketIdentityLive` لفحصه بجانب is_active.

### [P2] A8-02 — JWT الأدمن الحقيقي يُعاد في جسم استجابة /login ويُحفظ في ذاكرة JS: حماية httpOnly اسمية على هذا السطح

- **أين:** `backend/src/routes/admin/auth.ts:95-102` و`:161-168` (إرجاع `token`) · `frontend/src/lib/auth.tsx:110-112` (`setAdminToken(realJwt)`) · `frontend/src/lib/admin-session.ts` + `use-admin-headers` (Bearer مع كل نداء) · `lib/socket.ts:193` (توكن المصافحة `auth.adminToken`).
- **الدليل:** `return res.json({ token, display_name: … })` — نفس الكوكي httpOnly يُصدَر، لكن النسخة القابلة للقراءة من JS تُمنح أيضًا.
- **سيناريو الهجوم:** أي ملحق متصفح خبيث، أو DevTools على جهاز مشترك، أو أي XSS مستقبلي (تخطى CSP) يقرأ الرمز مباشرة من ذاكرة React — الكوكي httpOnly لا يضيف شيئًا. سطح **المستخدم** انتقل فعلًا إلى الحارس `__cookie_session__` (`frontend/src/lib/auth.tsx:65`) بينه يبقى واجهة أدمن الرمز الحقيقي في الذاكرة، ما يجعل A8-01 أسهل استغلالًا.
- **الإصلاح:** أوقف إرجاع `token` من /login و/verify-2fa؛ الواجهة تستخدم sentinel + الكوكي فقط (requireAdmin يقرأ الكوكي أولًا أصلًا `requireAdmin.ts:27`). إن كان مسار Authorization مطلوبًا لعملاء API غير المتصفحين، فلْيكن توكنًا منفصلًا قابلًا للإبطال.

### [P2] A8-03 — قفل تسجيل دخول الأدمن مفتاحه اسم المستخدم وحده: DoS إقفال عن بُعد دائم لأي اسم معروف

- **أين:** `backend/src/routes/admin/auth.ts:41` (`const lockoutKey = \`admin:${username}\``) · `lib/lockout.ts` (5 محاولات → 15 دقيقة، تضاعف أُسّي).
- **السيناريو:** مهاجم يعرف اسم مستخدم الأدمن (يتسرب من تصديرات تدقيق قديمة، أو وسم تلغرام، أو هندسة اجتماعية). يرسل 5 كلمات مرور خاطئة كل 15 دقيقة — **ضمن ميزانية authLimiter البالغة 10/15د/IP تمامًا** — إلى الأبد: الحساب الحقيقي مقفل بصورة دائمة، طابور الشحن يتجمد (توافر مسار المال)، ولا تنبيه إقفال مستمر يوجد.
- **الإصلاح:** مفتاح مركّب (اسم + /24 من IP) مع سقف عالمي أعلى لكل اسم (مثلاً 20 ثم تدوير تدريجي)، وتنبيه عند إقفال مستمر > ساعة. (المقايضة موثقة؛ الحالي يحمي كلمة المرور لكنه يضحّي بالتوافر هديةً للمهاجم.)

### [P3] A8-04 — verify-2fa لا يفحص is_active (ادمين معطّل يكمل التحدي)

- **أين:** `backend/src/routes/admin/auth.ts:120-130` — يفحص الوجود وtotp فقط؛ `/login` يفحص `isActive` (سطر 67) و`requireAdmin` يفحصه لكل طلب.
- **السيناريو:** أدمن يُعطَّل بعد حصوله على temp_token (نافذة 8 ساعات!): يكمل TOTP ويستلم توكن كاملًا + كوكي — يُرفض لاحقًا من requireAdmin لكن يمر من `/api/admin/probe`؟ لا (يفحص isActive). الأثر: توكن ميت + سجلات تدقيق مربكة، لا اختراق فعلي.
- **الإصلاح:** `if (!admin || !admin.isActive || …) → 401` في verify-2fa.

### [P3] A8-05 — تفعيل 2FA لأول مرة بلا كلمة مرور (بقايا موثقة 93-C2)

- **أين:** `backend/src/routes/admin/auth.ts:562-575` — الفرع «fresh enrollment» اختياري كلمة المرور، والتعليق نفسه يصرح بالمتابعة 93-C2.
- **السيناريو:** مهاجم يمتلك كلمة المرور + جلسة واحدة يُسجّل سر TOTP خاصًا به → بعد انتهاء الجلسة يملك كلمة المرور وعامل 2FA معًا — 2FA مهزوم بصورة دائمة للحساب.
- **الإصلاح:** نفّذ التغيير المخطط (الواجهة ترسل current_password) ثم اجعله إلزاميًا — الملاحقة موجودة في كودكم.

### [P3] A8-06 — مسار الإرث `?token=` في صفحة الاسترجاع ما زال حيًّا

- **أين:** `frontend/src/pages/auth-callback.tsx:45-50` (`if (token) { setToken(token); navigate("/"); }`).
- **السيناريو:** الخادم لم يعد يصدر توكن في URL منذ F-010؛ لكن الفرع يقبل أي توكن محقون عبر رابط مصنوع (`/auth/callback?token=…`): يدخل الرمز سجل التاريخ وReferrer لأي مستخدم ينقر رابطًا خبيثًا يحمل توكن المهاجم (حقن جلسة ذاتي — لا تصعيد، لكن تنظيف مخطط أصلًا ولم يُنفذ).
- **الإصلاح:** احذف الفرع — مسار الكوكي حي منذ جولات عديدة.

### [P3] A8-07 — مفتاح HMAC لـOTP هو SESSION_SECRET نفسه (ازدواج استخدام سري جلسة)

- **أين:** `backend/src/services/whatsapp-otp.service.ts:38-47` (`getServerSecret()` = SESSION_SECRET).
- **السيناريو:** تسريب SESSION_SECRET إلى مهاجم يمنحه تزوير JWT مباشرة (أسوأ أصلًا)، لكنه إضافيًا يجعل codeHash المخزّن قابلاً للكسر offline (فضاء 10^6 لكل صف، لحظي) — أي تسريب DB فقط + سرّ معروف يكفي لاستنتاج الرموز الحية داخل TTL.
- **الإصلاح:** اشتقاق مفتاح فرعي: `createHmac("sha256", SESSION_SECRET).update("otp-hmac-v1").digest("hex")` أو متغير OTP_SECRET مستقل.

### [P3] A8-08 — ENCRYPTION_KEY أحادية بلا إصدارات/تدوير

- **أين:** `backend/src/lib/encryption.ts:8-14` (مفتاح واحد، بلا بادئة نسخة)، `safeDecrypt` يعيد null عند فشل GCM (B2-11).
- **السيناريو:** تدوير المفتاح لأي سبب (تسريب مشتبه) يعطّل فك كل بيانات الاعتماد المشفرة تاريخيًا بصمت — المشترين يرون «بيانات غير متاحة» على مشترياتهم المدفوعة؛ لا آلية `ENCRYPTION_KEY_OLD` ولا بادئة `v2:`.
- **الإصلاح:** مغلف مُصدَر (`enc:v2:iv:tag:ct`) + متغير مفاتيح قديمة أثناء نافذة الترحيل + عدّاد فشل فك مرصود في alerting.

### [P3] A8-09 — `jwt.verify` بلا تثبيت خوارزمية (HS384/HS512 مقبولة أيضًا)

- **أين:** `backend/src/lib/jwt.ts:110-156` (كل دوال التحقق).
- **الدليل (اختبار مباشر على jsonwebtoken 9.0.3 في بيئة المشروع):** توكن موقّع HS384 يُقبل بنفس السر النصي؛ `alg=none` مرفوض («jwt signature is required»). لا استغلال اليوم (كل عائلات HMAC تتطلب معرفة السر، ولا التباس غير متماثل ممكن مع سر نصي) — تحصين فقط.
- **الإصلاح:** `jwt.verify(token, SECRET, { algorithms: ["HS256"] })` في الدوال الأربع.

### [P3] A8-10 — توكن 2FA المؤقت بعمر جلسة كاملة (8 ساعات)

- **أين:** `backend/src/routes/admin/auth.ts:91` يستخدم `signAdminToken` (8h افتراضي) للرمز نصف-الجلسة.
- **السيناريو:** نافذة تحدي TOTP تمتد 8 ساعات — كافية لسحب قاموس 6 أرقام بهدوء عبر سقف lockout (5 محاولات/15د = ~480 محاولة في 24س لكل حساب) بلا أي دافع للاستعجال. سقف المحاولات يمنح الاحتمالية العملية منخفضة، لكن تقصير العمر يقصص السطح مجانًا.
- **الإصلاح:** `jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: "10m", ... })` للرمز isTemp.

### [P3] A8-11 — تعديل الأدمن لمحفظة «حسابه الشخصي» في المتجر بلا حارس ذاتي

- **أين:** `backend/src/routes/admin/users.ts:124-160` — تعديل رصيد أي user بلا فحص علاقة بالأدمن المنفّذ (أثر التدقيق actorId هو الضابط الوحيد).
- **السيناريو:** مشغّل لديه حساب متجر شخصي (نمط QATEST10 الموثق في العمل) يضيف رصيدًا لنفسه عبر لوحة الأدمن — يعمل، ويُسجل في audit_logs، لكنه أقل بروزًا للمراجعة لأن السياق «عملية أدمن عادية».
- **الإصلاح:** فحص بسيط (ربط حساب المستخدم بالأدمن عبر جدول أو بريد/هاتف) + تنبيه عند تعديل ذاتي؛ أو منع الاستثناء صراحة.

### [P3] A8-12 — استهلاك OTP عند النجاح بلا قيد `isNull(consumedAt)` (جلسة مزدوجة متزامنة لنفس المستخدم)

- **أين:** `backend/src/services/whatsapp-otp.service.ts:326-329` — المسار الفاشل محروس (سطر 310) بينما مسار النجاح ليس كذلك.
- **السيناريو:** طلبا verify متزامنان بنفس الرمز الصحيح: كلاهما يقرأ الصف غير مستهلك، كلاهما يصدر جلسة. الأثر محدود (نفس الهاتف = نفس المستخدم، جلستان مختلفتان للجهاز نفسه) — سباق الـ500 عند الإنشاء المتزامن أبلغه A4-F6.
- **الإصلاح:** `UPDATE … SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL RETURNING id` ورفض عند صفر صفوف.

---

## ما فُحص ولم يُعد تقريرًا (تم التحقق من سلامته)

- **IDOR:** كل مسارات المستخدم مقيدة بـ userId (orders.ts:238، wallet.ts:100، cart.ts:197/235، support.ts:146/199، notifications.ts:52، loyalty.ts، auth.ts:761 DELETE /sessions/:id بشرط userId) — صفر ثغرات.
- **تثبيت الجلسة:** كل قناة دخول تولد sessionId جديدًا (`createUserSession`) — لا إعادة استخدام.
- **CSRF GET:** لا حالة تغيّر عبر GET إلا `/api/auth/telegram/callback` (يتطلب توقيع تلغرام) — سليم.
- **تجاوز IP:** H11 مُطبق؛ getRemoteAddr في socket يستخدم المدخل الأيمن؛ resolveAuditClientIp كذلك.
- **fail-open حدود المعدل عند سقوط Redis → MemoryStore** أحادي النسخة (توثيق R2 مقصود) — لم يُعد تقريرًا.
- **prototype pollution:** `body-parser-recovery` يبني كائنًا جديدًا بمفاتيح من URLSearchParams (لا دمج عميق)؛ qs في express 5 محمي؛ PATCH auth/:id يقيّد المفاتيح بقائمة PROVIDERS.
- **ReDoS:** تعابير التحليل كلها مرتكزة وبسيطة (telegram callback `^topup_(app|rej):\d+$`، عناوين IP)؛ cardinality مسار cwv محدودة بجدول (SEC-92-05).
- **الأسرار:** لا قيم افتراضية للأسرار في الكود؛ pino-http يقصّ URL قبل query (توكنات لا تُسجّل)؛ سجل firebase-admin يطبع فقط 16 حرفًا من رأس JSON الحساب (غير حساس)؛ tracing توكن Firebase يسجل metadata للعميل فقط.
- **Uploads:** لا multer/formidable في الخلفية؛ InventoryUploadDialog تحليل CSV في العميل (ملفات A1/A3 غطّت الواجهة).

## الترتيب المقترح للإصلاح

1. A8-01 + A8-02 معًا (صفوف جلسات أدمن + إيقاف إرجاع التوكن في الجسم) — أعلى عائد أمني في المنطقة.
2. A8-03 (مفتاح قفل مركّب) — يحمي توافر مسار المال.
3. A8-05 (إلزام كلمة المرور عند تفعيل 2FA — متابعتكم 93-C2).
4. البقية P3 دفعة تحصين واحدة (تثبيت الخوارزمية، TTL مؤقت، مفتاح OTP مشتق، حارس verify-2fa، حذف فرع الإرث).

# Round 97 — Repair Plan (خطة الإصلاح)

**التاريخ**: 2026-09-11 · **المدخلات**: 6 تقارير تشخيص (docs/inspection-r97/) = 74+ نتيجة
**النطاق**: كل P0/P1/P2 بلا استثناء · P3 → طابور الجولة 98 (موثق)
**الملكية الحصرية للملفات** لكل وكيل — تعارض صفري مضمون.

---

## 🔴 الحالة الحرجة المكتشفة (R97)

1. **طبقة المجدولات ميتة صامتة منذ ~2026-09-08**: `REDIS_URL` غير موجود في بيئة Render المستعادة + خدمة Redis غير مُنشأة أصلًا في Render (فشل الإنشاء عبر API — plan غير متاح) → scheduler-coordinator يعيد `no_client` للأبد (fail-closed) → 13 cron + 3 watchers + التنبيهات + heartbeat كلها ميتة. المهاجرون fail-open لهذا يعمل التطبيق طبيعيًا ظاهريًا.
   - **أثر مستخدم مباشر**: مسار ربط Firebase (409→consent) يرد **503 REDIS_UNAVAILABLE** على المستخدمين (account-link-consent.ts fail-closed).
   - التنبيهات صفرية رغم 5 منتجات بمخزون 0 · 5 OTP منتهية · 5 جلسات أدمن منتهية.
2. **تجاوز قفل admin login** بتزوير `CF-Connecting-IP` (admin/auth.ts يقرأ الهيدر خامًا) → brute-force موزع بلا سقف.
3. **علة «Waiting for this message» جاهزة للعودة**: بوابة settle تربط حالتها بمعرف جلسة لا يتغير — إعادة الاقتران بنفس المعرف تتجاوز الحماية (WA-01) + البوابة تخزّن creds نصف مربوطة أثناء qr_ready (WA-02).
4. **تسرب بيانات مالي عبر تبديل المستخدم** (F-01): login بمستخدم ثانٍ بعد انتهاء جلسة الأول = كاش المحفظة/الطلبات للسابق معروض للجديد.
5. حزمة Sentry 151KB على المسار الحرج بلا DSN · meta تفعيل GSC لا تُحقن أبدًا (regex) · انجراف ticket_replies (FK+فهرس مفقودان + صفّان يتيمان).

---

## الموجات (ملكية حصرية)

### 97-F1 — إحياء المجدولات: PG-lease leadership + one-shots

**الملكية**: `backend/src/lib/scheduler-coordinator.ts` · `backend/src/lib/pg-leader-lease.ts` (جديد) · `backend/src/services/web-scheduler.ts`

1. وحدة `pg-leader-lease.ts` جديدة: جدول `scheduler_leader_lease` (صف مفرد id=1، holder، expires_at) — acquire عبر INSERT..ON CONFLICT DO UPDATE..WHERE expires_at<now() RETURNING (CAS آمن عبر Neon pooler) · TTL 60s · refresh كل 30s · release=DELETE WHERE holder=$me. `CREATE TABLE IF NOT EXISTS` idempotent عند التهيئة.
2. coordinator: عند غياب عميل Redis → backend الـPG lease (نفس دلالات acquire/refresh/demote). Redis يبقى المسار الأساسي إن وُجد.
3. web-scheduler: إضافة one-shats الإقلاع الناقصة (A6-D): `pruneExpiredOtps` + `pruneStaleAdminSessions` + flash-sale catch-up.
4. اختبارات: وحدة lease CAS (استئثار/انتهاء/تجديد) + coordinator بدون Redis يقود.

### 97-F2 — أمان الخلفي: IP spoofing + consent PG fallback + حدود السوكت

**الملكية**: `backend/src/routes/admin/auth.ts` (أو المسار الحامل للقفل) · `backend/src/lib/account-link-consent.ts` · `backend/src/app.ts` · `backend/src/lib/socket.ts` (خلفي)

1. R97-01: قفل admin login على `req.ip` المصحح (سطر واحد) + اختبار تثبيت.
2. consent: fallback جدول PG `account_link_consents` (token PK، candidate_user_id، firebase_uid_hash، expires_at) عند غياب Redis — consume = DELETE..WHERE token AND expires_at>now() RETURNING + مقارنة hash. CREATE IF NOT EXISTS idempotent. تنظيف المنتهي في كل consume (best-effort).
3. R97-02: إيقاف إرجاع JWT في جسم login/verify-2a (httpOnly cookie يبقى المصدر الوحيد) — مع الحفاظ على اختبارات الواجهة (تحقق عبر الكوكي).
4. R97-06: حد اتصالات Socket.IO لكل IP + حد عام.
5. تهدئة رفض CORS (لا 500 noisy) — نفس الملكية app.ts.

### 97-F3 — واتساب: إعادة تسليح بوابة settle + مراقبة موت القناة

**الملكية**: `backend/src/services/openwa.service.ts` · `backend/src/routes/auth-settings.ts` · `backend/src/services/whatsapp-watch.ts` (جديد — الو.unit كاملة، التوصيل في web-scheduler يقوم به الوكيل الرئيسي لتجنب التعارض)

1. WA-01: مفتاح بوابة settle = (session.id + lastReadyAt/connectedAt) — تغيّر lastReadyAt (اقتران جديد) → تصفير readySince + إعادة نافذة settle + إسقاط dispatchReady.
2. WA-06: `whatsapp-watch.ts`: فحص دوري (كل 60s) للحالة — `status ∉ {ready,settling,qr_ready حديثة}` لأكثر من 15 دقيقة → تنبيه أدمن (alertLogger) بمفتاح dedupe ثابت.
3. WA-03 جزئيًا: تعليق دقة توفير readiness (`ready` تستلزم settle منتهيًا + warm-up OK — تعزيز موجود، وثّق).
4. حالة «failed» تُبلَّغ كما هي في /api/auth/providers (بدون تخفيف) — نسخة الواجهة الصادقة في F5.

### 97-F4 — بوابة OpenWA (مستودع منفصل — إصلاح محلي، بلا دفع حتى اكتمال الاقتران)

**الملكية**: مستودع `/home/z/my-project/repos/openwa-gateway` بالكامل

1. WA-02: عند loggedOut → تصفير lastReadyAt/connectedAt/accountDigits/accountLidDigits + عدم flush creds إلا بعد open (أو flush بشرط ready).
2. حد معدل pair-code (5/ساعة/IP) + حد عام على /api (120/دقيقة/IP) — in-memory bucket.
3. WA-04: توثيق دلالات حالات delivery-log + حصر السجل (آخر 500).
4. اختبارات الوحدة + بناء. **commit محلي فقط — الوكيل الرئيسي يدفع في وقت آمن** (دفع الآن = إسقاط جلسة qr_ready الجارية!).

### 97-F5 — صحة الواجهة: تسريب الكاش + سباقات المال + أرقام عربية

**الملكية**: `frontend/src/lib/user-session.ts` · `admin-session.ts` · `socket.ts` · `auth.tsx` · `pages/product.tsx` · `components/WhatsAppPhoneSignIn.tsx` · `hooks/use-public-auth-providers.ts`

1. F-01: `setToken` (تبديل المستخدم) → `queryClient.clear()` مثل logout + إبطال المسارات المالية.
2. F-04: نفس الشيء لـ `setAdminToken`/`adminLogout`/موجّه 401 الإداري.
3. F-02: مفتاح نية الشراء في product.tsx → sessionStorage بنمط checkout (TTL + ربط بالمنتج).
4. F-03: إعادة join الغرفة عند تبديل الهوية (reconnect socket بكوكي جديد أو re-join) — أو فصل السوكت عند logout.
5. F-05: تحويل الأرقام Arabic-Indic ٠-٩ في normalizePhoneInput + OTP input (وليس حذفها).
6. F-06: الشراء المفرد يبطل `/api/wallet` أيضًا.
7. J-1 (نسخة الواجهة): حالة whatsapp_status==="failed" → تلميح صادق «قناة WhatsApp غير مرتبطة حاليًا — استخدم Google/Telegram» (وليس «قيد الربط»).
8. F-05/Enter: منع إرسال نموذج الشحن من Enter عندما الزر disabled.

### 97-F6 — SEO/Sentry/بناء

**الملكية**: `frontend/src/lib/seo.ts` (أو ملف seoHeadInject) · `boot-sentry.ts`/`instrument.ts` · `vercel.json` · `OPERATIONS_RUNBOOK.md`

1. J-2: إصلاح regex seoHeadInject (multiline data-rh) + اختبار تأكيد dist.
2. J-3: حارس تحميل Sentry — الـvendor chunk لا يُحمَّل إطلاقًا بدون DSN (dynamic import مشروط).
3. J-4: vercel.json rewrites لـ robots.txt/sitemap.xml على مسار Vercel + توثيق معمارية النشر المزدوج (Cloudflare→Render أساسي، Vercel موازٍ) في OPERATIONS_RUNBOOK.
4. .map soft-404 → صفحة 404 حقيقية على Vercel (headers/rewrites).

### 97-F7 — قاعدة البيانات: إغلاق الانجراف (بعد الموجة أ — تعتمد جداول F1/F2)

**الملكية**: `backend/src/db/migrate.ts` · `backend/src/db/schema/*` · `backend/src/services/cron.ts`

1. V1-M9: رسم جدولي `scheduler_leader_lease` + `account_link_consents` رسميًا (CREATE IF NOT EXISTS موجود من F1/F2 — التسجيل الرسمي فقط).
2. V1-M10: ticket_replies — حذف الصفين اليتيمين ثم FK cascade + idx_replies_ticket.
3. إسقاط فهرسي firebase_uid المكررين + مواءمة orders.discount_amount (schema يطابق DB) + عكس uniq_wallet_topups_payment_reference وidx_users_phone_trgm في schema TS.
4. cron: سياسة احتفاظ idempotency_keys (احتفاظ 48h) + تنفيذها.
5. drizzle-kit check يعود صفر انجراف (إن أمكن تشغيله).

---

## طابور الجولة 98 (P3 موثق، غير منفَّذ هذه الجولة)

- توكن ميت عند فشل إدراج الجلسة · ?token= التراثي · قفل 2FA DoS · كوبون بلا سقف/مستخدم · Cache-Control للمصادق · bot_token تلغرام نص صريح (يحتاج تدوير تشفير) · timing oracle username · /api/metrics sid · بحث الأدمن LIKE · مفاتيح checkout TTL/intent-binding · storage event للسلة · ~40 raw-fetch بلا مهلة (الجولة القادمة جولة كاملة) · CSRF على Vercel path · تلميحات كيبورد اللمس.

## التسلسل

1. **موجة أ (متوازية)**: F1 + F2 + F3 + F4 + F5 + F6 (6 وكلاء — ملكية حصرية).
2. **موجة ب**: F7 (يعتمد جداول F1/F2).
3. **دمج الوكيل الرئيسي**: توصيل whatsapp-watch في web-scheduler · تحديث render.yaml (توثيق WHATSAPP_OTP_OPERATOR_E164) · فحوص كاملة (typecheck/lint/951+430 اختبار/بناء).
4. **دفع main → CI → Render** · دفع openwa **بعد جاهزية الجلسة** (أو رمز ربط جديد بعده).
5. تحقق حي + تحديث worklog + تقرير الجولة.

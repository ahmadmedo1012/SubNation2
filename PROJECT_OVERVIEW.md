# SubNation2 — مرجع المشروع الشامل (Project Reference)

> وثيقة مرجعية واحدة تشرح المشروع بالكامل: المعمارية، الميزات، نقاط القوة،
> العيوب، وما يُنصح بإضافته أو حذفه. عُدّ إليها بدلاً من قراءة الكود من جديد.
>
> **آخر فحص:** 2026-05-29 — عبر سرب وكلاء ruflo (أمان، قاعدة بيانات، خلفية، واجهة، بنية تحتية).
> **الحالة العامة:** مشروع إنتاجي ناضج ومنظّم بدرجة عالية. الأساس قوي جداً أمنياً ومعمارياً.

---

## 1) نظرة عامة (What it is)

**SubNation** — سوق إلكتروني عربي (RTL) لبيع الاشتراكات الرقمية في السوق الليبي
(بث مباشر، موسيقى، ألعاب، أدوات إنتاجية). الدفع عبر محفظة داخلية، التسليم فوري
(بيانات حساب مشفّرة تُسلَّم بعد الدفع). يعمل على https://subnation.ly.

| البُعد         | القيمة                                                              |
| -------------- | ------------------------------------------------------------------- |
| البنية         | pnpm monorepo                                                       |
| الخلفية        | Express 5 + TypeScript (~21,500 سطر)                                |
| الواجهة        | React 19 + Vite + Tailwind (~30,000 سطر)                            |
| المشترك        | Drizzle ORM (DB) + api-zod (تحقق) + api-client-react (hooks مولّدة) |
| قاعدة البيانات | PostgreSQL (Neon) — 21 جدول                                         |
| الكاش/الحالة   | Redis (rate-limit, leader-lock, socket adapter)                     |
| مسارات الخلفية | 32 ملف مسار                                                         |
| صفحات الواجهة  | 35 صفحة، 75 مكوّن                                                   |
| الاختبارات     | 13 ملف / 163 اختبار (تمر كلها)                                      |
| النشر          | Render (Docker): web + worker + redis                               |
| المراقبة       | Sentry + Prometheus (prom-client) + pino                            |

---

## 2) المعمارية (Architecture)

```
frontend/   Vite + React + Tailwind (RTL، عربي)
backend/    Express API + auth + jobs + migrations + يخدم الواجهة المبنية
shared/
  db/             مخطط Drizzle + الأنواع
  api-zod/        مخططات تحقّق zod
  api-client-react/ hooks مولّدة من OpenAPI
  api-spec/       مواصفة OpenAPI
scripts/    تشغيل محلي، seed، صيانة
config/      env.example (مرجع مُعلّق كامل)
```

- **أصل واحد (single origin):** الخلفية تخدم الواجهة المبنية من نفس المنفذ.
- **التهيئة كلها عبر `.env`** — لا حاجة لتعديل كود لتغيير النطاق/المنفذ/الأصل.
- **Worker tier:** خدمة `subnation-worker` منفصلة (cron + alerting + heartbeat) تحت قفل Redis، أو يشغّلها الـ web إن لم تكن مفعّلة (`DISABLE_WEB_SCHEDULERS`).

---

## 3) المصادقة (Authentication) — ثلاث طرق نشطة فقط

| الطريقة          | الآلية                                                                                     | الحالة |
| ---------------- | ------------------------------------------------------------------------------------------ | ------ |
| **Google**       | Firebase JS SDK (popup) → ID token → `/api/auth/firebase/session` يتحقق عبر Firebase Admin | نشط    |
| **Telegram**     | Login Widget (redirect) + Mini App (WebApp initData)، تحقق HMAC                            | نشط    |
| **WhatsApp OTP** | OpenWA gateway، كود 6 أرقام، تحقق + JWT                                                    | نشط    |

- **Firebase Phone OTP: مُتقاعد نهائياً** — الخلفية ترفض `sign_in_provider === "phone"`
  صراحةً (دفاع في العمق)، والواجهة أزالت كتل الـ UI الخاصة به. WhatsApp OTP هو
  مسار الهاتف الوحيد الآن.
- النظام **بلا كلمات مرور** للمستخدمين (passwordless). الأدمن فقط بكلمة مرور + 2FA.
- الجلسة عبر cookie httpOnly (`auth_token`) + JWT صلاحية 30 يوماً.

> **ملاحظة مهمة:** Firebase ليس كوداً ميتاً — هو الخلفية الفعلية لتسجيل Google.

---

## 4) قاعدة البيانات (21 جدول)

**الأساسية:** `users`, `products`, `inventory`, `orders`, `wallet_ledger`,
`wallet_topups`, `sessions`, `user_auth_identities`, `admin_users`.
**الدعم:** `coupons`, `flash_sales`, `referral_events`, `notifications`,
`support_tickets`, `ticket_replies`, `loyalty`(عبر users), `audit_logs`,
`auth_activity`, `login_attempts`, `admin_alerts`, `whatsapp_otps`,
`organizations`.

- **الفهارس:** ممتازة — فهارس مركّبة على الأنماط الفعلية (مثل
  `idx_orders_status_created`, `idx_inventory_product_sold`,
  `idx_products_active_category`).
- **النزاهة المالية:** المحفظة بـ `numeric(10,2)`، دفتر أستاذ (`wallet_ledger`)
  يسجّل `balanceBefore/After` لكل حركة.
- **الهجرات:** ملف واحد `migrate.ts` (1026 سطر)، كل العبارات idempotent
  (`IF NOT EXISTS`)، يُشغَّل عند الإقلاع تحت قفل Redis NX (مثيل واحد فقط).

---

## 5) تدفق الشراء (نقطة قوة معمارية)

`POST /api/orders` يستخدم **معاملة ذرية** تجمع:

1. حجز المخزون ذرياً (`UPDATE ... WHERE is_sold=false`) — يمنع البيع المزدوج.
2. خصم الرصيد بـ **قفل تفاؤلي** (`WHERE wallet_balance = currentBalance`) — يمنع سباق التزامن.
3. إدخال دفتر الأستاذ ذرياً (يتراجع كله إن فشل أي جزء).
4. توليد كود الطلب + تسليم بيانات الحساب (مفكوكة التشفير وقت التسليم فقط).

اختبار التزامن موجود (`tests/concurrency.test.ts`).

---

## 6) الأمان (Security) — نقاط قوة بارزة

- **Helmet + CSP** مضبوطة بدقة لتوافق Firebase popup (COOP=`same-origin-allow-popups`، بلا trusted-types، frame-src/connect-src لـ Firebase/Google).
- **CORS** بقائمة سماح (`APP_ORIGINS`)، **CSRF** بالتحقق من Origin/Referer لطلبات التغيير.
- **Rate limiting متعدد الطبقات** على Redis: IP غير مُصادق 600/د، لكل مستخدم 1200/د، مسارات المصادقة 10/15د.
- **JWT:** يفرض `SESSION_SECRET ≥ 32` حرفاً عند الإقلاع، سرّ أدمن منفصل (`_admin`)، صلاحية أدمن 8 ساعات.
- **التشفير:** `AES-256-GCM` لكلمات مرور المخزون — **مشفّرة عند الكتابة**، تُفكّ وقت التسليم فقط.
- **Logger redaction:** يحجب `account_password`/`accountPassword` من السجلات.
- **الأدمن:** argon2 لكلمات المرور، 2FA (TOTP)، lockout على المحاولات الفاشلة، فحص `isActive` لحظياً، RBAC (permissions)، audit log.
- **حماية إعادة التشغيل (replay):** Telegram hash يُسجَّل في Redis بـ TTL.

---

## 7) الميزات (Features) — ملخّص

- كتالوج منتجات (فئات، فلاتر، بحث، flash sales، كوبونات خصم).
- محفظة + شحن (`wallet_topups`) + دفتر أستاذ.
- نظام ولاء (نقاط + مستويات bronze/silver/gold/platinum).
- نظام إحالة (referral) بمكافأة 5 د.ل.
- تذاكر دعم + ردود.
- إشعارات (داخل التطبيق + Telegram للعمليات الإدارية).
- لوحة تحكم أدمن غنية (طلبات، منتجات، مستخدمون، شحن، كوبونات، تسعير، أمان، تنبيهات، نظام، مراقبة).
- SEO (sitemap, robots, JSON-LD, meta، canonical-host redirect).
- PWA (service worker, manifest، precache).
- مراقبة كاملة (Sentry، Prometheus metrics، CWV beacons، صفحة /status عامة).
- RTL عربي مثبّت، نظام ثيم (dark/light) بـ tokens موحّدة.

---

## 8) العيوب والثغرات (Defects & Gaps)

### أولوية متوسطة

1. **JWT المستخدم بلا `sessionId` في مساري Telegram/WhatsApp** — `signUserToken({userId})` فقط، بينما مسار Firebase يُنشئ صف `sessions`. النتيجة: "تسجيل الخروج من كل الأجهزة" + إبطال الجلسة لا يغطيان جلسات Telegram/WhatsApp بنفس الدقة.
2. **`safeDecrypt` يُرجع القيمة الخام عند فشل فك التشفير** بصمت — لو دخلت قيمة غير مشفّرة بطريقة ما، تُسلَّم كما هي دون تنبيه. (مقبول كتوافق رجعي لكن يستحق تحذيراً في السجل.)
3. **`ALERTING_ENABLED=false` في الإنتاج** (render.yaml) — التنبيهات التشغيلية معطّلة؛ التنبيهات تُسجَّل في DB فقط ولا تصل Discord/webhook.
4. **`subnation-worker` مُعرّف لكن `DISABLE_WEB_SCHEDULERS=false`** — أي أن web tier ما زال يشغّل الـ cron؛ الـ worker لا يملكها فعلياً بعد.

### أولوية منخفضة

5. **`GOOGLE_CLIENT_ID` فارغ** — تسجيل Google يعمل عبر Firebase فقط (مقصود، لكن متغيّر البيئة المعطّل قد يربك).
6. **تغطية اختبارات الخلفية محدودة** (163 اختبار لكنها مركّزة على crypto/telegram/whatsapp/audits) — لا يوجد اختبار تكامل آلي لمسار الشراء الكامل عبر HTTP أو لمنطق المحفظة/الكوبون end-to-end.
7. **ملفات ثقيلة في مجلد العمل:** `subnation.zip` (27MB)، `ruvector.db` (1.5MB)، مجلد `ruflo/` كامل — أدوات تطوير لا علاقة لها بالتطبيق (الـ README يذكر أنها gitignored؛ تأكّد أنها فعلاً غير مُتعقّبة في git).
8. **`recommendations` skeleton (`h-48`)** تقريبي — قد يسبب قفزة بسيطة عند التحميل (تجميلي فقط).

### ملاحظات على الأصول (Assets) — تحتاج تدخلك يدوياً

9. **جودة صور المنتجات** تعتمد على روابط خارجية تُدخلها من لوحة التحكم. بعض الشعارات قد تكون منخفضة الدقة أو بهوامش شفافة كبيرة → تظهر صغيرة. (أُضيفت معاينة حية في فورم الأدمن + سقف حجم في البطاقة لتخفيف هذا، لكن الحل الجذري هو تطبيع الأصول نفسها: شفافة، ≥800px، مقصوصة بهامش موحّد.)

---

## 9) توصيات: ما يُضاف / يُحذف / يُحسّن

### يُضاف (Add)

- **توحيد `sessionId` في كل مسارات المصادقة** (Telegram/WhatsApp) لإكمال إبطال الجلسات.
- **اختبارات تكامل HTTP** لمسار الشراء (رصيد كافٍ/غير كافٍ، نفاد المخزون، كوبون، تزامن) ولمسار المحفظة.
- **تفعيل `ALERTING_ENABLED=true`** + ضبط `DISCORD_WEBHOOK_URL` قبل الإطلاق الكامل.
- **مكوّن صورة منتج مشترك** (`<ProductMedia>`) لتوحيد إطار/حشو/fallback عبر 7 مواضع render حالياً (اختياري — التكرار منضبط الآن).
- **سكربت تدقيق أصول الصور** (يفحص روابط `products.image_url` للروابط المكسورة/منخفضة الدقة).

### يُحذف / يُنظّف (Remove)

- **`subnation.zip`** من مجلد العمل (27MB، غير ضروري).
- التأكد أن `ruflo/`, `ruvector.db`, `.swarm/`, `.claude-flow/` كلها مُستثناة من git فعلاً.
- (تم سابقاً) أيقونات github/facebook الميتة، تعليقات Firebase Phone القديمة.

### يُحسّن (Improve)

- نقل الـ schedulers إلى `subnation-worker` فعلياً (`DISABLE_WEB_SCHEDULERS=true`) بعد تجهيزه.
- إضافة تحذير سجل في `safeDecrypt` عند فشل فك التشفير.
- ضبط `recommendations` skeleton ليطابق ارتفاع البطاقة الحقيقي.

---

## 10) النشر والتشغيل (Deploy & Ops)

- **Render Docker:** `web` (starter) + `worker` (starter) + `redis` (free, allkeys-lru).
- **Health:** `/api/healthz` (probe)، canonical-host redirect (www/onrender → apex).
- **الهجرات:** تُشغَّل عند الإقلاع تحت قفل Redis؛ `DISABLE_BOOT_MIGRATIONS` مخرج طوارئ.
- **الأسرار:** كلها `sync:false` في render.yaml (تُضبط يدوياً في Dashboard) — ممارسة سليمة.
- **النسخ الاحتياطي:** سكربتات `db-backup.sh` / `db-restore.sh` + `docs/DISASTER_RECOVERY.md`.

---

## 11) خريطة الملفات المهمة (للرجوع السريع)

| الغرض                                       | الملف                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| تهيئة Express + الأمان + rate-limit         | `backend/src/app.ts`                                                       |
| مصادقة المستخدم (Firebase/logout/providers) | `backend/src/routes/auth.ts`                                               |
| إعدادات مزودي المصادقة + Telegram           | `backend/src/routes/auth-settings.ts`                                      |
| WhatsApp OTP                                | `backend/src/routes/auth-whatsapp.ts` + `services/whatsapp-otp.service.ts` |
| Firebase (Google)                           | `backend/src/services/firebase-auth.service.ts` + `lib/firebase-admin.ts`  |
| الشراء + المحفظة                            | `backend/src/routes/orders.ts` + `lib/ledger.ts` + `lib/pricing.ts`        |
| مصادقة الأدمن + 2FA                         | `backend/src/routes/admin/auth.ts` + `middlewares/requireAdmin.ts`         |
| التشفير                                     | `backend/src/lib/encryption.ts`                                            |
| JWT                                         | `backend/src/lib/jwt.ts`                                                   |
| الهجرات                                     | `backend/src/migrate.ts`                                                   |
| cron jobs                                   | `backend/src/jobs/cron.ts`                                                 |
| المخطط                                      | `shared/db/src/schema/*.ts`                                                |
| بطاقة المنتج                                | `frontend/src/components/ProductCard.tsx`                                  |
| صفحة المنتج                                 | `frontend/src/pages/product.tsx`                                           |
| أزرار المصادقة                              | `frontend/src/components/AuthProviders.tsx` + `WhatsAppPhoneSignIn.tsx`    |
| سياق المصادقة                               | `frontend/src/lib/auth.tsx` + `lib/firebase-auth.ts`                       |
| تهيئة التطبيق + المسارات                    | `frontend/src/App.tsx`                                                     |
| الوثيقة المرجعية الرسمية للحالة             | `PLATFORM.md`                                                              |

---

## 12) الخلاصة

المشروع في حالة **جيدة جداً**: معمارية نظيفة، أمان من الدرجة الإنتاجية (تشفير،
2FA، rate-limit، CSRF، معاملات ذرية)، قاعدة بيانات مُفهرسة جيداً، وتغطية مراقبة
شاملة. أبرز ما يستحق العمل قبل التوسّع: **توحيد sessionId عبر كل المصادقات**،
**تفعيل التنبيهات التشغيلية**، **اختبارات تكامل لمسار الشراء**، وتنظيف **الملفات
الثقيلة** من مجلد العمل. لا توجد ثغرات أمنية حرجة مكتشفة في هذا الفحص.

# SubNation2 — مرجع المشروع الشامل (Project Reference)

> **⚠️ لقطة تاريخية (snapshot) بتاريخ 2026-08-25 — ليست الحالة الحالية.**
> الوضع الراهن للإنتاج موثّق في: `OPERATIONS_RUNBOOK.md` +
> `docs/final-audit-2026-09-20.md` (عدد الجداول/المسارات/الاختبارات والبنية
> التحتية أدناه تجاوزها التطور اللاحق — من بينها إزالة keep-alive وRedis
> وworker في جولة 2026-09-20).

> وثيقة مرجعية واحدة تشرح المشروع بالكامل: المعمارية، الميزات، نقاط القوة،
> العيوب، وما يُنصح بإضافته أو حذفه. عُدّ إليها بدلاً من قراءة الكود من جديد.
>
> **آخر فحص:** 2026-08-25 — فحص شامل بعد توقف التطوير منذ 2026-06-05.
> **الحالة العامة:** مشروع إنتاجي ناضج ومنظّم بدرجة عالية. الأساس قوي جداً أمنياً ومعمارياً.
> ميزات المواصفات 010 (AI Copilot) و011 (توقع الطلب) و012 (إثراء الكتالوج)
> **منفّذة ومكتملة الربط** (مسارات + هجرات + cron + واجهة أدمن).

---

## 1) نظرة عامة (What it is)

**SubNation** — سوق إلكتروني عربي (RTL) لبيع الاشتراكات الرقمية في السوق الليبي
(بث مباشر، موسيقى، ألعاب، أدوات إنتاجية). الدفع عبر محفظة داخلية، التسليم فوري
(بيانات حساب مشفّرة تُسلَّم بعد الدفع). يعمل على https://subnation.ly.

| البُعد         | القيمة                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------ |
| البنية         | pnpm monorepo                                                                                    |
| الخلفية        | Express 5 + TypeScript (~21,500 سطر)                                                             |
| الواجهة        | React 19 + Vite + Tailwind (~30,000 سطر)                                                         |
| المشترك        | Drizzle ORM (DB) + api-zod (تحقق) + api-client-react (hooks مولّدة)                              |
| قاعدة البيانات | PostgreSQL (Neon) — 41 جدولاً (مخطط Drizzle موحّد)                                               |
| الكاش/الحالة   | ~~Redis (rate-limit, leader-lock, socket adapter)~~ — أُزيل Redis من render.yaml في جولة 2026-09-20 (بدائل داخل العملية + PG-lease)  |
| مسارات الخلفية | 17 ملف موجِه + مجموعات فرعية                                                                     |
| صفحات الواجهة  | 35 صفحة، 75 مكوّن                                                                                |
| الاختبارات     | ~1800+ اختبار (backend+frontend+openwa — الأعداد المتغيرة راجع `docs/final-audit-2026-09-20.md`) |
| النشر          | ~~Render (Docker): web + worker + redis~~ — الآن web فقط على الخطة المجانية (أُزيل worker وRedis في 2026-09-20)  |
| المراقبة       | Sentry + Prometheus (prom-client) + pino                                                         |

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
- **Worker tier:** خدمة `subnation-worker` أُزيلت من render.yaml في جولة 2026-09-20 (توثيق تاريخي: كانت cron + alerting + heartbeat)؛ الـ web يشغّلها تحت قائد PG-lease (`DISABLE_WEB_SCHEDULERS` يبقى مفتاح الترحيل لعمال مستقبليين).

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

## 4) قاعدة البيانات (41 جدولاً)

**(أُحدّث في الجولة 103 — كان العدد المعلن 21 ثم 33 ثم 40 في r99؛ العدد الفعلي اليوم
41 تعريف pgTable في shared/db/src/schema/، منها: product_variants (إعمار الكتالوج
r98)، scheduler_leader_lease + account_link_consents (r97)، idempotency_keys (r94)،
provider_fulfillments (r102، V1-M18 — سجل استيفاء المورد لكل طلب)،
admin_alerts، whatsapp_otps، risk_events، forecast*/enrichment* …)**

**الأساسية:** `users`, `products`, `product_variants`, `inventory`, `orders`,
`wallet_ledger`, `wallet_topups`, `sessions`, `user_auth_identities`, `admin_users`.
**الدعم:** `coupons`, `flash_sales`, `referral_events`, `notifications`,
`support_tickets`, `ticket_replies`, `loyalty`(عبر users), `audit_logs`,
`auth_activity`, `login_attempts`, `admin_alerts`, `whatsapp_otps`,
`organizations`.

- **الفهارس:** ممتازة — فهارس مركّبة على الأنماط الفعلية (مثل
  `idx_orders_status_created`, `idx_inventory_product_sold`,
  `idx_products_active_category`).
- **النزاهة المالية:** المحفظة بـ `numeric(10,2)`، دفتر أستاذ (`wallet_ledger`)
  يسجّل `balanceBefore/After` لكل حركة.
- **الهجرات:** ملف واحد `migrate.ts` (2634 سطراً كما في r103، المراحل حتى V1-M19)، كل العبارات idempotent
  (`IF NOT EXISTS`)، يُشغَّل عند الإقلاع — والقفل قفل Redis NX فقط عندما يكون `REDIS_URL` مضبوطاً؛ على الطوبولوجيا الحالية (مثيل free واحد، بلا Redis) تعمل الهجرات بلا قفل بأمان لأن الإقلاع مَسلسَل خلف بوابة 503.

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

1. **توحيد الجلسات (مُنجَز جزئياً ✅):** أصبحت كل المصادقات الثلاث (Google/Telegram/WhatsApp) تُنشئ صف `sessions` موحّداً + JWT بصيغة `{userId, sessionId}` عبر أداة مركزية واحدة `lib/session.ts → createUserSession()`. سابقاً مسار Firebase فقط كان يُنشئ الصف. **يبقى مؤجّلاً** (تغيير معماري أعمق): `requireUser` لا يقرأ جدول `sessions` بعد للتحقق/الإبطال في كل طلب — لذا "تسجيل الخروج من كل الأجهزة" الكامل يتطلّب استعلام DB لكل طلب مُصادق (قرار أداء منفصل). لكن الآن البنية التحتية (الصفوف + sessionId في كل التوكنات) جاهزة لتفعيله متى لزم.
2. **(أُحدّث r99 — عُدّل هذا البند)** `ALERTING_ENABLED` أصبح **`"true"` في الإنتاج** منذ 2026-09-06 (render.yaml يحمل القيمة مع تعليق التوثيق: «مع التنبيهات مطفأة، موت الشيكاوت لن يوقظ أحداً») — التنبيهات التشغيلية تعمل وتصل Discord/webhook عند ضبط `DISCORD_WEBHOOK_URL`.
3. **`subnation-worker` مُعرّف لكن `DISABLE_WEB_SCHEDULERS=false`** — أي أن web tier ما زال يشغّل الـ cron؛ الـ worker لا يملكها فعلياً بعد. تعليقات render.yaml توثّق الآن خطوات التبديل بدقة (WORKER_TIER=true على الـ worker + DISABLE_WEB_SCHEDULERS=true على الويب معاً).
4. **أسرار AI غير مضبوطة بعد:** `COPILOT_*` و`ENRICHMENT_*` أضيفت كـ placeholders في render.yaml (sync:false) — اضبطها في Dashboard لتفعيل Copilot والإثراء. مسارات forecast/enrichment ترفض العمل إلا على worker tier (`WORKER_TIER=true`)، لذا تبقى معطلة حتى تقسيم الطبقات.

### أولوية منخفضة

5. **`GOOGLE_CLIENT_ID` فارغ** — تسجيل Google يعمل عبر Firebase فقط (مقصود، لكن متغيّر البيئة المعطّل قد يربك).
6. **تغطية اختبارات الخلفية:** 291 اختبار (286 ناجحة + 5 todo صريحة). ⚠️ **تصحيح:** `tests/concurrency.test.ts` كان يحتوي 8 اختبارات **وهمية** (`expect(true).toBe(true)`) توهم بتغطية غير موجودة — استُبدلت باختبارات invariants حقيقية + `it.todo` صريحة. أُضيفت `pricing.test.ts` (اختبارات حقيقية لمنطق الخصم المالي: نسبة/ثابت/قصّ ≥0/حد أدنى). يبقى مؤجّلاً: اختبار تكامل HTTP كامل لمسار الشراء (يحتاج Postgres حيّ — موسوم `it.todo`).

### ما أُصلح في فحص 2026-08-25

- **انزياح تجهيزة الاختبار (كسر CI):** جدول `inventory` في `backend/src/test/db.ts` كان ينقصه عمود `updated_at` المضاف للمخطط (متطلب copilot 010 FR-PREVIEW-004) → فشل 12 اختبار checkout في CI على آخر 3 كوميتات (يونيو 2026) رغم نجاحها محلياً قبل إضافة العمود. أُصلح.
- **بوابة النشر:** `deploy.yml` كان ينشر إلى Render مباشرة عند push بغضّ النظر عن نتيجة CI — لهذا انتشر كود فاشل الاختبارات إلى الإنتاج. أصبح النشر الآن مشروطاً بنجاح CI كاملاً (`workflow_run` + شرط conclusion==success).
- **`safeDecrypt` يُرجع القيمة الخام بصمت** عند فشل فك التشفير — أُضيف تحذير سجل (دون تسجيل القيمة نفسها لأنها مادة حساسة).
- **`VITE_GSC_VERIFICATION` لا يصل لبناء Docker** — render.yaml يعرّفه لكن Dockerfile لم يكن يمرره كـ ARG، فكان توكن Search Console دائماً فارغاً في الإنتاج. أُصلح.
- **skeleton توصيات صفحة المنتج** بارتفاع ثابت `h-48` لا يطابق البطاقة الحقيقية → قفزة تخطيط. استُبدل بهيكل مطابق (aspect-[4/3] + صفوف نصية).

### ما أُصلح في جولة UX العالمية 2026-09-06 (خطة subnation-ux-world-class-plan)

> التوثيق الكامل: `docs/ux-audit-icons.md` + `docs/ux-audit-storefront.md` + `docs/ux-audit-admin.md`.
> التحقق: CI أخضر (كان أحمر 4 كوميتات متتالية) → نشر Render live → جولة متصفح حية على 375/768/1440.

- **انزياح هجرة Drizzle (كان يُفشل CI ويوقف كل النشر منذ إضافة السلة):** جدول `cart_items` أُضيف للمخطط دون توليد هجرة → أُلتزمت `0002_strong_freak.sql` + snapshot. (الإنتاج كان سليماً لأن migrate.ts idempotent يغطي الجدول أصلاً.)
- **رحلة السلة كانت UI ميتاً:** لا زر "أضف للسلة" في أي مكان (addItem غير مستدعى) → أُعيدت هيكلة ProductCard (زر حقيقي شقيق للرابط) + زر ثانوي في صفحة المنتج. شارة السلة في Navbar كانت دائماً 0.
- **checkout أُعيدت كتابته:** أخطاء مالية أصبحت بانر ثابت داخل الصفحة (كانت toast 4 ثوانٍ)، أُزيل خيار COD الوهمي (الخلفية تخصم المحفظة دائماً)، الكمية أصبحت لكل وحدة (لم تكن تُرسل أبداً)، الفشل الجزئي يزامن السلة (يمنع الخصم المزدوج عند إعادة المحاولة)، فشل جلب الرصيد لم يعد يفبرك 0.
- **CSS قاتل:** `mobile-nav-safe-pad` كان يُلغي `md:pb-0` في كل المقاسات (فجوة 72px شبح على سطح المكتب لكل مسجَّل — موثَّق بفحص CSS المبني) → قُصرت الأدوات المحمولة على media queries؛ حُذف spacer المزدوج في home؛ `mobile-product-pad-auth` لم يعد يحسب nav مرتين.
- **لوحة إشعارات الجرس كانت تُقتطع خارج الشاشة** على 480–1300px (مرساة RTL خاطئة) → مرساة الحافة اليسرى + clamp؛ الصفوف أصبحت أزراراً حقيقية (لوحة مفاتيح).
- **شارة السلة غير مرئية في الثيم الفاتح** (text-primary-text ≈ نفس لون الخلفية) → text-primary-foreground.
- **التوستات كانت تتبع ثيم نظام التشغيل** (useTheme من next-themes بلا مزوّد!) → @/lib/theme الحقيقي.
- **توحيد اتجاه الأيقونات (قرار RTL المركزي):** رجوع=يمين، تقدّم=يسار، فاصل breadcrumb=يمين — أُصلحت 8 مواضع مخالفة (not-found، category ×2، terms، dashboard KPI، admin/orders، system، category "→" النصي).
- **جداول الأدمن:** risk.tsx أُعيد بناؤه بالنمط القياسي (overflow + بطاقات جوال + TableSkeleton + EmptyState)؛ أزرار hover-only أصبحت ظاهرة على اللمس؛ topups flex-wrap؛ nav prefix-match + صفحة security اليتيمة في القائمة؛ debounce حقيقي لحاسبة الأسعار (كانت POST لكل ضغطة مفتاح).
- **فرز حالات الخطأ عن الفراغ** في home/category/flash-sales/product (الانقطاع كان يُقرأ "لا نتائج") + هيكليات skeleton مطابقة لصفحات product/order (كانت تقفز 256px).
- **بيانات الحساب المسلَّمة:** كلمة المرور مخفية افتراضياً + إظهار/إخفاء + dir=ltr + نسخ آمن بـfallback (كانت ظاهرة نصاً والنسخ يفشل صامتاً).

### ملاحظات على الأصول (Assets) — تحتاج تدخلك يدوياً

7. **جودة صور المنتجات** تعتمد على روابط خارجية تُدخلها من لوحة التحكم. بعض الشعارات قد تكون منخفضة الدقة أو بهوامش شفافة كبيرة → تظهر صغيرة. (أُضيفت معاينة حية في فورم الأدمن + سقف حجم في البطاقة لتخفيف هذا، لكن الحل الجذري هو تطبيع الأصول نفسها: شفافة، ≥800px، مقصوصة بهامش موحّد.)
8. **✅ حادثة إنتاج (اكتُشفت وحُلّت 2026-08-25):** كل مسارات DB كانت ترجع 500 لأن حصة Neon المجانية استُنفدت (الإيقاف التالي معطّل + الحصة مُجمَّعة على مستوى المنظمة). أُنشئ مشروع Neon جديد `SubNation2`، طُبّق المخطط كاملاً عبر migrate.ts (33 جدولاً)، زُرع الأدمن والمنتجات، حُدِّث `DATABASE_URL` في Render، وتم التحقق شاملاً — الموقع يعمل. ⚠️ **تحذير استدامة:** الخطة تمنع تفعيل الإيقاف التلقائي؛ الاستهلاك سيقترب من سقف الحصة نهاية كل شهر. الحلول الجذرية: خطة Neon المدفوعة، أو حساب Neon جديد بإعدادات افتراضية سليمة، أو تقبّل انقطاعات قصيرة تعيد الحصة يوم 1 من كل شهر.

---

## 9) توصيات: ما يُضاف / يُحذف / يُحسّن

### يُضاف (Add)

- ~~تفعيل `ALERTING_ENABLED=true`~~ (منفّذ منذ 2026-09-06 — راجع البند 2 في «العيوب»). يتبقى فقط ضبط `DISCORD_WEBHOOK_URL` في الـ Dashboard.
- **اختبارات تكامل HTTP** لمسار الشراء (رصيد كافٍ/غير كافٍ، نفاد المخزون، كوبون، تزامن) ولمسار المحفظة.
- **مكوّن صورة منتج مشترك** (`<ProductMedia>`) لتوحيد إطار/حشو/fallback عبر مواضع render المتعددة (اختياري — التكرار منضبط الآن).
- **سكربت تدقيق أصول الصور** (يفحص روابط `products.image_url` للروابط المكسورة/منخفضة الدقة).

### يُحذف / يُنظّف (Remove)

- ~~الملفات الثقيلة (`subnation.zip`, `ruvector.db`, `ruflo/`)~~ — **منظّفة فعلاً**؛ `.gitignore` يغطيها كلها.

### يُحسّن (Improve)

- تقسيم الطبقات فعلياً: توفير `subnation-worker` + `WORKER_TIER=true` + `DISABLE_WEB_SCHEDULERS=true` (الخطوات موثّقة في render.yaml) — بعدها يمكن تفعيل forecast/enrichment crons.
- إصلاح حادثة DB في الإنتاج (بند 8 أعلاه) — أولوية قصوى.

---

## 10) النشر والتشغيل (Deploy & Ops)

- **Render Docker:** خدمة `web` واحدة (خطة free) — بلا worker وبلا Redis بعد جولة 2026-09-20 (الطوبولوجيا الكاملة الحالية في render.yaml).
- **Health:** `/api/healthz` (probe)، canonical-host redirect (www/onrender → apex).
- **الهجرات:** تُشغَّل عند الإقلاع (قفل Redis NX فقط عند وجود `REDIS_URL`)؛ `DISABLE_BOOT_MIGRATIONS` مخرج طوارئ.
- **الأسرار:** كلها `sync:false` في render.yaml (تُضبط يدوياً في Dashboard) — ممارسة سليمة.
- **النسخ الاحتياطي:** `pnpm run db:backup` (scripts/src/backup-db.ts) + `docs/DISASTER_RECOVERY.md`.

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
شاملة. ميزات AI الثلاث (Copilot، توقع الطلب، إثراء الكتالوج) منفّذة بالكامل.
خط CI/النشر أصبح محكماً: النشر لا يحدث إلا بعد نجاح كل الفحوص. **الأولوية القصوى
الآن تشغيلية لا برمجية:** إصلاح اتصال Neon في الإنتاج (بند 8 §8)، ثم تفعيل
التنبيهات، ثم تقسيم الطبقات عند الحاجة لتفعيل crons التوقّع/الإثراء.

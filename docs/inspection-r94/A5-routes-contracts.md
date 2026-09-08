# A5 — تفتيش المسارات والعقود (routes/** + middlewares/** + openapi.yaml) — الجولة 94

**الوكيل:** A5 (routes & contracts inspector) — **الوضع:** قراءة فقط، صفر تعديلات على الكود.
**النطاق:** `backend/src/routes/**` (43 ملف مسار) + `backend/src/middlewares/**` (9) + `backend/src/app.ts`/`server.ts` + `shared/api-spec/openapi.yaml` (4675 سطر) + ملفات مساندة (lib/http, lib/permissions, lib/service-error, error-codes, scripts/check-openapi-routes.ts, workflows, مخططات DB، api-zod المولّد).
**المنهجية:** قراءة سطر-بسطر لكل ملف مسار/ميدل‌وير + تشغيل بوابة الانجراف `check-openapi-routes.ts` فعليًا + مقارنة آلية (Node) بين enum ErrorCode في العقد والمقابل المشترك + تحقق Node لسلوك TypeError/RangeError + تتبع git لجذر الانجراف.

**الملفات المفحوصة:** 55 ملفًا في النطاق الأساسي + 14 ملفًا مساندًا (≈ 69).

---

## P1 — النتائج الحرجة

### A5-01 [P1] خط أنابيب CI/CD بأكمله معطّل (فلاتر فروع تالفة) — بوابة عقد openapi لا تعمل أصلًا
- **ملف:سطر:** `.github/workflows/ci.yml:4-7` و `.github/workflows/deploy.yml:8-11`
- **الدليل (بايت-ببايت، `cat -A`):**
  ```yaml
  on:
    push:
      branches: ain, develop]     # ← ليست [main, develop] — سلسلة نصية لا تطابق أي فرع
    pull_request:
      branches: ain, develop]
  ```
  وdeploy.yml: `branches: ain]` تحت `workflow_run`. التلف موجود منذ أول إدخال للملفين (commit `b5e956e`) — القيمة `[ma` مفقودة من كل المواضع (يبدو إصلاح sed سابق أكلها).
- **الأثر:** `on.push.branches` = السلسلة `"ain, develop]"` → لا يطابق `main`/`develop` أبدًا → **سير عمل CI لا ينطلق إطلاقًا** (lint/typecheck/بوابة عقد OpenAPI/فحص انجراف drizzle/اختبارات الباك/الفرنت/البناء/gitleaks/CVE كلها داكنة)، وسير عمل النشر المعتمد على `workflow_run: [CI]` لا ينطلق بدوره → «بوابة النشر على CI أخضر» الوثّقت لإغلاق حادثة يونيو 2026 (deploy.yml:2-6) غير موجودة عمليًا.
- **الإثبات المرتبط:** شغّلتُ `tsx scripts/check-openapi-routes.ts` على HEAD (`255370e`) → **فشل**:
  ```
  ❌ Implemented but NOT documented (outside the allowlist):
       get /api/admin/diagnostics/inventory-health
  ```
  المسار أُضيف في `508652d` (جولة 93) بلا توثيق ولا إضافة للقائمة البيضاء، ومع ذلك نُشر — **مستحيل لو أن CI كان يعمل** (الخطوة `OpenAPI ↔ Express route contract gate` في ci.yml:203 بلا continue-on-error).
- **الإصلاح الدقيق:** ① `branches: [main, develop]` في ci.yml و `branches: [main]` في deploy.yml. ② توثيق `GET /api/admin/diagnostics/inventory-health` في openapi.yaml (أو إضافته لـ KNOWN_UNDOCUMENTED بتصنيف admin-gap مع سبب). ③ إعادة تشغيل البوابة محليًا قبل الدفع.

### A5-02 [P1] عقد copilot/history: حقل `admin_id` موثّق إلزاميًا ولا يُصدَر أبدًا
- **ملف:سطر:** `shared/api-spec/openapi.yaml:4570-4594` مقابل `backend/src/routes/admin/copilot/history.ts:89-105`
- **الدليل (العقد):** CopilotHistoryEntry `required: [id, admin_id, intent_text, action_class, risk_tier, outcome, created_at]`، والمولّد `shared/api-zod/src/generated/api.ts:1792+`: `admin_id: zod.number()` (إلزامي غير قابل للـ null).
- **الدليل (الكود):** خريطة الاستجابة الفعلية تُصدر `id, preview_id, intent_text, tool_name, action_class, risk_tier, outcome, failure_reason, before_state, after_state, executed_at, created_at` — **لا وجود لـ admin_id**:
  ```ts
  entries: page.map((r) => ({ id: r.id, preview_id: r.previewId, intent_text: r.intentText, tool_name: r.toolName, ... }))
  ```
- **الأثر:** أي عميل مولّد من العقد (orval — `shared/api-client-react`) يفشل تحويل الاستجابة في **كل** طلب سجل؛ العقد كاذب لحقل إلزامي.
- **الإصلاح الدقيق:** أضِف `admin_id: r.adminId` في خريطة الاستجابة (العمود محمّل أصلًا في `copilotActionsTable` — يتطلب إضافته للـ select) أو انزع `admin_id` من required والـ zod بعد `pnpm codegen`؛ الأفضل الأول (الملكية مفيدة للـ UI).

---

## P2 — النتائج المهمة

### A5-03 [P2] فلاتر status على أعمدة pg-enum بلا تحقق → 500 بدل 400 (4 مواضع)
- **ملف:سطر:**
  1. `backend/src/routes/admin/topups.ts:31-33` — `conditions = status … ? [eq(walletTopupsTable.status, status as any)]` والعمود `topupStatusEnum` (`shared/db/src/schema/wallet_topups.ts:16,31`).
  2. `backend/src/routes/admin/orders.ts:22-23` — نفس النمط على `orderStatusEnum` (schema/orders.ts:18,46).
  3. `backend/src/routes/admin/tickets.ts:12-14` — نفس النمط على `ticketStatusEnum` (schema/support_tickets.ts:4,15).
  4. `backend/src/routes/admin/risk.ts:62-63` — `if (eventType) filters.push(eq(riskEventsTable.eventType, eventType as never))` على `riskEventTypeEnum` (schema/risk.ts:37,75) — لاحظ أن `level` المُجاور **مُتحقَق** عبر VALID_LEVELS (risk.ts:57-60) وeventType منسي.
- **الدليل:** دريزل يُمرر القيمة كوسيط: `WHERE status = $1` مع قيمة خارج الـ enum → Postgres 22P02 `invalid input value for enum "topup_status"` → استثناء → المصحّح العام → 500 INTERNAL_ERROR.
- **الأثر التعاقدي:** openapi يوثّق المعامل كسلسلة حرة بلا enum (مثل openapi.yaml:1433-1437 لـ /admin/topups، و1287-1300 لـ /admin/orders) → **مدخل مشروع بموجب العقد نفسه يفجّر 500**. أيضًا انكشاف تشويش في السجلات (Sentry يقبل حدث 500 لكل قيمة عشوائية).
- **الإصلاح الدقيق:** قائمة بيضاء قيم لكل مسار (`["pending","approved","rejected"]` … و12 قيمة لـ risk eventType — أو اشتقها من الـ pgEnum) → قيمة غير معروفة: إما تجاهل الفلتر أو 400 INVALID_DATA؛ ثم أضِف `enum:` للمعامل في openapi.

### A5-04 [P2] POST /api/coupons/validate يقرأ الجسم خامًا → TypeError → 500 (وثّقت 400)
- **ملف:سطر:** `backend/src/routes/coupons.ts:79-84`
- **الدليل:**
  ```ts
  const { code, order_amount } = req.body ?? {};
  if (!code?.trim()) return res.status(400)…   // code = 5 → TypeError: code?.trim is not a function
  ```
  تحقق Node فعلي: `{"code":5}` → `TypeError`، `{"code":{}}` → `TypeError` → مسار async يرفض → Express 5 يمرره للمصحّح العام → **500 INTERNAL_ERROR** بينما العقد يوثّق 400 «Invalid body» (openapi.yaml:742-750).
- **سياق:** فئة الخطأ نفسها أُصلحت في الجولة M2 لجسمَي كوبونات الأدمن (zod كامل + اختبارات `coupons-schema.test.ts:76` «rejects a non-string description (the .trim() TypeError → 500 path)») — لكن مسار المستخدم `/coupons/validate` فاته الإصلاح. مسارات أخرى بنفس الفئة: `routes/support.ts:98-99` (title/message غير نصية → 500) و`routes/admin/tickets.ts:159-160` (message).
- **الإصلاح الدقيق:** zod schema للتحقق (`code: z.string().trim().min(1)`, `order_amount: z.number().positive()`) أو تحويل إلى `typeof code !== "string" || !code.trim()`؛ مثله في support/admin-tickets؛ أضِف اختبار انحدار بنمط الاختبار الموجود.

### A5-05 [P2] رمزا COPILOT_PHASE_DISABLED و COPILOT_SECRET_LEAK يُصدَران خارج عقد ErrorCode (53≠53)
- **ملف:سطر:** `backend/src/middlewares/requireCopilotPhase.ts:18` و`backend/src/routes/admin/copilot/ask.ts:329,336` و`draft.ts:175,209`
- **الدليل:**
  ```ts
  res.status(503).json({ error: "هذه المرحلة…", code: "COPILOT_PHASE_DISABLED", phase });
  ```
  والفحص الآلي (Node) لكل `code:`/`ErrorCode.` في routes+middlewares مقابل `shared/error-codes/src/index.ts` (109 سطرًا، يدّعي «the enum stays exhaustive over what the backend actually emits») → المفقودان فقط: `COPILOT_PHASE_DISABLED`, `COPILOT_SECRET_LEAK` (البقية FARMER01/ONESHOT/RACE10/UNLIMITED في اختبارات فقط).
- **الأثر:** openapi يسمّيهما نصًا في وصف الاستجابات (2400: «COPILOT_PHASE_DISABLED»، 2394: «COPILOT_SECRET_LEAK») لكن enum ErrorCode (openapi.yaml:2937-2997، ومطابقته مع error-codes مثالية 53=53) **لا يحتويهما** → العميل الذي يفكّ `code` عبر الـ enum لن يتعرّف عليهما، وخريطة الرسائل العربية تسقط للنص الخام.
- **الإصلاح الدقيق:** أضِف الرمزين إلى `shared/error-codes/src/index.ts` + enum ErrorCode في openapi + `pnpm codegen` (وخريطة رسائل الفرنت إن وُجدت) — نفس أسلوب 93-A8 F-8/F-15.

### A5-06 [P2] /admin/copilot/history: معاملات موثّقة غير منفذة + عدم تطابق اسم معامل `since_iso`↔`since`
- **ملف:سطر:** `shared/api-spec/openapi.yaml:2709-2771` مقابل `backend/src/routes/admin/copilot/history.ts:23-61`
- **الدليل (العقد):** يوثّق query params: `action_class, outcome, entity_type, entity_id, since_iso, limit, cursor` + استجابة 400 «Invalid query (e.g. entity_id without entity_type)».
- **الدليل (الكود):** المسار يقرأ فقط `limit, action_class, outcome, since, cursor`:
  ```ts
  const sinceRaw = typeof req.query.since === "string" ? req.query.since : null;  // not since_iso
  ```
  - `entity_type`/`entity_id` **لا يُقرآن إطلاقًا** (تُتجاهل بصمت — نفس فئة 93-A8 F-2).
  - عميل يرسل `?since_iso=…` (كما يوثّق العقد) لا يحصل على أي تصفية زمنية.
  - الـ 400 الموثقة لـ entity_id بلا entity_type غير موجودة.
- **الإصلاح الدقيق:** إما تنفيذ الفلاتر (`entity_type` نص، `entity_id` int>0 مع 400 عند غياب النوع، وتوحين القراءة إلى `since_iso` مع دعم الاسم القديم) أو حذف المعاملات من العقد + `pnpm codegen`.

### A5-07 [P2] POST /admin/copilot/draft يصدر 200 بـ `preview_id: null` بينما العقد يوجب سلسلة
- **ملف:سطر:** `backend/src/routes/admin/copilot/draft.ts:179-187` مقابل `openapi.yaml:4514-4521` والمولّد `api.ts:1499-1500` (`preview_id: zod.string()` غير nullish).
- **الدليل:** مسار «النموذج رفض الصياغة وأجاب نصًا» يرد:
  ```ts
  res.json({ preview_id: null, preview: null, assistant_text: result.text, … });
  ```
- **الأثر:** استجابة 200 قانونية تخترق مخطط CopilotDraftResponse (والعميل المولّد) — فئة «حالة صادرة فعلًا بلا توثيق صحيح للشكل».
- **الإصلاح الدقيق:** في openapi: `preview_id: type: ["string","null"]` + `preview: oneOf[CopilotPreviewView, "null"]` (مع تحديث حالة «model declined» في الوصف) ثم codegen؛ أو أعد التشكيل إلى `{drafted: false, assistant_text…}`.

### A5-08 [P2] POST /admin/alerts/test يفبرك نجاح تسليم القنوات الثلاث (نجاح كاذب في سطح مراقبة)
- **ملف:سطر:** `backend/src/routes/admin/alerts.ts:34-50`
- **الدليل:** `dispatchTestAlert` يعيد نتيجة تسليم حقيقية لكل قناة (`alerting.service.ts:865-887` → `delivery: ChannelDeliveryResult[]`)، لكن المسار **يرميها** ويصلب الثابت:
  ```ts
  const alertEvent = await dispatchTestAlert(typeof rule === "string" ? rule : undefined);
  return res.json({ alert: alertEvent, delivery: { telegram: { ok: true }, discord: { ok: true }, webhook: { ok: true } } });
  ```
- **الأثر:** المشغّل يضغط «اختبار التنبيه» أثناء عطل فعلي في قناة (توكن تلغرام خاطئ / ويبهوك ميت) فيرى ok:true×3 — عكس الغرض التشغيلي للمسار؛ فئة نجاح-كاذب نفسها التي أصلتها R93 في مواضع أخرى (topups 404-for-failure إلخ).
- **الإصلاح الدقيق:** `return res.json({ alert: alertEvent, delivery: alertEventDelivery })` بعد تفكيك `const { alert, delivery } = await dispatchTestAlert(...)` وتحويل المصفوفة للشكل `{telegram:{ok},discord:{ok},webhook:{ok}}` من النتيجة الفعلية؛ أضِف `writeAuditLog` للمسار (لا يوجد).

---

## P3 — نتائج متوسطة/دقيقة

### A5-09 [P3] /admin/security/auth-activity: تواريخ غير صالحة → RangeError → 500
- **ملف:سطر:** `backend/src/routes/admin/security.ts:15-20`
- **الدليل:** `conditions.push(gte(authActivityTable.createdAt, new Date(startDate as string)))` بلا تحقق — `?startDate=abc` (أو مصفوفة query مكررة) → `new Date("abc")` → دريزل يستدعي `toISOString()` → `RangeError: Invalid time value` (مُتحقق Node) → 500. مثله `endDate`. ولا `action` مُتحقق كمصفوفة (`action as string`).
- **الإصلاح:** `const d = new Date(String(startDate)); if (Number.isNaN(d.getTime())) return 400 INVALID_DATA` قبل الدفع للـ where — نفس حراسة risk.ts:65-74 (from/to محروس جيدًا هناك — استنسخها).

### A5-10 [P3] رفع مخزون (حتى 500 وحدة بيانات دخل) بلا سجل تدقيق
- **ملف:سطر:** `backend/src/routes/admin/products.ts:389-572` (POST /products/:id/inventory)
- **الدليل:** المسار يفحص ويدمج ويشفّر ويدرج `inventoryTable` بلا أي استدعاء `writeAuditLog`، بينما `set-count` المجاور يسجل (`products.ts:380-384`) وكذلك product.create/update/archive. عمود إدخال بيانات اعتماد (دخول/تشفير) دون أثر «من رفع ماذا».
- **الإصلاح:** `void writeAuditLog(req, "product.inventory.upload", "product", productId, { added: inserted.length, skipped_duplicates })` بعد الإدراج.

### A5-11 [P3] PATCH /admin/settings/auth/:id — قيم حقول غير متحققة وبلا سجل تدقيق
- **ملف:سطر:** `backend/src/routes/auth-settings.ts:991-998`
- **الدليل:**
  ```ts
  const val = incoming[field.key]; if (val === undefined) continue;
  if (field.isSecret && (val === "[SET]" || val === "")) continue;
  updated[field.key] = String(val).trim();   // object → "[object Object]"، وبدون حد طول (حتى 1MB داخل حد الجسم)
  ```
  المسار يبدّل إعدادات مزودي المصادقة (bot_token، تفعيل/تعطيل تلغرام) — إجراء حساس أمنيًا — بلا zod وبلا writeAuditLog وبلا تحقق شكلي للتوكن.
- **الإصلاح:** zod لكل حقل (نص، حدود طول 200-500، واختياريًا نمط توكن)، واستدعاء writeAuditLog قبل upsert؛ تجاهل غير-النص مع 400 بدل تخزين "[object Object]".

### A5-12 [P3] محددات معدل مستوى المسار (تذاكر/ردود) غير مدعومة بـ Redis — تنسى عند إعادة التشغيل
- **ملف:سطر:** `backend/src/routes/support.ts:84-93` و`179-187`
- **الدليل:** `rateLimit({ windowMs, limit, keyGenerator, message })` بلا `store: makeRateLimitStore()` — بينما كل محددات app.ts (apiLimiter/userLimiter/authLimiter/couponValidateLimiter) تستخدم المخزن المرن (app.ts:378-379,432,477,495,529). إعادة نشر = تصفير عدادات السبام (5 تذاكر/ساعة، 30 رد/ساعة)، وتوزّع بين النسخ لو تعددت.
- **الإصلاح:** `store: process.env.REDIS_URL ? createResilientRateLimitStore() : undefined` في كلا المحددين (نسخ نمط app.ts).

### A5-13 [P3] واجهة debug لـ copilot/settings تسرّب طول مفتاح المزوّد وبادئته (4 محارف)
- **ملف:سطر:** `backend/src/routes/admin/copilot/settings.ts:56-61`
- **الدليل:** `copilot_api_key_prefix: rawKey.slice(0, 4)` + `copilot_api_key_length` يُعادان لكل أدمن يملك `admins|settings`. موثّق كخيار متعمد للتشخيص؛ بادئة مفاتيح OpenRouter قياسية (`sk-o`) لكن لو تغيّر المزوّد فالبادئة قد تحمل إنتروبيا. مقيد بنطاق أدمن رفيع + خلف auth.
- **الإصلاح (اختياري):** اكتفِ بـ `key_present: boolean` و`provider`، أو اجعل البادئة خيارًا خلف `?debug=2` موثّقًا.

### A5-14 [P3] `intParam` يقبل id سالبًا/بلاحقة قمامة — 404 بدل 400 الموثقة
- **ملف:سطر:** `backend/src/lib/http.ts:10-15` (يستهلكه كل مسار `:id`)
- **الدليل:** `Number.parseInt("-5")` → -5 يمر، `parseInt("12abc")` → 12 يمر. العقد يوثّق 400 «Invalid (non-integer) id» (مثل openapi.yaml:239-244 لـ recommendations، 2090-2095 لمنتج أدمن). الأثر محدود (استعلام PK سالب → 404) لكن شكل الاستجابة يخالف العقد، ويُهدر رحلة DB.
- **الإصلاح:** `const parsed = Number.parseInt(value, 10); return Number.isInteger(parsed) && parsed > 0 && String(parsed) === value.trim() ? parsed : null;` (تعديل موحد في مكان واحد).

### A5-15 [P3] تعليق مكرر منسوخ خطأً فوق مسار recommendations
- **ملف:سطر:** `backend/src/routes/products.ts:327-333`
- **الدليل:** بلوك تعليق «/api/products/by-slug/:slug … Mounted BEFORE /:id at the parent /products router level» منسوخ حرفيًا فوق `router.get("/:id/recommendations")` — مضلل لقارئ الكود (يصف مسارًا آخر).
- **الإصلاح:** احذف المكرر أو استبدله بتعليق يصف مسار التوصيات.

---

## ما تحقق وسلِم (إيجابيات موثقة بالاقتباس)

1. **`requireAdmin` يرفض توكن 2FA المؤقت** (`requireAdmin.ts:53-58`) و`/api/metrics` يطبق نفس الفحص (`metrics.ts:48-58`) — لا مكرر.
2. **بوابة CSRF fail-closed + إقلاع-إجهاض** عند قائمة أصول فارغة في الإنتاج (`app.ts:101-112,723-738`) — وتخطي مُبرَّر محصور (webhook/cwv/firebase/probe).
3. **تركيب الميدل‌وير سليم**: cloudflareClientIp مبكرًا (app.ts:292) → CSRF (744) → محددات auth الحساسة (748-759) قبل المحددات العامة (763-764) → المسارات؛ 404 JSON للمسارات غير المطابقة (768-770)؛ معالج أخطاء لا يسرّب stack ويشكّل ZodError إلى 400 بـ issues (838-870).
4. **Cloudflare IP لا يثق بـ XFF أعمى**: يتحقق من أن النظير الأخير داخل نطاقات CF المنشورة قبل تبني CF-Connecting-IP (`cloudflareClientIp.ts:173-209`).
5. **تطابق ErrorCode في العقد = enum المشترك بالضبط 53=53** (فحص آلي؛ أصل الرمزين المفقودين A5-05 هو الاستثناء الوحيد).
6. **safeParse مفحوصة النجاح في كل مسارات المال** (orders.ts:96-98، wallet.ts:110-112، topups.ts:24-27، coupons.ts:170-172,239-241، products(admin):102-103,183-184، admin/auth.ts:36-38) — لا موضع safeParse بلا فحص success.
7. **كل مسارات المال تحوّل أخطاء الخدمة لرموز مستقرة**: orders.ts:114-209 (كل reason→رمز)، topups.ts:100-107/133-140 (ServiceError→mapServiceErrorToCode)، users.ts:246-253 (AdjustmentError→mapper مخصص يرجّح CONFLICT للسباق) — إغلاق 93 قائم.
8. **idempotency مركّب على كل مسارات المال الإدارية + مسار العميل** (orders.ts:93، topups.ts:86/119، users.ts:122، bulk-status:130، referrals:106) و409 أجسامه موثقة بوفاء (IdempotencyConflictResponse).
9. **قصّ pagination موحد**: orders(admin):17-21، users:22-26، alerts:23-32، risk events:50-53، copilot history:23-26، forecast:50 — الكل clamp [1..cap].
10. **تسريب معلومات داخلية مضبوط في health/metrics/seo**: /healthz/summary عام بشكله فقط (health.ts:709-722، 503 عند failing فقط)، تفاصيل Redis/Neon/worker خلف requireAdmin، /metrics خلف أدمن أو توكن بثابت-الزمن (metrics.ts:30-62)، robots.txt/sitemap بلا أسرار وCache-Control سليم (seo.ts:96-99,216-230) وbumpSitemapCache مربوط بـ CRUD المنتجات.
11. **أمان أجهزة WhatsApp الإداري** بوابات قابلة للتشكيل لرموز خدمة (diagnostics.ts:276-293) وsession name/phone قراءة نصية خام لكن داخل نطاق أدمن settings.
12. **حدود أجسام على مسارات الكتابة العامة**: تذاكر/ردود 4000 حرف (support.ts:21,106,212)، رد admin-topup zod strict 500 (topups.ts:18-28)، كوبونات مدجنة (coupons.ts:25-59).
13. **إنذار كاذب 200-for-failure مُصلَح** في عدة مسارات (delete coupon/products/notifications/sessions/alerts → 404 عند الصفر) — التعليقات تشير للجولة الأصلية.
14. **بوابة عقد openapi نفسها ممتازة** (scripts/check-openapi-routes.ts) — تحل شجرة مسارات Express ثابتًا وتفحص الاتجاهين مع قائمة بيضاء مبررة لكل عائلة — المشكلة الوحيدة أنها لا تعمل (A5-01) ومسار واحد فلت منها (A5-01).

## إحصاء
- **P1:** 2 (A5-01، A5-02) — **P2:** 6 (A5-03..A5-08) — **P3:** 7 (A5-09..A5-15) = **15 نتيجة**، كلها باقتباس كود/تشغيل فعلي.
- تداخلات مع جيران الجولة (تُذكر ولا تُعاد): A4-F1 (risk-soft/hard-block middlewares غير مركّبة — منطق middlewares) وA4-F10 (idempotency pass-through من الفرنت لمسارات المال) وA4-F3 (failed→completed ثم refund) — كلها في منطقة services/الواجهة وموثقة في تقرير A4.

> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/deep-audit-2026-09-06.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# تقرير الفحص والتشخيص العميق الشامل — SubNation2

> **التاريخ:** 2026-09-06 · **الالتزام:** `main@c9871a6` · **الإنتاج:** Render LIVE
> **المنهجية:** gstack v1.80.0.0 (Garry Tan / YC) — وضع CSO الشامل (14 مرحلة) + جيش المراجعين (8 متخصصين + فريق أحمر) + تحقق حي مباشر
> **نطاق الفحص:** كامل المستودع (backend + frontend + shared + scripts + infra + CI/CD + git history) + الموقع الحي subnation.ly

---

## 1. الملخص التنفيذي

شُغّلت أضخم جولة تشخيص في تاريخ المشروع: **8 متخصصين متوازيين** بطريقة gstack Review-Army (أمن، أداء، عقود API، اختبارات، صيانة، هجرات بيانات، تبسيط، فريق أحمر خصومي) + المراحل الميكانيكية لنمط CSO (أسرار Git، سلسلة التوريد، أمان CI/CD، الظل البنيوي، الويبهوكات، أمان LLM) + تحقق حي بالمتصفح الآلي على الإنتاج.

**الحصيلة: ~123 نتيجة موزّعة كالتالي:**

| الخطورة | العدد | ملاحظات |
|---|---|---|
| CRITICAL | 6 (بعد إزالة التكرار) | 2 منها مؤكدتان **مباشرة على الإنتاج** |
| HIGH | 35 | أغلبها في مسار الشراء والعمليات |
| MEDIUM | 43 | عقود، هجرات، صيانة، اختبارات |
| LOW | 30 | |
| ADVISORY (تبسيط) | 15 | ~6,250 سطر قابلة للحذف/التجنب |

**أخطر اكتشاف:** مسار الشراء (checkout) **معطّل فعلياً لكل المستخدمين المسجلين** منذ نشر `af61fc9` — سببها خطأ شكل استجابة (`data?.user?.wallet_balance` بينما الخادم يعيد المستخدم مسطحاً)، وأزاله حذف خيار COD الذي كان يحمي الكود القديم من هذا المسار. تم التحقق حياً: زر التأكيد لا يُفعَّل أبداً مع سلة غير فارغة (الرصيد يُقرأ دائماً 0).

**النقاط الجيدة المهمة (للإنصاف التشخيصي):** المال لا يُسرق عبر سباقات SQL (قفل تفاؤلي + معاملات سليمة)، الويبهوك موقّع بمقارنة ثابتة الزمن، تشفير AES-256-GCM للمخزون، حزم أمامية ممتازة (36.6KB gzip بحد CI 55KB)، CI أخضر مع فحص انجراف هجرات، صفر XSS أمامي، وكل حسابات المشتريات تُحسب من جديد في الخادم. المشروع مبني بعناية هندسية حقيقية — لكن طبقات الحماية التشغيلية (المراقبة/الإنذار/الاسترجاع) معطّلة أو ميتة في الإنتاج، والفجوات الحرجة تتركزت في **الواجهة المكتوبة يدوياً خارج العقود المولّدة**.

---

## 2. المنهجية والأدوات (gstack)

| الطبقة | الأداة/المتخصص | التغطية |
|---|---|---|
| CSO Phase 0-1 | نموذج البنية + إحصاء سطح الهجوم | 141 نقطة نهاية (75 GET/43 POST/11 PATCH/10 DELETE/2 PUT)، 43 ملف مسارات، 21 صفحة إدارية |
| CSO Phase 2 | أسرار Git (تنقيب التاريخ) | لا مفاتيح مفعّلة (ghp_/sk_/AKIA/xoxb) في التاريخ |
| CSO Phase 3 | سلسلة التوريد | `pnpm audit --prod`: 23 تحذيراً (12 high, 12 moderate) |
| CSO Phase 4 | أمان CI/CD | actions غير مثبتة بـ SHA، لا CODEOWNERS، لا حماية فرع (خطة مجانية) |
| CSO Phase 5 | الظل البنيوي | Dockerfile يسقط root ✓، render.yaml أسرارها sync:false ✓ |
| CSO Phase 6 | الويبهوكات | telegram-webhook موقّع x-telegram-bot-api-secret-token ✓ |
| CSO Phase 7 | أمان LLM | Copilot: rate-limit + secret-scan + validator ✓ (فجوات ثانوية أدناه) |
| Review Army | 8 متخصصين متوازيين + فريق أحمر | كامل الكود (كل ملف، ليس diff فقط) |
| Phase 12 | تحقق نشط | قراءة شخصية للكود الحرج + فحص حي subnation.ly (متزامن/قياسات/أخطاء) |
| Health | CI أخضر على `c9871a6` | lint 0 errors، typecheck، 39+310 اختبارات، بناء كامل |

---

## 3. النتائج الحرجة — P0 (6)

### P0-1) مسار الشراء معطّل للمستخدمين المسجلين — `checkout.tsx:73` 🔴 مؤكد حياً
```tsx
setBalance(data?.user?.wallet_balance ?? 0);   // الخادم يعيد المستخدم مسطحاً!
```
- الخادم `routes/auth.ts:270` يعيد `{...formatUser(user), linked_identities}` — **لا يوجد غلاف `user`**. الرصيد يُقرأ دائماً `0` → `insufficient = true` لأي سلة غير فارغة → `canSubmit=false` → **زر "تأكيد الشراء" معطّل دائماً**.
- تحقق حي: `/api/auth/me` يعيد `{"error","code"}` (401 لغير المسجل) والشكل المسطح للمسجلين مؤكد بقراءة الكود — وكل مستهلك آخر (Navbar, product.tsx) يقرأ `user.wallet_balance` المسطح بشكل صحيح.
- هذه الخلل كشفه حذف COD في `af61fc9` (الكود القديم كان يهرب عبر `method === "cod"`).
- **الإصلاح (سطر واحد):** `setBalance(typeof data?.wallet_balance === "number" ? data.wallet_balance : null)`

### P0-2) كل أخطاء الشراء تظهر رسالة عامة — `checkout.tsx:131-134` 🔴 مؤكد حياً
```tsx
failureMessage = (orderData as { message?: string }).message ?? "فشل في إنشاء الطلب";
```
- مغلف أخطاء الخادم هو `{error, code}` (تم التحقق حياً: `{"error":"غير مصرح","code":"UNAUTHORIZED"}`) — لا يوجد `message` أبداً → كل أخطاء المال الحقيقية (رصيد غير كافٍ، نفاد مخزون، 409) تظهر النص الاحتياطي العام.
- نفس الخلل في `cart.tsx:118`. المسار الآخر (product.tsx عبر orval `useCreateOrder`) يقرأ `code` بشكل صحيح — مساران مختلفان لعقد واحد.
- **الإصلاح:** اقرأ `orderData.error` / `orderData.code` أو انتقل لخطاف `useCreateOrder` المولّد.

### P0-3) الفشل الجزئي يترك الكمية كاملة → **خصم مزدوج عند إعادة المحاولة** — `checkout.tsx:119-146`
- `orderedProductIds.push(it.productId)` لا يُنفّذ إلا بعد نجاح **كل** وحدات السطر (سطر 141). إن فشلت الوحدة 2 من 3: وحدة واحدة اقتُطعت من المحفظة فعلياً، لكن السطر يبقى qty=3 → إعادة المحاولة تشتري الوحدات الثلاث = **4 خصومات لسعر 3 وحدات**.
- نفس الحلقة تعيد تطبيق **نفس الكوبون** لكل وحدة (`coupon_code` في كل POST): كوبون قيمة ثابتة يُستهلك N مرات بنقرة واحدة.
- ملاحظة: تعليق الكود (112-115) يدّعي معالجة هذا السيناريو — لكنه يغطي الترتيب بين العناصر فقط لا داخل العنصر الواحد.
- **الإصلاح:** تتبّع نجاح الوحدات لكل سطر + `updateQuantity(id, it.quantity - unitsOrdered)`؛ أو نقطة نهاية شراء دفعية بمعاملة واحدة.

### P0-4) `migrate.ts` يبتلع كل إخفاقات الهجرة — `migrate.ts:1428-1430`
```ts
} catch (err) { logger.error({ err }, "Startup migration failed"); }  // لا rethrow!
```
- شبكة أمان `boot-migrations.ts` (تصنيف الخطأ + Sentry + `process.exit(1)` في server.ts) **كود ميت**: الخطأ لا يصل إليه أبداً. فشل منتصف السلسلة (مثل ALTER غير محروس عند سطر 697) يتجاوز كل الجداول اللاحقة (risk/copilot/forecast/enrichment) **ويخدم الخادم زيارات بمخطط مبتور** = أخطاء 500 عشوائية "relation does not exist".
- **الإصلاح:** احذف الـ catch الخارجي أو أعد رمي الخطأ بعد التسجيل.

### P0-5) فخ فقدان بيانات `drizzle-kit push` — جدولان حيّان خارج المخطط
- `system_settings` و`openwa_sessions` موجودان في قاعدة الإنتاج **فقط** عبر boot SQL في migrate.ts (سطر 380 و535) — لا ملف schema لهما → غائبان عن كل snapshots. أي `pnpm --filter @workspace/db push` (السكربت ملتزم في package.json!) سيسقطهما **مع بياناتهما**.
- كذلك ستُسقط: unique `login_attempts.identifier` (حماية brute-force)، singleton فلاش-سيل الجزئي، unique سلة المشتريات، 4 فهارس audit_logs، GIN trigram.
- تحقق تجريبي: `drizzle-kit generate` = "No schema changes" (سلس 1:1 مع snapshot) — الخطر في push فقط.
- **الإصلاح:** أضف `systemSettingsTable` + `openwaSessionsTable` + الفهارس الناقصة إلى schema وأعد التوليد.

### P0-6) صفر اختبارات لكل حرس المصادقة/المال الإداري — (خطر عمليات)
- 43 ملف مسارات: 3 فقط لها اختبارات (cart كامل، cwv، telegram-webhook مساعد فقط). **صفر اختبارات** لـ: `requireAdmin`، `requirePermission` (~20 بوابة RBAC)، idempotency (409 replay)، rate-limit الـ copilot، موافقات topup، الاسترجاع الجماعي — والـ harness نفسه لا يملك جداول admin_users/sessions (لا يمكن بناء الاختبارات دون توسيع DDL).
- 42 صفحة أمامية: **صفر اختبارات مكوّنات** — بما فيها checkout المُعاد كتابته بالكامل في af61fc9.
- **الإصلاح:** وسّع `src/test/db.ts` بجداول الأدمن ثم 4 ملفات اختبار أساسية (guard/authz/idempotency/checkout.tsx).

---

## 4. النتائج عالية الخطورة — P1 (35، مجمّعة)

### أ) المال والثقة
| # | الموقع | الخلل |
|---|---|---|
| H1 | `middlewares/requireUser.ts:12-34` | **إبطال الجلسات غير فعّال**: تحقق JWT فقط دون النظر لجدول sessions → logout/logout-all/soft-block لا يقتلون JWT لمدة 30 يوماً. (socket.ts:42 يوثّق الفجوة بنفسه) |
| H2 | `checkout.service.ts:178` | بيانات الحسابات المُسلَّمة تُخزَّن **نصاً صريحاً** في `orders.delivered_password` (يفكّ تشفير inventory ويكتب النص) |
| H3 | `routes/wallet.ts:77-159` | نفس التحويل المالي يمكن تقديمه/اعتماده **3 مرات** (لا قيد فريد على المرجع، الواجهة لا ترسل مرجعاً أصلاً، كل صفح pending يولّد زر موافقة Telegram منفصلاً) |
| H4 | `checkout.service.ts:94-99` | اختيار صف المخزون `.limit(1)` **بدون ORDER BY** → مشتريان متزامنان يختاران نفس الصف؛ الخاسر يرى 409 كاذب "محجوز" رغم توفر وحدات |
| H5 | `checkout.service.ts:125` | `CONCURRENCY_ERROR` لا يُعالَج في الخريطة → **500 خام** أثناء سباق موافقة-topup مع الشراء |
| H6 | `admin/users.ts:121-129` | `wallet_adjustment: 1e999` (Infinity) يمرّ التحقق → `walletBalance:"Infinity"` في PG → مشتريات مجانية دائمة (يتطلب أدمن مخترقاً، لكنه يفسد المال بصمت) |
| H7 | `cart.ts:85-90` + `checkout.tsx:122` | كمية بلا سقف (1e9 مقبولة) → حلقة شراء تسلسلية self-DoS |
| H8 | idempotency | مفقود تماماً على `POST /api/orders` (مسار الزبون الأهم)؛ وفي الـ admin غياب المفتاح = تجاوز صامت |
| H9 | `admins.ts:72-103` | نطاق `admins` وحده يستطيع إنشاء super-admin بصلاحية `all` (تصعيد ذاتي) |
| H10 | `admin/auth.ts:99-146` | `/verify-2fa` بلا قفل محاولات → brute-force TOTP ميسّر مع تجاوز IP (انظر H17) |

### ب) البنية التحتية والعمليات
| # | الموقع | الخلل |
|---|---|---|
| H11 | `cloudflareClientIp.ts:53-76` | **تزوير `CF-Connecting-IP`** عبر النطاق العمومي subnation2.onrender.com (مفتوح عمداً) يُبطل كل حدود IP (login limiter 10/15د يصبح بلا معنى) ويلوّث logs/forensics بعناوين مزيفة |
| H12 | `redis-client.ts:143-188` | أي وميض Redis → **`process.exit(1)` على النسخة الوحيدة** → حلقة انهيار للموقع كله (SPA معه). الفشل المفتوح هنا مضخّم self-DoS |
| H13 | `render.yaml:184` + `alerting.service.ts` | **محرك الإنذار معطّل في الإنتاج** (`ALERTING_ENABLED="false"` بينما env.example يقول true) + قاعدة neon تقرأ عدّاد `redis_errors_total` (خطأ نسخ/لصق) + 4 قواعد ترجع false دائماً → لن يُنذر أحد عن أي شيء |
| H14 | live console | `VITE_SENTRY_DSN is not set in production` — مراقبة أخطاء الواجهة **معتمة في الإنتاج** (مؤكد حياً) |
| H15 | `render.yaml:247` | Redis free بسياسة `allkeys-lru` → مفتاحات القفل/التكرار/الحدود **قابلة للإخلاء الصامت** (نوافذ brute-force تتصفّر) |
| H16 | `migrate.ts:799-966,689-693` | إعادة **بذر إنتاج** عند كل إقلاع بارد: <12 منتجاً → 12 منتجاً تجريبياً + بيانات دخول مخترعة + WELCOME10؛ وأدمن بصلاحيات فارغة → إعادة منح `["all"]` |
| H17 | Phase 4 CI | actions طرف ثالث غير مثبتة بـ SHA (`gitleaks@v2`, `codeql@v4`) + لا CODEOWNERS + لا حماية فرع |

### ج) الأداء (نسخة Render واحدة بمشارك 15 اتصال)
| # | الموقع | الخلل |
|---|---|---|
| H18 | `admin/tickets.ts:33-45` | N+1: **حتى 201 استعلام** لعرض 100 تذكرة (نمط DISTINCT ON الصحيح موجود في support.ts الجواب!) |
| H19 | `cart.ts:24-58` | N+1: 2N+1 استعلام لعرض السلة (منتج لكل عنصر + فلاش-سيل لكل عنصر رغم أنه صف واحد) |
| H20 | `lib/cache.ts` كامل | طبقة التخزين المؤقت **كود ميت** (صفر مستوردات!) — كل ضربة قائمة كتالوج = JOIN ثلاثي على Postgres؛ ويبقى حدها s-maxage=60 فقط |
| H21 | `pricing.ts:105-128` | صف الفلاش-سيل يُقرأ من DB **لكل ضغطة زر** في pricing-calculator وكل وحدة شراء وكل عنصر سلة |
| H22 | `admin/dashboard.tsx:202-227` + `admin/layout.tsx:479` | Polling كل 30 ثانية (إحصاءات 8 تجميعات + طلبات + تنبيهات) رغم وجود Socket.IO يدفع الأحداث أصلاً |
| H23 | `checkout.tsx:119-133` | الشراء التسلسلي لكل وحدة: سلة 3×3 = 9 معاملات متتالية (~2-5 ثوان) على أكثر صفحة حساسية للزمن |

### د) العقود (API)
| # | الموقع | الخلل |
|---|---|---|
| H24 | `openapi.yaml` | **124 من 158 عملية (79%) خارج العقد** — عائلات كاملة غائبة: cart (مسار مالي!)، coupons/validate، loyalty/convert-points، support، risk، forecast، enrichment، admin-auth/2FA، tickets، flash-sales... |
| H25 | `openapi.yaml:1051` | `ErrorResponse` لا يوثّق `code` — الحقل الذي تعتمد عليه كل رسائل الواجهة العربية للخطأ |
| H26 | `admin/users.ts:13-24` | spec يوثّق `page` والتنفيذ يتجاهله (اقتطاع صامت عند 100) + الحقول الجديدة غير موثقة |
| H27 | `ci.yml:195-206` | لا حارس انجراف أوفال (spec↔generated↔backend) — خطة af61fc9 غيّرت مسار المال دون تحريك الـ spec |
| H28 | zod | تحقق body في 5 فقط من ~40 مساراً؛ مسارات المال اليدوية: `parseInt("250abc")→250` في convert-points، expires_at غير محقق → 500 |

### هـ) الهجرات والبنية
| # | الموقع | الخلل |
|---|---|---|
| H29 | `schema/login_attempts.ts` | فريد identifier موجود **فقط في boot SQL** → push يسقطه → عدّادات القفل تنشطر (سباق SELECT-then-INSERT) |
| H30 | `schema/flash_sales.ts` | singleton الجزئي (WHERE is_active) **فقط في boot SQL** → push يسقطه → فلاش-سيلات متزامنة متعددة |
| H31 | `schema/cart.ts:20-26` | اسم "uniq" لكنه index عادي غير فريد + لا FK — التوثيق يكذب على نفسه؛ العلاقة الفريدة موجودة في الإنتاج فقط |
| H32 | migrate.ts (عام) | **نظام هجرة مزدوج** (1431 سطر يدوي مقابل drizzle) — انجراف أفعّل 4 commits فاشلة سابقاً؛ لا شيء يوازن migrate.ts↔drizzle |
| H33 | `worker.ts:31-33` | جدولة العامل **بلا قيادة leader-gate** → تفعيل WORKER_TIER دون DISABLE_WEB_SCHEDULERS = تكرار كل cron |

### و) الصيانة والاختبارات
| # | الموقع | الخلل |
|---|---|---|
| H34 | `risk-soft-block.ts` + `risk-hard-block.ts` | **243 سطر حماية ميتة** — غير مركّبة في أي مسار (مواصفات 003 تقول "منتهية") |
| H35 | الموت الصامت | cache.ts (175 سطراً)، payment.service.ts (محاكاة Math.random تمنح مالاً إن وُصلت!)، risk-labels.ts (100)، requireRole — كلها بأسماء موثّقة كـ"مستخدمة في كل مكان" |

(بالإضافة: قسط الاختبارات الكامل في P0-6 — lockout/encryption/transfer-code/CSRF/ويبهوك المال: صفر اختبارات لكل منها؛ وحزمة snyk: 12 high عبر gRPC/ws/protobufjs/form-data — كلها سلسلة تبعية firebase-admin/socket.io.)

---

## 5. النتائج المتوسطة — P2 (43، مختصرة)

**عقود وأخطاء:** مغلفات خطأ غير متسقة (topups بلا code؛ 429 لقاعدة عمل بدل 409/422؛ أكواد COPILOT_* خارج enum) · ترقيم صفحات ثلاثي الأساليب (cursor/offset/mصفوفة عارية) + camelCase مختلط في alerts · enum خطأ الواجهة متأخر عن الخادم بـ 3 أكواد (INVALID_TOKEN/FEATURE_DISABLED/CONFLICT) · sort=newest بلا فرع تنفيذ · DELETE منتج غير موجود يعيد 200 · docs/API.md يوثّق GET لـ coupons/validate والواقع POST.

**بنية:** انجراف فهارس (audit_logs/idx_users_firebase_uid/trgm حية فقط في boot؛ و4 فهارس drizzle غير موجودة في الإنتاج) · otps يُنشأ ويُحذف كل إقلاع · `ALTER TYPE` لعمود المخزون كل إقلاع (قفل ACCESS EXCLUSIVE) · TTL قفل الهجرة 300 ث مقابل انتظار 60 ث (fail-open) · backfill التشفير غير محدود زمنياً + لا رواية تدوير مفاتيح (safeDecrypt يعيد النص الخام عند فشل الفتح!) · نسختا نسخ احتياطي غير متوافقتين مع سكربت استرجاع واحد (pg_restore لن يقرأ plain-gzip) · ENCRYPTION_KEY شرط استرجاع غير موثّق في DR.

**صيانة:** ثابت 5 LYD مكرر في 9 مواضع (خرق invariant الـ ledger عند أي تعديل جزئي) · عتبات الولاء مكررة أمامياً رغم عودة الخادم لها في الاستجابة · كتل تحكم برسائل الأخطاء ("INVENTORY_CLAIMED" كسلسلة) · ErrorCode+خريطة عربية مكررة بين الطرفين · 115 استدعاء fetch خام مقابل عميل مولّد كامل (checkout يعيد تعريف MeResponse يدوياً!) · eslint بـ warn فقط (57 تحذيراً يمرّ) + tsconfig `noUnusedLocals:false` + الاختبارات خارج typecheck · audit-log غائب عن CRUD الكوبونات (نطاق finance!) وردود التذاكر · لا إشعار للمستخدم عند نجاح الشراء (كل البقية تُخطر) · ملفات الأسماء العشرة الكبرى (system.tsx 1536، CopilotPanel 1518، settings 1224...) · ~20 متغير بيئة مستخدم غير موثق في examples · توثيق متقادم (PROJECT_OVERVIEW أرقام أغسطس، RUNBOOK بروابط .kiro وهمية، tasks.md للspecs غير مطابقة).

**تشغيل:** cron.ts يرسل تعبير `*/5` للـ Sentry والواقع `45 * * * *` + URL بوابة openwa مشفّرة حرفياً · `GET /admin/coupons` بلا حد · `first-100` بلا إزاحة في topups/tickets/users (اقتصاص صامت) · ticker كل 5 ثوان يعيد رسم layout الأدمن بالكامل · NotificationBell يستقصي 15 ثانية رغم الـ socket.

**أداء:** wallet.ts ثلاثة استعلامات تسلسلية قابلة للتوازي · detail منتج 4 awaits تسلسلية · فلترة/فرز بلا useMemo في users/wallet · `admin_alerts` بلا فهارس مع polling 30 ث.

**أمان (متوسط):** إعدادات CSRF تفشل مفتوحة عند قائمة أصل فارغة في الإنتاج · enumeration كوبونات (1200 طلب/دقيقة) · رسالة تذكرة بلا سقف طول · بادئة مفتاح Copilot تُكشف · context.route غير مقيّد في prompt (self-injection محدود).

---

## 6. النتائج المنخفضة — P3 (30، جدول)

SHA-256 legacy بكلمة ملح ثابتة (انتقالية) · ADMIN_JWT_SECRET مشتق خارج الإنتاج · payment mock RNG · X-at-qty-1 محروسة أمامياً فقط (لا سقف خادمي) · supported.length+prefix مكشوفان · لا استراتيجية إصدار API/Sunset · flash-sales.tsx بلا fake-timers في الاختبارات · Math.random في seeds الاختبارات · telegram غير mocked (خطر بيئة dev) · تنظيف بقايا af61fc9 (ServerCart/navigate/totalLYD/persist) · AlertToast.tsx ميت ومنسوخ · README للمسارات... (البقية في مخرجات المتخصصين المرفقة نصياً بالملف المصدر للعقد).

---

## 7. لوحة الصحة

| البعد | الحالة | الدليل |
|---|---|---|
| CI | 🟢 | أخضر على c9871a6 (lint/typecheck/349 test/build/codeql/gitleaks) |
| النشر | 🟢 | deploy LIVE عبر hook (autoDeploy=OFF ✓) |
| مسار الشراء (UI) | 🔴 | معطّل للمسجلين (P0-1/2/3) |
| مسار المال (خادم) | 🟡 | المعاملات سليمة؛ فجوات: revocation، plaintext كلمات المرور المسلّمة، topup 3×، 500 سباق |
| المراقبة/الإنذار | 🔴 | ALERTING=false + قاعدة neon خاطئة + Sentry أمامي بلا DSN |
| المرونة التشغيلية | 🔴 | Redis exit→انهيار؛ هجرات مبتلعة؛ push فخ بيانات |
| الأداء | 🟡 | أمامي ممتاز (36.6KB/حزم يدوية/12 chunks)؛ خلفي: N+1 إداري + كاش ميت |
| الاختبارات | 🔴 | 3/43 ملف مسارات، 0/42 صفحة أمامية، حرس الأدمن صفر |
| العقود | 🔴 | 79% خارج openapi؛ بلا حارس انجراف |
| الأمن (تطبيق) | 🟡 | أساس صلب (موّقّع/مشفّر/parametrized)؛ ثقوب: IP تزوير، 2FA بلا قفل، تصعيد admins |

---

## 8. القياسات الحية (subnation.ly — 2026-09-06)

| المقياس | القيمة | التقييم |
|---|---|---|
| TTFB (عبر Cloudflare) | 677ms | مقبول لنسخة starter باردة |
| DOMContentLoaded / Load | 1014 / 1016ms | جيد |
| نقل HTML | 3KB | ممتاز (SPA shell) |
| `/api/products` (بارد → ساخن) | 286ms → **5-6ms** | التخزين الحدي s-maxage=60 يعمل |
| `/api/healthz` | 218ms | جيد |
| تجاوز أفقي (1280px) | 0px | نظيف |
| أخطاء صفحة | 1 فقط | `[sentry] VITE_SENTRY_DSN is not set` (H14) |

---

## 9. الاقتراحات الاستشارية (التبسيط — 15 نتيجة)

أكبر ثلاث فرص: **1)** مصائر رافعة inspection/audits الكامنة (~5,200 سطر بلا مستدعٍ إنتاجي) **2)** تحويل CopilotPanel إلى خطافات orval المولّدة أصلاً لـ 7 عمليات (~180 سطراً + توحيد الأنواع الثلاثي) **3)** إكمال هجرة طبقة بيانات الأدمن (10 صفحات setState → useQuery؛ دمج 20 مكرر استخراج أخطاء/رؤوس/نسخ). الإجمالي المقدّر: **~1,050 سطراً نشطاً + ~5,200 كامنة = ~6,250**.

---

## 10. خطة الإصلاح ذات الأولوية (Backlog مقترح)

**المرحلة صفر — اليوم (Hotfix):**
1. `checkout.tsx:73` → قراءة المسطح (سطر) + `:131-134` → `error/code` (سطران)
2. الفشل الجزئي: خصم الوحدات المنجزة فقط (منطق صغير)
3. migrate.ts: rethrow + بوابة NODE_ENV للبذر + إسقاط منح ["all"] (3 أسطر)
4. render.yaml: `ALERTING_ENABLED=true` + VITE_SENTRY_DSN

**المرحلة الأولى — هذا الأسبوع (ثقة المال):**
5. requireUser: فحص صف session (مع كاش 60 ث)
6. تشفير delivered_password + backfill
7. قيد فريد لمرجع topup + تحذير تكرار في رسالة الموافقة
8. ORDER BY لاختيار المخزون + خريطة CONCURRENCY_ERROR→409 + سقف كمية 99
9. idempotency على POST /api/orders
10. 2FA: قفل محاولات per-admin
11. CF-Connecting-IP: التحقق من نطاقات CF الفعلية
12. Redis: وضع degraded بدل exit + مراجعة allkeys-lru

**المرحلة الثانية — السبرنت القادم (العقود والهجرات):**
13. schema: system_settings + openwa_sessions + الفهارس الناقصة → regen + تحديث 0003
14. دمج عائلات cart/coupons/loyalty/support في openapi + حارس انجراف أوفال في CI
15. zod لمسارات المال اليدوية
16. موت الكود الميت (risk-blocks, cache, payment, labels, requireRole, AlertToast)
17. N+1 التذاكر/السلة + تفعيل cache.ts على 3 endpoints + كاش فلاش-سيل 30 ث

**المرحلة الثالثة (الاختبارات):** توسيع DDL ثم: requireAdmin.permissions، orders/wallet.route، lockout، encryption، checkout.tsx (partial-failure + balance + COD regression)، ProductCard.

---

## 11. ملاحظات المنهجية والحدود

- المتخصصون يعملون بقراءة كود صامتة (no live attacks) — عدا التحقق الحي الموصوف.
- لم يختبر أحد تدفقات الأدمن الحقيقية (لا بيانات اعتماد متاحة للمدقق) — فجوات الأدمن موثقة بقراءة الكود + اختبارات CI فقط.
- حسابات النتائج بعد إزالة التكرار عبر البصمات (نفس الموقع:سطر:فئة من متخصصين = نتيجة واحدة معوسمة "تأكيد متعدد").
- مصدر إضافي: مخرجات المتخصصين الثمانية الكاملة محفوظة في جلسة التنفيذ (JSON-per-finding عند الطلب).

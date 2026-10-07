> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r94/A7-perf-seo.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# A7 — تفتيش الأداء و SEO (الجولة 94)

**الوكيل:** A7 · **النوع:** قراءة فقط (صفر تعديلات على المصدر) · **التاريخ:** 2026-09-08
**المنطقة:** vite.config.ts + main.tsx/App.tsx + كل الصفحات من زاوية الأداء + backend/src/routes/seo.ts + sitemap/robots + ترويسات الكاش/الضغط + أحجام الممتلكات الثابتة.

## المنهجية

قراءة سطرية للمسار الحرج للتحميل + الصفحات + مسارات SEO/الكاش، **مع قياس فعلي للبناء الجاهز** (`frontend/dist/public` — بناء حي من الجولة الأخيرة): أحجام gzip لكل chunk، تحليل رسم الاستيراد المتحمّس (modulepreload)، عدّ تعريفات أيقونات lucide داخل chunk الأيقونات، وفحص font-display في CSS المبني. لم يُعدَّل أي ملف.

## قياسات أساس (Baseline — من dist/public)

| المورد | gzip | ملاحظة |
|---|---|---|
| index-*.js (الدخول) | **31.6 KB** | ضمن ميزانية 55 KiB (bundle-budgetPlugin) بهامش مريح |
| vendor-react | 58.5 KB | متحمّس (modulepreload) |
| vendor-query | 10.5 KB | متحمّس |
| vendor-utils | 9.7 KB | متحمّس (clsx+slot…) |
| vendor-icons | **10.9 KB** | متحمّس — انظر P3-F5 |
| vendor-router | 2.4 KB | متحمّس |
| index-*.css | 29.8 KB | ملف CSS واحد (244 KB خام) |
| خطوط 400 (عربي+لاتيني، preload) | 24.3 KB | من أصل 75 KB لـ6 ملفات woff2 |
| **إجمالي المسار الحرج** | **≈ 177 KB gz** | |
| vendor-sentry | 155.6 KB | **خارج** المسار الحرج (idle-defer عبر boot-sentry) ✅ |
| vendor-charts (recharts) | 109.4 KB | **خارج** المسار الحرج (صفحات أدمن فقط) ✅ |
| public/ كله | 200 KB | opengraph.jpg 40K · logo 66K · pwa 52K/16K/8K |

الصفحات الـ42 (متجر+أدمن) كلها lazy عبر lazyWithRetry — لا صفحة واحدة في الحزمة الأولى عدا not-found (مع layout). إيجابي مؤكد.

---

## النتائج

### [P2] F-1 — `preconnect` بـ`crossorigin` لأصل صور المنتجات: المصافحة لا يستخدمها المتصفح (تلميحة LCP ميتة)

- **الموضع:** `frontend/index.html:59` ← `<link rel="preconnect" href="https://image2url.com" crossorigin />` (موجود حرفيًا كذلك في dist/public/index.html:59).
- **الدليل:** كل صور المنتجات تُحمَّل كـ`<img src>` **بدون** `crossorigin` (ProductCard.tsx:233-273، product.tsx:586-612) — أي طلبات no-cors. اتصال preconnect **المُنشأ بـ`crossorigin` هو مقبض TLS "anonymous/CORS" منفصل** لا تُعيد استخدامه طلبات الصور العادية (سلوك موثّق في Lighthouse/web.dev: "preconnect with crossorigin only helps fetches that use CORS"). النتيجة: المتصفح يفتح مصافحة لا أحد يستخدمها، وأول طلب لصورة LCP (البطاقة الأولى بـ`fetchPriority="high"`، ProductCard.tsx:264) يبدأ DNS+TCP+TLS كاملة من الصفر.
- **الأثر:** على جوال بارد نحو image2url.com (خارج Cloudflare): ~100-250ms ضائعة من LCP — على أهم عنصر LCP في المتجر (صورة أول بطاقة). التلميحة موجودة لكنها بلا أي مكسب، بل تفتح مقبضًا إضافيًا.
- **الإصلاح الدقيق (سطر واحد):** حذف `crossorigin` من هذا الـpreconnect فقط: `<link rel="preconnect" href="https://image2url.com" />`. (تلميحات dns-prefetch الأخرى تبقى كما هي — أصول CORS فعلية.)

### [P2] F-2 — بطاقة مشاركة WhatsApp/Telegram/Facebook لصفحات المنتجات عامة (SPA بلا SSR/prerender — unfurlers لا تنفّذ JS)

- **الموضع:** `backend/src/app.ts:806-819` (كل GET غير-/api يُخدم نفس `index.html` الثابت) + `frontend/index.html:24-38` (الـOG الثابت موقع-فقط) — بينما الـOG الديناميكي للمنتج يعمل فقط داخل JS (`MetaTags.tsx:119-126`).
- **الدليل:** بطاقة المنتج (اسم/صورة/سعر) تُبنى client-side فقط؛ أي زار غير منفّذ للجافاسكربت (WhatsApp link unfurler، Facebook crawler، Telegram) يرى دائمًا: "SubNation — سوق الاشتراكات الرقمية" + opengraph.jpg العام. تعليق index.html نفسه يسميها "no-JS baseline (non-rendering crawlers, link unfurlers)" — أي أن الفجوة معروفة معماريًا لكنها لم تُسجَّل كنقص في أي جولة.
- **الأثر:** السوق ليبيّ وواتساب هو قناة المشاركة المهيمنة (الموقع نفسه مبني على OTP واتساب وإحالات واتساب — `whatsapp-otp.service.ts`). كل رابط منتج يُشارك في مجموعة/محادثة يظهر بلا اسم المنتج ولا سعره ولا صورته → خسارة CTR قابلة للقياس على قناة التوزيع الأولى. Googlebot غير متأثر (ينفّذ JS).
- **الإصلاح الدقيق:** بدون SSR كامل: مسار خلفي `/product/:slug` (قبل fallback الـSPA) يشمّ UA bots المعروفة (WhatsApp/Facebook/Telegram/Twitter — قائمة صغيرة) ويعيد HTML مصغّرًا يحوي فقط `<title>` + `og:title/og:description/og:image/og:url` مبنيًّة من صف المنتتج (البيانات موجودة في `/api/products/by-slug/:slug` مع كاش `catalogCache`)، ويمرّر البقية إلى index.html كما هي. كلفة ~60 سطرًا في seo.ts + إعادة استخدام buildProductLd نفسها.

### [P2] F-3 — FlashSaleBanner يظهر بعد التحميل ويدفع المحتوى للأسفل (CLS على كل صفحة متجر وقت تفعيل عرض)

- **الموضع:** `frontend/src/App.tsx:307-311` (banner في التدفق الطبيعي فوق `<main>` مع `<Suspense fallback={null}>`) + `FlashSaleBanner.tsx:18-30,52` (يُرندر `null` حتى يصل `fetch("/api/flash-sale")`).
- **الدليل:** الشريط لا يشغل أي ارتفاع قبل وصول الاستجابة، ثم يُركَّب في التدفق **فوق المحتوى الرئيسي** فيزيائيًا (الترتيب: Navbar → Banner → main). أول fetch يكتمل عادة بعد أول رسم (~100-300ms) → إزاحة كل المحتوى للأسفل.
- **الأثر:** ارتفاع الشريط `py-2` + صف محتوى ~28px ≈ **40px إزاحة**. على جوال 640px: مسافة الإزاحة 40/640 ≈ 0.062، ومساحة التأثر ≈ معظم viewport → **≈ +0.05 CLS** مضافة لكل زيارة وقت العرض — أي نصف ميزانية "good" (0.1) تُستهلك بتلميح إعلاني. الحالية: المنتج قيد عرض فعّال؟ يُقاس بالـCWV (routes/cwv.ts سيلتقطها).
- **الإصلاح الدقيق:** في App.tsx، غلاف ثابت الارتفاع حول الـSuspense (مثل `<div className="h-10" aria-hidden>` مقلص) — أو الأصح: أن يرندر FlashSaleBanner نفسه placeholder بارتفاع مطابق (`py-2` + صف ارتفاع 28px) أثناء حالة التحميل الداخلية، فيتحول الظهور إلى ملء داخل مساحة محجوزة. بديل أرخص: نقل البانر أسفل أول قسم (لكن يضعف رؤيته).

### [P2] F-4 — سياق السلة واحد واسع: كل ProductCard مشترك فيه → «أضف للسلة» يعيد رندر الشبكة كاملة (INP على زر الشراء)

- **الموضع:** `frontend/src/lib/cart.tsx:125-131` (Provider واحد، `value={{items, itemCount, totalLYD, addItem, …}}` — الهوية تتغير مع أي تغيّر سلة) + `ProductCard.tsx:150-151` (`const { addItem } = useCart()` داخل كل بطاقة).
- **الدليل:** بطاقات الشبكة كلها مشتركة في نفس السياق. `memo()` على ProductCard (سطر 398-414) يقارن props فقط — **تحديثات السياق تخترق memo بالكامل** (React يمرر تحديث الـcontext لكل مشترك بغضّ النظر عن memo). النقر على «أضف للسلة» يغيّر `items` → قيمة سياق جديدة → إعادة رندر N بطاقة فورًا (الشبكة الحالية 19 بطاقة؛ flash-sales/category تتحمل أكثر).
- **الأثر:** على جوال متوسط: ~19 شجرة صغيرة + أعادة حساب aria-label والطبقات ≈ 3-8ms TBT/INP لكل نقرة — على **أهم تفاعل تجاري في الموقع** (CTA الشراء). ليس كارثيًا بالحجم الحالي لكنه يتراكم مع نمو الكتالوج ويهدر الطاقة، والعنصر المُنقر عليه نفسه يتنافس مع رندر الإخوان.
- **الإصلاح الدقيق:** تقسيم السياق إلى اثنين: `CartActionsContext` (addItem/removeItem/updateQuantity/clear — كلها `useCallback` ثابتة الهوية أصلًا) و`CartStateContext` (items/itemCount/totalLYD/isLoaded). ProductCard يستهلك Actions فقط → صفر إعادة رندر عند تغيّر السلة؛ Navbar/Cart/Checkout تستهلك State. تعديل محصور في cart.tsx + استبدال `useCart()` بـ`useCartActions()` في ProductCard.tsx:150.

### [P3] F-5 — chunk الأيقونات manual يجمع 129 أيقونة (كل الصفحات بما فيها الأدمن) في المسار الحرج المتحمّس

- **الموضع:** `frontend/vite.config.ts:322-324` (`if (id.includes("node_modules/lucide-react")) return "vendor-icons"`) + dist/public/index.html modulepreload لـ`vendor-icons-PQeUzRHV.js`.
- **الدليل (قياس):** فحص chunk المبني: **129 تعريف أيقونة** (`=e("activity"…) …`)، بينها أيقونات لا تُستخدم إلا في صفحات الأدمن — تم التحقق حرفيًا داخل chunk: `database`، `server`، `cpu`، `shield-alert`، `trending-up`، `key-round` موجودة. سبب السحب: Navbar (متحمّس عبر App.tsx:17) يستورد 8 أيقونات → chunk الأيقونات كله يدخل modulepreload → أيقونات الأدمن تدفعها الزيارة الأولى للمتجر.
- **الأثر:** chunk كامل 10.9 KB gz على المسار الحرج، منها ~40-50% (تقدير من نسبة أيقونات غير المتجر) ≈ **4-6 KB gz تُنزَّل بلا أي استخدام** لكل زائر متجر — تتنافس مع بايتات LCP على 3G ليبي.
- **الإصلاح الدقيق:** حذف قاعدة lucide من manualChunks (دع Rollup يوزّع الأيقونات على chunks المستوردة — tree-shaking يعمل لكل صفحة) — النتيجة: Navbar يسحب ~8 أيقونات فقط للحرج، والبقية تسقط في chunks الصفحات. تحقق بعده أن vendor-icons اختفى من modulepreload.

### [P3] F-6 — نسخة MetaTags الاحتياطية تصدر `robots=index,follow` + canonical للمسارات الخاصة

- **الموضع:** `frontend/src/App.tsx:289-294` (fallback يمرر `path={location}` بلا `robots`) + `MetaTags.tsx:107` (`const robots = input.robots ?? "index,follow"`).
- **الدليل:** صفحات wallet/orders/order-detail/loyalty/referrals/profile/onboarding/auth-callback لا تستدعي useSeo → تتلقى الاحتياطية: canonical = `subnation.ly/wallet` (أو `/orders/CODE`) + `index,follow`. هذا يناقض `robots.txt` الذي يمنع نفس المسارات (seo.ts:72-77) — robots.txt يمنع الزحف فلا تُرى meta أصلًا، لكن canonical يشير لمواقع URL خاصة ويعطي إشارة index لمسارات ممنوعة (خلط إشارات كلاسيكي؛ /orders/:code عمليًا مرشح لظهور URL-only إذا أُشير إليه خارجيًا).
- **الأثر:** ضجيج إشارات لمحركات البحث + canonical لمواقع كود طلبات — بلا كارثة (robots.txt هو خط الدفاع الفعّال).
- **الإصلاح الدقيق:** في App.tsx (أو MetaTags fallback): قائمة بادئات `PRIVATE = ["/wallet","/orders","/loyalty","/referrals","/profile","/onboarding","/auth/","/status","/cart","/checkout","/admin","/login","/register"]` → تمرير `robots="noindex,nofollow"` وحذف canonical لهذه البادئات.

### [P3] F-7 — `/api/admin/probe` ينطلق لكل زائر متجر مجهول

- **الموضع:** `frontend/src/lib/auth.tsx:246-264` (استدعاء غير مشروط داخل تأثير الإقلاع الوحيد).
- **الدليل:** الاستدعاء موازٍ مع user probe فلا يضيف زمن انتظار، لكن لكل زائر متجر (99%+ من الحركة) يذهب طلب HTTP كامل عبر سلسلة middleware (rate-limit → CSRF → pino-http → metrics) + سطر log لكل زيارة بلا جدوى — والـcookie غائب فيعود 200 فوريًا (`admin/auth.ts:188-195`، بلا DB hit).
- **الأثر:** طلب + سطر سجل مهدور لكل زيارة باردة؛ على مقياس الحركة عبء غير ضروري على pino/log-drain وrate-limit buckets.
- **الإصلاح الدقيق:** تشغيل الـadmin probe فقط عند `window.location.pathname.startsWith("/admin")` (تحميل الجلسة الإدارية يبقى يعمل عبر تنفيذ المؤخر داخل أول رندر لمسار /admin — AdminProtectedRoutes يستدعي useAuth بالفعل؛ يمكن رفع probe إلى دالة `ensureAdminProbe()` تُستدعى من صفحة login/الداشبورد).

### [P3] F-8 — مؤقّت عدّاد FlashSaleBanner لا يُوقف بعد انتهاء العرض (النمط أُصلح في صفحة flash-sales لكن لا في البانر)

- **الموضع:** `frontend/src/components/layout/FlashSaleBanner.tsx:32-49` — `update()` عند `diff <= 0` يفعل `setExpired(true); return;` **دون `clearInterval`**؛ المقابل الموثّق: `pages/flash-sales.tsx:29-51` نفس الملف يصرّح «Expired: stop the timer instead of re-setting 0 every second» وينفّذ `clearInterval`.
- **الأثر:** نبضة 1Hz لا-عملية (React يتخلّص من setState بنفس القيمة فلا رندر) تدوم مدة الجلسة على كل صفحة متجر بعد انتهاء أي عرض — مؤقّت حي يوقظ main thread كل ثانية (مصرف بطارية ضئيل + تعارض مع النمط المُصلَّح والموثّق في نفس الكود).
- **الإصلاح الدقيق:** نسخ سلوك flash-sales.tsx:36-39: عند `ms <= 0` → `clearInterval(id); id = undefined;` قبل `setExpired(true)`. 3 أسطر.

### [P3] F-9 — apple-touch-icon يشير إلى PNG كامل الدقة 66KB (وSW يprecache نفس الملف بلا استخدامه)

- **الموضع:** `frontend/index.html:41` (`<link rel="apple-touch-icon" href="/subnation-logo.png" />`) + `vite.config.ts:170` (`includeAssets: ["favicon.svg", "subnation-logo.png"]`).
- **الدليل:** `subnation-logo.png` = 66,498 بايت؛ حجم بقعة أيقونة iOS = 180×180. مكوّن `Logo.tsx` يرسم الشعار **SVG inline** — أي أن ملف PNG لا يظهر في أي صفحة واجهة أصلًا؛ استعمالاته: apple-touch-icon فقط + precache.
- **الأثر:** iOS يسحب 66KB لعرضه في بقعة 180px عند "إضافة إلى الشاشة الرئيسية"، وWorkbox يخزّنها مسبقًا (ضمن حد 256KB) لكل مستخدم PWA أول — بايتات بلا مقابل بصري.
- **الإصلاح الدقيق:** توليد `apple-touch-icon.png` بحجم 180×180 (~8-12KB) في public/ وتحديث index.html:41، وإبقاء PNG الكبير للـOG فقط إن لزم (أو إسقاطه من includeAssets).

### [P3] F-10 — الملفات الثابتة الجذرية بـ`maxAge: "1h"` (opengraph.jpg يعاد جلبه/التحقق منه يوميًا من كل unfurler)

- **الموضع:** `backend/src/app.ts:790-792` (`express.static(frontendDist, { maxAge: "1h" … })`).
- **الدليل:** opengraph.jpg (40KB) + pwa-*.png تُخدم بـ1 ساعة؛ صور OG تسحبها برامج unfurl (WhatsApp/FB/Telegram/Slack) وتعيد التحقق عند كل مشاركة جديدة. الملفات لا تتغير فعليًا إلا بالنشر، والتحقق يتم عبر ETag قوي (304) لكنه RTT كامل لكل مشاركة.
- **الأثر:** مطبات إعادة تحقق شبكية غير ضرورية على أصل ثابت عمليًا — صغير لكنه مجاني الإصلاح.
- **الإصلاح الدقيق:** في setHeaders: رفع الصور + manifest إلى `max-age=86400, stale-while-revalidate=604800` مع إبقاء html/sw/robots على no-store (السلوك الحالي).

### [P3] F-11 — `init.js` سكربت كلاسيكي حاجب للرسم داخل `<head>`

- **الموضع:** `frontend/index.html:65` (`<script src="/init.js"></script>` — بلا `defer`/`async`؛ 404 بايت).
- **الدليل:** المتصفح يوقف تحليل HTML لسحب الملف قبل المتابعة (طلب same-origin إضافي ~5-20ms على RTT جوال) — والغرض (منع وميض الثيم) يتطلب التنفيذ قبل أول رسم، لا كونه ملفًا شبكيًا.
- **الأثر:** تأخير FCP ميلي ثانية قليلة — لكنه قابل للإزالة بصفر مخاطرة.
- **الإصلاح الدقيق:** تضمين منطق السطور العشرة inline داخل `<head>` (نفس الكود حرفيًا) بدل طلب الملف؛ يُحذف init.js من public لاحقًا (احذر: الـSW/معاينة Vite — تحقق أن glob precache لا يشير إليه).

### [P3] F-12 — مسارات GET الخاصة بالمستخدم بلا `Cache-Control` صريح (اعتماد على ETag+السلوك الافتراضي)

- **الموضع:** `backend/src/routes/cart.ts:85` (GET /api/cart)، `orders.ts` (GET /api/orders)، `notifications.ts`، `wallet.ts`، `loyalty.ts` — لا ترويسة CC على الإطلاق (المقابل: /api/auth/me يضبط `private, max-age=30` صراحةً — auth.ts:309).
- **الدليل:** الاستجابات شخصية لكن بلا `private`/`no-store`: يُعتمد ضمنيًا على (أ) Cloudflare لا يكاش /api افتراضيًا، (ب) غياب مدة صلاحية يجبر إعادة التحقق عبر ETag القوي (app.ts:281). أي خلل مستقبلي في قاعدة كاش CF/وكيل وسيط يحوّل استجابة مستخدم لآخر قابلًا للتخزين.
- **الأثر:** تسليح دفاعي ناقص — الحالة الراهنة صحيحة وظيفيًا (تحقق 304 دائمًا) لكنها ليست صريحة.
- **الإصلاح الدقيق:** middleware صغير `privateNoStore` يضبط `Cache-Control: private, no-store` على GET/HEAD لمسارات المستخدم الخمسة (يكفي تثبيتها في routes/index.ts عند التركيب).

### [P3] F-13 — غياب AggregateRating في Product LD: بيانات عدد الطلبات موجودة لكن لا نظام تقييمات حقيقي (توجيه، لا تزييف)

- **الموضع:** `frontend/src/lib/seo-builders.ts:67-110` (buildProductLd بلا aggregateRating) + `product.tsx:369-379` (لا يمرر order_count رغم أن الـAPI يعيده: `backend/src/routes/products.ts:269,323`).
- **الدليل:** لا يوجد `AggregateRating` ولا `review` في أي ملف (grep: صفر نتائج). الشارة «الأكثر مبيعاً» تُبنى من order_count لكن عدد الطلبات **ليس** مراجعات — إدخال `reviewCount: order_count` مع `ratingValue` مُختلَق يخالف سياسة Google (structured-data spam وقد يكامل العقوبة على كامل الدومين).
- **الأثر:** حرمان شرعي من نجوم SERP (CTR أقل للمنتجات) — السبيل الوحيد المشروع: ميزة تقييمات فعلية.
- **الإصلاح الدقيق (خارطة طريق، ليست تزييفًا):** جدول product_reviews (نجمتان-5 + نص) عند تسليم مكتمل، ثم `aggregateRating: {ratingValue, reviewCount, bestRating:5}` في buildProductLd + عرضها في ProductCard. إلى حينها: يبقى الحذف هو الصحيح.

### [P3] F-14 — `og:locale:alternate=en_US` تُصدر بينما لا وجود لنسخة إنجليزية (تعارض مع سياسة sitemap الموثقة)

- **الموضع:** `frontend/src/components/seo/MetaTags.tsx:103-104` (`ogLocaleAlt = lang === "ar" ? "en_US" : "ar_LY"` ثم سطر 125 upsert)؛ سياسة البديل المعكوس موثقة في `backend/src/routes/seo.ts:158-164`: «لا نُصدر alternate en لأن لا نسخة موجودة».
- **الأثر:** إشارة لغة بديلة لا تقابلها نسخة — الضجيج نفسه الذي رفضه الـsitemap، بدرجة أقل خطورة (og:locale إرشادية).
- **الإصلاح الدقيق:** إسقاط سطر og:locale:alternate (أو إصداره فقط عند وجود نسخة فعلية مستقبلًا).

### [P3] F-15 — lastmod للمسارات الثابتة في sitemap يستخدم MAX(updatedAt) للمنتجات حتى لـ/terms و/support

- **الموضع:** `backend/src/routes/seo.ts:169-191` (globalLastmod لكل STATIC_ROUTES).
- **الدليل:** `/terms` (priority 0.3, yearly) يحمل lastmod = آخر تعديل منتج — إشارة تغيّر كاذبة تدفع أعيد الزحف إلى صفحة قانونية لا تتغير.
- **الأثر:** ضئيل: crawl budget يميل قليلًا نحو /terms//support عند كل تحديث منتج. الإصلاح: lastmod ثابت للمسارات القانونية (تاريخ آخر تعديل فعلي من seed/جدول settings) أو حذفه لها.

---

## إيجابيات مؤكدة (حتى لا يُعاد فحصها كنواقص)

1. **كل الصفحات lazy** (App.tsx:33-77) مع lazyWithRetry للتعافي من انجراف النشر — لا صفحة ثقيلة في الحزمة الأولى، وvendor-charts/sentry/firebase خارج المسار الحرج.
2. **ميزانية حزمة مفروضة آليًا** (vite.config.ts:17-66: فشل البناء > 55 KiB gz؛ الحالي 31.6).
3. **صور المنتجات**: أول 4 eager + `fetchPriority=high` للأولى (ProductCard.tsx:263-264) — القرار الصحيح لـLCP؛ width/height؛ حاويات aspect ثابتة في كل الصفحات (لا CLS من صور).
4. **خطوط**: self-hosted subsets عربية/لاتينية 400/600/700 (≈75KB)، `font-display:swap` في الستة (قياس في CSS المبني)، preload hash-aware للوزن 400 فقط عبر إضافة build (vite.config.ts:109-141).
5. **كاش خلفية**: compression + ETag قوي + `/assets` 1y immutable + no-store لـhtml/sw/robots + s-maxage للكتالوج (موثق سابقًا — لن يُعاد).
6. **probe يبذور كاش react-query** (auth.tsx:230) — لا طلب /me مزدوج في home رغم useGetMe.
7. **QueryClient مضبوط** (staleTime 60s، refetchOnWindowFocus/Reconnect معطل — يمنع عواصف إعادة الجلب).
8. **NotificationBell**: 60s fallback فقط + socket-push أساسي + إيقاف عند إخفاء التبويب (NotificationBell.tsx:206-232).
9. **sitemap/robots**: ديناميكي بكاش ذاكرة 60s + bumpSitemapCache عند CRUD المنتجات؛ robots.txt شامل؛ 301 للمضيف الكنوني (app.ts:294-321)؛ hreflang ar+x-default فقط — قرار موثق ومقبول لسوق أحادي اللغة (seo.ts:158-165).
10. **no مكتبات مزدوجة**: لا moment/date-fns (Intl مُخزَّن مؤقتًا على مستوى الوحدة في utils.ts:17-38)؛ qrcode مستورد ديناميكيًا في admin/settings فقط.
11. **سلوك تنبؤي للـSW**: precache diet (256KB cap، بلا JS)، SWR للكتالوج، CacheFirst للصور 30 يومًا.
12. **CWV**: جمع beacon (web-vitals.ts) بعيدًا عن المسار الحرج + مسار /api/cwv مُختبَر.

## حدود الفحص والاستبعادات الملتزمة بها

لم يُعاد الإبلاغ عن: lazy radix (r4)، تحسينات CWV الموثقة، إدارة head المباشرة، seoBlock في cart/checkout، s-maxage للكتالوج، ترويسات vercel.json، والـP2 المؤجلة الموثقة (بحث عربي، أهداف لمس، GA/CSP، قاعدة كاش Cloudflare). الفحص ساكن (static analysis) — لم يُطلق خادم أو يُقس من الإنتاج الحي؛ قياسات الأحجام من dist الحالي.

**عدد الملفات المفحوصة:** 38 ملف مصدر/إعداد + مخرجات البناء (28 chunk + 6 خطوط + CSS + HTML + SW) + ملفا توثيق.
**التعديلات:** صفر (قراءة فقط). أُنشئ هذا التقرير فقط.

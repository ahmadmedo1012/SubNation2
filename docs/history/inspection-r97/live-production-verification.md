> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r97/live-production-verification.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# الجولة 97 — التحقق الحيّ الإنتاجي العميق (R97-A1)

**التاريخ:** 2026-09-11 (UTC) · **الوكيل:** R97-A1 (تشخيص فقط — صفر تعديلات على المصادر، صفر commits)
**النطاق:** التحقق أن كل إصلاح مُعلَن في الجولة 96 حيّ فعلاً في الإنتاج الآن، عبر فحوص HTTP حيّة + تنزيل وتحليل حِزم JS الحيّة + متصفح headless حقيقي (شلال الشبكة الفعلي) + مقارنة مع مصدر المستودع (HEAD = `315e4c0`).

---

## 1) المنهجية

1. **قراءة خط الأساس**: `worklog.md` (round-96 + round-96-deploy) · `docs/round-96-mobile-perfection-2026-09-11.md` · `docs/round-96-repair-plan.md` (موجات F1–F7) · مصادر الواجهة (`index.html`, `vite.config.ts`, `public/manifest.json`, `App.tsx`) والخلفي (`app.ts`, `routes/auth-settings.ts`, `services/openwa.service.ts`, `lib/origins.ts`, `vercel.json`).
2. **فحوص HTTP حيّة** بـ `curl -w` (TTFB/total/size/type/headers) على: `https://subnation.ly` و `https://subnation2.onrender.com` و `https://subnation-seven.vercel.app` و `https://openwa-gateway-7aaa.onrender.com` — كل قياس تكرر 3 مرات.
3. **تحليل الحِزم الحيّة**: تنزيل entry chunk + 12 chunk بمسارات (login/WhatsApp/checkout/product/cart/wallet/home/MobileNav/SocketInitializer/idempotency) بلا ضغط وفكّها بحثًا عن السلاسل العربية النصية ومنطق `Idempotency-Key` و `AbortSignal.timeout/any` و `visibilitychange`.
4. **متصفح headless حقيقي** (agent-browser/Playwright): تحميل `https://subnation.ly/` وتسجيل شلال الشبكة الفعلي (boot waterfall)، فحص تسجيل Service Worker، قياس 320px (bounding box لأيقونة السلة + scrollWidth)، فتح صفحة `/login` وتشغيل شريحة WhatsApp OTP خطوة بخطوة.
5. **اختبارات أمن سلبية**: Origin/Referer عدائي، endpoints أدمن بلا auth، مصافحة Socket.IO، بوابات CSRF — كلها بلا أي تعديل بيانات (لا POST حقيقي على مسارات مال؛ probes على مسار وهمي `__r97_csrf_probe` فقط).

**اكتشاف معماري مهم قبل كل شيء:** النطاق `subnation.ly` لا يُقدَّم من Vercel — الأدلة الحيّة تؤكد أنه **Cloudflare → Render (الخلفي نفسه يقدّم static الواجهة)**: الترويسات `server: cloudflare` + `x-render-origin-server: Render` + `rndr-id` + CSP الخاصة بـ helmet في الخلفي حرفيًا + `access-control-allow-credentials: true` من middleware الـ CORS. نشر Vercel يعمل بالتوازي على `subnation-seven.vercel.app` ببناء مختلف (chunk hash مختلف) — انظر النتيجة J-4.

---

## 2) جدول الأحكام المُلخّص

| #   | الفحص                                      | الحكم                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1a  | Entry chunk: الاسم والحجم                  | **LIVE ✓** — `index-DM6GWwq9.js` · 116,755B raw · **34,852B gzip** · 34,547B brotli wire (مطابق للمعلَن 34.8KBgz، تحت حد 55KB)                                                                                                                                |
| 1b  | Sourcemaps مغلقة                           | **LIVE ✓** — كل `.js.map`/`.css.map` تُعيد SPA HTML بحجم 6568B ونوع `text/html` (لا مصدر JS إطلاقًا)؛ على نطاق Vercel: 403                                                                                                                                    |
| 1c  | SW cache TTL                               | **LIVE ✓** — `sw.js` (2163B) يحوي `maxAgeSeconds: 604800` على `api-catalog-v1` + `images-v1` + 3 `registerRoute` + `precacheAndRoute` + `Cache-Control: no-cache`                                                                                             |
| 1d  | Manifest بمعرّف مستقر                      | **LIVE ✓** — `"id": "/"` + `application/json` + الاختصارات العربية                                                                                                                                                                                            |
| 1e  | `interactive-widget=resizes-content`       | **LIVE ✓** — في viewport meta للـ HTML الحي                                                                                                                                                                                                                   |
| 1f  | Critical CSS inline                        | **غير منفَّذ ✗** (ليس ادعاءً في الجولة 96) — CSS خارجي `index-FMCqzl2S.css` (249KB raw / 30.3KB gz / 28.1KB br) render-blocking؛ **preload الخطوط الحرج منفَّذ ✓**                                                                                            |
| 1g  | `google-site-verification` meta            | **MISSING ✗ (علة regex)** — انظر النتيجة J-2                                                                                                                                                                                                                  |
| 2   | شريحة WhatsApp sign-in في الحزمة           | **LIVE ✓** — كل السلاسل المطلوبة في chunk `use-public-auth-providers-BgBFnhe-.js` (12,430B raw / 4.3KB br) + تحقق UI حي في المتصفح                                                                                                                            |
| 3a  | `/api/healthz`                             | **LIVE ✓** — 200 `{"status":"ok"}` · TTFB 0.53s مباشر / 0.57s عبر subnation.ly                                                                                                                                                                                |
| 3b  | `whatsapp_status` في `/api/auth/providers` | **LIVE ✓ + ⚠ الوضع الحالي `failed`** — الحقل موجود وصادق ويعكس الواقع (البوابة قائمة لكن الجلسة بحالة failed) — انظر النتيجة J-1                                                                                                                              |
| 4   | ترويسات الأمن + CORS + CSRF                | **LIVE ✓** (nosniff · X-Frame-Options SAMEORIGIN + frame-ancestors 'self' · Referrer-Policy · HSTS 63072000 preload · CSP كاملة · Permissions-Policy) · CORS allow-list يعمل (Origin عدائي بلا ACAO) · بوابة CSRF تعمل (403) — مع ملاحظتَي P3 (انظر J-3, J-5) |
| 5   | شلال الإقلاع (AuthGate waterfall)          | **LIVE ✓ بدليل سلوكي مباشر** — طلب `/api/products` انطلق **قبل** `/api/auth/probe` في سجل الشبكة الحقيقي؛ كود `startBootHeadStart` (import chunk الرئيسية + prefetchQuery) موجود حرفيًا في entry الحي                                                         |
| 6   | SEO (verification/robots/sitemap)          | **robots ✓ / sitemap ✓ / verification meta ✗ (J-2)** — robots.txt فيه `Sitemap: https://subnation.ly/sitemap.xml`؛ sitemap.xml 200 `application/xml` 10,259B                                                                                                  |
| 7   | عقد `/api/products`                        | **LIVE ✓** — 18 منتجًا، كل الحقول الإلزامية موجودة؛ حقلا `description_long`/`faq` (اختياريان في العقد) محذوفان من JSON — متوافق عقدًا بلا كسر                                                                                                                 |
| 8   | www/canonicalization                       | **LIVE ✓** — `https://www` → 301 apex · `http://` → 301 `https://` · sitemap بالنطاق القانوني                                                                                                                                                                 |
| 9   | حماية `/api/admin/*`                       | **LIVE ✓** — 8/8 endpoints ترجع **401** بلا auth (ليس 404/500)                                                                                                                                                                                                |
| 10  | مصافحة Socket.IO                           | **LIVE ✓** — open packet كامل + CORS صحيح للنطاق القانوني و omittance للعدائي                                                                                                                                                                                 |

**إضافي (تحقق أعمق من ادعاءات الجولة 96):** مفاتيح Idempotency للمسارات المالية ✓ (checkout/product/wallet) · مفاتيح sessionStorage مستقرة عند إعادة المحاولة ✓ · مهلة 20s + `AbortSignal.any` ✓ · معالج 401 للمتجر («انتهت الجلسة») ✓ · إحياء السوكت (online/visibilitychange) ✓ · الضيوف بلا socket.io ✓ · MobileNav بلا backdrop-blur + visualViewport ✓ · حارس letter-spacing الموسَّع ✓ · رقاقة الرصيد `hidden sm:block` ✓ · «إفراغ السلة» + «تراجع» ✓ · `inputMode:"decimal"` ✓ · توست تحديث SW («تحديث جديد») ✓ · سلة ظاهرة عند 320px ✓ (bounding box + scrollWidth=clientWidth=320).

---

## 3) الأدلة التفصيلية

### 3.1 — الفحص 1: هيكل الواجهة الحيّ

**HTML الحي** (`GET https://subnation.ly/` — HTTP 200, TTFB 0.23–0.32s، بارد 0.67s):

```html
<meta
  data-rh="true"
  name="viewport"
  content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"
/>
...
<script src="/init.js"></script>
<script type="module" crossorigin src="/assets/index-DM6GWwq9.js"></script>
<link rel="modulepreload" crossorigin href="/assets/vendor-react-3l2p7574.js" /> ← 5 vendor preloads
فقط
<link rel="modulepreload" crossorigin href="/assets/vendor-icons-BYeaE9MX.js" />
<link rel="modulepreload" crossorigin href="/assets/vendor-utils-PJZsc2dN.js" />
<link rel="modulepreload" crossorigin href="/assets/vendor-router-B4JciV8b.js" />
<link rel="modulepreload" crossorigin href="/assets/vendor-assets/vendor-query-CdLgOk98.js" />
<link rel="stylesheet" crossorigin href="/assets/index-FMCqzl2S.css" />
<link
  rel="preload"
  as="font"
  type="font/woff2"
  crossorigin
  href="/assets/readex-pro-arabic-400-normal-De1vYjJZ.woff2"
/>
<link
  rel="preload"
  as="font"
  type="font/woff2"
  crossorigin
  href="/assets/readex-pro-latin-400-normal-DJUYAYkk.woff2"
/>
<script id="vite-plugin-pwa:register-sw" src="/registerSW.js"></script>
```

- **لا توجد route chunks مُحمَّلة eager في HTML** (تحقق مباشر لمطلب الفحص 5) — فقط entry + 5 vendor chunks.
- `interactive-widget=resizes-content` ✓ حيّ (إصلاح 96-F5).
- preload الخطوط (fontPreloadInject) ✓ حيّ.
- CSS حرج inline: **غير موجود** — ورقة أنماط خارجية واحدة (249KB raw / 30.3KB gzip / 28.1KB brotli wire). **هذا ليس انحدارًا**: الجولة 96 لم تدَّعِ inline critical CSS؛ ادعاؤها كان preload الخطوط (منفَّذ). تُدرَج فرصة تحسين (P3).

**حجم الدخول مقابل بوابة الميزانية (96-main):**

| القياس                    | القيمة      | الحد             |
| ------------------------- | ----------- | ---------------- |
| raw                       | 116,755B    | —                |
| **gzip (gzipSync مكافئ)** | **34,852B** | 56,320B (55KB) ✓ |
| brotli wire               | 34,547B     | —                |

**Sourcemaps (إغلاق 9.38MB — 96-main F-8):**

```
/assets/index-DM6GWwq9.js.map      → HTTP 200  text/html  6568B  (SPA fallback — ليس JS)
/assets/home-D9UoYlfh.js.map       → HTTP 200  text/html  6568B
/assets/vendor-react-3l2p7574.js.map → HTTP 200  text/html  6568B
/assets/index-FMCqzl2S.css.map     → HTTP 200  text/html  6568B
```

على نشر Vercel: `.js.map` → **403** (محمي). **الحكم: LIVE ✓** — لا تسريب مصادر. (ملاحظة P3: الحالة 200 بنوع text/html = soft-404؛ الأصح 404 لكنه غير مؤذٍ.)

**Service Worker (`/sw.js` — 2163B, `Cache-Control: no-cache, no-store, must-revalidate`):**
يحوي حرفيًا: `api-catalog-v1` مع `maxAgeSeconds: **604800**` (TTL 7 أيام — إصلاح 96-main F-7a) · `images-v1` (CacheFirst 30 يومًا) · 3× `registerRoute` · `precacheAndRoute`. التسجيل مؤكد سلوكيًا: `navigator.serviceWorker.getRegistration().active.scriptURL === "https://subnation.ly/sw.js"`.

**Manifest (`/manifest.json` — 200, `application/json`):** `"id": "/"` ✓ (معرّف مستقر — إصلاح 96-main) + الاسم/الاختصارات العربية + `lang: ar`, `dir: rtl`.

### 3.2 — الفحص 2: شريحة WhatsApp sign-in في الحزمة الحيّة

الشريحة في chunk مشترك باسم `use-public-auth-providers-BgBFnhe-.js` (12,430B raw / 4,304B brotli) — يُحمَّل عند فتح `/login` (مؤكد من سجل الشبكة):

| السلسلة (fixed-string)                           | عدد التكرارات الحيّة |
| ------------------------------------------------ | -------------------- |
| `رمز التحقق`                                     | 2 ✓                  |
| `رببطت للتو` (نص بانر «قناة WhatsApp ربطت للتو») | 2 ✓                  |
| `إعادة الإرسال`                                  | 4 ✓                  |
| `تُهيَّأ`                                        | 2 ✓                  |
| `لم يصلك الرمز`                                  | 2 ✓                  |
| `whatsapp_settling`                              | 1 ✓                  |
| `retry_after_sec`                                | 3 ✓                  |
| `رمز التحقق المكوّن من 6 أرقام` (aria-label)     | 1 ✓                  |

**تحقق UI حي (متصفح headless على https://subnation.ly/login):**

1. الصفحة تعرض «المتابعة عبر WhatsApp» + «المتابعة عبر Telegram» + «المتابعة عبر Google».
2. بعد النقر: خطوة الهاتف — `textbox "رقم الهاتف"` + زر «إرسال» (disabled حتى رقم صالح) + زر «تراجع» (هدف 44px — 96-F2) + التلميح «تُقبل أرقام ليبيانا ومدار التي تبدأ بـ 091 / 092 / 093 / 094.».
3. **التلميح الصادق للقناة ظاهر حيًّا** (لأن `whatsapp_status="failed"`): «قناة WhatsApp قيد الربط مؤقتاً — يمكنك المحاولة، أو استخدم Google / Telegram الآن».
4. نشر Vercel يحمل الشريحة نفسها (نفس أعداد السلاسل بالضبط).

### 3.3 — الفحص 3: الخلفي الحيّ

```
GET https://subnation2.onrender.com/api/healthz
→ HTTP 200 · TTFB 0.531s · {"status":"ok"}

GET https://subnation2.onrender.com/api/auth/providers   (Origin: https://subnation.ly)
→ HTTP 200 · TTFB 0.394s
{"providers":[telegram ✓ (bot_id 8884466008), google ✓], "whatsapp_enabled": true, "whatsapp_status": "failed"}
```

- الحقل `whatsapp_status` **موجود ✓** ويعرض قيمة دورة حياة OpenWA الحقيقية — **صادق ✓** (لا "ready" مفبرك أبدًا — منهج r95/96-F1).
- القيمة الحالية **`failed`** وليست `qr_ready` المتوقعة في موجز المهمة: البوابة `openwa-gateway-7aaa.onrender.com` قائمة (200، صفحة دخول المشغّل العربية، `/api/sessions` بلا مفتاح → **401** ✓ محمية) لكن الجلسة المكونة في حالة `failed` — أي **قناة OTP معطّلة الآن** (انظر J-1).
- القيمة مستقرة عبر إعادة الفحص بعد انتهاء كاش الـ30s وعبر المسارين (Render مباشر + subnation.ly).

### 3.4 — الفحص 4: ترويسات الأمن وCORS وCSRF

**ترويسات كل استجابات الخلفي (وتشمل static الواجهة على Render):**

| الترويسة                    | القيمة الحيّة                                                                                 | الحكم                                 |
| --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------- |
| `X-Content-Type-Options`    | `nosniff`                                                                                     | ✓                                     |
| `X-Frame-Options`           | `SAMEORIGIN`                                                                                  | ✓ (+ `frame-ancestors 'self'` في CSP) |
| `Referrer-Policy`           | `strict-origin-when-cross-origin`                                                             | ✓                                     |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload`                                                | ✓                                     |
| `Content-Security-Policy`   | مطابقة حرفيًا لسياسة helmet في `app.ts` (connect-src تضم subnation.ly/www/vercel)             | ✓                                     |
| `Permissions-Policy`        | `camera=(), microphone=(), geolocation=(), usb=(), payment=(self), midi=(), accelerometer=()` | ✓                                     |

**سلوك CORS (allow-list):**

```
GET /api/products  Origin: https://subnation.ly   → 200 + access-control-allow-origin: https://subnation.ly + allow-credentials: true ✓
GET /api/products  Origin: https://evil.example   → 500 INTERNAL_ERROR بلا أي ترويسة ACAO ← الرفض فعّال (المتصفح يحجب) لكن بشكل صاخب (J-3)
OPTIONS (preflight) Origin: https://evil.example  → 500 بلا ACAO ← الرفض فعّال
```

**بوابة CSRF (Origin/Referer — لا يوجد token endpoint بالتصميم: Origin/Referer + SameSite):**

```
POST /api/__r97_csrf_probe  Referer: https://evil.example/page (بلا Origin)
→ 403 {"error":"طلب غير مصرح","code":"FORBIDDEN"} ✓

POST /api/__r97_csrf_probe  بلا Origin/Referer/cookie
→ 403 ✓ (أصرم من اللازم — يرفض العملاء بلا ترويسات أيضًا؛ سلوك F-009 المقصود)

POST /api/__r97_csrf_probe  Origin: https://subnation.ly
→ 404 (عبر البوابة — المسار وهمي) ✓ البوابة لا تحجب النطاق القانوني
```

**حماية الأدمن (الفحص 9):** `/api/admin/{stats,orders,session,products,alerts,topups,settings/auth,users}` بلا auth → **401 في 8/8** ✓ (وليس 404/500).

**مصافحة Socket.IO (الفحص 10):**

```
GET https://subnation2.onrender.com/socket.io/?EIO=4&transport=polling  (Origin: https://subnation.ly)
→ HTTP 200 · 0.185s
  0{"sid":"fhYz4JGORR4fdjE2AAAA","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":65536}
  + access-control-allow-origin: https://subnation.ly + access-control-allow-credentials: true ✓

نفس الطلب بـ Origin: https://evil.example
→ open packet يُصدر للاتصال غير المتصفحي لكن **بلا أي ترويسة ACAO** ← المتصفح العدائي يُحجب على مستوى CORS ✓ (المصادقة على الأحداث تتم لاحقًا على مستوى السوكت)
```

### 3.5 — الفحص 5: شلال الإقلاع (أقوى دليل في الجولة)

**قياسات TTFB (متوسط 3 محاولات، من نقطة فحص آسيوية):**

| الهدف                                      | TTFB                       |
| ------------------------------------------ | -------------------------- |
| `https://subnation.ly/`                    | 0.23–0.32s (بارد 0.67s)    |
| entry chunk                                | 0.036–0.049s               |
| `/api/auth/probe` (عبر subnation.ly)       | 0.196–0.221s               |
| `/api/products` (عبر subnation.ly)         | 0.29–0.71s                 |
| `/api/products` (Render مباشر)             | 0.26–0.28s                 |
| `/api/products` (عبر نطاق Vercel → Render) | 0.72s (وثبة الوكيل إضافية) |

**(أ) دليل الحزمة:** entry الحي يحوي حرفيًا (minified):

```js
import("./home-D9UoYlfh.js"),__vite__mapDeps([12,2,13,5,14,7,6,15,16,8])).catch(()=>{}),
Hr.prefetchQuery({queryKey:Sr({}),queryFn:async()=>{const r=await fetch("/api/products",
{credentials:"include",headers:{Accept:"application/json"}...
```

هذا هو `startBootHeadStart()` (96-F3 §5) — تسخين chunk الرئيسية + طلب المنتجات **عند تقييم الوحدة، قبل mount الـ AuthGate**.

**(ب) الدليل السلوكي (سجل شبكة متصفح حقيقي على زيارة باردة كضيف):**

```
[38] GET /assets/home-D9UoYlfh.js            (تسخين chunk الرئيسية فور الإقلاع)
[43] GET /api/products          (Fetch) 200   ← المنتجات انطلقت
[44] GET /api/auth/probe        (Fetch) 200   ← الـ probe بعدها بالتوازي — لم يعد يحجب شيئًا
[45] GET /assets/instrument-*.js
[46] GET /assets/vendor-sentry-*.js
[54] GET /api/catalog/stats · [56] GET /api/flash-sale
(لا يوجد أي طلب socket.io للضيف ✓ — إصلاح 96-F3 §6 مؤكد سلوكيًا)
```

في الشلال القديم كان الترتيب: probe → chunk الرئيسية → products (تسلسلي). **الآن products [43] يسبق probe [44]** — إزالة الـ RTTs التسلسلية حيّة **بالدليل السلوكي المباشر**.

**(ج) إضافات مؤكدة من الحزم الحيّة (ادعاءات 96-F3/F4):**

- **مهلة 20s**: entry الحي يحوي `os=2e4` (DEFAULT_REQUEST_TIMEOUT_MS) + دالة الدمج `is(signal, timeoutMs)` باستخدام `AbortSignal.timeout(t)` و `r.any([e,s])` (مع feature-detect وتدهور رشيق) ✓.
- **معالج 401 للمتجر**: «انتهت الجلسة» ×2 في entry الحي ✓.
- **إحياء السوكت**: `SocketInitializer-Bv1MJp6H.js` يحوي `addEventListener("online")` + `visibilitychange` ×2 ✓.
- **Idempotency للمسارات المالية**: ترويسة `"Idempotency-Key"` موجودة في `checkout-*.js` ✓ و`product-*.js` ✓ (شراء مفرد) و`wallet-*.js` ✓ (شحن — `A.current` مفتاح ثابت لكل نيّة)؛ ومنطق المفاتيح المستقرة حيّ في checkout: `sessionStorage.getItem/setItem/removeItem(B(productId, …))` — إعادة استخدام عند إعادة المحاولة وحذف عند الحسم ✓.
- **«إفراغ السلة»** ×4 + «تراجع» (undo toast) في chunk السلة ✓ · **`inputMode:"decimal"`** ×2 في المحفظة ✓.
- **MobileNav**: لا وجود لأي `backdrop-blur`/`blur-3xl` + `visualViewport` موجود (يختفي عند الكيبورد) ✓.
- **حارس letter-spacing**: CSS الحي يحوي `.tracking-tight,.tracking-tighter,.tracking-wide,.tracking-wider,.tracking-widest{letter-spacing:0}` + `h1,h2,h3,h4{letter-spacing:0;line-height:1.3}` ✓ (96-F7).
- **رقاقة الرصيد تحت sm**: نمط `hidden sm:block` في entry (Navbar مجمّع فيه) ✓ (96-F5 P0-1).
- **توست تحديث SW**: «تحديث جديد» في entry ✓.

**(د) اختبار 320px سلوكي (P0-1):** عند viewport 320×800 (ضيف): أيقونة السلة bounding box **x=16, y=6, width=44** (داخل الشاشة بالكامل) و`scrollWidth=320 == clientWidth=320` — **لا فيض أفقي** ✓. (حالة المسجَّل تتطلب بيانات دخول لم تُستخدم — لكن كلاسَي الإخفاء موجودان في الحزمة والرياضيات المعلنة ≈271px ≤ 288px.)

### 3.6 — الفحص 6: SEO

- **robots.txt** (`https://subnation.ly/robots.txt` — 200): `User-agent: * Allow: /` + حظر زحف بوتات الذكاء الاصطناعي (GPTBot, CCBot, ClaudeBot, Google-Extended…) + `Sitemap: https://subnation.ly/sitemap.xml` (سطر 102). (مقدمة Content-Signals من Cloudflare تُسبَق تلقائيًا.)
- **sitemap.xml** — 200 `application/xml` 10,259B بنطاق `https://subnation.ly` القانوني ✓.
- **google-site-verification**: **غير موجودة في HTML الحي** — علة regex في `seoHeadInject` (vite.config.ts:83): النمط `/<meta name="viewport"[^>]*>/` لا يطابق الوسم الفعلي متعدد الأسطر `<meta data-rh="true" name="viewport" …>` (بسبب `data-rh` والأسطر الجديدة) → الوسم لا يُحقن أبدًا. **أعيد إنتاجها محليًا** على dist مبني من HEAD (لا وجود للوسم فيه أيضًا). اليوم غير مؤذية (الـ token فارغ أصلًا) لكنها تمنع تفعيل GSC مستقبلًا عبر meta (J-2).

### 3.7 — الفحص 7: عقد `/api/products`

`GET https://subnation.ly/api/products` → 200 · **18 منتجًا** ✓ (المتوقع 18) · `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300` ✓ (نافذة edge المعلنة) · ETag قوي.

مطابقة الحقول مع العقد المولَّد (`shared/api-client-react/src/generated/api.schemas.ts` — `Product`):

| الحقل                                                                                                                                                 | في الاستجابة الحيّة                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| id, slug, name, description, image_url, price, category, is_active, usage_terms, stock_count, is_available, sale_price, discount_percent, order_count | ✓ كلها (14/14 إلزامية)                                                                                     |
| description_long, faq                                                                                                                                 | ✗ محذوفان من JSON — **اختياريان في العقد** (`?: … \| null`) فلا كسر؛ العميل يتعامل مع غيابهما كـ undefined |

`/api/catalog/stats`: `{"total_products":18,"available_products":14,"total_units":62,"lowest_price":4.49,"has_flash_sale":false}` — متسق مع 18 منتجًا و0 صور (فجوة البيانات المعروفة: enrichment معطّل).

### 3.8 — الفحص 8: www / canonicalization

```
https://www.subnation.ly/  → 301 → https://subnation.ly/          ✓
http://subnation.ly/       → 301 → https://subnation.ly/          ✓ (Always Use HTTPS — Cloudflare)
http://www.subnation.ly/   → 301 → https://www.subnation.ly/ → 301 → https://subnation.ly/  (وثبتان — مقبول)
```

DNS: النطاقان عبر Cloudflare proxy (104.21.61.206 / 172.67.214.139) · sitemap/robots بالنطاق القانوني ✓.

### 3.9 — الفحص 3 (تكملة): بوابة OpenWA

```
GET https://openwa-gateway-7aaa.onrender.com/           → 200 (0.21s) — صفحة «تسجيل الدخول — OpenWA» (noindex) — البوابة قائمة
GET https://openwa-gateway-7aaa.onrender.com/api/sessions (بلا مفتاح) → 401 {"error":"invalid or missing X-API-Key"} ✓ محمية
```

الحكم: البوابة تعمل؛ **جلسة WhatsApp بحالة `failed`** — يعكسها `whatsapp_status` بأمانة.

---

## 4) الاكتشافات الجديدة (خارج نطاق ادعاءات الجولة 96 — لم تُصلح مصادر، موثّقة فقط)

- **J-1 (P1 تشغيلي): قناة WhatsApp OTP معطّلة الآن** — `whatsapp_status: "failed"` (مستقر عبر المسارين وإعادة الفحص). الحقل صادق، لكن المستخدم الذي يجرّب WhatsApp سيفشل؛ والتلميح الظاهر («قيد الربط مؤقتاً — يمكنك المحاولة») نص عام لكل حالة غير ready — يقول «يمكنك المحاولة» بينما الإرسال سيفشل فعليًا بحالة failed. **الإجراء:** إعادة اقتران الجلسة من لوحة OpenWA (البوابة قائمة)؛ واختياريًا نص تلميح مخصص لحالة `failed` («القناة متوقفة مؤقتًا — استخدم Google/Telegram»).
- **J-2 (P2): علة `seoHeadInject`** — regex لا يطابق وسم viewport متعدد الأسطر مع `data-rh` → وسم `google-site-verification` لا يُصدر أبدًا (حي + محلي). الإصلاح: نمط يسمح بالأسطر والسمات الوسيطة (مثل `/<meta[^>]*name="viewport"[^>]*>/s`) — مع اختبار build يتحقق من وجود الوسم في dist.
- **J-3 (P2): Sentry الواجهة معطّل في الإنتاج** — console الخطأ الحي: `[sentry] VITE_SENTRY_DSN is not set in production. Frontend errors will not be reported.` بينما `vendor-sentry-*.js` (**154,658B brotli ≈ 151KB**) يُحمَّل في الإقلاع (مؤكد في سجل الشبكة [3349.46]). النتيجة: **كلفة حرجة بلا أي قيمة + صفر مراقبة أخطاء الواجهة**. الإجراء: ضبط `VITE_SENTRY_DSN` في بيئة بناء Render/Vercel أو إسقاط Sentry من المسار الحرج حتى يُضبط.
- **J-4 (P2 معماري): انحراف نشرين متوازيين** — النطاق القانوني `subnation.ly` يُقدَّم من **Cloudflare → Render** (وليس Vercel كما في موجز المهمة)؛ نشر Vercel حي على `subnation-seven.vercel.app` ببناء مختلف (entry `index-DMvVGAvn.js` مقابل `index-DM6GWwq9.js`، 35,375B مقابل 34,852B gzip). كلاهما يحمل الجولة 96 كاملة (تم التحقق)، لكن: (أ) خطر انجراف مستقبلي بين بناءين، (ب) نطاق Vercel يقدّم SPA HTML لـ `robots.txt`/`sitemap.xml` (rewrite إلى index.html — محتوى مكرر محتمل للفهرسة)، (ج) أصول Vercel بلا `X-Content-Type-Options` (vercel.json يطبق الأمان فقط على غير `/assets/`)، (د) مسار API عبر Vercel أبطأ (0.72s مقابل 0.29s). **الإجراء:** توثيق القرار (أيهما النشر القانوني) وإما إحالة نطاق Vercel بالنطاق القانوني أو демotingه + إضافة rewrite لـ robots/sitemap على Vercel.
- **J-5 (P3): رفض CORS يرجع 500 INTERNAL_ERROR** — `cb(new Error(...))` من middleware الـ cors تصل إلى error handler العام → 500 عربي عام بدل رفض صامت/403. وظيفيًا الرفض فعّال (لا ACAO) لكنه: يضيف ضوضاء Sentry/سجلات لكل سكانر، ويكشف أن كل طلب cross-origin عشوائي يولّد استثناء مُسجَّل. الإجراء: بدل الـ error callback، استجابة بدون ترويسات ACAO (تمرير `null` مع عدم ضبطها) أو 403 صريح.
- **J-6 (P3): استدعاء مزدوج لـ `/api/auth/providers`** عند فتح `/login` (طلبان متتاليان [3349.118]/[3349.119]) — على الأرجح مستهلكان للـ hook أو refetch. كاش 30s على الخلفي يخفف الأثر لكن الطلب الثاني RTT بلا فائدة.
- **J-7 (P4/ملاحظة):** `.map` تُرجع 200 soft-404 بنوع text/html بدل 404 (سلوك SPA rewrite — نفس ملاحظة round-96-deploy؛ الأصح إرجاع 404 للأصول المفقودة في `/assets/`).
- **J-8 (إيجابي):** `cf-cache-status: DYNAMIC` على `/api/products` (Cloudflare لا يخزّن الكتالوج — بسبب `Vary: Origin` + credentials) — التخزين الفعّال يقوم به SW على العميل (TTL 7 أيام) — متسق مع التصميم.

---

## 5) قائمة الإصلاحات ذات الأولوية

### P0 — لا شيء 🔴

كل مطالبات الجولة 96 التي فُحصت (sourcemaps · SW TTL · manifest.id · interactive-widget · شريحة WhatsApp · idempotency المسارات المالية · شلال الإقلاع · حماية الأدمن 401 · Socket.IO · CORS/CSRF · canonicalization · عقد المنتجات 18) — **حيّة في الإنتاج**.

### P1

1. **J-1: إعادة اقتران جلسة OpenWA** (البوابة قائمة، الجلسة failed) — قناة WhatsApp OTP معطّلة للمستخدمين الآن. (تشغيلي — من لوحة OpenWA، بلا كود.)
2. (اختياري مرافق لـ J-1) نص تلميح مخصص لحالة `whatsapp_status === "failed"` في `WhatsAppPhoneSignIn.tsx` بدل النص العام «قيد الربط مؤقتاً».

### P2

3. **J-2: إصلاح regex `seoHeadInject`** في `vite.config.ts` + اختبار تحقق على dist (وسم google-site-verification لا يُصدر أبدًا اليوم).
4. **J-3: ضبط `VITE_SENTRY_DSN`** في بيئة البناء (Render/Vercel) — أو إخراج Sentry من المسار الحرج — 151KB brotli تُحمَّل بلا وظيفة + صفر مراقبة أخطاء واجهة.
5. **J-4: حسم معمارية النشر المزدوج** (Canonical = Cloudflare→Render) — توثيق القرار، ومعالجة robots/sitemap ونواقص ترويسات الأصول على نطاق Vercel أو демوته.

### P3

6. **J-5: رفض CORS الصامت/النظيف** بدل 500 (تقليل ضوضاء السجلات وSentry).
7. **J-6: إزالة الاستدعاء المزدوج** لـ `/api/auth/providers` على صفحة الدخول.
8. **J-7: إرجاع 404 حقيقي** للأصول المفقودة تحت `/assets/` (بدل SPA HTML 200).
9. **فرصة: inline critical CSS** (ليست ادعاءً للجولة 96) — ورقة 28KB br render-blocking؛ حقن ~حجم حرج مضغوط + async البقية يوفر على LCP الجوال.
10. **فرصة: تفعيل GSC** بعد إصلاح J-2 (ضبط `VITE_GSC_VERIFICATION`).

### P4

- توثيق أن http+www يمر بوثقتين (301→301) — تحسين اختياري في قواعد Cloudflare.

---

## 6) حدّ التحقق المعلن (حدود هذا الفحص)

- لم يُختبر مسار «المسجَّل» سلوكيًا (لا بيانات اعتماد متاحة، ولا يُنشَأ حساب اختباري) — تحقق شريط التنقل المسجَّل تم على مستوى الحزم/الكلاسات (`hidden sm:block`) + سلوك الضيف عند 320px.
- لم تُرسل أي OTP حقيقية (POST `/api/auth/whatsapp/start`) — لتفادي الضغط على قناة معطّلة أصلًا وعدم تلويث rate-limiters؛ كفاية الدليل: الحقل الصادق + سلاسل العقد (whatsapp_settling/retry_after_sec) في الحزم الحيّة + الشيفرة في المصدر.
- القياسات الزمنية من نقطة فحص واحدة (آسيوية) — كافية للمقارنة النسبية (serial vs parallel) وليست بديلًا عن RUM.
- عقد الـ API قورن على `shared/api-client-react/src/generated/api.schemas.ts` (لا يوجد `frontend/src/lib/api.ts` في المستودع — العقد الحقيقي في المولَّد المشترك؛ وُثّق للتصحيح).

---

## 7) الخلاصة

**كل إصلاح رئيسي مُعلَن في الجولة 96 مؤكد LIVE في الإنتاج بثلاث طبقات دليل (ترويسات/حِزم/سلوك متصفح حقيقي):** إغلاق sourcemaps ✓ · TTL 7 أيام للكتالوج في SW ✓ · manifest.id ✓ · interactive-widget ✓ · شريحة WhatsApp كاملة بالسلاسل العربية المفروضة ✓ (والتلميح الصادق ظاهر حيًّا) · إزالة شلال الإقلاع ✓ (products يسبق probe في سجل الشبكة) · idempotency للمسارات المالية الثلاثة ✓ · حماية الأدمن 401/8 ✓ · Socket.IO ✓ · CORS/CSRF فعّالان ✓ · canonicalization ✓ · 18 منتجًا بعقد متوافق ✓.

**الثغرات المكتشفة كلها جديدة (غير مطالب بها الجولة 96) أو تشغيلية:** قناة WhatsApp بحالة failed (تشغيلي — أهم بند)، Sentry بلا DSN (151KB ميتة على المسار الحرج)، علة regex لوسم GSC، انحراف نشرين متوازيين، ورفض CORS بصوت 500. لا يوجد أي P0، ولا أي انحدار.

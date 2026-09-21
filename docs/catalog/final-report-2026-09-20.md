# تقرير إعادة بناء كتالوج SubNation النهائي — 2026-09-20

> المرحلة: COMPLETE CATALOG RECONSTRUCTION & PRODUCT FINALIZATION
> المصدر: زحف حي لـ embronic.com (WooCommerce Store API + استخراج نماذج variations من صفحات المنتجات) — بلا قوائم ثابتة أو تخمين.
> Commit: `01b4570` (main) · الترحيلات: drizzle 0009 + 0010 + V1-M16 (مطبّقة على قاعدة الإنتاج)

---

## 1. Catalog Audit

> **مطابقة حسابية (تدقيق 2026-09-20 النهائي — تحقق فعلي من البيانات الحية):**
> الزحف المصدر أعاد **56 منتجًا** (مجموع التصنيفات في تقرير الفجوة:
> streaming 17 + music 11 + RESELLER 10 + utility 5 + vpn 4 + education 2 +
> ai 2 + seo 2 + automation 1 + other 1 + webmaster 1 = 56؛ رقم «51» في
> عنوان تقرير الفجوة كان خطأ نسخ فقط). المستبعد **11** (RESELLER 10 +
> Gmail Creator 1). **56 − 11 = 45** ✓ — يطابق عدد الصفوف النشطة في قاعدة
> الإنتاج حرفيًا (streaming 17 · music 11 · software 7 — دمج utility/other/webmaster —
> · vpn 4 · education 2 · ai-tools 2 · seo-tools 2 = 45). الأرشيف 14 = 12
> بلا مصدر توريد + Disney+ المكرر (id 14) + منتجا اختبار (19، 23)؛
> والمجموع 45 + 14 = 59 صفًا = الواقع في القاعدة.

| المقياس                               | قبل                                         | بعد                                                                                                 |
| ------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| المنتجات (إجمالي)                     | 20                                          | 59 صفًا (45 نشطًا + 14 مؤرشفًا)                                                                     |
| المنتجات النشطة (المتجر)              | 18                                          | **45**                                                                                              |
| منتجات محدّثة ببيانات حقيقية          | 0                                           | 6 (Netflix, Spotify, Disney+, YouTube Premium, Apple TV+, Prime Video)                              |
| منتجات جديدة مضافة                    | —                                           | **39**                                                                                              |
| منتجات مؤرشفة (غير قابلة للتوريد)     | 2                                           | 14 (12 إضافي: PS Plus×3, Xbox, Canva, MS365×2, NordVPN, Adobe, Shahid, Disney-dup, Crunchyroll)     |
| التصنيفات                             | 5 غامضة                                     | **7** موثقة (streaming 17 · music 11 · software 7 · vpn 4 · ai-tools 2 · education 2 · seo-tools 2) |
| الـ variants (الباقات)                | 0 (لا بنية)                                 | **263** (Product → Plan → Duration → Price)                                                         |
| المنتجات بلا باقة                     | 18/18                                       | **0/45**                                                                                            |
| تكرارات                               | 3 أزواج مكررة (Disney×2, MS365×2, PSPlus×3) | **0**                                                                                               |
| صور المنتجات                          | 0/18                                        | **45/45** (أصول محلية `/products/*.webp` — حُوّلت PNG→WebP في r102: 2.90MB→0.52MB)                                                            |
| وصف عربي كامل (قصير+مطول+مميزات+شروط) | 0                                           | **45/45**                                                                                           |
| SEO (title + description لكل منتج)    | 0                                           | **45/45**                                                                                           |

## 2. Pricing

- **سعر الصرف**: 1 USD = 10 LYD (افتراضي مضمن، قابل للتعديل من الأدمن)
- **الهامش**: 100% (التكلفة × 2)
- **القاعدة**: `السعر بالدينار = التكلفة$ × (1 + الهامش%) × الصرف` — مصدر واحد: `backend/src/lib/pricing-config.ts` مدعوم بـ `system_settings` (`pricing.usd_to_lyd` = 10، `pricing.markup_percent` = 100)
- **أمثلة فعلية من قاعدة البيانات** (كل الأسعار = التكلفة × 20 بالضبط — 0 انتهاكات من 263):

| الباقة                                                     | التكلفة | سعر العميل      |
| ---------------------------------------------------------- | ------- | --------------- |
| Netflix — شهر واحد                                         | $3.99   | **79.80 د.ل**   |
| Netflix — سنة كاملة                                        | $29.99  | **599.80 د.ل**  |
| ChatGPT Plus — شهر                                         | $4.99   | **99.80 د.ل**   |
| ChatGPT Plus — سنة                                         | $44.99  | **899.80 د.ل**  |
| ExpressVPN — شهر                                           | $3.99   | **79.80 د.ل**   |
| Disney+ Premium — سنة                                      | $49.99  | **999.80 د.ل**  |
| $1 → 20 د.ل · $5 → 100 د.ل · $10 → 200 د.ل · $20 → 400 د.ل |         | مثبتة بالاختبار |

- الأدمن يستطيع: تعديل الصرف/الهامش (PUT `/api/admin/pricing/config`) ثم **إعادة احتساب جماعي** (POST `/api/admin/pricing/recompute`) — بلا أسعار hardcoded في أي ملف.
- لا Embronic API integration في هذه المرحلة (كما طُلب) — بنية الاستعداد فقط (variants + DTO layer).

## 3. Filtering — ما استُبعد ولماذا

| المستبعد                                                                                                                                                                                                               | السبب                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 10 منتجات RESELLER (YouTube Premium Reseller, Spotify Reseller, Shahid VIP Reseller, Reseller Kit, Reseller Credit, Prime Video Reseller, Netflix Reseller, NBA League Pass Reseller, Hulu Reseller, Disney+ Reseller) | مصنفة RESELLER صراحة — أسعار $149–$4,990 موجّهة للموزعين وليس المستهلك النهائي                        |
| Unlimited Gmail Account Creator ($499–$1,499)                                                                                                                                                                          | أداة إنشاء حسابات بالجملة (Automation/B2B) — ليست منتج Retail                                         |
| ADULT / Sports / Uncategorized                                                                                                                                                                                         | تصنيفات فارغة على Embronic (0 منتجات)                                                                 |
| 12 منتجًا قديمًا في SubNation بلا مصدر توريد Retail من Embronic (PS Plus, Xbox Game Pass, Canva, MS365, Adobe, Shahid, NordVPN, Crunchyroll…)                                                                          | لا يمكن الوفاء بها من المورد — أُرشفت (الطلبات التاريخية سليمة: بيانات delivered\_\* منسوخة في الطلب) |
| 59 وحدة مخزون ديمو غير قابلة للتسليم (مشفرة بمفتاح قديم — سبب علة INVENTORY_CORRUPT)                                                                                                                                   | كانت تعرض «متوفر» كاذبًا للعميل وتفشل عند الشراء — حُذفت آمنة (الوحدات المباعة محفوظة للسجل)          |

**مصطلحات محجوبة عن العميل نهائيًا** (ممنوعة في Public API/HTML/JS): `cost_price, originalCost, providerCost, supplierPrice, wholesalePrice, margin, markup, provider, supplier, sku` — مثبتة باختبار `catalog-security.test.ts` يفحص الـ JSON الخام للـ DTO بأكمله.

## 4. Images

- **45/45 منتجًا** بصورة مناسبة عالية الجودة (450×450 من الكتالوج الفعلي) — مخزنة محليًا `frontend/public/products/<slug>.webp` (لا اعتماد على CDN خارجي) + alt text وصفي عربي لكل صورة.
- منتجات تحتاج أصلًا أفضل: **0** (جميع صور المصدر متوفرة وقابلة للاستخدام).
- نسخة dist تتضمن الصور الـ45 (تم التحقق).

## 5. Technical Changes

**قاعدة البيانات (Neon — مكتملة وحية):**

- جدول `product_variants` (id, product_id, plan_label, duration_label, duration_days, cost_price USD, price_lyd, sku, is_active, sort_order) + UNIQUE(product, plan, duration)
- أعمدة إضافية: `products.seo_title/seo_description/features` · `orders.variant_id/variant_label` (نسخة تاريخية) · `inventory.variant_id` · `cart_items.variant_id/variant_label`
- ترحيلات: drizzle `0009` + `0010` + boot V1-M16 (additive, idempotent — مطبقة على الإنتاج)

**Backend:**

- `lib/pricing-config.ts` (جديد) — مصدر الحقيقة الوحيد للتسعير
- `routes/products.ts` — DTO عام بـ variants (بلا تكلفة) + price_from «تبدأ من» + seo/features في التفاصيل
- `services/checkout.service.ts` — شراء variant-aware: تسعير من الباقة، حارسا `VARIANT_NOT_FOUND`/`VARIANT_STALE` داخل الـ tx، أولوية مطالبة المخزون (variant-scoped ثم عام)، فشل مغلق لأي باقة غير صالحة
- `routes/orders.ts` + `routes/cart.ts` — تمرير/إرجاع variant، استبدال الخيار في السلة الخادمية
- `routes/admin/product-variants.ts` (جديد) — CRUD كامل + حارس حذف عند وجود طلبات + صيانة سعر العرض
- `routes/admin/pricing-config.ts` (جديد) — GET/PUT إعدادات + recompute جماعي (idempotent)
- `routes/admin/products.ts` — قائمة الأدمن تشمل variants بالتكلفة (سياق أدمن مصرّح به)

**OpenAPI + codegen:** 56 مسارًا/83 schemas (ProductVariant، AdminProductVariant، PricingConfig، CreateVariantBody…) — orval أعاد توليد api-zod + api-client-react.

**Frontend:**

- صفحة المنتج: محدد باقات (نوع الباقة + المدة) بأهداف لمس 44px + قائمة المميزات + SEO overrides
- ProductCard: «تبدأ من» + شارة «N باقات» + إضافة سريعة بأرخص باقة
- السلة المحلية v2: أسطر لكل باقة + ترقية تلقائية من v1 + تسمية الباقة في السطر
- الدفع: يرسل variant_id لكل وحدة + تقليص السلة بدقة لكل سطر
- الأدمن: حوار إدارة الباقات (+748 سطرًا) + قسم إعدادات التسعير مع إعادة الاحتساب

**سكربتات (scripts/catalog/):** زحف Embronic، تنزيل الصور، الاستيراد مع بوابة تحقق متقاطع (260 نقطة سعر تحققت قبل الكتابة — أي عدم تطابق يوقف الاستيراد).

## 6. Testing (نتائج فعلية مشغَّلة)

| الفحص                             | النتيجة                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Backend tests (vitest)            | **1081/1081 ✓** (119 ملفًا — منها 28 اختبارًا جديدًا: تسعير 14 + أمان 7 + شراء variants 7) |
| Frontend tests (vitest)           | **482/482 ✓** (66 ملفًا)                                                                   |
| Typecheck (libs+backend+frontend) | **0 أخطاء** ✓                                                                              |
| ESLint (الملفات المعدلة)          | **0 أخطاء** (4 تحذيرات مسبقة الوجود لم تتغير)                                              |
| Build (backend + frontend + PWA)  | **نجح** — 45 صورة في dist ✓                                                                |
| gitleaks على commit هذا العمل     | **0 تسريبات** ✓ (v8.24.3 محليًا)                                                           |
| pnpm audit --prod (critical)      | **0 critical** محليًا ✓                                                                    |
| drizzle drift (generate)          | **نظيف** ✓                                                                                 |

## 7. Needs Verification / إجراءات مطلوبة من المشغّل

1. **🔴 Render معلّق لأسباب فوترة (billing)**: كل خدمات الحساب الثمانية معلقة منذ الآن (`suspenders: ['billing']` — نفاد ساعات الخطة المجانية 750 ساعة/شهر أو التزام مالي). `subnation.ly` يرد 503 «Service Suspended». لا يمكن الاستئناف عبر API («only services suspended by a user can be resumed»). **المطلوب**: دخول لوحة Render → ترقية SubNation2 إلى Starter (~$7/شهر) أو انتظار تجديد الساعات أول الشهر. الكود ملتزم في main وسيُنشَر تلقائيًا فور استئناف الخدمة (زر Deploy من dashboard أو إعادة دفع).
2. **CI jobs فشلت بسبب بنية تحتية** (بلا runner مخصص — انتهت الوظيفة في 4 ثوانٍ بلا خطوات): نفس نافذة توقف Render. التحقق المحلي الكامل أعلاه بديل كامل. أعد تشغيل CI بعد استقرار الحساب.
3. **سعر الصرف قابل للتغيير**: لو تغير سعر الدولار رسميًا، عدّله من (الأدمن → التسعير) ثم اضغط «إعادة احتساب».
4. (مرحلة قادمة كما خُطط) Embronic API / Fulfillment integration — **لم تُنفَّذ** عمدًا في هذه المرحلة.

## 8. معيار الاكتمال

**SubNation Catalog = Clean ✓ + Complete ✓ + Retail-only ✓ + Correctly Priced ✓ + Properly Categorized ✓ + Properly Described ✓ + Visually Complete ✓ + Secure ✓**

45 منتجًا Retail حقيقيًا بـ263 باقة، كل سعر قابل للتدقيق (تكلفة × 20)، صفر تكرارات، صفر نواقص بيانات، صفر مصطلحات داخلية في واجهة العميل — والعميل يرى المنتجات والباقات والأسعار بلا أي معلومة مورد/تكلفة/جملة.

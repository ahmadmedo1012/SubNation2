# تحليل فجوة الكتالوج — SubNation vs Embronic (2026-09-20)

> Phase 3 deliverable. Source of truth: live crawl of embronic.com via WooCommerce Store API
> (`/wp-json/wc/store/v1/products` + product-page `data-product_variations`) — 56 products,
> real prices (USD), real variation matrices. Zero assumptions.

## 1. ما هو موجود في Embronic (Retail)

**56 منتجًا إجماليًا** موزعة على تصنيفات: [صُحّح من 51 — خطأ نسخ، الجدول أدناه يجمع إلى 56]
STREAMING(17) · MUSIC(11) · RESELLER(10) · Utility(5) · VPN(4) · EDUCATION(2) · AI Tools(2) ·
SEO Tools(2) · Automation(1) · Other(1) · Webmaster(1) — بالإضافة إلى ADULT(0)/Sports(0)/Uncategorized(0) فارغة.

**استُبعد 11 منتجًا (غير Retail):**

- 10 منتجات RESELLER صريحة: YouTube Premium Reseller, Spotify Reseller, Shahid VIP Reseller,
  Reseller Kit, Reseller Credit, Prime Video Reseller, Netflix Reseller, NBA League Pass Reseller,
  Hulu Reseller, Disney+ Reseller (أسعار $149–$4,990، مصطلحات reseller/credits)
- Unlimited Gmail Account Creator (Automation، $499–$1,499): أداة إنشاء حسابات بالجملة —
  ليست منتج مستهلك نهائي (bulk/B2B tool)

**النتيجة: 45 منتج Retail** — كلها بنية variation حقيقية (Product → Plan → Validity → Price USD):

- Netflix/Hulu/HBO Max/Disney+/Spotify/... → Plan(Individual/Duo/Family/Basic/Premium/With Ads/...)
  × Validity(1M/3M/6M/1Y)
- Ahrefs/Semrush → Plan(Lite/Standard/Advance/Pro/Guru/Business) × Validity(Monthly/Yearly)
- cPanel → Plan(VPS/Dedicated) × Validity(1M/1Y/Lifetime)
- Lifetime Cloud Storage → Plan(500GB/1TB/Unlimited)
- Windows/WinRAR/Brain.fm/UltimateGuitar → خيار واحد

## 2. ما هو موجود في SubNation (قبل التنظيف)

**20 منتجًا** (18 نشطًا): 12 منتج دمو (IDs 1–11, 13) بأسعار شبيهة بالدولار غامضة الدلالة
(14.99/5.99/…)، + 6 منتجات مضافة لاحقًا (IDs 14–18) بأسعار LYD (25–60) بلا صور أو وصف،

- منتجا اختبار مؤرشفان (19, 23).

**مشاكل مؤكدة بالبيانات:**

1. تكرارات: Disney+ (id 3 "Disney+ Standard" $9.99 + id 14 "Disney+" 25 LYD)،
   Microsoft 365 (id 8 $12.99 + id 15 50 LYD)، PS Plus Essential (id 5 $17.99 + id 13 30 LYD)
2. غموض العملة: `price` واحد بلا دلالة — بعضها منسق كدولار وبعضها كدينار
3. صفر صور (0/18 نشط) · صفر long descriptions · صفر FAQ
4. لا بنية variants/durations إطلاقًا (جدول واحد products مسطح)
5. لا مصدر حقيقة للتسعير (لا cost ولا markup ولا rate) — cost_price فارغ 19/20
6. **كل المخزون الحالي (59 وحدة لمنتجات 1–12) غير قابل للتسليم** — مشفّر بمفتاح قديم
   (INVENTORY_CORRUPT: checkout يفشل مغلقًا) → stock_count يكذب على العميل (يعرض متوفرًا لمنتج لا يمكن تسليمه)
7. منتجات بلا مصدر توريد من Embronic: PS Plus (5, 13, 18) · Xbox Game Pass (6) · Canva Pro (7) ·
   Microsoft 365 (8, 15) · Adobe CC (11) · Shahid VIP (16 — يوجد فقط كـ RESELLER في Embronic) · NordVPN (9) ·
   Crunchyroll (محذوف سابقًا)

## 3. الخطة (Gap → Target)

### أ. بنية البيانات (مطلوبة لتفادي duplicate products)

جدول جديد `product_variants`: (product_id, plan_label?, duration_label?, cost_price USD داخلي,
price_lyd, sort, is_active) + UNIQUE(product_id, plan_label, duration_label).
أعمدة إضافية (additive, migration-safe): products.seo_title/seo_description،
orders.variant_id/variant_label (نسخة تاريخية غير قابلة للتغيير)، inventory.variant_id (nullable)،
cart_items.variant_id/variant_label.

### ب. محرك التسعير — مصدر واحد للحقيقة

`lib/pricing-config.ts`: rate=USD_TO_LYD (10) + markup=100% من system_settings (قابلة للتعديل من
الأدمن، cache 60s). `computeRetailLYD(costUsd) = costUsd × (1+markup/100) × rate`. يستخدمه:
استيراد الكتالوج + أدمن (إنشاء/تعديل variant + زر إعادة احتساب جماعي) + حاسبة التسعير الأدمن.

### ج. تدقيق المنتجات الحالية (لكل حالة حكم منفصل)

| المنتج                                                                                                | الإجراء                                                                                                      |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Netflix (1), Spotify (2), YouTube Premium (4), Apple TV+ (10), Prime Video (17)                       | تحديث + variants حقيقية من Embronic                                                                          |
| Disney+ (3)                                                                                           | تحديث + 8 variants (دمج id 14 المكرر بالأرشفة)                                                               |
| Microsoft 365 (8, 15), PS Plus (5, 13, 18), Xbox (6), Canva (7), Adobe (11), Shahid (16), NordVPN (9) | أرشفة (is*archived) — غير قابلة للتوريد من Embronic؛ الطلبات التاريخية محفوظة (delivered*\* منسوخة في الطلب) |
| مخزون دمو غير قابل للتسليم (غير مباع)                                                                 | حذف آمن — يوقف عرض "متوفر" الكاذب                                                                            |
| test (19), sim (23)                                                                                   | تبقى مؤرشفة                                                                                                  |

### د. الإضافات (كلها من Embronic retail — بلا اختراع)

- STREAMING (14 جديد): HBO Max, Hulu, OSN+, Sling TV, Shudder, Showtime, Paramount Plus,
  Hallmark Movies Now, Funimation, Fox Now, DirecTV Stream, AMC Plus (+تحديث 5 موجودة)
- MUSIC (10): Tidal, SoundCloud, TuneIn, Qobuz, Pandora, Napster, IDAGIO, Headspace, Brain.fm, UltimateGuitar
- VPN (4): ExpressVPN, CyberGhost, IPVanish, HMA VPN Pro
- AI Tools (2): ChatGPT Plus, Shopia AI
- SEO Tools (2): Ahrefs, Semrush Classic
- EDUCATION (2): Skillshare, Scribd
- Software/Utility (7): Windows 10 Pro, Windows 10 Home, Windows 8, WinRAR Lifetime, Grammarly, cPanel, Lifetime Cloud Storage

### هـ. التصنيفات النهائية (تعكس الواقع + ذوق العميل الليبي)

streaming (17) · music (11) · vpn (4) · ai-tools (2) · software (7) · education (2) · seo-tools (2) = **45 منتجًا**

### و. الحماية

cost_price/sku بيانات داخلية: DB نعم · أدمن نعم · Public API/DTO ممنوع · HTML/JS ممنوع.
Public variant DTO: {id, labels, price_lyd, availability} فقط.

### pricing snapshots (cost USD → retail LYD = ×20)

- Netflix 1M: $3.99 → 79.80 LYD · 1Y: $29.99 → 599.80 LYD
- ChatGPT Plus 1M: $4.99 → 99.80 LYD
- Disney+ Basic 1M: $3.99 → 79.80 LYD · Premium 1Y: $49.99 → 999.80 LYD
- ExpressVPN 1M: $3.99 → 79.80 LYD

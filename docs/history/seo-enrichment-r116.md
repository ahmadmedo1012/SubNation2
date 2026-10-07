> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/seo-enrichment-r116.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# SEO Enrichment — Round 116 (R116-SEO)

**التاريخ:** 2026-09-24 (جولة 116) · **النطاق:** تحرير بيانات فقط (`docs/SEO_PRODUCTS.json` + هذا الملخص) — لا يوجد أي تعديل على قاعدة البيانات أو تشغيل سكربتات استيراد.

---

## 1. ما تم إنجازه

تمت إضافة **37 مدخل SEO جديد** إلى `docs/SEO_PRODUCTS.json` (كان الملف يحوي 8 مداخل منسّقة بالكامل، وأصبح يحوي **45** — تغطية كاملة للكتالوج النشط). المداخل الثمانية القديمة **لم تُمَس بأي بايت** (تحقق آلي: نص الملف الأصلي بادئة حرفية للملف الجديد).

المصادر المعتمدة: `download/catalog-dump.json` (لقطة قاعدة البيانات، 59 منتجًا) + `docs/catalog/catalog-gap-analysis-2026-09-20.md` + `docs/catalog/final-report-2026-09-20.md` + بذرة `scripts/src/seed.ts`. كل باقة/مدة/سعة مذكورة في النصوص مأخوذة من مصفوفة الـ variants الحقيقية في اللقطة.

### جودة المحتوى (نفس معايير المداخل الثمانية الأولى)

- `meta_description`: 110–131 حرفًا وتحوي الكلمة المفتاحية الرئيسية (المداخل القديمة: 115–131).
- `description_long`: 1401–1726 حرفًا (القديمة: 1448–1826)، بنفس تدفق الأقسام: تعريف المنتج → عرض سب نيشن وطريقة الدفع → مميزات نقطية → لمن يصلح → طريقة الاستخدام → ضمان ودعم.
- 5 أسئلة شائعة لكل منتج تغطي: طريقة الشراء، وقت التسليم، خصوصية/تشارك الحساب (أو تفعيل المفتاح لمنتجات الرخص)، المدد والتجديد، الدعم.
- **ادعاءات صادقة فقط:** لا أسعار مخترعة، لا وصف «رسمي» في المداخل الجديدة، لا ضمانات غير موثقة. التسليم الفوري عبر صفحة الطلب وضمان الاستبدال طوال المدة مأخوذان من `usage_terms` الخاصة بكل منتج في قاعدة البيانات (وهي سياسة المتجر الموثقة). أرقام مثل «105 دولة» (ExpressVPN) و«11 ألف خادم» (CyberGhost) من وصف الكتالوج نفسه.
- الروابط الداخلية تستخدم **سلاجات قاعدة البيانات الحقيقية** (`/product/{slug}` و`/category/{slug}` مسارات فعلية في الواجهة) — خلافًا لبعض روابط المداخل القديمة التي تستخدم سلاجات SEO غير مطابقة.

## 2. المداخل المضافة (37)

| # | المنتج | السلَغ (مطابق لقاعدة البيانات) | التصنيف |
|---|--------|-------------------------------|---------|
| 1 | OSN+ | `osn-plus` | streaming |
| 2 | Paramount+ | `paramount-plus` | streaming |
| 3 | Showtime | `showtime` | streaming |
| 4 | AMC+ | `amc-plus` | streaming |
| 5 | Sling TV | `sling-tv` | streaming |
| 6 | DirecTV Stream | `directv-stream` | streaming |
| 7 | Fox Now | `fox-now` | streaming |
| 8 | Funimation | `funimation` | streaming |
| 9 | Hallmark Movies Now | `hallmark-movies-now` | streaming |
| 10 | Shudder | `shudder` | streaming |
| 11 | Tidal | `tidal` | music |
| 12 | SoundCloud Go+ | `soundcloud-go-plus` | music |
| 13 | Pandora Premium | `pandora-premium` | music |
| 14 | Napster | `napster` | music |
| 15 | Qobuz | `qobuz` | music |
| 16 | IDAGIO | `idagio` | music |
| 17 | TuneIn Premium | `tunein-premium` | music |
| 18 | Headspace | `headspace` | music |
| 19 | Brain.fm Pro | `brain-fm-pro` | music |
| 20 | UltimateGuitar Pro | `ultimate-guitar-pro` | music |
| 21 | ExpressVPN | `expressvpn` | vpn |
| 22 | CyberGhost VPN | `cyberghost-vpn` | vpn |
| 23 | IPVanish VPN | `ipvanish` | vpn |
| 24 | HMA VPN Pro | `hma-vpn-pro` | vpn |
| 25 | ChatGPT Plus | `chatgpt-plus` | ai-tools |
| 26 | Shopia AI | `sophia-ai` | ai-tools |
| 27 | Ahrefs | `ahrefs` | seo-tools |
| 28 | Semrush Classic | `semrush-classic` | seo-tools |
| 29 | Skillshare | `skillshare` | education |
| 30 | Scribd | `scribd` | education |
| 31 | Windows 10 Pro | `windows-10-pro` | software |
| 32 | Windows 10 Home | `windows-10-home` | software |
| 33 | Windows 8 | `windows-8` | software |
| 34 | WinRAR Lifetime | `winrar-lifetime` | software |
| 35 | Grammarly Pro | `grammarly-pro` | software |
| 36 | cPanel | `cpanel` | software |
| 37 | Lifetime Cloud Storage | `lifetime-cloud-storage` | software |

> **قرار منهجي:** كل سلَغ جديد مطابق 100% لسلاَغ المنتج في قاعدة البيانات (`product_name` و`category` كذلك)، لأن `import-seo.ts` يطابق بالسلَغ أولًا ثم بالاسم بالضبط. بهذا يكون الانضمام حتميًّا لا يعتمد على ترتيب الصفوف.

## 3. المنتجات المتجاوزة عن قصد (14 — كلها مؤرشفة `is_archived=true`)

| المنتج (id) | السبب |
|--------------|-------|
| PlayStation Plus Essential (5)، PS Plus Essential (13)، PS Plus Deluxe (18) | مؤرشف — غير قابل للتوريد (تحليل الفجوة §ج) |
| Xbox Game Pass Ultimate (6) | مؤرشف — غير قابل للتوريد |
| Canva Pro (7)، Adobe Creative Cloud (11) | مؤرشف — غير قابل للتوريد |
| Microsoft 365 Personal (8)، Microsoft 365 (15) | مؤرشف — مكرر وغير قابل للتوريد |
| NordVPN 1 شهر (9) | مؤرشف — غير قابل للتوريد |
| Crunchyroll Premium (12) | مؤرشف — محذوف من التوريد سابقًا |
| Disney+ (14) | مؤرشف — **مكرر** لـ Disney+ النشط (id 3) — الدمج بالأرشفة مقرر في خطة الكتالوج |
| Shahid VIP (16) | مؤرشف — يوجد فقط كـ RESELLER لدى المورّد |
| Test Product Playwright (19)، محاكاة 94 (23) | مؤرشف — منتجات اختبار |

لا يوجد أي منتج نشط بلا تغطية بعد الدمج (45/45). **Spotify Premium** مغطى بالمدخل القديم «Spotify» عبر تطابق السلَغ `spotify-premium`.

## 4. ملاحظات للمشغّل قبل الاستيراد

1. **المستورد يكتب حقلين فقط:** `description_long` و`faq`. حقلا `meta_description` و`seo_title` في الـ JSON مصدرهما المحررون (والواجهة تولد ميتا الوصف من `seo-builders.ts`) — الاستيراد لا يمسّهما.
2. **المستورد لا يستبدل قيمًا غير فارغة** إلا مع `--force` (يدوّن «kept» لكل حقل محفوظ). المداخل الجديدة الـ 37 كلها لمنتجات «وصفها رقيق» فستُكتب مباشرة.
3. ⚠️ **حالة Disney+ القديمة (خارج نطاق هذه الجولة):** المدخل القديم بسلَغ `disney-plus` لا يطابق أي سلاَغ في القاعدة، فيسقط على مطابقة الاسم «Disney+» التي تشمل **صفين**: النشط (id 3, `disney-standard`) والمؤرشف المكرر (id 14, `disney`). مع `LIMIT 1` بلا ترتيب، قد يختار المستورد الصف المؤرشف ويتجاوز المدخل. راقب سطر Disney+ في مخرجات الـ dry-run؛ إذا ظهر «archived» فالقرار التحريري هو تحديث سلَغ المدخل القديم إلى `disney-standard` (لم يُلمس التزامًا بمبدأ «المداخل القديمة دون تغيير»).
4. المداخل القديمة الأخرى تنضم إما بالسلَغ (`spotify-premium`, `youtube-premium`, `hbo-max`, `hulu`) أو بمطابقة الاسم بالضبط (`Netflix`, `Disney+`, `Prime Video`, `Apple TV+`) — كلها أسماء فريدة في القاعدة النشطة عدا Disney+ أعلاه.

## 5. أمر الاستيراد للمشغّل (لا تشغَّل من الوكيل)

من جذر المستودع `SubNation2` وبعد توفر `DATABASE_URL` في البيئة:

```bash
# 1) Dry-run أولًا — يطبع خطة كل مدخل (APPLY / SKIP / kept) بدون كتابة شيء
pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts

# 2) بعد مراجعة الخطة — الكتابة الفعلية (معاملة واحدة، كل شيء أو لا شيء)
pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply

# (اختياري) لاستبدال قيم description_long/faq غير الفارغة قسراً:
pnpm --filter @workspace/scripts exec tsx ./src/import-seo.ts --apply --force
```

بديل بيئي: `IMPORT_SEO_APPLY=true` بدل `--apply`. المتوقع في الـ dry-run: **45 مدخلًا → 45 مطابقًا، 0 متجاوزًا** (مع ملاحظة Disney+ في §4.3).

## 6. كيف تم ضمان الجودة

- تحقق آلي لكل مدخل جديد: تطابق الاسم/السلَغ/التصنيف مع قاعدة البيانات، ترتيب المفاتيح نفس ترتيب المخطط الأصلي، طول الميتا 110–135، طول الوصف 1400–1800، 5 أسئلة بضبط مفاتيحي `question`/`answer`، عدد الكلمات المفتاحية في نطاق المداخل القديمة، كل روابط داخلية تشير لمسارات/سلاجات موجودة، ولا كلمة «رسمي» في أي وصف جديد، ولا أي ذكر لسعر رقمي.
- الملف الناتج JSON صالح (إعادة تحليل بعد الكتابة) والمحتوى القديم محفوظ بادئةً حرفية للملف الجديد.

# R96-A6 — تدقيق عميق: RTL/طباعة عربية/وصولية/جودة النصوص على الجوال

> **الوكيل:** R96-A6 (تشخيص فقط — **لم يُعدَّل أي ملف كود**)
> **النطاق:** الجوال أولًا. frontend/ بالكامل: index.html، index.css (1512 سطر، قُرئ كاملًا)، كل صفحات المتجر (storefront) + مكوناتها، lib/{utils,direction,errors,cart,transfer-code,validation,user-display}، مكونات UI (dialog/app-dialog/input/label/button/switch/sonner/status-badge)، NotificationBell/MobileNav/Navbar/Footer/ProductCard/CopyButton/WhatsAppPhoneSignIn/TopupWaitingModal/LinkConsentModal/FlashSaleBanner، hooks/{use-socket,use-toast}، App.tsx — + تحقق إمبراطوري بـ Node 24 لسلوك `Intl` مع ar-LY، وفحص bundle الـ sonner v2.0.7 الفعلي (node_modules/sonner/dist/index.mjs) للتأكد من إعلانات قارئ الشاشة.
> **المنهجية:** قراءة سطر-بسطر للملفات المالية/الهوية، مسوحات ripgrep لكل الأنماط (dir=، tracking-، toFixed، toLocaleString، aria-live، aria-label، placeholder، maximum-scale، text-justify، leading-none، أحجام 9-10px)، وحساب تباين WCAG فعلي (نسب luminance يدوية) لأزواج الألوان الحرجة في الوضعين.

---

## جدول الملخص

| #   | الشدة  | المجال        | الموقع                                                                               | الخلاصة                                                                                                                                                                        |
| --- | ------ | ------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **P1** | طباعة عربية   | index.css:1042 + 3 مواقع متجر + index.css:1356                                       | letter-spacing مطبَّق على نص عربي (tracking-wider/widest غير محمية؛ العنوان premium-toast بـ −0.005em) — يفكك اتصال الحروف                                                     |
| 2   | **P1** | نماذج/وصولية  | wallet.tsx:851-872,924-952,1090-1098                                                 | حقول مبلغ/هاتف/حساب المُرسل في مسار المال بلا label مرتبط (placeholder فقط) — عكس الإصلاح الموثق A4 P3 #37                                                                     |
| 3   | **P1** | قارئ شاشة/مال | TopupWaitingModal.tsx:144-163                                                        | قرار الشحن (اعتماد/رفض) يتبدل داخل Dialog بلا aria-live — المنطقة الحية الوحيدة (العدّاد) تُزال عند التبديل ⇒ صمت تام                                                          |
| 4   | **P1** | تباين (نهاري) | wallet.tsx:696,708; referrals.tsx:507                                                | نص تحذيري بشفافية /75 و/80 على بطاقة بيضاء ≈ **2.07-2.2:1** — فشل AA واضح في الوضع الفاتح (نهار الجوال)                                                                        |
| 5   | **P1** | طباعة عربية   | index.css:359,377-383; label.tsx:10; dialog.tsx:77; home.tsx:418                     | ارتفاع سطر عربي دون الحد (body 1.58، عناوين 1.2، Label/DialogTitle بـ leading-none، hero بـ 1.15) — ازدحام/قص الحركات                                                          |
| 6   | **P2** | أرقام         | lib/utils.ts:62,209,217; admin/risk.tsx:321,352 وآخرون                               | `toLocaleDateString("ar-LY")` بلا تثبيت `-u-nu-latn` — محركات تفتقر لبيانات ar-LY ترث جذر ar ⇒ أرقام هندية ٠١٢ (أثبت Node empirically أن ar-LY نفسها latn، لكن ar-EG تعطي ٨/٩) |
| 7   | **P2** | BIDI          | order-detail.tsx:361-364; product.tsx:536-540                                        | `delivered_extra_details` نص حر غير معزول اتجاهيًا (بيانات اعتماد LTR داخل جمل عربية تتشابك بصريًا)                                                                            |
| 8   | **P2** | لمس           | cart.tsx:214-245                                                                     | أزرار +/−/حذف في صفحة السلة ≈26-28px (p-1.5 + أيقونة 14px) — دون 44px (WCAG 2.5.5) في صفحة المال الأكثر استخدامًا بالإبهام                                                     |
| 9   | **P2** | إظهار الفعل   | order-detail.tsx:285-292                                                             | أيقونة النسخ بجوار رقم الطلب `opacity-0 group-hover:opacity-100` — غير مرئية إطلاقًا على اللمس (لا hover)؛ المستخدم لا يعرف أن الرقم قابل للنسخ                                |
| 10  | **P2** | نماذج         | support.tsx:584-625                                                                  | ثلاثة Label بلا htmlFor/Input بلا id في نموذج الدعم (تسمية بصرية فقط) — نفس نمط P1-2                                                                                           |
| 11  | **P2** | مقروئية       | ProductCard.tsx:305 (text-[9px])؛ 152 استخدامًا لـ text-[10px]                       | طباعة مجهرية عربية 9-10px في شبكة جوال عمودين — غير مقروءة عمليًا على 360px                                                                                                    |
| 12  | **P2** | تباين         | register.tsx:96; TopupWaitingModal.tsx:277; ProductCard.tsx:347                      | /80 فاتح ≈4.0-4.14:1 — إخفاق حدّي AA لنص 10-11px (حد 4.5:1)                                                                                                                    |
| 13  | **P2** | نماذج/مال     | wallet.tsx:962-964,988,1111                                                          | أخطاء تحقق الهاتف بلا id/aria-describedby وغير معلنة؛ `wallet-error` موجود كـ id لكن لا شيء يشير إليه                                                                          |
| 14  | **P2** | جودة أخطاء    | lib/errors.ts:147-175; WhatsAppPhoneSignIn.tsx:104,137                               | مسار هبوط `getErrorMessage` يعيد `err.error`/`message` خامًا — أي رسالة إنجليزية من طبقة وسيطة تظهر للمستخدم العربي كما هي (HTTP 4xx من customFetch)                           |
| 15  | **P2** | جداول أدمن    | admin/orders.tsx:896-926; users.tsx:813; risk.tsx:277; InventoryUploadDialog.tsx:389 | `<th>` بلا `scope="col"` + جداول min-w بلا container dir-aware — مسح عمودي بقارئ شاشة بلا ربط رأس/خلية                                                                         |
| 16  | **P3** | لغة محتوى     | كامل الواجهة                                                                         | لا `lang="en"` على أي مقطع لاتيني (أسماء منتجات Netflix، شارات WhatsApp/Telegram/Google/LyPay) — نطق خاطئ بقارئ الشاشة                                                         |
| 17  | **P3** | نسخ OTP       | WhatsAppPhoneSignIn.tsx:283,330,331                                                  | «(60s)» بحرف s لاتيني بدل «ث»؛ مزج «كود التحقق»/«رمز التحقق»؛ aria-label يستخدم الرقم الهندي ٦ — كسر اتفاقية الأرقام اللاتينية                                                 |
| 18  | **P3** | عملة          | register.tsx:97 «5 د.ل»                                                              | نصوص hardcoded تخالف سياسة formatCurrency (خانتان عشريتان + فواصل آلاف): admin/products.tsx:646,983، pricing.tsx:269، promotions.tsx:363                                       |
| 19  | **P3** | RTL           | wallet.tsx:278-286                                                                   | تلميد عربي داخل صندوق `dir="ltr" text-left font-mono` (حالة فراغ كود USSD) — محاذاة/اتجاه شاذ                                                                                  |
| 20  | **P3** | RTL           | profile.tsx:202                                                                      | `dir="ltr"` يلف نصًا عربيًا «حساب Telegram» (يجب أن يلف الرقم فقط)                                                                                                             |
| 21  | **P3** | اتساق UI      | NotificationBell.tsx:293-295 مقابل Navbar.tsx:225-227                                | حد الشارة 9+ مقابل 99+؛ زاوية الشارة `-left-0.5` مقابل `-right-0.5` في RTL                                                                                                     |

**العدّ: P0 = 0 · P1 = 5 · P2 = 10 · P3 = 6** (تفاصيل كل بند أدناه)

لا توجد أي P0: لا معنى مكسورًا، لا اتجاه خاطئ لبيانات مالية حرجة، ولا zoom معطّل. البنية التحتية RTL/a11y الأساسية ممتازة (انظر «المُتحقق سليمًا»)؛ ما تبقى هو طبقة تشطيب.

---

## 1) [P1] letter-spacing على النص العربي — الحماية نصف موجودة فقط

**المواقع:**

- `frontend/src/index.css:1042-1045` — الحماية الحالية تغطي الضيق فقط:
  ```css
  .tracking-tight,
  .tracking-tighter {
    letter-spacing: 0;
  }
  ```
- `frontend/src/pages/order-detail.tsx:54` — تسمية حقل الاعتماد عربية مع tracking:
  ```tsx
  <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider mb-0.5">
    {label}   // «البريد الإلكتروني» / «كلمة المرور» — عربية
  ```
- `frontend/src/pages/product.tsx:521` — نفس النمط على «بيانات الحساب» (`uppercase tracking-wider`).
- `frontend/src/pages/profile.tsx:452` — `uppercase tracking-wider` على عنوان قسم عربي.
- `frontend/src/index.css:1356` — عنوان التوست: `letter-spacing: -0.005em;` على نص عربي (negative tracking).
- للمقارنة: `admin/system.tsx:47` وثّق إصلاح 94-C2 لكل «uppercase tracking-widest» على العربي في الإدارة — **المتجر لم يُصحح**.

**لماذا P1:** letter-spacing في الخط المتصل يفكك وصلات الحروف بصريًا (تظهر الفواصل بين الحروف المتصلة ج/ح/خ والكشيدة تُعطَّل) — تشويه كتابي منهجي في كل بطاقة اعتماد (شاشة ما بعد الشراء الأهم). `uppercase` نفسه no-op على العربي (يشي بأن النمط نسخ من Latin design system دون تفكير RTL).

**الإصلاح:** وسّع الحارس في index.css:

```css
.tracking-wide,
.tracking-wider,
.tracking-widest {
  letter-spacing: 0;
}
/* أو أدق: */
[dir="rtl"] :is(.tracking-wide, .tracking-wider, .tracking-widest) {
  letter-spacing: 0;
}
```

واحذف `letter-spacing: -0.005em` من عنوان premium-toast (خطأ شكلي غير ملموس على اللاتيني، لكنه مبدأ خاطئ على العربي).

---

## 2) [P1] نموذج شحن المحفظة: حقول مسار المال بلا تسمية برمجية

**المواقع:**

- المبلغ (تحويل موبايل): `wallet.tsx:851-872` — `Input type="number"` بلا `id`/`aria-label`؛ التسمية البصرية هي `StepDot n={2} label="المبلغ بالدينار الليبي"` (wallet.tsx:834) — عنصر زخرفي غير مرتبط.
- هاتف المُرسل: `wallet.tsx:924-952` — `Input type="tel"` بلا تسمية مرتبطة؛ `placeholder="091XXXXXXX"` فقط.
- رقم الحساب (LyPay): `wallet.tsx:1090-1098` — نفس النمط.
- **التناقض داخل نفس الملف:** `PaymentReferenceField` (wallet.tsx:326-357) أُصلحت في 93-C5/F-03 بالضبط لهذا السبب («A4 P3 #37 — placeholder-only names») — `Label htmlFor={id}` + `Input id={id}` — بينما الحقول الثلاثة الأساسية بقيت كما هي.

**الأثر على الجوال:** قارئ الشاشة (TalkBack/VoiceOver) يعلن «091XXXXXXX، حقل نص» بدل «رقم هاتف المُرسل» — على النموذج الذي يحرك أموالًا. وضع التعبئة التلقائية (autocomplete) يتعطل أيضًا لغياب التسمية.

**الإصلاح:** أعطِ كل حقل `id` + `<Label htmlFor>` (حوّل StepDot إلى Label، أو أضف aria-label مؤقتًا: `aria-label="رقم هاتف المُرسل"`). ميّز `autoComplete="tel"` للحقل.

---

## 3) [P1] قرار الشحن (اعتماد/رفض) لا يُعلن لقارئ الشاشة

**الموقع:** `frontend/src/components/TopupWaitingModal.tsx:144-163`

```tsx
{status === "waiting" && <WaitingBody … />}   // العدّاد: <span aria-live="polite" aria-atomic="true">
{status === "approved" && <ApprovedBody … />} // لا aria-live
{status === "rejected" && <RejectedBody … />} // لا aria-live
```

المنطقة الحية الوحيدة هي رقم العدّاد داخل WaitingBody (السطر 211-217) — **وتُفكَّك من DOM عند التبديل**. عند اعتماد الشحن تتبدل محتويات الـ Dialog كاملة (عنوان جديد «تمت إضافة الرصيد»، مبلغ، رصيد جديد) دون أي إعلان؛ مستخدم قارئ الشاشة يسمع آخر إعلان «3… 2… 1» ثم صمتًا مطلقًا على أهم لحظة مالية في التطبيق. (Toast من use-socket يُطلق أيضًا — لكنه قد لا يصل إذا كان التبديل عبر polling الـ 3 ثوانٍ قبل حدث socket، والاثنان معًا لا يضمنان إعلان المحتوى الجديد داخل النافذة).

**الإصلاح:** على `DialogContent` (أو غلاف الحالات الثلاث): `aria-live="polite"` — أو أبسط: أعطِ `role="status"` + `aria-live="polite"` لجذر ApprovedBody و`role="alert"` لجذر RejectedBody. انتقال waiting→approved يُعلن تلقائيًا كاملًا.

---

## 4) [P1] تباين نص التحذير الشفاف في الوضع الفاتح (نهار الجوال)

**المواقع والدليل المحسوب (L = luminance نسبية، على بطاقة بيضاء `--card: 0 0% 100%` بالوضع الفاتح):**

- `wallet.tsx:708` — `text-[11px] text-status-warning/75` («أقدم طلب: …»): تحذير `hsl(38 90% 45%)` بشفافية 0.75 فوق أبيض ⇒ نسبة **≈2.07:1** (حساب: مزج غاما 0.75 ثم luminance ≈0.458 ⇒ (1.05)/(0.508)).
- `wallet.tsx:696` — نفس `/75` على «قد تُقيَّد عملية الشحن» داخل بطاقة `bg-status-warning/8`.
- `referrals.tsx:507` — `text-xs text-status-warning/80` (شارة حالة 12px) ⇒ **≈2.2:1**.
- للسياق: R94-A1 #5 أصلح `text-yellow-400` إلى رمز `--status-warning` كامل الشفافية — لكن متغيرات الشفافية الناقصة بقيت.

**الأثر:** الوضع الفاتح + شمس ليبيا + شاشة 360px = هذه النصوص شبه معدومة الرؤية، وهي تشرح قيود المال (حد الطلبات المعلقة، عمر أقدم طلب).

**الإصلاح:** احذف `/75` و`/80` من نصوص الحالة (أو استبدلها بألوان tokens نصية أغمق مخصصة: `--status-warning-text`). قاعدة عامة: الشفافية على ألوان الحالة للنص فقط لا للخلفيات.

---

## 5) [P1] ارتفاع السطر العربي دون الحد الأدنى عبر النظام

**الأدلة:**

- `index.css:359` — `body { line-height: 1.58; }` (العربي يحتاج ≥1.7 للنص الطويل؛ Readex Pro تحديدًا بمقاييس عمودية عالية).
- `index.css:377-383` — `h1..h4 { line-height: 1.2; }` (العناوين العربية بحركات/مدّات تحتاج ≥1.3 لتفادي التصاق/قص الحركات).
- `index.css:1042` + استخدامات `leading-none` على نص عربي: `ui/label.tsx:10` (كل Label في التطبيق!)، `ui/dialog.tsx:77` (DialogTitle القديم)، `home.tsx:418` — `h1 leading-[1.15] tracking-tight`، `wallet.tsx:643` (الرصيد الكبير `leading-none` — مقبول رقميًا لكنه على حافة القص مع كسر السطر `break-words`).
- `leading-relaxed` (الأكثر استخدامًا للفقرات) = 1.625 — لا يزال دون 1.7.
- الاستثناء الجيد: `AppDialog` title بـ `leading-snug` (app-dialog.tsx:124) — النمط الصحيح موجود ومُثبت في المشروع نفسه.

**الأثر على الجوال:** فقرات عربية مزدحمة عموديًا (خصوصًا `description_long` وصفحة الشروط الطويلة)، وحركات تشكيل مقصوصة/متصاقبة في العناوين الكبيرة والتسميات.

**الإصلاح (بلا لمس كل صفحة):** في index.css:

```css
body {
  line-height: 1.7;
} /* أو [lang="ar"] body */
h1,
h2,
h3,
h4 {
  line-height: 1.3;
}
```

وفي label.tsx/dialog.tsx: `leading-none` → `leading-snug`. الفرق البصري طفيف على اللاتيني، جوهري على العربي.

---

## 6) [P2] أرقام التواريخ غير مثبَّتة على latn — خطر ارتداد لأرقام هندية

**الأدلة (امبراطوري، Node 24.19.0 ICU):**

```
ar-LY date:  «8 سبتمبر 2026 في 02:30 م»   ← لاتينية ✅
ar-EG date:  «٨/٩»                          ← هندية (جذر ar الافتراضي arab)
ar-LY num:   «1.234,5»                      ← تنبيه: فواصل أوروبية إن استُخدم رقميًا!
```

- `lib/utils.ts:62` — `formatDate` يستخدم `toLocaleDateString("ar-LY")` بلا `-u-nu-latn`؛ كذلك `formatDateShort` (utils.ts:217). المشروع نفسه يعرف الحل: `formatRelativeTime` يثبّت `"ar-LY-u-nu-latn"` صراحةً (utils.ts:177-180) مع تعليق يشرح السبب («the bare "ar" CLDR default is Arabic-Indic»).
- مواقع الإدارة: `admin/risk.tsx:321,352`، `admin/risk-event.tsx:175,236`، `admin/security.tsx:340`، `CopilotHistoryView.tsx:139`، `StockoutRiskPanel.tsx:144` — كلها `toLocaleString("ar-LY")`.
- محركات/أجهزة تفتقر لبيانات ar-LY (Safari/WebView أقدم) تسقط إلى جذر `ar` ⇒ «٨ سبتمبر ٢٠٢٦» — كسر فوري لاتفاقية الأرقام اللاتينية الموثقة أعلى utils.ts («the site's established numeral language is Latin digits»).

**الإصلاح:** ثبّت `-u-nu-latn` في كل استدعاءات ar-LY للتاريخ (نسخ دقيقة كافية)، أو أضف مساعد `formatDateAr()` واحد. ملاحظة جانبية: لا تستخدم `Intl.NumberFormat("ar-LY")` للمال أبدًا (فواصل أوروبية + د.ل بنقطة زائدة) — formatCurrency الحالي بـ en-US هو الصحيح.

---

## 7) [P2] بيانات التسليم الإضافية (نص حر) بلا عزل اتجاهي

**المواقع:**

- `order-detail.tsx:361-364`:
  ```tsx
  {order.delivered_extra_details && (
    <div className="px-5 py-3.5 text-sm text-muted-foreground leading-relaxed">
      {order.delivered_extra_details}
  ```
- `product.tsx:536-540` — نفس الحقل في شاشة نجاح الشراء.

هذا الحقل يأتي من الـ enrichment/الجرد ويحمل غالبًا بيانات LTR (روابط تفعيل، أكواد PIN، خطوات «Login: user@mail.com then…») داخل جمل عربية. بلا `dir="auto"` سلوك البدي الافتراضي سيرتّب المقاطع المختلطة ترتيبًا بصريًا خاطئًا (نفس فئة الخطأ التي أصلحها التعليق عند order-detail.tsx:57-59 لحقلي email/password). الـ credentials المنظمة معزولة (dir="ltr" في CopyField — سطر 61) — الحقل الحر ليس كذلك.

**الإصلاح:** `dir="auto"` على الحاوية (يستنتج الاتجاه من أول حرف قوي — موجود سابقًا في admin/enrichment.tsx:235 كسابقة داخلية)، مع `text-align: start`.

---

## 8) [P2] أهداف اللمس في صفحة السلة دون 44px

**الموقع:** `cart.tsx:214-245` — أزرار إنقاص/زيادة/حذف:

```tsx
className = "p-1.5 …"; // + أيقونة w-3.5 (14px) ⇒ ~25×25px
```

الصفحة الأكثر تعديلًا بالإبهام (تغيير الكميات قبل الدفع). المشروع لديه أداة جاهزة `.touch-target { min-height:44px; min-width:44px }` (index.css:1135-1138) مستخدمة في Navbar/dialog/NotificationBell — لكن ليس هنا (عنصر مؤجل موثق أصلًا في جولة 94 — لم يُنفذ).
ملاحظة معيارية: WCAG 2.2 AA (2.5.8) يفرض 24px فقط — 25-28px «يمر» رسميًا؛ 44px هو Enhanced (2.5.5) وسياسة المشروع المعلنة. الخفض إلى P2 مقصود، لكنه صفحة مال.

**الإصلاح:** `p-1.5` → `p-2.5` أو أضف `touch-target` (مع محاذاة الشبكة المرافقة كي لا يقفز التخطيط).

---

## 9) [P2] فعل النسخ بجوار رقم الطلب غير مرئي على اللمس

**الموقع:** `order-detail.tsx:285-292`:

```tsx
<Copy className="w-2.5 h-2.5 opacity-0 group-hover/code:opacity-100 transition-opacity" />
```

الزر نفسه قابل للنقر ويعمل باللمس (والنسخ يُعلن عبر toast ✅) — لكن المؤشر البصري (أيقونة النسخ) يظهر فقط على hover: على الهاتف يبدو رقم الطلب نصًا عاديًا؛ الاكتشاف صدفة. في `product.tsx:505-511` الأيقونة `opacity-60` دائمًا — أفضل قليلًا لكن ضعيفة. الشارات المصاحبة «انسخ بياناتك بأمان» (order-detail.tsx:351) تخفف الأثر هنا تحديدًا؛ الصفحة الأخرى لا.

**الإصلاح:** `opacity-60` ثابتة (كما في product.tsx) أو أزل opacity-0 تحت `@media (hover: none)`.

---

## 10) [P2] نموذج الدعم: تسميات بصرية غير مرتبطة

**الموقع:** `support.tsx:584` (الفئة)، `605` (عنوان المشكلة)، `616-625` (تفاصيل المشكلة) — `<Label>` بلا htmlFor وInput/textarea بلا id. (الرد على التذكرة مغطى صح بـ aria-label — support.tsx:540.) كما أن نتيجة الإرسال/الأخطاء تعتمد على toast فقط دون role="alert" مرئي في النموذج.

**الإصلاح:** نفس وصفة PaymentReferenceField (id + htmlFor).

---

## 11) [P2] طباعة مجهرية عربية 9-10px

**الأدلة:** `ProductCard.tsx:305` — شارة الفئة `text-[9px]` في بطاقة عمودين على 360px («بث مباشر» بحروف متصلة عند ~2.6mm x-height). إحصاء ripgrep: **10 استخدامات `text-[9px]`** و**152 استخدامًا `text-[10px]`** عبر 40+ ملفًا — منها مسارات مال: أسعار مشطوبة (ProductCard.tsx:323)، عدادات (wallet.tsx:755)، تلميحات الشحن (wallet.tsx:708/352)، «نفد» (ProductCard.tsx:347). Readex Pro عند 9px عربي يفقد التمييز بين ح/ج/خ لدى كثيرين فوق 40 سنة.

**الإصلاح:** حد أدنى عملي 11px للمعلومات الوظيفية (خصم، حالة، أسعار)؛ 9-10px للزخرفة فقط (sr-only أو أرقام لاتينية قصيرة مقبولة جزئيًا). رفع شارة الفئة إلى text-[10px]/[11px] + خط 600.

---

## 12) [P2] إخفاقات حدّية /80 في الوضع الفاتح

**المواقع والنسب المحسوبة على أبيض:**

- `register.tsx:96` — `text-[11px] text-status-success/80` («ستُضاف مكافأة…») ≈ **4.0:1**.
- `TopupWaitingModal.tsx:277` — «المبلغ المُضاف» بنفس /80 ≈ 4.0:1.
- `ProductCard.tsx:347` — `text-[10px] text-muted-foreground/80` («نفد») ≈ **4.14:1**.
  كلها تحت 4.5:1 لنص صغير (فشل AA حدّي). (الوضع الداكن يمر بمريح: 5.5-5.9:1 — المشكلة فاتحة فقط.)

**الإصلاح:** /80 → كامل الشفافية أو /90 مع الحفاظ على الرموز.

---

## 13) [P2] أخطاء التحقق في المحفظة غير معلنة/غير مربوطة

**المواقع:** `wallet.tsx:962-964` — `<p className="text-xs text-destructive mt-1.5">{senderPhoneErr}</p>` بلا id/aria-describedby/role. بانرات `wallet-error`/`wallet-error-2` (988-995, 1110-1118) تحمل `role="alert"` ✅ لكن ids لا يُشار إليها من أي حقل أو زر إرسال — قارئ الشاشة على خطأ التحقق اللحظي (أثناء الكتابة) لا يعلن شيئًا؛ الخطأ المُعلن يظهر فقط عند وجود role=alert المرئي بعد submit.

**الإصلاح:** `id="sender-phone-error"` + `aria-describedby` على الحقل (وaria-invalid عند الخطأ).

---

## 14) [P2] مسارات تسريب رسائل إنجليزية خام

**الأدلة:**

- `lib/errors.ts:147-149` — `if (err.error) return err.error;` — أي `error` نصي من أي طبقة يُمرر كما هو.
- `lib/errors.ts:175` — `return message;` — رسائل Error غير معروفة (مثل `HTTP 404 Not Found` من customFetch لأن الـ regex يسقط إلا 5xx فقط — errors.ts:171).
- `WhatsAppPhoneSignIn.tsx:104,137` — `setError(data.error ?? …)` مباشرة من استجابة الخادم بلا تمرير عبر getErrorMessage: تعتمد كليًا على أن الخلفية ترسل عربيًا دائمًا في /api/auth/whatsapp/\*.
  الطبقة الأساسية ممتازة (خريطة كاملة بالعربية errors.ts:14-111 + كشف أعطال الشبكة 161-174) — الثقوب في أطراف الهبوط. سيناريو واقعي: 429 من proxy/CDM قبل الوصول للتطبيق ⇒ رسالة إنجليزية كاملة في toast عربي.

**الإصلاح:** وسّع كشف الرسائل التقنية: `/^HTTP \d{3}/` (كل الأكواد لا 5xx فقط) + قائمة بيضاء للرسائل العربية المعروفة من الخادم؛ مرّر whatsapp عبر getErrorMessage.

---

## 15) [P2] جداول الإدارة بلا scope/ارتباط رؤوس

**المواقع:** `admin/orders.tsx:896-926` (7 أعمدة `<th>` بلا scope، خلايا برموز طلبات font-mono بلا dir — مقبولة لأنها مقاطع لاتينية نقية)، `users.tsx:813+`، `risk.tsx:277` (min-w-[720px])، `InventoryUploadDialog.tsx:389`. قارئ شاشة يعلن «خلية» بدل «المبلغ، 45.00 د.ل». الإدارة سطح مكتب غالبًا (جداول hidden md:block مع بطاقات جوال موازية في orders ✅) — لذا P2 لا P1.

**الإصلاح:** `scope="col"` على كل th (تغيير ميكانيكي آمن).

---

## 16-21) نتائج P3 (مختصرة)

16. **بلا lang="en" على المقاطع اللاتينية:** شارات البطاقات «Netflix/Spotify» (home.tsx:451-463 — تحتاج `lang="en"` على `brand.latin` span، العربية موجودة sr-only ✅ مما يجعل الإضافة سهلة)، «المتابعة عبر WhatsApp» (WhatsAppPhoneSignIn.tsx:240)، «LyPay» (wallet.tsx:771)، ترجمة أسماء المنتجات. النطق العربي للحروف اللاتينية مشوه («نِتفليكس»). الإصلاح: `<span lang="en">` أو `<bdi lang="en">`.
17. **نسخ OTP:** (a) `WhatsAppPhoneSignIn.tsx:283` — «إعادة الإرسال ({cooldown}s)» ⇒ «(٦٠ ث)» خطأ مزدوج (s لاتينية + يجب «60 ث»). (b) مزج مصطلحي: placeholder «كود التحقق» (سطر 330) مقابل aria-label «رمز التحقق…» (331) — «كود/رمز» عنصر مؤجل موثق منذ جولة 93 ولم يوحَّد. (c) aria-label يستخدم «٦ أرقام» (رقم هندي) — استثناء وحيد مرصوص لاتفاقية الأرقام اللاتينية في الواجهة (باستثناء زخرفة ٤٠٤ في not-found.tsx:30 المقصودة).
18. **عملة hardcoded خارج formatCurrency:** register.tsx:97 «5 د.ل» (يخالف «5.00 د.ل» — الخانات العشرية جزء من العرف المالي المعتمد في utils.ts:17-25 ومقفل باختبارات utils.test.ts:38-58)؛ admin/products.tsx:646,983 وpricing.tsx:269-270 وpromotions.tsx:363 تستخدم `toFixed(2) د.ل` يدويًا بلا فواصل آلاف (المبالغ الكبيرة تفقد التجميع). الإصلاح: استبدال بـ formatCurrency.
19. **`wallet.tsx:278-286`:** حالة فراغ كود التحويل تعرض عربية «أدخل المبلغ لإنشاء الكود تلقائياً» داخل `dir="ltr"` + `text-left` + `font-mono` — محاذاة يسار لنص عربي وصندوق مُعلن aria-live يقرأه قارئ الشاشة بسياق LTR. الإصلاح: انقل التلميد لخارج الصندوق LTR أو اجعل الحاوية dir="auto".
20. **`profile.tsx:202`:** `dir="ltr"` يلف صفًا كاملًا يحوي «حساب Telegram» عربية (لف الرقم فقط هو الصواب — انظر السطر الموازي 246 حيث الرمز وحده داخل dir="ltr").
21. **اتساق الشارات:** NotificationBell.tsx:294 «9+» مقابل Navbar.tsx:226 «99+» (عتبات مختلفة لنفس مفهوم)؛ زاوية شارة الجرس `-left-0.5` مقابل السلة `-right-0.5` في RTL (جهتان مختلفتان لنفس النمط).

---

## البنود المُتحققة سليمة (لا تُعِد فحصها — رصيد الجولات السابقة حي)

| البند                                                                                              | الدليل                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Zoom مفعّل** — لا maximum-scale/user-scalable في أي مكان                                         | index.html:7-9 («width=device-width, initial-scale=1, viewport-fit=cover» فقط)؛ MetaTags.tsx:131-134 يعيد نفس السطر حرفيًا                                                                                                                                                                                                                                                                                                                                                  |
| **tabular-nums عالمي** + صريح على كل المال                                                         | index.css:358 (`font-variant-numeric: tabular-nums` على body) + `tabular-nums` في checkout.tsx:679,684,691 وcart.tsx:196,226,257 وorder-detail.tsx:317,321 وwallet.tsx:643,1227 وProductCard.tsx:319,323                                                                                                                                                                                                                                                                    |
| **عملة أحادية المصدر:** «د.ل» لاحقة + أرقام لاتينية + فواصل en-US + خانتان عشريتان                 | lib/utils.ts:17-25 (CURRENCY_NUMBER_FORMATTER)؛ «LYD» فقط في البيانات الآلية SEO (seo-builders.ts:102) — فصل صحيح                                                                                                                                                                                                                                                                                                                                                           |
| **BIDI على المقاطع الحرجة:** 70+ `dir="ltr"`                                                       | الاعتمادات (order-detail.tsx:60-62، product.tsx:126-127 في CopyField)، رموز الطلبات (order-detail.tsx:287، orders.tsx:357)، الكوبونات (checkout.tsx:574,609، order-detail.tsx:332)، الهواتف (WhatsAppPhoneSignIn.tsx:264، wallet.tsx:943، profile.tsx:202)، IBAN (wallet.tsx:1029)                                                                                                                                                                                          |
| **ثبات اتجاه المستند**                                                                             | lib/direction.ts (قفل وقت الإقلاع) + App.tsx:431 `useDocumentDirection("ar")` — يمنع انقلاب RTL→LTR عند unmount                                                                                                                                                                                                                                                                                                                                                             |
| **toasts تُعلن لقارئ الشاشة**                                                                      | sonner v2.0.7 dist/index.mjs:1083-1085: `<section aria-live="polite" aria-relevant="additions text" aria-atomic="false">` — تحقق مباشر في الـ bundle                                                                                                                                                                                                                                                                                                                        |
| **Sonner RTL**                                                                                     | ui/sonner.tsx:43 `dir="rtl"` + موضع top-center لا يتعارض مع MobileNav                                                                                                                                                                                                                                                                                                                                                                                                       |
| **focus-visible عالمي** (حلقة 2px صلبة)                                                            | index.css:985-992؛ Button: focus-visible:ring-2 (button.tsx:8)؛ Input: focus-visible:ring (input.tsx:21)                                                                                                                                                                                                                                                                                                                                                                    |
| **Dialogs:** مصيدة تركيز + استعادة (Radix) + زر إغلاق 44px + sr-only «إغلاق» + الزاوية الصحيحة RTL | ui/dialog.tsx:49-52؛ AppDialog: aria-modal + close aria-label (app-dialog.tsx:100,133-142) + إيقاف الإغلاق أثناء المعالجة (TopupWaitingModal.tsx:137-142)                                                                                                                                                                                                                                                                                                                   |
| **زر/شارات أيقونية مسماة**                                                                         | البحث (home.tsx:594 aria-label) — select الترتيب (home.tsx:656) — السلة بعدّ عربي كامل (Navbar.tsx:210-220) — الجرس (NotificationBell.tsx:287 + aria-expanded) — تبديل المظهر (Navbar.tsx:112) — الجلسة/القائمة (Navbar.tsx:183) — تبويبات MobileNav كلها (MobileNav.tsx:67 aria-label + aria-current) — نسخ/إغلاق في كل مكان (CopyButton.tsx:75 aria-live، dialog close، coupon X checkout.tsx:581) — إرسال الرد (support.tsx:553) — لصق OTP (WhatsAppPhoneSignIn.tsx:345) |
| **aria-live للمسارات المالية**                                                                     | أخطاء checkout (role=alert ×3: 519,531,701)، حالة الكوبون (605)، أخطاء المحفظة (989-990، 1112-1113)، كود USSD الحي (wallet.tsx:283)، عدّاد الانتظار (TopupWaitingModal.tsx:213)، حالة المخزون (product.tsx:692-693)، CopyButton (75)، RouteSkeleton (47-48)                                                                                                                                                                                                                 |
| **أحداث socket تُترجم**                                                                            | use-socket.ts:79 (statusLabel للحوالة)، 98 (formatCurrency للمبلغ) — لا enum إنجليزي يرى المستخدم                                                                                                                                                                                                                                                                                                                                                                           |
| **h1 واحد لكل صفحة**                                                                               | مسح كامل: 33 صفحة لكل منها h1 واحد (login/register بـ sr-only — login.tsx:92)                                                                                                                                                                                                                                                                                                                                                                                               |
| **Landmarks + skip-link**                                                                          | App.tsx:340-347 (تخطَّ إلى المحتوى) + main#main-content (354-356) + header/footer/nav                                                                                                                                                                                                                                                                                                                                                                                       |
| **أيقونات اتجاهية صحيحة RTL**                                                                      | back = ArrowRight (order-detail.tsx:242)، forward = ChevronLeft (Navbar.tsx:257، orders.tsx:397 بـ translate معكوس)، Send مُعكوس -scale-x-100 (support.tsx:562)، Switch بـ rtl:-translate-x-4 (switch.tsx:26)                                                                                                                                                                                                                                                               |
| **kashida/justify:** صفر استخدام text-justify                                                      | مسح ripgrep: لا نتائج ✅                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **حماية الأرقام من اهتزاز العرض**                                                                  | جميع اختبارات البدي المفحوصة («−12.00 د.ل»، «+99»، «25%»، «2 × 35.00 د.ل») تحل صحيحة في RTL: الطرح والجمع والنسبة المئوية كلها ET/ES ملتصقة بمقاطع الأرقام                                                                                                                                                                                                                                                                                                                  |
| **iOS zoom عند focus:** ممنوع تلقائيًا                                                             | input.tsx:17 `text-base` تحت md (16px) — لا تقريب iOS                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **خط عربي-قادر في mono**                                                                           | index.css:213 — «Readex Pro» داخل سلسلة font-mono (رموز مختلطة لا تسقط لخط نظام)                                                                                                                                                                                                                                                                                                                                                                                            |
| **قابلية الحركة المخفضة**                                                                          | index.css:1240-1251 مفتاح قتل شامل + 1506-1511 للتوست                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **تباين WhatsApp**                                                                                 | #054339 على #25d366 ≈5.7:1 موثق (index.css:87-92) — WhatsAppPhoneSignIn.tsx:275 يستخدمه                                                                                                                                                                                                                                                                                                                                                                                     |
| **جمع عربي للأعداد**                                                                               | formatCount بست حالات (utils.ts:27-59) — مستخدم في السلة/الطلبات/الشحن/الإحالات/الرئيسية                                                                                                                                                                                                                                                                                                                                                                                    |

---

## خطة الإصلاح المقترحة (ترتيب قيمة/جهد)

1. **دفعة CSS واحدة (P1-1 + P1-5 + P2-12 جزئي):** توسيع حارس tracking + رفع line-height العام + إزالة الشفافيات الناقصة على نصوص الحالة — تغيير index.css فقط، صفر مخاطرة منطقية.
2. **TopupWaitingModal (P1-3):** سطران (aria-live على غلاف الحالات).
3. **Wallet/support Labels (P1-2 + P2-10 + P2-13):** نمط PaymentReferenceField المعروف — نسخ ميكانيكي ×5 حقول.
4. **P1-4:** حذف `/75` `/80` من أربعة مواقع نصية.
5. **P2-6:** تثبيت `-u-nu-latn` (سطر واحد لكل موقع، أو مساعد مشترك).
6. **البقية P2/P3:** كتلة تنظيف واحدة (scope، dir=auto للحقل الحر، أهداف لمس السلة، حروف lang).

**الأولوية المطلقة للجوال:** البنود 1-4 أعلاه — كلها مرئية/مسموعة مباشرة على الهاتف في وضع النهار الفاتح مع قارئ شاشة، على مسار الشراء/الشحن.

---

_R96-A6 · 2026-09-08 · تشخيص فقط — لا تغييرات كود. كل الأرقام أعلاه قابلة للإعادة عبر الأدلة المرفقة (file:line + حسابات luminance + Node Intl)._

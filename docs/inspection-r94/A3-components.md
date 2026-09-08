# A3 — تفتيش المكوّنات المشتركة (الجولة 94)

**الوكيل:** A3 (جيش التدقيق، جولة 94) • **النوع:** قراءة فقط — لم يُعدَّل أي ملف كود.
**المنطقة:** `frontend/src/components/**` (40 ملف مكوّن + 8 اختبارات) + `frontend/src/index.css` (1502 سطر — نظام التصميم). لا يوجد `tailwind.config.*` (إعداد Tailwind v4 CSS-first عبر `@theme`).
**الاستثناءات المحترمة:** لم يُعاد الإبلاغ عن AppDialog/StatusBadge v2/اتجاه أيقونات RTL/حد focus — تم التحقق منها كـ✅ (انظر §الإيجابيات).

---

## ملخص الأرقام

| المؤشر | القيمة |
|---|---|
| ملفات مفحوصة قراءة كاملة | 48 (40 مكوّنًا + 8 اختبارات + index.css) |
| نتائج | 2 P1 عمليّة + 3 P1 جودة + 12 P2 + 14 P3 |
| أزرار/عناصر تفاعلية أقل من 44×44px | 19 موضعًا (10 في واجهة المتجر، 9 في الأدمن) |
| مواضع ألوان Tailwind خام بدل الرموز | 22 (كود فعلي، غير التعليقات) |
| مواضع `text-white` بدل `text-primary-foreground` | 7 |
| مواضع `text-primary` بدل `text-primary-text` | 20 عبر 7 ملفات |

---

## P1 — أخطاء وظيفية حقيقية

### P1-1: مُحدِّد CSS تالف يُبطل قاعدة الـcursor العالمية بالكامل
- **الملف:** `frontend/src/index.css:1003-1010`
- **الدليل:**
```css
  button:not(:disabled),
  aref],
  label[for],
  summary,
  [role="button"]:not([aria-disabled="true"]),
  [role="tab"],
  [role="menuitem"] {
    cursor: pointer;
  }
```
- **الأثر:** `aref],` ليس مُحدِّدًا صالحًا (كان المقصود `a[href],`). وفق CSS Selectors Level 3، مُحدِّد واحد غير صالح داخل قائمة **يُسقط القاعدة بأكملها** → `cursor: pointer` لا يُطبَّق على أي زر/رابط/role=button في الموقع. الدليل المرافق: **16 موضعًا** عبر المكوّنات كتبت `cursor-pointer` يدويًا كتعويض صامت (ProductCard.tsx:362، NotificationBell.tsx:467، Footer.tsx:44 …) — أي أن المكوّنات "تُصلح" عطل CSS الاسمي مكانًا مكانًا بدل إصلاح القاعدة.
- **الإصلاح:** استبدال السطر 1005 بـ`a[href],` (سطر واحد). ثم إزالة `cursor-pointer` المتفرقة تدريجيًا.

### P1-2: LinkConsentModal — نافذة يدوية ناجية من هجرة AppDialog (بلا focus trap ولا قفل تمرير)
- **الملف:** `frontend/src/components/LinkConsentModal.tsx:45-54`
- **الدليل:**
```tsx
<div
  className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
  onClick={(e) => { if (e.target === e.currentTarget && !loading) onCancel(); }}
  role="dialog" aria-modal="true" aria-labelledby="link-consent-title"
>
```
- **الأثر:** هذا overlay يدوي بالكامل (div + onClick) — الفئة نفسها التي بُني AppDialog لاستبدالها (هجرة الجولة 93 غطّت 10 نوافذ لكن هذه نجا منها، وكذلك aside الأدمن في CopilotPanel). الناقص عمليًا:
  1. **لا focus trap** — Tab بعد فتح النافذة يتجول في صفحة /login خلف الـoverlay.
  2. **لا نقل تركيز أولي** إلى النافذة ولا استرجاعه عند الإغلاق.
  3. **لا قفل تمرير** للجسم خلف الـoverlay (Radix يفعل scroll-lock تلقائيًا).
  4. الوصول بلوحة المفاتيح للنقر خارجها غير موجود (mousedown فقط)؛ Escape مُعالَج ✅ (السطر 33-39).
- **الإصلاح:** التحويل إلى `<AppDialog dismissable={!loading}>` (title="تأكيد ربط الحساب"، footer بزرّي إلغاء/تأكيد) — يحل النقاط 1-4 دفعة واحدة ويطابق النمط المُعتمد.

### P1-3: أزرار تفاعلية أقل من 44×44px في واجهة المتجر (WCAG 2.5.5/Apple HIG)
الرمز `touch-target` (min 44×44) معرَّف في index.css:1098-1101 و Navbar يستخدمه لأزراره — لكن المواضع التالية بلا حماية:

| # | الملف:سطر | العنصر | الحجم الفعلي |
|---|---|---|---|
| 1 | `AuthErrorBanner.tsx:115-122` | زر إغلاق بانر خطأ تسجيل الدخول (بلا padding إطلاقًا، أيقونة w-3.5) | **~14×14px** |
| 2 | `NotificationBell.tsx:275-293` | زر الجرس نفسه (p-2 + w-4) | 32×32 |
| 3 | `NotificationBell.tsx:421-427` | زر إغلاق اللوحة (p-1.5 + w-3.5) | 26×26 |
| 4 | `NotificationBell.tsx:412-419` | "تحديد الكل كمقروء" (px-2.5 py-1.5) | ~30×30 |
| 5 | `NotificationBell.tsx:509-515` | شريحة إجراء الإشعار (px-2.5 py-1) | ~26×26 |
| 6 | `NotificationBell.tsx:518-527` | "تحديد كمقروء" (px-2 py-1) | ~24×24 |
| 7 | `Navbar.tsx:191` | شريحة المحفظة على الجوال `h-8` (رابط قابل للنقر، mobile-only) | 32×32 |
| 8 | `ProductCard.tsx:362` | زر "أضف للسلة" على الجوال `h-9` — **CTA المال الأساسي** | 36×36 |
| 9 | `ui/app-dialog.tsx:137` | زر إغلاق كل الحوارات `h-9 w-9` | 36×36 |
| 10 | `ui/dialog.tsx:45-48` | DialogClose (أيقونة X بلا أي padding) | **~16×16px** |
| 11 | `FlashSaleBanner.tsx:125-131` | زر إغلاق الشريط (p-2.5 + w-3) | 32×32 |
| 12 | `CopyButton.tsx:36-40` | نسخ صغير (px-2 py-1 + text-xs) | ~24×24 |
| 13-19 | الأدمن: `CopilotPanel.tsx:865,881,901,908,916,928,1189` و`CopilotHistoryView.tsx:87,94` و`StockoutRiskPanel.tsx:147` | أزرار رأس اللوحة (p-1.5→26px)، حذف المحادثة (p-0.5→**14px**)، نسخ الرد (p-1→18px) | 14-26px |

- **الدليل (أسوأها):**
```tsx
// NotificationBell.tsx:421-427
<button onClick={onClose}
  className="p-1.5 rounded-lg hover:bg-secondary/70 ..." aria-label="إغلاق">
  <X className="w-3.5 h-3.5" />
</button>
```
- **الإصلاح:** إضافة `touch-target` (أو `min-h-11 min-w-11` على الجوال) لأزرار الأيقونات، ورفع `h-9`→`min-h-11` لزر السلة، وpadding 2 على أزرار الإغلاق. زر حذف المحادثة في Copilot يحتاج أيضًا `focus-visible:opacity-100` (انظر P2-9).

---

## P2 — انحراف design tokens وجودة

### P2-1: 22 موضعًا بألوان Tailwind خام في كود المكوّنات (تلطيش خاطئ في الثيم الفاتح)
الرصيد المتبقي من عنقود B6-P1-4 الموثَّق ("~13 موضعًا متبقية") — الجرد الدقيق الحالي:

| الملف | الأسطر | الألوان |
|---|---|---|
| `admin/InventoryUploadDialog.tsx` | 364, 445, 447, 473, 479, 484, 499, 504 | `text-emerald-400`, `bg-orange-500/10 text-orange-400`, `bg-blue-500/10 text-blue-400`, `bg-violet-500/10 text-violet-300`, `bg-emerald-500/10` |
| `admin/forecast/StockoutRiskPanel.tsx` | 136, 137, 156, 239, 246 | `from-orange-500/5`, `text-orange-400`, `bg-amber-500/10 text-amber-400` **و**`bg-yellow-500/10 text-yellow-400` (ثلاث درجات كهرمانية مختلفة في ملف واحد!), `text-emerald-400` |
| `admin/copilot/CopilotPanel.tsx` | 1314, 1334, 1379, 1399, 1439 | `text-amber-400`, `bg-amber-500/90 text-amber-50`, `text-emerald-400`, `bg-emerald-500/5` |
| `admin/copilot/CopilotHistoryView.tsx` | 133 | `text-amber-400` |
| `ErrorBoundary.tsx` | 57, 58, 74 | `bg-red-500/8 border-red-500/15 text-red-400`, `text-red-400/70 bg-red-500/5` |

- **الدليل (InventoryUploadDialog.tsx:444-449 — دالة StatPill):**
```tsx
: tone === "success"
  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
  : tone === "warning"
    ? "bg-orange-500/10 border-orange-500/30 text-orange-400"
```
- **الأثر:** هذه الملفات **تستورد StatusBadge بالفعل** لبعض حبّاتها (السطر 22 في StockoutRiskPanel بتعليق "93-C7 B14") لكن الجسم ترك الألوان الخام — emerald-400/orange-400 مضبوطة للثيم الداكن فقط؛ في الفاتح تفقد التباين (العطل نفسه الموصوف في تعليق NotificationBell). ملف الاختبار `status-tokens.test.tsx` يغطي TYPE_CONFIG وAuthErrorBanner فقط — الثغرات الثلاث هذه غير مغطاة.
- **الإصلاح:** استبدال منهجي: `emerald→status-success`، `orange/amber/yellow→status-warning` (و`low-stock` حيث السياق مخزون)، `blue→status-info`، `violet→status-purple`، `red→status-error/destructive`، ثم توسيع RAW_HUE في الاختبار ليمسح `src/components/**` كاملًا.

### P2-2: تباين نص فاشل على زر التأكيد الثاني في Copilot (مُسار مالي حرج)
- **الملف:** `admin/copilot/CopilotPanel.tsx:1376-1379`
- **الدليل:**
```tsx
className="flex-1 px-3 py-2 rounded-xl bg-amber-500/90 text-amber-50 text-xs font-bold ..."
```
- **الأثر:** amber-50 على amber-500/90 ≈ تباين **~1.9:1** (فشل AA حتى للنص الكبير). هذا زر "تأكيد ثانٍ — تنفيذ الآن" لتعديلات عالية الخطورة — أسوأ مكان ممكن لتباين منهار.
- **الإصلاح:** `bg-status-warning text-foreground` أو نص داكن `text-foreground` على `bg-status-warning/15 border-status-warning/30` (نمط StatusBadge).

### P2-3: `text-white` الخام على `bg-primary` في 7 مواضع بدل `text-primary-foreground`
- **المواضع:** `ProductCard.tsx:209`، `TopupWaitingModal.tsx:303,319`، `ErrorBoundary.tsx:85`، `LinkConsentModal.tsx:97`، `NotificationBell.tsx:289`، `FlashSaleBanner.tsx:76` (حالة urgent).
- **الدليل (ProductCard.tsx:209):**
```tsx
className="absolute top-2.5 right-2.5 z-10 ... bg-primary text-white text-[10px] font-black ..."
```
- **الأثر:** الرمز `--primary-foreground: 0 0% 100%` موجود حصرًا لهذا الغرض. النتيجة اليوم متطابقة بصريًا لكن أي تعديل مستقبلي للرمز (primary أفتح مثلًا) يكسر تباين 7 مواضع صامتة — انحراف "سيف بشفرتين". لاحظ أن NotificationBell.tsx:405 في نفس الملف يستخدم `text-primary-foreground` ✅ (عدم اتساق داخل ملف واحد).
- **الإصلاح:** استبدال بحث-واستبدال لسبعة أسطر.

### P2-4: `text-primary` بدل `text-primary-text` في 20 موضعًا (نص أحمر داكن 48%L على خلفيات داكنة)
- **الملفات:** `CopyButton.tsx:25,36`، `SessionManager.tsx:93,120`، `CopilotPanel.tsx:828,1024,1064,1210,1314,1404` + `InventoryUploadDialog.tsx:237,304` + `NotificationBell.tsx:280,455,459` (تلك الأخيرة على حالات hover فاتحة، أخف أثرًا) + `StockoutRiskPanel` لا شيء ✅.
- **الدليل (CopyButton.tsx:36):**
```tsx
className="... bg-primary/10 hover:bg-primary/18 text-primary text-xs font-bold ..."
```
- **الأثر:** `--primary: 348 80% 48%` مقصود للخلفيات؛ الرمز `--primary-text: 348 80% 65%` (documentation في index.css) مقصود للنص على أسطح داكنة. `text-primary` على `bg-primary/10` فوق بطاقة داكنة ≈ تباين ~3.9:1 — **فشل AA** لنص 12px bold.Navbar وProductCard وTrustCard كلها تستخدم `primary-text` صح — الانحراف في المكوّنات الثانوية.
- **الإصلاح:** استبدال `text-primary` → `text-primary-text` في سياقات نص على سطوح داكنة (20 موضعًا).

### P2-5: أزرار WhatsApp: أبيض على `#25D366` بتباين ~2:1 + hex خام
- **الملف:** `WhatsAppPhoneSignIn.tsx:231,251`
- **الدليل:**
```tsx
< MessageCircle className="w-4 h-4 text-[#25D366]" />
...
className="h-11 px-4 rounded-xl bg-[#25D366] text-white font-bold text-sm ..."
```
- **الأثر:** لمعان #25D366 ≈ 0.48 → تباين أبيض ≈ **1.97:1** (فشل AA بفارق ضخم). زر "إرسال" في مسار OTP حساس. أيضًا لون العلامة التجانية مُضمَّن hex خام خارج نظام الرموز.
- **الإصلاح:** تعريف `--brand-whatsapp` كرمز، واستخدام نص `text-foreground` (داكن) فوق `bg-[#25D366]`، أو إغماء الخلفية إلى `#1DA851` مع نص أبيض (~3.6:1) + font-black.

### P2-6: تضارب تعريفَي `.pb-safe` في index.css
- **الملف:** `frontend/src/index.css:737-739` و`1141-1143`
- **الدليل:**
```css
/* الأول (سطر 737) */          /* الثاني (سطر 1141) */
.pb-safe {                      .pb-safe {
  padding-bottom:               padding-bottom:
    env(safe-area-inset-bottom,   env(safe-area-inset-bottom);
    20px);                     }
}
```
- **الأثر:** تعريفان متعارضان لنفس الأداة في نفس @layer — الأخير يربح في المتصفحات الداعمة، لكن الفallback مختلف (20px مقابل بلا fallback). في متصفحات بلا دعم env() السلوك غير متوقع (invalid at computed-value time). يظهر أيضًا أصل تكرار: قسم "Stagger delay helpers" يحتضن pb-safe/pt-safe بلا علاقة موضوعية.
- **الإصلاح:** حذف النسخة الأولى (737-742) والإبقاء على الثانية + نقلها لقسم safe-area.

### P2-7: حد أعلى MobileNav مختفٍ في الثيم الفاتح (border أبيض خام)
- **الملف:** `layout/MobileNav.tsx:45`
- **الدليل:**
```tsx
<div className="absolute inset-0 bg-card/92 backdrop-blur-3xl border-t border-white/[0.06]" />
```
- **الأثر:** في الثيم الفاتح `--card: 0 0% 100%` → حد أبيض شفاف على خلفية بيضاء = **صفر فاصل بصري** بين شريط التنقل الثابت والمحتوى. باقي الطبقات (Navbar `border-border/35`) تستخدم الرمز الصحيح.
- **الإصلاح:** `border-t border-border/40`.

### P2-8: ثلاث منظومات حوارية حية بثلاث لغات بصرية (تكرار مفاهيمي #1)
- **الملفات:** `ui/app-dialog.tsx` (القانوني) + `ui/dialog.tsx` (مستهلكه الوحيد: TopupWaitingModal) + `ui/alert-dialog.tsx` (مستهلكه: useConfirm).
- **الدليل (الفروقات):**
```tsx
// app-dialog.tsx:87   "fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"        + bg-card, p-5, rounded-2xl/t-2xl, بوتوم-شيت جوال
// dialog.tsx:22       "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"        + bg-background, p-6, sm:rounded-lg
// alert-dialog.tsx:19 "fixed inset-0 z-50 bg-black/80 backdrop-blur-sm"        + bg-background, p-6, sm:rounded-lg
```
- **الأثر:** نفس مفهوم "نافذة مشروطة" بثلاث معالجات: شفافية overlay مختلفة (70/80/80)، سطح مختلف (`bg-card` مقابل `bg-background`)، حشو مختلف (p-5/p-6)، أنصاف أقطار مختلفة (`rounded-2xl`/`sm:rounded-lg`)، وزر إغلاق مختلف (AppDialog: RTL-flex `justify-between` + h-9؛ dialog.tsx: `absolute right-4 top-4` بلا حجم — انظر P1-3/10، وهو موضع فيزيائي right يعاكس توقع RTL).
- **الإصلاح:** ترحيل TopupWaitingModal من `DialogContent` إلى `AppDialog` (السلوك المحروس موجود أصلًا بـ`dismissable`)، ثم حذف dialog.tsx أو تحويله لغلاف رقيق فوق نفس القيم.

### P2-9: صفوف محادثات Copilot عناصر div قابلة للنقر (بلا لوحة مفاتيح) + زر حذف غير مرئي للتركيز
- **الملف:** `admin/copilot/CopilotPanel.tsx:840-870`
- **الدليل:**
```tsx
<div key={c.id}
  className={`group rounded-lg px-2 py-2 ... cursor-pointer flex ... ${
    c.id === currentId ? "bg-primary/15 border border-primary/30" : "hover:bg-muted/50 ..."}`}
  onClick={() => { setCurrentId(c.id); ... }}>
  ...
  <button onClick={(e) => { e.stopPropagation(); deleteConversation(c.id); }}
    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/20 ..." aria-label="حذف">
```
- **الأثر:** (1) div بـonClick دون `role="button"`/`tabIndex` — مستخدم لوحة المفاتيح لا يستطيع تبديل المحادثة إطلاقًا. (2) زر الحذف `opacity-0` يظهر فقط عند hover بالفأرة — لا `focus-visible:opacity-100`، فالتركيز عليه يجعله غير مرئي (Trap قاتل للوحة المفاتيح).
- **الإصلاح:** تحويل الصف إلى `<button>` كامل العرض مع span للحذف بداخله (أو `role="button" tabIndex={0}` + onKeyDown)، وإضافة `group-focus-within:opacity-100 focus-visible:opacity-100` لزر الحذف.

### P2-10: NotificationPanel — حوار يدوي عبر portal بلا focus trap ولا استرجاع تركيز
- **الملف:** `layout/NotificationBell.tsx:389-398`
- **الدليل:**
```tsx
<div ref={panelRef} tabIndex={-1} data-notification-panel="1"
  className="bg-card border ... rounded-2xl shadow-2xl ..."
  style={panelStyle} role="dialog" aria-label="الإشعارات">
```
- **الأثر:** التركيز يُنقل لللوحة عند الفتح ✅ (سطر 385-387) وEscape يعمل ✅ — لكن Tab يخرج من الحوار إلى الصفحة خلفه (بلا trap) ولا يُستعاد التركيز لزر الجرس عند الإغلاق. `role="dialog"` بلا سلوكيات الحوار المكتملة. أيضًا `zIndex: 70` أعلى من حوارات Radix (z-50) — إن فُتح حوار أثناء فتح اللوحة سيرتسم فوقه.
- **الإصلاح:** استبدال بـRadix Popover/Dialog، أو استعارة `useFocusTrap` بسيطة + `restoreFocus`، وجعل z-index مستمدًا من متغير واحد.

### P2-11: نص 7px في عدّاد FlashSaleBanner
- **الملف:** `layout/FlashSaleBanner.tsx:119`
- **الدليل:**
```tsx
<span className="text-[7px] opacity-50 leading-none">{seg.label}</span>
```
- **الأثر:** 7px عند شفافية 50% = غير مقروء فعليًا على شاشات الجوال الصغيرة (أصغر من أي حد أدنى مطبوع). الوحدات (س/د/ث) جزء وظيفي من العدّاد.
- **الإصلاح:** رفع إلى `text-[9px] opacity-70` على الأقل، أو وضع الوحدة بجانب الرقم داخل نفس السطر بحجم text-[10px].

### P2-12: استطلاع مستمر بعد الإغلاق + نص Countdown في FlashSaleBanner
- **الملف:** `layout/FlashSaleBanner.tsx:18-30`
- **الدليل:**
```tsx
useEffect(() => {
  const load = async () => { ... const d = await r.json(); if (d.flash_sale) setFlashSale(d.flash_sale); };
  load();
  const interval = setInterval(load, 60_000);
  return () => clearInterval(interval);
}, []);
```
- **الأثر:** بعد `dismissed=true` (أو `expired`) يظل المكوّن محمَّلًا يستدعي `/api/flash-sale` كل 60 ثانية إلى الأبد — بلا فائدة، ومع `refetchIntervalInBackground` غير معطّل. أثر شبكة صغير لكنه نمط.
- **الإصلاح:** `if (dismissed || expired) return;` داخل load أو تعليق interval عند التقادم.

---

## P3 — اتساق وصقل

### P3-1: مدة toast واحدة (4s) لكل الأنواع بما فيها الأخطاء المالية
- **الملف:** `hooks/use-toast.ts:62` (`duration: input.duration ?? 4000`) + `ui/sonner.tsx:38`.
- **الأثر:** خطأ "فشل الرفع" بوصف عربي طويل يختفي خلال 4 ثوانٍ؛ لا hook لتمييز destructive. (سلوك مقصود توثيقيًا ضد عطل 16-دقيقة السابق — لكن من دون حد أدنى أعلى للأخطاء).
- **الإصلاح:** `duration: input.duration ?? (variant==="destructive" ? 8000 : 4000)`.

### P3-2: NavigationProgress ينمو من اليسار في RTL
- **الملف:** `NavigationProgress.tsx:78` — `origin-left` فيزيائي. في واجهة RTL يتوقع المستخدم نموّ الشريط من اليمين (origin-right، أو `origin-inline-start` بمنطق RTL). z-[100] تحت Sonner (999999999) بلا تعارض ✅.

### P3-3: تفاوت مؤشر الحالة النشطة
- `Navbar.tsx:69` خط سفلي `bg-primary/65` مقابل `MobileNav.tsx:78` شريط `bg-primary` كامل — مسار نفسه (التنقل) بشدتين مختلفتين. توحيد إلى `bg-primary/80` أو رمز `--nav-active-indicator`.

### P3-4: fallback الجرس في Navbar بلا skeleton
- `Navbar.tsx:117` — `<div className="w-8 h-8 rounded-lg bg-secondary/30" />` كتلة صامتة بينما كل الواجهة تستخدم `skeleton-shimmer`. توحيد النمط.

### P3-5: dead token `--badge-outline`
- `index.css:111,257` معرَّف في الثيمين ولا مستهلك واحد له في المشروع كله (rg = 0 خارج index.css). حذف أو استعمال.

### P3-6: theme-color ثابت raw hex
- `seo/MetaTags.tsx:115` — `upsertMeta(..., "#e11d48")` لا يتبدل مع الثيم (primary الفاتح 348 80% 46% ≈ #D8145B قريب لكن ليس المرموز). مرشح: قيمتان بـ`media=(prefers-color-scheme)`.

### P3-7: تباين خافت لحالة "نفد" في ProductCard
- `ProductCard.tsx:217` — `text-white/55` على `bg-black/75` عند 10px bold ≈ 4.5:1 حدّي. رفع إلى `text-white/70`.

### P3-8: مخطط خطأ مزدوج المصدر في AuthErrorBanner
- `AuthErrorBanner.tsx:100-103` — info/warning من `--status-*` لكن error من `--destructive` (بينما `--status-error` موجود ومستخدم في StatusBadge). توحيد العائلة.

### P3-9: زر داخل نموذج بلا type="button"
- `WhatsAppPhoneSignIn.tsx:337` (زر "تغيير الرقم") و`CopyButton.tsx:23,34` — لو وُضع المكوّن داخل `<form>` سيرسل النموذج بدل نسخه. إضافة `type="button"`.

### P3-10: setTimeout بلا cleanup (نمط متفرق)
- `CopyButton.tsx:18`، `CopilotPanel.tsx:1170,1174`، `NavigationProgress.tsx:64` (المؤقت الداخلي غير مُتتبَّع في refs). `WhatsAppPhoneSignIn.tsx:58-62` يفعلها صح — توحيد النمط.

### P3-11: ظل بطاقة ProductCard غير متسق + مدد انتقال متضاربة
- `ProductCard.tsx:198` — `hover:shadow-2xl hover:shadow-black/40` لبطاقة منتج، بينما TrustCard:52 `hover:shadow-md`. مدد: `duration-200/220/280/300` داخل نفس الملف (197, 301, 383, 266). تثبيت سلم موحد.

### P3-12: إعادة تدوير fetch مع flash-sale رغم خاصية canceled ✅ — نسخة RSS الخاصة بالتنبيه
- `NotificationBell.tsx:136-174` — fetchAll آمن، لكن poller 60s لا يوقف عند إغلاق اللوحة (سلوك مقصود للشارة). مقبول.

### P3-13: CopilotPanel monolith 1546 سطرًا
- أكبر مكوّن في المنطقة (Conversation persistence + UI + markdown parser + preview state machine). استخراج `MarkdownLite` و`PreviewCard` لملفات خاصة يحسّن قابلية الاختبار (اختبار copilot-copy موجود بالفعل للـexported AskAnswer ✅).

### P3-14: زر إغلاق TopupWaitingModal فيزيائي right-4 داخل RTL + أزرار CTA يدوية
- `ui/dialog.tsx:45` (`absolute right-4 top-4`) — عنوان الحوار يبدأ من اليمين في RTL؛ الأصح left-4 أو start. + أزرار TopupWaitingModal.tsx:303,319,348 نسخ يدوية من زر primary (bg-primary + shadow-md) بدل `<Button>` — من نفس عائلة التكرار P2-8.

---

## تكرار مفاهيمي — الجرد الكامل (المطلوب رقم 1)

| # | المفهوم | التنفيذات المتزامنة |
|---|---|---|
| 1 | **نافذة مشروطة** | `AppDialog` (قانوني) + `dialog.tsx` (TopupWaitingModal) + `alert-dialog.tsx` (useConfirm) + `LinkConsentModal` (يدوي) + CopilotPanel aside (يدوي z-40) — **5** |
| 2 | **زر CTA أساسي** | `Button` default (gradient + shadow-md) + ProductCard (flat bg-primary + shadow-lg) + TopupWaitingModal/ErrorBoundary/LinkConsentModal (flat + shadow-md) + Copilot submit (gradient + brightness) + WhatsApp (bg-primary مباشرة) — **6 معالجات** |
| 3 | **حالة فراغ** | `admin/EmptyState` (قانوني) + NotificationBell:432 + CopilotPanel EmptyState (دالة محلية!) + StockoutRiskPanel:167 + CopilotHistoryView:111 + SessionManager:102 — **6** |
| 4 | **زر نسخ** | `CopyButton.tsx` (مكوّن عام) + `CopilotPanel AskAnswer` زر نسخ خاص بمنطق copied/failed مستقل — **2** |
| 5 | **عرض خطأ النماذج** | AuthErrorBanner (بانر بحدود) + AuthProviders:305 (نص p مجرد) + WhatsAppPhoneSignIn:347 (صندوق بحدود وحركة) — **3 في مسار auth واحد** |
| 6 | **فقاعة أيقونة مصنَّفة** | TrustCard icon-tile (w-9 rounded-xl bg-background/45) + NotificationBell row icon (w-8 rounded-xl + bg token) + InventoryUpload chips (w-2.5) — متشابهة بلا رمز مشترك |

- **سكيليتون: نمط واحد ✅** — `skeleton-shimmer` موحد في route-skeleton (كل الأصداف) + TableSkeleton + SessionManager:100 + Navbar wallet:135 (نفس الأداة). الاستثناء الوحيد fallback الجرس (P3-4).
- **Toast: موحّد ✅** — shim واحد فوق Sonner بـToaster واحد؛ إصلاح عطل 16-دقيقة موثَّق داخل use-toast.ts.

---

## الإيجابيات المتحقَّقة (ضد قائمة "ممنوع إعادة الإبلاغ")

1. **AppDialog** ✅ — focus trap/aria/scroll-lock من Radix، حرس `dismissable` موحد (ESC/backdrop/زر)، max-h-[85vh]، جسم واحد للتمرير، مستهلك في SessionManager confirm وInventoryUploadDialog. اختبارات app-dialog.test.tsx حاضرة.
2. **StatusBadge v2** ✅ — 8 نغمات كلها على `--status-*`، STATUS_TONE موحد، أيقونة aria-hidden. (مواضع الخام في P2-1 خارج المكوّن نفسه).
3. **اتجاه أيقونات RTL** ✅ — Send `rtl:-scale-x-100` (CopilotPanel:989)، ChevronLeft للأمام (Navbar:253، StockoutRiskPanel:258)، سويتش `rtl:-translate-x-4` (switch.tsx:26) مع اختبار switch-rtl.test.tsx.
4. **حد focus المرئي** ✅ — `:focus-visible` بـoutline 2px صلب ring + offset (index.css:960-966) — يتجاوز 2.4.11.
5. **MobileNav** ✅ — عقد ارتفاع MOBILE_NAV_HEIGHT/--mobile-nav-h بمؤكِّد اختبار (mobile-nav-clearance.test.tsx)، safe-area عبر env() على الحاوية، aria-current، خمس مسارات بمطابقة prefix صحيحة.
6. **ProductCard** ✅ — زر سلة حقيقي (لا div زائف)، aria-label مركّب، تحميل LCP eager لأول 4 صور + fetchpriority، alt وصفي مولَّد، memo بمقارن كامل الحقول.
7. **SEO** ✅ — MetaTags upsert بلا تراكم + JsonLd مع escape وcleanup — إصلاح V3-A1 موثَّق.
8. **Toaster** ✅ — ثيم من `useTheme` التطبيقي (لا OS)، dir=rtl، visibleToasts=3، closeButton.

---

## إحصاء أحجام اللمس — الخلاصة
19 عنصرًا تفاعليًا < 44×44px (10 متجر / 9 أدمن). أخطرها: إغلاق AuthErrorBanner (~14px)، إغلاق dialog.tsx (~16px)، حذف محادثة Copilot (~14px)، جرس الإشعارات (32px)، زر السلة (36px).

## التوصية بالترتيب
1. إصلاح `aref],` (سطر واحد — أعلى مردود/جهد في التقرير كله).
2. LinkConsentModal → AppDialog.
3. جولة tokens: 22 خام + 7 text-white + 20 text-primary + زر Copilot amber (يمكن آليتها بـcodemod واحد).
4. touch-target sweep للـ10 مواضع المتجر.
5. توحيد dialog.tsx→AppDialog ثم حذف الثالثة الزائدة.

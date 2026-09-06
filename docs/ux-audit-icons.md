# تدقيق اتجاه الأيقونات — التطبيق الموحّد (RTL دائم)

> **تاريخ التدقيق:** 2026-09-06 | **المرجع:** `subnation-ux-world-class-plan-2026-09-06.md` القسم 4
> **الحالة:** ✅ نُفِّذ وأُصلح — بانتظار التحقق الحي (انظر نهاية الملف)

## القرار الموحّد المعتمد (مُتَّخذ مرة واحدة، مطبَّق في كل مكان)

التطبيق **RTL عربي دائم بلا وضع LTR بديل** (تحقُّق: `useDocumentDirection("ar")` في `App.tsx` يقفل الاتجاه عند الإقلاع؛ لا i18n ولا نظام لغات). لذلك اعتُمدت القواعد التالية حرفياً بلا شرطية `rtl:`:

| الدلالة | الاتجاه البصري الصحيح | التنفيذ المرجعي |
|---|---|---|
| **رجوع / السابق / العودة** | الأيقونة تشير **يميناً** | `ArrowRight` أو `ChevronRight`، أو `ArrowLeft/ChevronLeft` مع `rotate-180` ثابت |
| **التالي / المتابعة / رابط أعمق (عرض التفاصيل، الذهاب لصفحة أعمق)** | الأيقونة تشير **يساراً** | `ArrowLeft` / `ChevronLeft` |
| **فاصل مسار التنقّل (breadcrumb)** | يشير **يميناً** (العنصر الأعمق على اليسار، الأب على اليمين) | `ChevronLeft rotate-180` |
| **مُفتاح توسيع/طي (accordion/dropdown)** | غير اتجاهي — يدور عند الفتح | `ChevronDown` أو `ChevronLeft` مع `group-open:-rotate-90` |
| **روابط خارجية** | محايد | `ExternalLink` |

**حركات hover الاتجاهية:** حركة "التقدّم" في RTL تسار يساراً (`translate-x-[-2px]` / `-translate-x-0.5`)، وحركة "الرجوع" تسار يميناً (`translate-x-0.5`). أي حركة تخالف سهمها = خلل.

## جرد الاستخدامات (أشمل من الـ18 في الخطة — الجرد الكامل وجد 30+ موضعاً)

| # | الملف:السطر | الأيقونة | الدلالة | الحكم قبل الإصلاح | الإجراء |
|---|---|---|---|---|---|
| 1 | `pages/admin/tickets.tsx:305` | ChevronLeft | فتح تذكرة (أعمق) | ✅ صحيح (يسار) | — |
| 2 | `pages/admin/tickets.tsx:323` | ChevronLeft `rotate-180` + "العودة" | رجوع | ✅ صحيح (يمين) — نمط مسموح في القرار | — |
| 3 | `pages/admin/risk-event.tsx:144,166` | ArrowRight + "رجوع لقائمة الأحداث" | رجوع | ✅ صحيح (يمين) — النمط المرجعي للرجوع | — |
| 4 | `pages/product.tsx:453` | ArrowRight + `group-hover:translate-x-0.5` | العودة للكتالوج | ✅ صحيح (يمين + حركة يمين) | النمط المرجعي |
| 5 | `pages/order-detail.tsx:144,166` | ArrowRight (+ hover يمين) | رجوع | ✅ صحيح | — |
| 6 | `pages/orders.tsx:349` | ChevronLeft + `group-hover:translate-x-[-2px]` | رابط أعمق (تفاصيل الطلب) | ✅ صحيح (يسار + حركة يسار) | — |
| 7 | `pages/home.tsx:300,337` | ChevronLeft | "عرض الكل" / صف طلب → أعمق | ✅ صحيح | — |
| 8 | `pages/home.tsx:434` | ArrowLeft | "تسجيل الدخول" (تقدّم) | ✅ صحيح | — |
| 9 | `components/layout/NotificationBell.tsx:50,67,76,85` | ArrowLeft ×4 | أزرار إجراء "اذهب للتفاصيل" (تقدّم) | ✅ صحيح — **النمط المرجعي المعتمد** | أُضيف fallback للطلبات بلا رابط (`/orders`) |
| 10 | `components/layout/FlashSaleBanner.tsx:93` | ArrowLeft | "اذهب للعرض" (تقدّم) | ⚠️ الاتجاه صحيح لكن الرابط كان `/` بدل `/flash-sales` | ✅ أُصلح الرابط |
| 11 | `pages/terms.tsx:203` | ChevronLeft | فاصل breadcrumb | ❌ **خاطئ** — كان يشير يساراً (مخالف لقرار "الفاصل يميناً") | ✅ أُضيف `rotate-180 opacity-50` |
| 12 | `pages/category.tsx:180` | ChevronLeft `rotate-180` | فاصل breadcrumb | ✅ صحيح (يمين) | — |
| 13 | `pages/category.tsx:163` | ChevronLeft | "العودة للرئيسية" (رجوع) | ❌ **خاطئ** — كان يشير يساراً | ✅ أُضيف `rotate-180` |
| 14 | `pages/category.tsx:240` | حرف نصي "→" | "تصفّح كل المنتجات" (تقدّم) | ❌ **خاطئ** — سهم يشير يميناً + خطر إعادة تموضع bidi | ✅ استُبدل بـ`ChevronLeft w-3 h-3 inline` |
| 15 | `pages/not-found.tsx:56` | ArrowLeft | "الصفحة السابقة" (رجوع = history.back) | ❌ **خاطئ** — كان يشير يساراً | ✅ استُبدل بـ`ArrowRight` |
| 16 | `pages/admin/dashboard.tsx:404` | ArrowUpRight | KPI "اذهب" (تقدّم) | ❌ **خاطئ** — يشير أعلى-يمين | ✅ استُبدل بـ`ArrowUpLeft` |
| 17 | `pages/admin/orders.tsx:522` | ChevronRight `rotate-90` | فتح قائمة "تغيير الحالة" | ⚠️ يعمل لكنه مربك دلالياً في RTL | ✅ استُبدل بـ`ChevronDown` صريح |
| 18 | `pages/admin/layout.tsx:560` | ChevronRight (+rotate-180 عند الطي) | مُفتاح طي الشريط الجانبي (يمين الشاشة) | ✅ صحيح — rotator موضعي | — |
| 19 | `pages/admin/system.tsx:1432` | سهم نصي "←" | "عرض الكل" (تقدّم) | ⚠️ الاتجاه صحيح (يسار) لكنه نصي لا أيقونة | ✅ استُبدل بأيقونة `ChevronLeft` |
| 20 | `components/admin/forecast/StockoutRiskPanel.tsx:253` | ChevronLeft (مغلق) / ChevronDown (مفتوح) | مُفتاح توسيع صف | ✅ لغة بصرية مطابقة للأكورديونات (يسار مغلق → أسفل مفتوح) | — |
| 21 | `pages/support.tsx:285` | ArrowRight | زر إرسال رد (action) | ✅ محايد/صحيح | — |
| 22 | `pages/support.tsx:672,701` | ChevronLeft (+ `group-open:-rotate-90` في 701) | رابط أعمق / أكورديون FAQ | ✅ صحيح | — |
| 23 | `pages/profile.tsx:271` | ChevronLeft | رابط أعمق | ✅ صحيح | — |
| 24 | `pages/referrals.tsx:200,436` | ChevronLeft / ArrowLeft | تقدّم/أعمق | ✅ صحيح | — |
| 25 | `pages/loyalty.tsx:298` | ChevronLeft | رابط أعمق | ✅ صحيح | — |
| 26 | `pages/category.tsx:272` + `system.tsx:370` | ChevronLeft + `group-open:-rotate-90` | أكورديونات | ✅ rotator سليم — النمط المرجعي للأكورديون | — |
| 27 | `pages/home.tsx:571` | ChevronDown | سهم قائمة فرز | ✅ rotator | — |
| 28 | `Send` في `CopilotPanel:978` + `tickets:445` | Send (غير معكوس) | إرسال | ⚠️ ثانوي — أيقونة الإرسال التقليدية مقبولة عالمياً | مؤجَّل (بند تحسين لا خطأ) |
| 29 | `ExternalLink` متعددة | روابط خارجية | محايد | ✅ | — |
| 30 | `pages/product.tsx:453` (hover) | `group-hover:translate-x-0.5` | حركة رجوع | ✅ الحركة تُتابع السهم يميناً | — |

**بوابات أخرى فُحصت ولم يُعثر فيها على أيقونات اتجاهية:** cart.tsx, checkout.tsx, wallet.tsx, flash-sales.tsx, status.tsx, ProductCard.tsx, not-found (بعد الإصلاح).

## ملاحظات إضافية من التدقيق

- **تعارض breadcrumb كان حقيقياً:** category.tsx (يمين) ضد terms.tsx (يسار) — حلّه القرار الموحّد (يمين) + إصلاح terms.
- **النمط المرجعي المعتمد للرجوع:** نمط product.tsx/risk-event.tsx (`ArrowRight` + hover يمين + نص "العودة…"). نمط tickets (`ChevronLeft rotate-180`) مسموح أيضاً حرفياً بالقرار.
- **القرار مطبَّق بلا استبدال نصي أعمى:** ميِّزنا الأكورديونات والروتيتورس (26, 27, 20, 18) عن الأسهم الدلالية، والإرسال والروابط الخارجية عن الاتجاهية.

## التحقق الحي (يُستكمل بعد النشر)

| البند | الحالة | الدليل |
|---|---|---|
| not-found: السهم السابق يشير يميناً | ⏳ بانتظار النشر | لقطة 375px |
| category breadcrumb يشير يميناً | ⏳ | لقطة |
| terms breadcrumb يشير يميناً | ⏳ | لقطة |
| dashboard KPI: ArrowUpLeft | ⏳ | لقطة 1440px |
| FlashSaleBanner يذهب لـ/flash-sales | ⏳ | نقر فعلي |

# تدقيق UX — لوحة تحكم الأدمن (21 صفحة + مكونات الأدمن)

> **تاريخ:** 2026-09-06 | **المصدر:** خطة `subnation-ux-world-class-plan-2026-09-06.md` الفريق 3
> **المنهجية:** قراءة كاملة للـ21 صفحة أدمن + مكونات الأدمن (~15,900 سطر) عبر وكيل تدقيق مخصص، ثم إصلاح مركّز.
> **الحالة:** ✅ الإصلاحات منفَّذة ومتحقَّق محلياً — التحقق الحي بعد النشر.

## مصفوفة الجداول (قبل → بعد)

| الصفحة | جدول؟ | TableSkeleton قبل | الحالة الآن |
|---|---|---|---|
| orders.tsx | نعم (جدول حقيقي + بطاقات جوال) | ✅ كان يستخدمه | ✅ (مرجع) — ChevronRight rotate-90 → **ChevronDown** صريح |
| users.tsx | نعم | ✅ | ✅ (مرجع) |
| coupons.tsx | نعم (شبكة div) | ✅ لكن `zebra=false` بينما الصفوف الحية مخططة | ✅ النموذج مُوثَّق؛ **modal الإنشاء أُضيف له max-h-[90vh] + تمرير** |
| referrals.tsx | نعم | ✅ | ✅ (مرجع) |
| **risk.tsx** | نعم | ❌ نص "جاري التحميل…" فقط + chrome منحرف + **لا overflow-x-auto ولا بطاقات جوال** | ✅ **أُعيد بناؤه بالكامل:** chrome قياسي (bg-card border-border/60 rounded-2xl) + `overflow-x-auto` + `min-w-[720px]` + حبيبات/zebra + `TableSkeleton` + `EmptyState` + **قائمة بطاقات جوال** (مطابقة لنمط orders/users) |
| topups.tsx | لا (بطاقات — استثناء موثَّق) | TopupCardSkeleton خاص | ✅ بقي — **flex-wrap لصف الإجراءات** (كان يفيض أفقياً على 375px) |
| tickets.tsx | قائمة split-pane | skeleton يدوي مناسب | ✅ أزرار إغلاق/إعادة فتح: **حالة in-flight** (spinner + disabled + toast نجاح/فشل) |
| باقي الصفحات | بطاقات/لوحات | حسب الشكل | راجع "المتبقي" أدناه |

## فلاتر/بحث — الاتساق

النمط المرجعي: **tab-strip حالة + بحث فوري** (orders.tsx: فوري client-side + اختصار `/` + عدّاد). الانحرافات الموثَّقة:
- topups/tickets/coupons: لا بحث نصي رغم عرض هواتف/أكواد (موصى به لاحقاً)
- security.tsx: `<select>` أصلية — الصفحة الوحيدة خارج نمط chips/tabs (موثَّق)
- users.tsx: فلترة خلف لوحة قابلة للطي (انحراف تفاعلي موثَّق)
- **layout.tsx ⌘K:** تلميح "↵ اختيار" بلا تنفيذ لوحة مفاتيح فعلي — موثَّق كمتبقٍّ

## قابلية الاستخدام على 375px — الإصلاحات المنفَّذة

| الملف:السطر | المشكلة | الإصلاح |
|---|---|---|
| **risk.tsx** (الجدول كله) | 7 أعمدة بلا تمرير أفقي — تُسحق على 375px | overflow-x-auto + min-w + **بطاقات جوال md:hidden** |
| **topups.tsx:603** | صف إجراءات (تحديد الكل + موافقة جماعية + رفض + 4 تبويبات) بلا `flex-wrap` | ✅ `flex-wrap` |
| **alerts.tsx:490** | أزرار حذف/تعيين مقروء `opacity-0 group-hover:opacity-100` — **غير مرئية على اللمس** | ✅ `opacity-100 sm:opacity-0 sm:group-hover:opacity-100` |
| **CopilotPanel:1166** | زر نسخ hover-only — نفس المشكلة | ✅ نفس الحل |
| **coupons.tsx:247** | modal بلا max-height — يقصّ على شاشات قصيرة | ✅ `max-h-[90vh] flex flex-col` + تمرير للنموذج |
| **admins.tsx:528** | DialogShell بلا تمرير | ✅ `max-h-[90vh] overflow-y-auto` |

## الأيقونات (التفصيل الكامل في docs/ux-audit-icons.md)

- **dashboard.tsx:404** — KPI "اذهب" كان `ArrowUpRight` (يسار = تقدّم في RTL) → **`ArrowUpLeft`** ✅
- **admin/orders.tsx:522** — `ChevronRight rotate-90` "تغيير الحالة" → **`ChevronDown`** ✅
- **system.tsx:1432** — سهم نصي "←" → أيقونة `ChevronLeft` ✅
- **layout.tsx:560** (طي الشريط) + **StockoutRiskPanel:253** (موسّع صف) — rotators موضعية سليمة، حُفظت

## التنقّل في الشريط الجانبي — إصلاحات layout.tsx

| المشكلة | الإصلاح |
|---|---|
| المطابقة exact فقط (`location === item.href`) → `/admin/risk/events/:id` و`/admin/products/enrichment` **لا يضيئان أبداً** | **أطول مطابقة prefix** (`computeActiveHref`) — البند الأكثر تحديداً يضيء (enrichment يضيئ بنده، risk-event يضيء "مراقبة المخاطر") |
| PAGE_TITLES ناقصة: `/admin/risk`, `/admin/risk/events/:id`, `/admin/products/enrichment` → الشريط العلوي يظهر "الإدارة" فقط | ✅ أضيفت الثلاثة (مع fallback لسطر تفاصيل الحدث) |
| **`/admin/security` صفحة يتيمة** — موجودة في المسارات والعناوين لكن غائبة عن NAV_SECTIONS (وصول URL فقط!) | ✅ أضيفت لقسم "النظام" (أيقونة ShieldAlert، نطاق صلاحيات admins — نطاق موجود في PERMISSION_SCOPES) |

## حالات التحميل/الإجراءات

| البند | الإصلاح |
|---|---|
| **dashboard.tsx** — بث الطلبات الأخيرة: `isLoading` غير مفكَّك → ومضة "لا توجد طلبات" قبل وصول البيانات | ✅ skeleton صفوف (5) قبل الفراغ |
| **tickets.tsx** — إغلاق/إعادة فتح بلا حالة in-flight (خطر نقر مزدوج على PATCH) + بلا toast نجاح | ✅ `statusBusy` + spinner + disabled + toast نجاح/فشل |
| **products.tsx InlineStockEdit** — `catch(() => {})` صامت: **فشل تعديل المخزون يبدو نجاحاً** | ✅ فحص res.ok + toast نجاح/فشل مع رسالة الخطأ |
| **topups.tsx جماعي** — toast نجاح غير مشروط حتى عند فشل كلي ("✓ تمت الموافقة 0/N" بجانب toast الخطأ) | ✅ toast النجاح فقط عند successCount>0 + variant success |
| **pricing.tsx** — تعليق يدّعي debounce لكن **POST لكل ضغطة مفتاح** فعلياً (React batching لا يجمّع effects) | ✅ debounce حقيقي 300ms عبر ref |
| plain-text loading (بدون skeleton) في: risk.tsx (أُصلح)، risk-event.tsx، enrichment.tsx، security.tsx، admins.tsx، whatsapp.tsx؛ StockoutRiskPanel يرجع null أثناء التحميل | موثَّق كمتبقٍّ (أولوية منخفضة — ليست جداول) |
| EmptyStates يدوية تتجاوز EmptyState في: tickets, alerts, admins, enrichment, whatsapp, security | موثَّق كمتبقٍّ |

## ما حُفظ عمداً (أنماط مرجعية ممتازة)
- orders/users/referrals/coupons: TableSkeleton + chrome قياسي + حالات in-flight مع idempotency keys — **المرجع**
- استثناء topups (TopupCardSkeleton) موثَّق أصلاً في TableSkeleton.tsx وصحيح الشكل
- drawer الجوال في layout.tsx (يمين-مرساة، 85vw) — سليم RTL
- InventoryUploadDialog: نموذج مثالي (معاينة حية، drag-drop، ESC، bottom-sheet جوال)
- CopilotPanel/settings/system: أنماط تحميل وتقدّم ممتازة

## المتبقي (موصى به، لم يُنفَّذ في هذه الجولة لتقييد نطاق UX)
1. بحث نصي لـ topups/tickets/coupons (النمط المرجعي orders.tsx)
2. توحيد security.tsx من select أصلية إلى chips
3. GlobalSearch: تنفيذ ملاحة لوحة مفاتيح (↑↓ Enter) أو إزالة تلميح "↵"
4. مكون back-link موحَّد واحد (نمط risk-event/ArrowRight) بدل 4 أنماط
5. توحيد أحجام عناوين h1 الصفحات (text-lg/xl/2xl حالياً) + إزالة ازدواجها مع PAGE_TITLES
6. skeleton لأنماط البطاقات غير الجدولية (الصفحات الست أعلاه)
7. Send icons معكوسة RTL في copilot/tickets (`-scale-x-100`) — تحسين جمالي

## التحقق الحي (يُستكمل بعد النشر)

| # | البند | مقاس | الحالة |
|---|---|---|---|
| 1 | risk.tsx: بطاقات جوال على 375px + جدول قابل للتمرير على 768 | 375/768 | ⏳ |
| 2 | أزرار التنبيهات ظاهرة على اللمس (375px) | 375 | ⏳ |
| 3 | صف إجراءات topups لا يفيض أفقياً | 375 | ⏳ |
| 4 | nav: risk-event يضيء "مراقبة المخاطر" + security ظاهرة في القائمة | 1440 | ⏳ |
| 5 | KPI cards: السهم أعلى-يسار | 1440 | ⏳ |
| 6 | modal كوبونات قابل للتمرير على شاشة قصيرة | 375×600 | ⏳ |

# تفتيش A2 — صفحات الأدمن (الجولة 94)

**الوكيل:** A2 (تفتيش قراءة فقط — لم يُعدَّل أي ملف كود)
**المنطقة:** `frontend/src/pages/admin/**` (21 صفحة) + `frontend/src/components/admin/**` (6 مكوّنات) + تحقق خلفي من 6 مسارات API (`backend/src/routes/admin/{orders,users,products,topups,tickets,alerts}.ts`)
**الملفات المفحوصة:** 27 ملف واجهة قراءة سطرية كاملة (~17.2k سطر) + 6 ملفات خلفية للتحقق.
**المنهج:** قراءة سطرية كاملة لكل صفحة، تتبّع الأنماط العابرة للصفحات (false-empty، الترقيم، letter-spacing على العربية، 401، unsafe JSON parse)، والتحقق من كل ادّعاء باقتباس من الخلفي عند الحاجة.

**مستثنى من التقرير (مُصلَح في 92/93 ولم يُعاد إبلاغه):** حوارات التأكيد المالي بمعاينة، AppDialog في enrichment/coupons، StatusBadge v2 (والبقايا الموثّقة في `lib/utils.ts:128-136` كمتابعة معلنة)، بطاقات الخطأ في orders/users/topups/tickets/referrals/coupons/admins، 401→إعادة دخول في الصفحات التي تستخدم `isAdminUnauthorized`، ترقيم الطلبات، formatRelativeTime، TableSkeleton، اتجاه أيقونات RTL.

---

## P1 — نتائج حرجة

### P1-1) عائلة «قوائم مقيّدة بلا ترقيم + إجماليات كاذبة» — topups/users/alerts/tickets
جولة 93 أصلحت هذا النمط للطلبات فقط (A5 O-1). الصفحات الأربع التالية ما زالت تعرض «إجمالاً» على شريحة مقيّدة، وبدون أي تحكم ترقيم:

- **`pages/admin/topups.tsx:767`** — `<span>{allTopups.length} طلب إجمالاً</span>` بينما الخلفي يقصّ نهائيًا عند 100 بلا معامل `page` إطلاقًا:
  ```ts
  // backend/src/routes/admin/topups.ts:50
  .limit(100);
  ```
  **الأثر:** طابور المال — طلبات شحن معلقة أقدم من آخر 100 **غير مرئية نهائيًا** من الواجهة، وشارة `pendingTopups` في الشريط الجانبي تأتي من `/admin/stats` (إجمالي الخادم الحقيقي) فتظهر «250 معلق» بينما الصفحة تعرض 100 فقط و«موافقة الكل» تعالج المئة الظاهرة — تناقض عدد صريح. المستخدم #101 بانتظار موافقته لا وجود له في الطابور.
- **`pages/admin/users.tsx:477-478`** — `label: "إجمالي المستخدمين", value: users.length` بينما الخلفي يدعم `page/limit` (قُيِّم عند 1..200، افتراضي 100 — `routes/admin/users.ts:17-21`) والواجهة لا ترسل أيًّا منهما: بطاقات «إجمالي الأرصدة/إجمالي الإنفاق/متوسط الإنفاق» (سطور 485-507) تحسب أول 100 مستخدم فقط وتقدّمها كإجماليات، والمستخدمون الأقدم لا يمكن الوصول إليهم إلا بالبحث الهاتفي.
- **`pages/admin/alerts.tsx:573`** — `{alerts.length} تنبيه إجمالاً` بينما `DEFAULT_LIMIT=50` (`routes/admin/alerts.ts:19`) والاستجابة تتضمن `total` و`hasMore` (سطور 77-87 خلفيًا) **يتجاهلهما النوع المعلن** `{ alerts; unreadCount }` (سطر 131-134) — تبويبات الفلاتر وعدّاداتها كلها مشتقة من الخمسين المحمّلة.
- **`pages/admin/tickets.tsx:259`** — نفس القصة مع `.limit(100)` خلفيًا (`routes/admin/tickets.ts:31`) و`{visibleTickets.length} / {tickets.length} تذكرة`.

**الإصلاح المقترح:** (أ) topups: أضف `page` خلفيًا كنظير orders.ts ثم مرّر `page/limit` من الواجهة مع تحكم «السابق/التالي» بعطب `hasNextPage = length === PAGE_SIZE` (نسخ نمط orders.tsx:1117-1147). (ب) users: أرسل `page` (مدعوم فعلًا) وأضف الترقيم + بطاقة «الإجمالي الحقيقي» من مسار عدّ منفصل أو اجعل التسمية «أول 100». (ج) alerts: اقرأ `total/hasMore` من الاستجابة واعرضهما، وارفع الحد أو رقّم. (د) tickets: كما topups.

### P1-2) products.tsx — فشل تحميل القائمة يقنّع نفسه كـ«لا توجد منتجات» (false-empty نجا من موجة R93)
`pages/admin/products.tsx:189-192`:
```ts
const {
  data: products = [],
  isLoading,
  refetch,
} = useListAdminProducts(undefined, { ... });
```
لا `isError` ولا `error` مُستخلَصان، والشجرة الشرطية (سطر 791-792) `filtered.length === 0 → <EmptyState icon={Package} title="لا توجد منتجات" />`. انقطاع/401/500 أثناء التحميل ⇒ المصفوفة تسقط إلى `[]` ⇒ **كتالوج فارغ كاذب** — نفس صنف A5 S-2 الذي أُصلح في 7 صفحات أخرى وتخطّى هذه. أثناء عطل، المشغّل يظن أن كل المنتجات اختفت.
**الإصلاح:** استخلص `isError, error` وطبّق صناديق referrals.tsx:375-394 (بطاقة خطأ + زر إعادة محاولة) وشريط التحديث الفاشل فوق البيانات القديمة.

---

## P2 — نتائج مهمة

### P2-1) security.tsx — الصفحة الأقدم بلا معالجة أخطاء: `console.error` فقط + فراغ كاذب
`pages/admin/security.tsx:57-59` و`74-78`:
```ts
} catch (error) {
  console.error("Failed to fetch stats:", error);
}
```
كلا الدالتين تبتلع الفشل بالكامل: `stats` تبقى null (تختفي البطاقات بصمت) و`activities` تبقى `[]` ⇒ `EmptyState title="لا توجد أنشطة"` (سطر 218-219) — فراغ كاذب. لا `isAdminUnauthorized` ولا `getErrorMessage` ولا حالة `loadError`. جلسة منتهية منتصف العمل تظهر «لا توجد أنشطة» بدل إعادة الدخول. (حراسة App.tsx:175-196 تحمي حالة الخروج فقط.)
**الإصلاح:** تبنَّى نمط referrals.tsx حرفيًا (loadError + بطاقة خطأ + banner) + `isAdminUnauthorized` في كلا الفيتشين.

### P2-2) orders.tsx — بحث/تصفية على جهة العميل فوق بيانات مقسّمة صفحات: الطلب القديم «غير موجود» كذبًا
`pages/admin/orders.tsx:317-324` يرشّح محليًا:
```ts
const filtered = search
  ? byDate.filter((o) => o.order_code?.toLowerCase().includes(search.toLowerCase()) || ...)
```
بينما الخلفي يدعم بحثًا خادميًا فعليًا (`routes/admin/orders.ts:25-33`: `// V4: the admin command palette sends ?search=` مع LIKE على order_code/phone/email/name). البحث يشمل **آخر 100 طلب فقط** — طلب أقدم ⇒ «لا توجد طلبات» + «مسح الفلاتر» (فراغ كاذب مضلِّل) والوصول إليه يتطلب تصفّح صفحة صفحة يدويًا. عدّادات `STATUS_FILTERS` (سطر 716) كذلك محلية لكل صفحة.
**الإصلاح:** مرّر `search` و`status` إلى `useListAdminOrders` (الخلفي جاهز) مع debounce كما في users.tsx:156-159، وأبقِ `dateRange` محليًا أو أضفه للخادم.

### P2-3) layout.tsx GlobalSearch — سباق استجابات + نتيجة النقر تفقد الاستعلام + تلميح كاذب
`pages/admin/layout.tsx:269-292`:
```ts
const timer = setTimeout(() => {
  setLoading(true);
  Promise.all([
    fetch(`/api/admin/orders?search=${encodeURIComponent(q)}`, { headers })
      .then((r) => r.json()).catch(() => []),
    ...
```
- **لا AbortController ولا حارس تسلسل**: كتابة "abc" ثم "abcd" ⇒ طلبان متداخلان؛ إن حلّ الأقدم أخيرًا تعرض نتائج لا تطابق النص المكتوب (results قديمة)، و`finally` الخاص بالطلب القديم يطفئ `loading` بينما الأحدث ما زال جارًا.
- **`goTo("/admin/orders")` (سطر 345، وكذلك 373/398) بلا معامل بحث** — النقر على نتيجة يهجر الاستعلام: صفحة الطلبات (البحث فيها state محلي: سطر 126 `useState("")`) تعرض كل شيء، فيُفقد ما وجده المشغّل.
- **`r.json()` بلا `r.ok`** (سطر 272-280): جسم خطأ JSON ⇒ ليس مصفوفة ⇒ صمتًا `[]` ⇒ «لا نتائج لـ "…"» أثناء 401/500.
- التذييل يَعِد `↵ اختيار` (سطر 436-439) **ولا يوجد أي تنقّل بلوحة المفاتيح** (لا أسهم ولا Enter).
**الإصلاح:** `AbortController` لكل استعلام جديد + تجاهل الاستجابات الملغاة؛ مرّر `?search=` في goTo الثلاثة؛ أضف `r.ok` تحققًا؛ إما تنفيذ قائمة مفاتيح (↑/↓/↵) أو حذف التلميح.

### P2-4) CopilotPanel — دور محفوظ في localStorage بـ`loading: true` يعلّق «جارٍ التفكير…» للأبد
`CopilotPanel.tsx:473` يستدعي `appendTurn(turn)` (بـ`loading: true`, سطر 464-472) و`appendTurn` يحفظ فورًا:
```ts
// CopilotPanel.tsx:366
saveConversations(list);   // turn.loading:true يُكتب إلى localStorage
```
إغلاق التبويب/تحديث الصفحة أثناء طلب جارٍ ⇒ عند العودة `loadConversations()` (سطر 177-187) يعيد الدور كما هو: `loading:true` بلا أي سبيل لإنهائه — SpinLand «جارٍ التفكير…» (سطر 1101) أبدية، وزر «إعادة» يظهر للأخطاء فقط. لا يوجد أي تعقيم عند التحميل.
**الإصلاح:** في `loadConversations()`: `arr.map(c => ({...c, turns: c.turns.map(t => t.loading ? {...t, loading:false, error:"انقطع الطلب — أعد المحاولة"} : t)}))`.

### P2-5) users.tsx — نافذة تعديل المحفظة (نموذج مالي) يدوية الصنع: بلا ESC/aria/focus-trap وتُغلق أثناء الإرسال
`pages/admin/users.tsx:532-537`:
```tsx
<div className="fixed inset-0 bg-black/65 backdrop-blur-sm z-50 ..."
  onClick={(e) => e.target === e.currentTarget && setEditingUser(null)}>
```
هذا modal النموذج الذي يحتوي **تعديل المحفظة/النقاط** (فعل مالي): بلا `role="dialog"`/`aria-modal`، بلا معالج ESC (Radix يوفرها في AppDialog — `components/ui/app-dialog.tsx:93-98`)، بلا focus trap، والخلفية تُغلق **بلا حراسة `saving`** — نقر الخلفية أثناء PATCH يخفي النافذة ويترك الطلب يسير والـtoast يظهر بلا سياق. تأكيد الحفظ نفسه (useConfirm) سليم — القشرة هي المشكلة.
**الإصلاح:** انقلها إلى `AppDialog` مع `dismissable={!saving}` (نمط InventoryUploadDialog.tsx:178-201).

### P2-6) admins.tsx — نفس الصنف في DialogShell (إنشاء/تعديل مسؤول)
`pages/admin/admins.tsx:572-575`: `onClick={onClose}` على الخلفية **بلا شرط** + بلا ESC + بلا aria (`DialogShell` سطور 563-595). نقر الخلفية أثناء `saving` في إنشاء مسؤول يغلق الحوار والـPOST مستمر بلا نافذة تُظهر نتيجته. أزرار الحوار الداخلية معطّلة أثناء الحفظ لكن الخلفية غير معطّلة.
**الإصلاح:** `onClick={(e) => e.target === e.currentTarget && !saving && onClose()}` كحد أدنى، أو الترحيل إلى AppDialog.

### P2-7) settings.tsx — ادّعاء أمني كاذب في تبويب «الأمان»: «SHA-256 + salt» بينما الخلفي يستخدم argon2
`pages/admin/settings.tsx:1202`:
```ts
{ label: "تشفير كلمات المرور", value: "SHA-256 + salt", ok: true },
```
والخلفي: `backend/src/lib/crypto.ts:19` — `return argon2.hash(password, ARGON2_OPTIONS);` (وتوثيق `routes/admin/auth.ts:313`: "argon2 with a 500-for-user-input"). لوحة الأمان تعرض 6 صفوف خضراء **مكتوبة يدويًا ثابتة** لا تعكس حالة الخادم، أحدها خاطئ تقنيًا (نفس صنف «الشروط غير الصادقة» من موجة C8).
**الإصلاح:** اجعل القيمة من الخادم (أو صحّحها إلى argon2id) واحذف علامات ✓ الثابتة عن بنود لا يمكن التحقق منها حيًّا.

### P2-8) products.tsx — نجاح كاذب غير مشروط في الأفعال الجماعية («تمت أرشفة 0 منتج»)
`pages/admin/products.tsx:372-379`:
```ts
if (failedCount > 0) { toast({ title: "خطأ", description: `فشل تنفيذ العملية على ${failedCount} منتج`, variant: "destructive" }); }
toast({ title: `تمت أرشفة ${successCount} منتج` });
```
التوست الثاني **غير مشروط** — عند فشل كلي يظهر «خطأ» ثم «تمت أرشفة 0 منتج» بنبرة نجاح (نفس عيب B5-01 الذي أُصلح في topups.tsx:630-633 بتعليق `// the unconditional toast used to show "✓ تمت الموافقة 0/N"`). كذلك `bulkToggleActive` (سطر 410-412) و`catch {}` يبتلع أسباب الفشل (لا `getErrorMessage`) بعكس topups/orders.
**الإصلاح:** `if (successCount > 0 && failedCount === 0)` قبل توست النجاح؛ اجمع الأسباب كنمط topups.tsx:618-628.

### P2-9) promotions.tsx — `load()` بلا فحص `r.ok` ⇒ 401/500 JSON ⇒ «لا توجد عروض بعد» كاذبة
`pages/admin/promotions.tsx:83-85`:
```ts
const r = await fetch("/api/admin/flash-sales", { headers });
const d = await r.json();
setSales(d.flash_sales ?? []);
```
جسم خطأ JSON ⇒ `flash_sales` غير موجود ⇒ `[]` ⇒ الحالة الفارغة (سطر 368-375) تظهر كأن التاريخ نظيف. الـcatch يمسك أخطاء الشبكة فقط. إضافة: **تفعيل عرض سريع (خصم على كل المتجر) بنقرة واحدة بلا تأكيد** بينما «الإيقاف النهائي» له تأكيد — فعل تغيير الأسعار العالمي هو غير المؤكد.
**الإصلاح:** `if (!r.ok) throw new Error(getErrorMessage(await r.json().catch(()=>null)) || ...)` + useConfirm لتفعيل عرض متوقف.

### P2-10) letter-spacing + uppercase على نصوص عربية في 6 صفحات (~28 موضعًا) — مخالفة للقاعدة الموثّقة ذاتيًا في المشروع
التعليق في `layout.tsx:641-644` يوثّق القاعدة: `letter-spacing severs Arabic letter connections` — ومع ذلك:
- `system.tsx:236,340,986,1097,1288,1296,1398` — على تسميات عربية بحتة («مدة التشغيل»، «قاعدة البيانات»، «معدل الأخطاء»، «عملاء متّصلون»…) عبر MetricCard/HealthTile/كل التفاصيل.
- `orders.tsx:859-874` (8 رؤوس جدول «رقم الطلب/المستخدم…» بـ`tracking-wide`) و`users.tsx:760-781` (مثلها).
- `alerts.tsx:473` («اليوم/أمس/هذا الأسبوع»)، `users.tsx:416,436` («مستوى الولاء/الترتيب»)، `promotions.tsx:315` («معاينة سريعة»)، `dashboard.tsx:466` («إجراءات:»).
(whatsapp.tsx:256 سليم — نص لاتيني.)
**الأثر:** تمزيق وصل الحروف العربية عبر لوحة كاملة (system) بصريًا.
**الإصلاح:** احذف `uppercase tracking-widest/tracking-wide` من هذه المواضع (uppercase لا-معنى له عربيًا أصلًا).

### P2-11) alerts.tsx — حذف المقروءة/حذف الكل: طفرتان بلا فحص `r.ok` ⇒ فشل صامت
`pages/admin/alerts.tsx:225-233`:
```ts
const deleteRead = useMutation({
  mutationFn: () => fetch("/api/admin/alerts/read", { method: "DELETE", headers }).then((r) => r.json()),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-alerts"] }),
});
```
فشل 500 ⇒ الـfetch ينجح برمجيًا ⇒ `onSuccess` يُطلق ⇒ إبطال الكاش ⇒ الصفوف تعود كما كانت **بلا أي إشارة** (لا onError أصلًا). نفس النمط في `deleteAll` (سطر 231-238). كذلك تراجع optimistic في markRead/markAllRead بلا toast (سطر 171-173).
**الالإصلاح:** `if (!r.ok) throw new Error(getErrorMessage(...))` + onError toast (نمط أي فعل آخر في اللوحة).

### P2-12) enrichment.tsx — لا مقارنة «الحالي ↔ المقترح» + نشر نص فارغ ممكن + قطع صامت عند 25
- رأس الملف نفسه يَعِد: `* Side-by-side current ↔ proposed diff (research §R-3 + R-5)` (سطور 9-11) — لكن DraftCard يعرض `draft.generated_text` **فقط** (سطر 233-239): المشغّل يوافق على وصف جديد دون رؤية الوصف الحالي للمنتج.
- `publish.mutate(edited)` (سطر 287) بلا أي تحقق: تفريغ الـtextarea ⇒ `final_text: ""` — نشر وصف فارغ إن قبل الخادم.
- `limit=25` مع `next_cursor` في الاستجابة (سطر 58-62) **لا يُستخدم أبدًا** — أكثر من 25 مسودة معلقة تُقطع بصمت (بينما العنوان يظهر `pending_count` الحقيقي فيظهر التناقض).
**الإصلاح:** أضف عمود/قسم «النص الحالي» (يحتاج إما حقلًا من الـAPI أو جلب المنتج)، امنع النشر الفارغ (`edited.trim()` + حد أدنى)، وأضف زر «تحميل المزيد» بـnext_cursor أو ذكر القطع.

### P2-13) pricing.tsx — سباق في الحساب التلقائي بلا AbortController/حارس تسلسل + قصف toasts
`pages/admin/pricing.tsx:186-203`: كل إدخال (300ms debounce) يطلق `POST /api/admin/pricing/calculate` — الـdebounce يمنع الطلبات المتلاصقة لا **المتداخلة**: استجابة أقدم تصل بعد أحدث فتكتب `setResult(data)` قديمًا بصمت (أرقام لا تطابق المدخلات المعروضة). وكذلك كل فشل حساب (كوبون غير صالح مثلًا) أثناء الكتابة يطلق toast تدميريًا متكررًا (سطر 195-199).
**الإصلاح:** عدّاد تسلسل/AbortController يُمرَّر للطلب ويُتجاهل عند الحلول، واجمع الفشل في شريط داخلي بدل toast لكل محاولة.

### P2-14) 401 منتصف الجلسة في صفحات خارج منظومة isAdminUnauthorized (whatsapp كأسوأ حالة)
الصفحات التي تستخدم fetch خامًا بلا `isAdminUnauthorized` ولا customFetch: **whatsapp.tsx** (كل أفعالها: `responseError` سطر 62-67 تُرجع «فشلت العملية (401)» كـbanner خطأ — لا إعادة دخول)، **security.tsx** (console.error فقط — انظر P2-1)، **promotions/coupons/tickets/products** (في مسارات أفعالها). بينما orders/users/topups/referrals/admins/dashboard/system تحوّل. النتيجة: انتهاء الجلسة يعطي تجارب متناقضة حسب الصفحة.
**الإصلاح:** مرّر كل fetch خام عبر `isAdminUnauthorized(r, url)` (سطر واحد لكل موضع) أو استخدم customFetch.

---

## P3 — تحسينات دقيقة

1. **`risk.tsx:110-121`** — عدّادات رقائق الفلاتر تُحسب من الاستجابة **المفلترة**: عند اختيار «حرج» تعرض بقية المستويات `(0)` كذبًا (الخادم أعاد فقط أحداث حرج). احسب العدّادات من استعلام `all` أو من `dashboard.by_level`.
2. **`risk.tsx:102 + risk.tsx (backend limit=100, next_cursor غير مستخدم)`** — قطع صامت عند 100 حدث بلا مؤشر. أظهر «يُعرض أحدث 100 فقط» أو استخدم next_cursor.
3. **`dashboard.tsx:117-120`** — تجميع أسبوعي يبدأ الأحد (`date.getDay()`) بينما ar-LY أسبوعه يبدأ السبت — حدود الأسابيع منحرفة عن مألوف المستخدم.
4. **`dashboard.tsx:308,334 + layout.tsx:382 + orders.tsx:436 وغيرها`** — `${n} طلب` بصيغة مفردة ثابتة لكل الأعداد (10 طلب ⇒ «طلبات» عربيًا) بينما المساعد **`formatCount` موجود في lib/utils.ts:49 منذ الجولة 3 ولا يستخدمه أي ملف في pages/admin** (rg: صفر مطابقات).
5. **`dashboard.tsx:326-335 vs 94-100`** — تعريفان مختلفان لـ«اليوم» في نفس الصفحة: `todayCount` بتقويم اليوم، وفلتر «اليوم» (days=1) بآخر 24 ساعة.
6. **`dashboard.tsx:291`** — `openTickets: 0` مكتوبة يدويًا: شارة تذاكر الشريط الجانبي صفرية في كل الصفحات عدا /admin/tickets (مصدر العدّ صفحة-محلي).
7. **`topups.tsx:163-165 + 349-354`** — ESC أثناء رفض جارٍ يغلق الحوار ويصفّر `processingId` بلا حراسة loading ⇒ تعاد أزرار الصف بينما الطلب في الجو (نافذة فعل مزدوج).
8. **`referrals.tsx:316`** — `{r.credited_count * 50} نقطة`: ثابت عمل (50 نقطة/إحالة) مضروب يدويًا في الواجهة بينما `row.points_earned` يأتي من الخادم — إن غُيّر الإعداد تكذب لوحة الصدارة.
9. **`coupons.tsx:193-194, 222, 250`** — `const result = await r.json(); if (!r.ok) throw new Error(result.error);` ×3: parse غير آمن (HTML للبروكسي ⇒ SyntaxError إنجليزي في الـtoast) + raw `error` بدل `getErrorMessage` (صفحة الرفض تعالجها صح سطر 227-231 — عدم اتساق داخل نفس الملف). كذلك نسبة >100 غير مكتوبة client-side (الحد `max` لا يمنع الكتابة) و`coupons.tsx:622` «نشط» بدل «نشطة».
10. **`tickets.tsx:189-190, 216`** — نفس الـunsafe parse ×2 (`throw new Error(d.error)` / `(await res.json()).error`) بعكس openTicket (سطر 146-150) المعالَج.
11. **`tickets.tsx:116-137 + 165-167`** — `fetchTickets` بلا إجهاض: تبديل سريع بين تبويبات الحالة ⇒ استجابة قديمة قد تطغى على أحدث (نفس صنف P2-3). `useEffect [search]` في referrals.tsx:170-173 ي debounce لكن بلا إجهاض أيضًا.
12. **`login.tsx:62-63`** — `const data = await res.json(); if (!res.ok) throw new Error(data.error || "رمز خاطئ")`: غير آمن + أخطاء 2FA toast-only بينما أخطاء كلمة المرور inline (عدم اتساق في نفس النموذج).
13. **`users.tsx:640-643`** — `loyalty_points`: `min="0"` لا يمنع كتابة سالب؛ `parseInt("-5") = -5` يُرسل (wallet يُتحقق منه سطر 234-243، النقاط لا). و`step="0.5"` (سطر 622) غريب لمبالغ دينار.
14. **`orders.tsx:980-986`** — `delivered_password` معروض نصًا صريحًا فور التوسيع بلا قناع/إظهار-بنقرة (المتجر لديه نمط الإخفاء) وبلا زر نسخ للبريد/كلمة المرور.
15. **`layout.tsx:478-481`** — بناء هيدر يدوي داخل الاستعلام: `headers: { Authorization: adminToken ? \`Bearer ${adminToken}\` : "" }` — نفس المانع-النمط الذي أنشئ `useAdminHeaders` لإزالته (متاح كـ`headers` في نفس المكوّن، سطر 464).
16. **`layout.tsx:469-503`** — «آخر تحديث» يتجدد بكل re-render (`useEffect [children]` — children هوية جديدة كل رسم) ولا يتصل بالتحديث الفعلي: المؤشر الأخضر الوامض يكذب عن حداثة البيانات.
17. **`CopilotPanel.tsx:1416`** — «انتهت صلاحية **لمعاينة**» — لام زائدة (⇐ «انتهت صلاحية المعاينة»). و`422-426`: لا مؤقّت يحوّل preview إلى `expired` بعد 5 دقائق (الحالة موجودة بلا مشغّل؛ النقر يُخطئ من الخادم فقط). و`Escape` (سطر 422-426) لا يغلق `showActionHistory` أولًا بل يغلق اللوحة كلها. والـtextarea لا يُصفَّر ارتفاعه بعد الإرسال (`onInputChange` سطر 776-781).
18. **`security.tsx:236`** — التايم-لاين يعرض `activity.action` خامًا بالإنجليزية («login») بينما الفلاتر نفسها معرّبة («تسجيل دخول»). وسطر 117-119: حالة التحميل تُعرض **خارج AdminLayout** (نص مجرد بلا هيكل اللوحة). و`useEffect [adminToken, filters]` (سطر 42-47) يعيد جلب stats (غير المفلترة) عند كل تغيير فلتر — طلبات زائدة.
19. **`InventoryUploadDialog.tsx:155`** — `const data = await res.json();` قبل فحص ok (unsafe)؛ و`handleFile` (سطر 113-124): `await file.text()` بلا try/catch — فشل قراءة = وعد معلّق غير معالج.
20. **`system.tsx:413-415`** — `fetchAdminHealthReady` يعامل 401 كـ«متدنٍ» صامتًا بدل تمريره للمعالج العام (تعارض مع قاعدة R93)؛ و`formatUptime` (سطر 177-186) يصوغ «3ي 5س» بلا مسافة بين الرقم والحرف.

---

## ملاحظات إيجابية (تثبيتًا لعدم التدهور)
- المال في topups/orders/users/referrals: تأكيد بمعاينة مبلغ، Idempotency-Key لكل فعل، 207 partial يُحلّل بأسباب عربية، حرس ازدواج النقر — كلها حية وسليمة.
- علاج 401/الأخطاء ممتاز في orders/users/topups/referrals/admins/alerts/system (نمط referrals الدقيق مطبّق بحرفيته).
- InventoryUploadDialog و CopilotPanel (باستثناء ما ذُكر) ناضجان: dedup، dismissable أثناء الإرسال، copy آمن عبر copyToClipboard.
- الجوال 375px: لا توجد مشاكل بنيوية — كل الجداول لها نسخ بطاقات `md:hidden` و`overflow-x-auto`، الحوارات bottom-sheet، وأشرطة الأفعال الجماعية `flex-wrap`.

## خلاصة الأعداد
P1: 2 · P2: 14 · P3: 20 — **36 نتيجة** كلها باقتباس كود موثّق أعلاه.

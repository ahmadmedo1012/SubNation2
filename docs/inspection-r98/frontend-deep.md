# الجولة 98 — التدقيق الأمامي العميق (R98-A5)

**Task ID:** R98-A5 · **Agent:** R98-A5 (diagnostic — READ-ONLY) · **التاريخ:** 2026-09-21
**النطاق:** `frontend/` + `shared/api-client-react` — أعماق جديدة تحت مستوى الجولة 96: نظافة الـhooks، السباقات، تغطية AbortController، حدود الأخطاء، اتساق الحالة، بقايا الأداء/RTL/PWA، جرد كامل للـlocalStorage، وجودة لوحة الأدمن.

---

## 0) المنهجية + خط الأساس لمنع التكرار

1. قُرئ `worklog.md` (الجولات 92→96 + final-deep-audit 2026-09-20) + `docs/inspection-r97/frontend-races-state.md` (تقرير A4 كاملًا F-01→F-17) + `docs/round-97-repair-plan.md`.
2. **تحقق هبوط إصلاحات 97-F5 بالكود أولًا** (انظر §1) — كل بند هبط يُعتبر مقفلًا ولا يُعاد رصده.
3. قراءة سلوكية سطرية لملفات الحالة الأساسية + مسح `rg` منهجي لكل `setInterval`/`addEventListener`/`localStorage`/`fetch("/api`/`toLocaleDateString`/`dir="ltr"`/`placeholderData`.
4. صفر تعديلات مصدر. هذا التقرير هو الملف الوحيد المُنشأ.

**التقسيم في هذا التقرير:**
- **§2 نتائج جديدة كليًا** (غير موجودة في أي جولة 92→97).
- **§3 طابور الجولة 98 (P3 من r97) — تحقق حالة حالي** بأرقام أسطر محدّثة (مطلوب من خطة الإصلاح 97 حرفيًا: «طابور الجولة 98») — ليست اكتشافات جديدة بل تأكيد أنها ما زالت مفتوحة وبأرقامها الحالية ليصلحها وكيل الجولة 98.
- **§4 رصيد مؤكد سليم** لمنع إعادة الفحص.

---

## 1) تحقق هبوط موجة 97-F5 (الأمامية) — كلها حيّة ✅

| البند r97 | الدليل الحي بالكود |
|---|---|
| F-01 (P1) `setToken` يمسح الكاش كاملًا عند تبديل الهوية | `lib/auth.tsx:120-129` — `invalidateQueries(me)` ثم `queryClient.clear()` + `disconnectSocket()` |
| F-03 (P2) إعادة مصافحة السوكت عند تبديل الهوية | `lib/socket.ts:150-189` — `identitySwitch → disconnect()+connect()` + تعليق الغرفة صُحّح (33-43) |
| F-04 (P2) مسح كاش الأدمن عند التبديل/الخروج | `lib/auth.tsx:162-176` — `removeQueries(/api/admin*, admin-alerts*)` |
| F-12 (P3) علم disposeGeneration ضد سباق الاستيراد | `lib/socket.ts:7-19,100-108,221-230` |
| F-02 (P2) مفتاح نية الشراء المفرد في sessionStorage + TTL + بصمة | `pages/product.tsx:88-187,411-412` |
| F-06 (P2) الشراء المفرد يبطل `/api/wallet` | `pages/product.tsx:442-449` |
| F-05 (P2) أرقام هندية ٠-٩ في الهاتف/OTP | `components/WhatsAppPhoneSignIn.tsx:61-101,350` — `toLatinDigits` |
| F-08/P3 Enter أثناء الشحن | `pages/wallet.tsx:630-634` — حارس `if (submitting || isPending) return` |
| J-1 whatsapp_status==="failed" تلميح صادق | `hooks/use-public-auth-providers.ts` (whatsappFailed) |

---

## 2) نتائج جديدة (غير مُبلَّغة في أي جولة سابقة)

### R98-01 [P1] صفحة المنتج: الكوبون المُتحقق يبقى صالحًا عند تبديل الباقة — الزر المالي يعرض مبلغًا لن يُحصَّد
**الأدلة:**
- اختيار الباقة: `pages/product.tsx:373-391` (`selectedVariantId`) — `onSelect={setSelectedVariantId}` عند `948-953` (VariantSelector).
- التحقق من الكوبون يحسب على باقة **اللحظة** فقط: `product.tsx:462-477` (`basePrice = selectedVariant.sale_price ?? price`).
- **لا يوجد أي effect يصفّر `couponResult` عند تغيّر `selectedVariantId`** (اجمع `rg couponResult` — يُصفَّر فقط في `validateCoupon`/`clearCoupon`).
- كل مسارات العرض تدفع `couponResult.final_amount` كما هي: `product.tsx:1078,1083-1087` (لوحة الشراء) و`1136-1145` (الشريط اللاصق للموبايل) — `displayPrice={couponResult ? couponResult.final_amount : displayPrice}`.

**سيناريو الفشل (مستخدم عادي، بلا أي ظرف شاذ):**
1. منتج متعدد الباقات — المستخدم يختار باقة 50 د.ل، يتحقق من كوبون ثابت 10 د.ل → الشاشة: «40.00 د.ل» + زر «شراء الآن (40.00)».
2. يبدّل إلى باقة 100 د.ل (مقارنة سعرية طبيعية قبل الشراء) — **البصمة تتغير** (variantId داخل fingerprint عند 403-410) لكن `couponResult` يبقى → الزر يعرض **40.00** والفارق المالي/«الناقص» يُحسب على 40.
3. `handleBuyIntent` يرسل `coupon_code` فقط (395-397) — الخادم يعيد احتساب الخصم على 100 → المبلغ الفعلي المحصَّد **90.00**.
4. المستخدم أكّد شراءً معلنًا بـ40 ودفع 90 — أمر شراء «مكسور العقد» على مسار المال الأساسي للصفحة (الشراء المفرد).

لا يوجد فساد بيانات ولا خصم مزدوج (الخادم يحسب صح دائمًا + بصمة المفتاح تمنع 409) — لكن العرض المسبق للالتزام المالي كاذب. صفحة السلة عالجت **نفس الفئة** بصراحة: `checkout.tsx:243-249` يصفّر الكوبون عند أي تغيّر سطر — صفحة المنتج نست الاسترجاع.

**الإصلاح المحدد (3 أسطر):** effect واحد في product.tsx يوازي checkout:
```ts
useEffect(() => {
  setCouponResult(null);
  setCouponError("");
}, [selectedVariantId]);
```
(اختياري: الاحتفاظ بـ`couponInput` ليُعاد التحقق بنقرة، أو إظهار notice «أعد التحقق من الكوبون للباقة الجديدة».)

---

### R98-02 [P3] بحث إحالات الأدمن: استجابة قديمة تكتب فوق الأحدث (لا abort ولا رقم تسلسل)
**الأدلة:** `pages/admin/referrals.tsx:131-160` — `fetchData` يدوية (setState مباشر) + debounce 300ms فقط عند `170-173`. لا `AbortController` ولا `fetchSeq`. جرّد r97 غطّى home/GlobalSearch/orders/users (كلها query-key-abort) — صفحة الإحالات نست.
**السيناريو:** «abc» يُرسل → المستخدم يكمل «abcd» خلال RTT → استجابة «abc» تصل متأخرة → `setData` الأخيرة بالوصول لا بالطلب → قائمة/بطاقات إحصائية لاستعلام لم يعد معروضًا. يصحح نفسه عند أول تفاعل لاحق.
**الإصلاح:** `const r = await fetch(url, { headers, signal })` + controller في الـdebounce effect (نمط GlobalSearch `admin/layout.tsx:277-312`)، أو seq-guard واحد.

---

### R98-03 [P3] قيمة سياق السلة غير ممذكرة — كل مستهلكي useCart يعاد رسمهم عند أي render للمزوّد
**الأدلة:** `lib/cart.tsx:189-195` — `value={{...}}` inline (بلا `useMemo`). ProductCard ممذكّر بمقارِن مخصص (`ProductCard.tsx:456-472`) لكن **تحديث السياق يتجاوز memo** — كل تغيير سلة (أو أي إعادة رسم لـCartProvider) يعيد رسم كل بطاقات الشبكة + Navbar + MobileNav. الحجم محدود (56 منتجًا) لكن الرسم مشترك في اللحظة الأهم (نقرة «أضف للسلة»).
**الإصلاح:** `const value = useMemo(() => ({ items, itemCount, totalLYD, addItem, removeItem, updateQuantity, clear, isLoaded }), [items, itemCount, totalLYD, addItem, removeItem, updateQuantity, clear, isLoaded])` — الدوال كلها `useCallback` مستقرة أصلًا.

---

### R98-04 [P3] فلاتر الكتالوج (بحث/فئة/ترتيب/متوفر فقط) بلا انعكاس في الـURL — تضيع عند refresh/رجوع
**الأدلة:** `pages/home.tsx:124-128` (state محلية) + `196-200` (params تُبنى داخليًا للـqueryKey فقط). لا `history.replaceState` ولا `useSearch`. أدمن استلم مزامنة `?search=` (orders/users/products) — الواجهة الأمامية لا.
**الأثر:** مستخدم صفّى فئة+ترتيب، دخل منتجًا ثم عاد (back) → home يُركّب من جديد → كل الفلاتر صفر. مشاركة رابط لنتيجة مصفّاة مستحيلة.
**الإصلاح:** مزامنة params إلى querystring عبر `useLocation`/`replaceState` عند التغيير + قراءة أولية عند mount (نمط `admin/orders.tsx:380-386`).

---

### R98-05 [P3] نماذج الأدمن الطويلة بلا حارس فقدان التعديلات (dirty-state)
**الأدلة:** `rg beforeunload` على `frontend/src/pages` = **صفر نتائج**؛ ولا confirm عند التنقل بعيدًا لأي من نماذج الإدخال الطويلة: `admin/settings.tsx` (إعدادات + ملف شخصي + كلمة مرور)، `admin/products.tsx` (محرر منتج/مخزون/أسعار)، `admin/coupons.tsx`، `admin/promotions.tsx`. كل الحراس الموجودة تخص «الإرسال» (saving/disabled/confirm) لا «المغادرة».
**الأثر:** مشغّل يكتب وصفًا عربيًا طويلًا في محرر المنتج → نقرة عرضية على رابط الشريط الجانبي → التعديل كله يضيع بلا سؤال.
**الإصلاح الأدنى:** `useEffect` يسجّل `beforeunload` عند dirty (فقط للمتصفح/refresh) + اعتراض تنقّلات SPA الداخلية عبر تأكيد `useConfirm` في AdminLayout عند وجود نموذج dirty (module-level flag من النماذج).

---

### R98-06 [P3] استعلام عدّاد التنبيهات في AdminLayout: `r.json()` بلا فحص `r.ok` + هيدر Bearer فارغ مبني يدويًا
**الأدلة:** `pages/admin/layout.tsx:585-595`:
```ts
fetch("/api/admin/alerts/unread-count", { headers: { Authorization: adminToken ? `Bearer ${adminToken}` : "" } })
  .then((r) => r.json())
```
- 401/500/503 (جسم envelope خطأ) يُparse بنجاح → `data.count === undefined` → الشارة **0** بصمت أثناء العطل — النقيض الذي أصلحته الجولات السابقة لكل صفحة (خطأ يُقرأ فارغًا).
- `""` bearer عند غياب التوكن = نفس الصنف الذي أزاله `useAdminHeaders` (header فارغ «حاضر لكن مشوه») — والصفحة تستدعي `useAdminHeaders` أصلًا لكنها لا تستخدمه هنا.
**الإصلاح:** استخدام `headers` الجاهز + `if (!r.ok) return {count: undefined}` مع إبقاء القيمة القديمة، أو تمرير الخطأ لـquery error (الشارة تختفي بدل الكذب بصفر).

---

### R98-07 [P3] `sn_last_alert_id` يعيش للأبد — لا مسح عند خروج الأدمن ولا عند تبديل مشغّل
**الأدلة:** `pages/admin/layout.tsx:654,669` (كتابة/قراءة المؤشر) — لا `localStorage.removeItem` في أي مسار خروج (`adminLogout` في `auth.tsx:217-234` ينظف التوكنات/الكاش فقط).
**الأثر (جهاز مشترك بين مشغّلين):** أدمن B يدخل بعد ساعات — كل التنبيهات التي حدثت خلال غيابه **تُبتلع صامتة** (المؤشر ما زال عند آخر ما رآه A). أيضًا رفضات toast لأحداث قديمة انتهى صلاحيتها التشغيلية.
**الإصلاح:** في `adminLogout` (وأعقاب 401): `localStorage.removeItem("sn_last_alert_id")` — أو نقل المؤشر إلى حالة الاستعلام (TanStack) بدل storage.

---

### R98-08 [P3] PWA: لا قاعدة SW لأصول JS النفسية + لا محتوى offline داخل index.html + لا Push إطلاقًا
**الأدلة:**
- `vite.config.ts:298-371`: runtimeCaching يغطي `/api/products|flash-sale` (SWR 7d) + صور (CacheFirst 30d) **فقط**؛ `globIgnores: ["**/*.js"]` (368) — اعتماد JS على HTTP cache المتصفح (`immutable 1y`).
- `index.html:81-84`: `<div id="root"></div>` فارغ — لا شاشة «أنت غير متصل» ساكنة.
- `rg pushManager|new Notification` على src = صفر — لا تسجيل push ولا مستمع.

**التحليل (ليس عطلًا مباشرًا — ثغرة حافة موثّقة جزئيًا):** زيارة متكررة offline تعمل فعلًا (نفس إصدار HTML من precache + chunks من HTTP cache + كتالوج SWR). لكن متصفحات الموبايل تُجلي HTTP cache كاملًا تحت ضغط التخزين **دون** لمس مخازن SW → الهيكل offline يصبح HTML بلا JS → شاشة بيضاء بلا رسالة عربية، و`lazyWithRetry` يُطلق reload واحدًا (حارس `sn:chunk-reload:` بـsessionStorage) ثم ييأس. الغياب الأولي للتسجيل (زر Install ثم offline فورًا) نفس المصير. القصد موثق («Never precache JS… lazyWithRetry recovery») لكنه يفترض HTTP cache خالدًا.
**الإصلاح الأدنى:** قاعدة runtime ثالثة `CacheFirst` لنفس الأصل `/assets/*.js` بـ`maxEntries:~40 / maxAge 30d` (تجلبها الزيارة الأولى فعلًا → offline كامل بعد أول زيارة واحدة)، أو حقن noscript/سايت <div> برسالة «لا يوجد اتصال» يخفيها main.tsx عند الإقلاع. Push: قرار منتج موثّق أفضل من إصلاح — يُذكر في الجرد فقط.

---

### R98-09 [P3] مفتاح idempotency لشحن المحفظة داخل `useRef` فقط — يموت عند refresh (تكافؤ ناقص مع checkout/product)
**الأدلة:** `pages/wallet.tsx:477-483` — `topupKeyRef` بلا أي sessionStorage (يُدار بالتدوير النهائي عند نجاح/تغيير الحقول). أنماط الجوال 96-F4/97-F5 خزّنت الشراء المفرد والسلة في sessionStorage بTTL.
**الأثر الفعلي (محدود):** فشل شبكي غير محسوم → refresh → إعادة نفس النية = مفتاح جديد — **لكن** الخادم يمسك السقف عبر قيد `uniq_wallet_topups_payment_reference` + composite soft-dedup (اختبارات `wallet-topups-idempotency` / `topup-composite-dedup` خلفية). أي أن هذا المسار وحده يملك حراسة ثانية، لذا P3: تكافؤ دفاع-بالعمق فقط (هيدر الطلب يصبح عديم الفائدة بعد refresh).
**الإصلاح:** `subnation_topupkey` في sessionStorage بنمط buykey (TTL 10د + بصمة amount|method|phone).

---

### R98-10 [P3] جرد أصغر (تُصلح كموجة نظافة واحدة)
- **`subnation_cart_v1` (legacy) لا يُحذف بعد الترحيل** — `lib/cart.tsx:77` يقرأه كاحتياط ثم يكتب v2 دائمًا؛ مفتاح 2015-style يبقى للأبد في كل متصفح قديم. سطر `localStorage.removeItem(LEGACY_STORAGE_KEY)` بعد الترحيل الناجح.
- **السلة تنتقل بين مستخدمي جهاز مشترك** — لا تُمسح عند `setToken` (بضائع لا PII؛ قرار تصميمي شائع) — يستحق توثيقًا صريحًا أو مسحًا عند تبديل الهوية إن رُفع لاحقًا لمستوى سياسة.
- **صفحة /orders الأمامية: `useListOrders(undefined)`** (`pages/orders.tsx:146`) — سحب حتى 200 صف (سقف الخلفي `routes/orders.ts:85-86`) وrenderها كلها بلا load-more/قص — DOM طويل لمستخدم قديم. مقبول اليوم؛ عند تجاوز ~50 طلبًا يُفضّل قصًا أوليًا + «عرض المزيد».
- **أدمن orders/users: `statusFilter/dateRange/tier/sort` بلا URL** (search فقط مُزامن `orders.tsx:383-386`, `users.tsx:163`) — refresh يفقد تصفية العمق التشغيلي. عائلة R98-04 نفسها.

---

## 3) طابور الجولة 98 (P3 من r97) — ما زالت مفتوحة، بأرقام الأسطر الحالية

> هذه بنود **موثقة أصلًا في r97-A4 وأُجّلت رسميًا لجولتنا هذه** (خطة 97 §طابور الجولة 98). نُدرجها للتأكيد الحي فقط — ليست اكتشافات جديدة:

| البند r97 | الحالة | الدليل الحالي |
|---|---|---|
| F-07 مفاتيح checkout بلا TTL | ⛔ مفتوح | `checkout.tsx:115-143` — مفتاح خام بلا طابع (product أخذ TTL في 97-F5، checkout لم يأخذه) |
| F-09 السلة بلا listener للـstorage (multi-tab lost-update) | ⛔ مفتوح | `lib/cart.tsx` — لا `window.addEventListener("storage")` |
| F-10 الجرس: بلا try/catch في markRead/markAllRead + optimistic بلا rollback + بلا seq في fetchAll | ⛔ مفتوح | `NotificationBell.tsx:139-198` (fetchAll 139-177، markAllRead 179-186، markRead 188-198) |
| F-11 جزر raw-fetch (~40 موقعًا وقتها) | ⛔ مفتوح واتسسع | **99 موقعًا في 41 ملفًا** (`rg 'fetch\("/api'`) — أحرجها: `checkout.tsx:213` (probe الرصيد بلا مهلة)، `product.tsx:473` (validate الكوبون)، `NotificationBell.tsx:142`, `AuthProviders.tsx:221-230`, `admin/layout.tsx:655` |
| F-13 `retry: 1` يعيد 4xx | ⛔ مفتوح | `App.tsx:190` — لا مرشح status<500 |
| F-14 ErrorBoundary يُصفَّر بهوية children | ⛔ مفتوح | `ErrorBoundary.tsx:44-49` |
| F-16 البحث بلا keepPreviousData | ⛔ مفتوح | لا `placeholderData` في المستودع كله (`rg` = صفر) — `home.tsx:202-212` |
| F-17(4) `navigate` بعد نهاية اللوب حتى لو غادر المستخدم checkout | ⛔ مفتوح | `checkout.tsx:551` — `if (firstOrderCode) navigate(...)` بلا علم abandoned |

---

## 4) رصيد مؤكد سليم (فُحص بالكود هذه الجولة — يمنع إعادة الفحص)

1. **AbortController للـorval:** كل استعلام مولّد يمرر `signal` → `customFetch` يدمجه بـ`AbortSignal.any` مع المهلة (`generated/api.ts:177+`, `custom-fetch.ts:441-459`) — إلغاء unmount يعمل عبر كل TanStack. رصيد ممتاز.
2. **حدود الأخطاء:** Switch-level للعامة (App.tsx:446-477) + مستقل للأدمن (339-368) — Navbar/Footer يبقيان حيّين عند انهيار صفحة؛ لا شاشة بيضاء للتطبيق كله.
3. **حالات الخطأ للجلب:** home/checkout/product/orders/order-detail/loyalty(refactor B4)/support/profile/referrals/flash-sales/category/wallet + admin (orders/users/tickets/security/referrals/alerts) — كلها تملك فرع isError صريح بretry (اختبارات `*-error-state.test.tsx`). صفر «spinner لا نهائي» جديد.
4. **Polling الأدمن:** fallback 300s فقط + `refetchIntervalInBackground:false` + socket-driven invalidation (dashboard/orders/topups/layout-alerts) + كل الـintervals بcleanup (layout:607/677, copilot:393/1387, status:71, FlashSaleBanner:99/126, NotificationBell:224-243).
5. **Bundle:** بوابات gzip 55KiB على entry (`vite.config.ts:17-63`) + manualChunks (charts/firebase/sentry/socket/radix منفصلة) + كل الصفحات lazy (App.tsx:37-81) + recharts داخل admin/system+dashboard فقط (lazy) + qrcode dynamic import (`admin/settings.tsx:350`) + Sentry stub بلا DSN. صفر مكتبة رسم في المسار الرئيسي.
6. **الصور:** eager أول 4 + `fetchPriority` + `loading=lazy` + width/height + onError fallback (ProductCard:292-315) — srcset مؤجل بوعي (r96).
7. **Virtualization:** غير مطلوب — 56 منتجًا / 200 طلب سقفًا / الأدمن load-more مقيد بصفحة.
8. **RTL/أرقام:** كل اللاتينية المالية tabular-nums بen-US (`lib/utils.ts:15-40`)، تواريخ `ar-LY-u-nu-latn` مثبتة (utils:69-75)، `dir="ltr"` على الهواتف/الاعتمادات/الأكواد (orders:357, profile:235/280, users:438/704/716, order-detail:52-59/290/341)، أرقام هندية مُحوّلة في الهاتف/OTP/المبالغ (WhatsAppPhoneSignIn:75, wallet:162).
9. **PWA تحديث:** autoUpdate + توست controllerchange عربي بretry (main.tsx:93-118) — يعمل. manifest سليم (id, dir, shortcuts, maskable).
10. **المصادقة:** probe allSettled + cancelled (auth.tsx:277-353)، تدوير Firebase silent بلا وميض (143-145)، 401 router مزدوج بdedupe (user-session.ts/admin-session.ts) — كلها هبطت في 96/97 وتعمل.
11. **نماذج الأدمن:** saving-guards + confirm للمال (bulk refund بأجمالي، wallet-adjust بمعاينة الرصيد، referral credit، topup approve) + Idempotency-Key لكل عملية bulk/save — موثقة في كل صفحة.
12. **CSV تصدير المستخدمين** بBOM عربي (users.tsx:404).

---

## 5) جرد المفاتيح — localStorage/sessionStorage (كامل المستودع الأمامي)

### localStorage

| المفتاح | الملف | الشكل | انتهاء | تنظيف عند الخروج |
|---|---|---|---|---|
| `subnation_cart_v2` | lib/cart.tsx:38 | `LocalCartItem[]` (productId, variantId, variantLabel, slug, name, imageUrl, priceLYD, salePriceLYD, discountPercent, quantity≤99) | لا | ❌ (يبقى عبر المستخدمين — بضائع لا PII) |
| `subnation_cart_v1` | lib/cart.tsx:39 | قديم (بلا variantId) | لا | ❌ + **لا يُحذف حتى بعد الترحيل** (R98-10) |
| `sn_theme` | lib/theme.tsx:34 | `"light"|"dark"` | لا | غير مطلوب |
| `sn_last_alert_id` | admin/layout.tsx:654 | رقم | لا | ❌ (R98-07) |
| `subnation:copilot:conversations:v1` | CopilotPanel.tsx:172 | `Conversation[]` (≤8، loading مجمّل قبل الحفظ) | لا | ❌ (نص أسئلة مشغّل على جهاز مشترك) |
| `subnation:copilot:current:v1` | CopilotPanel.tsx:173 | id محادثة | لا | ❌ |
| `sn_flash_sale_ends` | FlashSaleBanner.tsx:35 | timestamp | منطقي (يُتجاهل عند المضي) | ✅ عند انتهاء/غياب العرض |
| `subnation_search_history` | home.tsx:83 | `string[]` (≤8) | لا | غير مطلوب |
| `subnation_saved_sender_phones` | wallet.tsx:58 | أرقام مرسلي محفوظة (طوعية) | لا | ❌ (PIA خفيف: أرقام هواتف على جهاز مشترك — نتيجة «تذكر الرقم» الصريحة للمستخدم) |
| `subnation_topup_preferences` | wallet.tsx:59 | {network, amount, method} | لا | ❌ |

### sessionStorage

| المفتاح | الملف | الشكل | انتهاء | ملاحظات |
|---|---|---|---|---|
| `subnation_checkout_key:{productId}:{unitIndex}` | checkout.tsx:115 | uuid خام | ❌ بلا TTL (طابور r97 F-07) | يُحذف عند الحسم النهائي فقط |
| `subnation_buykey:{productId}` | product.tsx:124 | `{k,t,f}` JSON | ✅ TTL 10د + بصمة | 97-F5 |
| `subnation_topup_return` | wallet.tsx:452 | مسار عودة | الجلسة | يُستهلك عند الاستخدام |
| `sn:chunk-reload:{pathname}` | lazy-with-retry.ts:60 | timestamp | الجلسة | حارس reload واحد |
| `cwv_session_id` | web-vitals.ts:47 | UUID | الجلسة | بلا حساسية |

**XSS-sensitive:** لا توكنات ولا JWT ولا بيانات اعتماد في أي storage — المصادقة كوكي httpOnly + JWT في الذاكرة فقط (`auth-token-holder.ts`). ✅
**Quota handling:** كل كتابة بـtry/catch (cart/copilot/flash-sale/search/wallet/lazy) — تعطل quota = تدهور صامت آمن. ✅

---

## 6) الحصيلة

| النوع | العدد |
|---|---|
| نتائج جديدة | **10** (P0: 0 · P1: 1 · P2: 0 · P3: 9) |
| طابور r97 مؤكد مفتوح (P3) | 8 بنود (تأكيد حالة، ليست جديدة) |
| إصلاحات 97-F5 متحقق هبوطها | 9/9 |

**الترتيب المقترح للإصلاح (موجة F واحدة تكفي):**
1. **R98-01 (P1)** — 3 أسطر في product.tsx (effect يصفّر الكوبون عند تبديل الباقة) + اختبار «switch-variant voids coupon».
2. R98-02/03/04/06/07/10 — كل بند ≤ 15 سطرًا، ملكية ملفات منفصلة (referrals.tsx / cart.tsx / home.tsx / admin-layout.tsx / cart.tsx+orders.tsx).
3. R98-05 — حارس dirty عبر AdminLayout (متوسط).
4. R98-08/09 — قرار تصميمي (قاعدة /assets SW) + تكافؤ مفتاح الشحن.
5. طابور r97 المؤكد (§3) — نفس الموجة إن اتسع الوقت، وإلا فوثّق أولويته.

**الملفات المفحوصة (قراءة معمّقة أو مسح منهجي):** `App.tsx, main.tsx, vite.config.ts, index.html, package.json, shared/api-client-react/custom-fetch.ts (+generated api.ts orval), lib/{auth, cart, theme, socket, user-session, admin-session, utils, lazy-with-retry, auth-token-holder, web-vitals, direction}.ts(x), hooks/{use-socket, use-admin-headers, use-public-auth-providers, use-telegram-webapp-auto-login}.ts, components/{ErrorBoundary, NotificationBell, ProductCard, TopupWaitingModal, AuthProviders, FlashSaleBanner, Navbar, CopilotPanel(+HistoryView)}.tsx, pages/{home, product, cart, checkout, wallet, orders, order-detail, loyalty, referrals, support, profile, category, flash-sales, status, login, register, onboarding, terms}.tsx, pages/admin/{layout, orders, users, topups, products, settings, coupons, referrals, tickets, pricing, system, dashboard}.tsx, public/manifest.json` + تحقق خلفي نقطي (`backend/src/routes/orders.ts` لسقف limit).

**الخلاصة:** النواة الحاملة للمال والحالة في وضع ممتاز بعد ست جولات إصلاح — الثغرة الجديدة الوحيدة ذات وزن حقيقي هي كذبة سعر الكوبون عند تبديل الباقة (P1، إصلاح 3 أسطر)، وكل الباقي نظافة P3 + طابور r97 المؤجل المفتوح.

> **ARCHIVED (2026-10-07, R122 docs reorg).** Moved from `docs/inspection-r97/frontend-races-state.md`; dated historical record — content unchanged, not current state (see ../README.md for the current index).

# الجولة 97 — أعمق تدقيق لصحة الواجهة: السباقات، إدارة الحالة، تسريبات الذاكرة، صمود الأخطاء

**Task ID:** R97-A4 · **Agent:** R97-A4 (diagnostic — research only) · **التاريخ:** 2026-09-11
**النطاق:** `frontend/src` — القراءة سطرًا-سطرًا للنواة الحاملة للحالة (checkout/product/wallet/cart/NotificationBell/socket/auth/TopupWaitingModal/WhatsAppPhoneSignIn/App.tsx/custom-fetch/user-session/admin-session/SocketInitializer/use-socket/use-confirm/theme/direction/firebase-auth/main.tsx/boot-sentry) + فحوص نقطية لـ orders/order-detail/home/Navbar/MobileNav/ProductCard/SessionManager/AuthProviders/use-admin-headers/admin dashboard + مقاطعة مصدرية مع `backend/src/lib/socket.ts` لتوثيق عقد الغرف.

---

## 0) المنهجية

1. **خط الأساس أولًا:** قُرئ `worklog.md` (جولات 94–96 كاملة) + `docs/round-96-repair-plan.md` (موجات F1–F7) + تقارير `docs/inspection-r96/mobile-*.md` الستة — لاستبعاد المُصلَح (idempotency keys للسلة، socket revive على online/visibilitychange، resync لمجموعات المال، مهلة 20s في customFetch، معالج 401 للمتجر، iOS zoom، double-tap locks، CopyButton الموحّد…). كل نتيجة أدناه **جديدة** أو **بقايا عالقة من إصلاح الجولة 96 نفسه** (فجوات lifecycle لم يغطِّها الإصلاح)، مع تمييز واضح.
2. **قراءة سلوكية للكود:** تتبّع دورة حياة كل قطعة حالة (مفتاح idempotency: التوليد→الاستخدام→الحذف)، وكل `useEffect` (deps + cleanup)، وكل Promise غير مُنتظر (`void fn()` / fire-and-forget)، وكل مفتاح queryKey (هل يشمل الهوية؟ هل تُبطَله كل الـmutations المؤثرة؟)، ومقارنة تعليقات الكود مع سلوك الخادم الفعلي (خاصة عقد Socket.IO rooms — قُرئ `backend/src/lib/socket.ts` للتحقق).
3. **نمذجة سيناريوهات فشل ملموسة:** لكل نتيجة سيناريو خطوات محدد (مستخدم، جهاز، شبكة) بترتيب زمني، وتقييم P0–P3 وفق: مسار مال؟ عرض بيانات لمستخدم خطأ؟ نافذة الخطورة العملية؟
4. **صفر تعديلات مصدر، صفر كوميتات** — تقرير فقط.

---

## 1) الملخص التنفيذي

| #    | الشدة     | المجال             | الخلاصة                                                                                                                                                                                                                                                                              | الملف:السطر                                                                          |
| ---- | --------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| F-01 | 🔴 **P1** | Auth/State         | بعد انتهاء جلسة منتصف الرحلة (401) ثم دخول مستخدم **آخر** بنفس التبويب: كاش TanStack لمجموعات المال (wallet/topups/orders) **لا يُمسح ولا يُبطَل عند تبديل الهوية** — يُعرض رصيدُ المستخدم السابق للمستخدم الجديد، وقد يبقى **بلا أي refetch** إذا كانت البيانات أحدث من `staleTime` | auth.tsx:86-92 · user-session.ts:126-163 · wallet.tsx:533-546                        |
| F-02 | 🟠 P2     | Idempotency        | مفتاح نية الشراء في product.tsx يعيش في `useRef` فقط — **يضيع عند unmount/refresh/رجوع** فيتحقق سيناريو الخصم المزدوج الذي وُلد إصلاح 96-F4 لإغلاقه (checkout محمي بـsessionStorage، صفحة المنتج لا)                                                                                 | product.tsx:253-261                                                                  |
| F-03 | 🟠 P2     | Socket/Auth        | تبديل حساب **دون تسجيل خروج** يترك السوكت في غرفة `user:<المستخدم القديم>` إلى الأبد: الجديد لا يستقبل أحداثه، والأحداث المالية للقديم تُعرض للجديد — تعليق الكود في socket.ts:18-23 **يدّعي عكس ذلك** والخادم يعامل `join-user` كـ no-op                                            | lib/socket.ts:125-148 · backend/src/lib/socket.ts:34-41,228-241                      |
| F-04 | 🟠 P2     | Admin/Auth         | تسجيل دخول أدمن ثانٍ (أو انتهاء جلسة أدمن ثم دخول آخر) **بلا أي إبطال/مسح للكاش الإداري** — بيانات الأدمن السابق (طلبات/مستخدمون/شحنات PII) تُعرض للأدمن الجديد، وقد تبقى حتى 5 دقائق (refetchInterval 300s هو المُنقذ الوحيد)                                                       | auth.tsx:110-112,152-169 · admin-session.ts:119-144                                  |
| F-05 | 🟠 P2     | Forms              | أرقام Arabic-Indic (٠-٩) **تُحذف ولا تُحوَّل** في حقلَي هاتف/رمز WhatsApp (مسار الدخول الأساسي) بينما حقل مبلغ المحفظة يحوّلها — لصق رقم من جهة اتصال عربية = حقل فارغ ورسالة «رقم الهاتف غير صالح»                                                                                  | WhatsAppPhoneSignIn.tsx:73-78,322-324 · مقابل wallet.tsx:162                         |
| F-06 | 🟠 P2     | Query/Invalidation | الشراء المفرد من صفحة المنتج يُبطل `me` و`orders` لكن **لا يُبطل `/api/wallet`** (عكس checkout) — رقاقة الرصيد في الشريط تتحدث بينما صفحة المحفظة تعرض الرصيد ما قبل الشراء حتى 60s+                                                                                                 | product.tsx:278-289 · مقابل checkout.tsx:504                                         |
| F-07 | 🟡 P3     | Idempotency        | مفاتيح checkout في sessionStorage **بلا TTL وبلا ربط بـ intent** — بعد فشل شبكي غير محسوم، نية شراء **لاحقة** لنفس المنتج قد تُجاب برد replay مخزّن (حتى 24h خادميًا) فلا تُنشأ الوحدة الجديدة                                                                                       | checkout.tsx:115-143,423-424                                                         |
| F-08 | 🟡 P3     | Wallet/Forms       | `handleSubmit` للشحن بلا حارس دخول — **Enter داخل حقل يُرسل النموذج حتى والزر disabled**؛ Enter مزدوج سريع = نداءان بنفس Idempotency-Key → الثاني يُجاب 409 in-flight → بانر خطأ فوق نافذة الانتظار المفتوحة                                                                         | wallet.tsx:626-693,1167-1172                                                         |
| F-09 | 🟡 P3     | Cart               | لا مزامنة multi-tab (لا `storage` event listener) — تبويبان على نفس السلة = **lost-update** (كتابة التبويب الثاني تلغي إضافة الأول) + شارة MobileNav تخلف تبويبًا                                                                                                                    | lib/cart.tsx:54-130                                                                  |
| F-10 | 🟡 P3     | Notifications      | `fetchAll` بلا ترتيب/sequence guard — استجابة أقدم تصل بعد أحدث فتُلغيها (last-write-wins)؛ و`markRead/markAllRead` بلا try/catch → **unhandledrejection** عند اللمس بلا شبكة + حالة مقروء متفائلة بلا rollback                                                                      | NotificationBell.tsx:139-198                                                         |
| F-11 | 🟡 P3     | Resilience         | كل نداءات `raw fetch` (~40 موقعًا، منها مسارات المال: probe الرصيد وvalidate الكوبون) **خارج customFetch** → بلا مهلة 20s وبلا مُوجِّه 401 — جلسة منتهية على checkout تُظهر بانر «تعذّر التحقق من رصيدك» بدل التحويل لتسجيل الدخول                                                   | checkout.tsx:213,274,373 · product.tsx:309 · NotificationBell.tsx:142-145            |
| F-12 | 🟡 P3     | Socket/Leak        | `disconnectSocket()` أثناء `await import("socket.io-client")` المعلق = no-op — يُنشأ السوكت **بعد** الخروج ويحاول بلا نهاية (reconnectionAttempts: Infinity) بلا كوكي صالح                                                                                                           | lib/socket.ts:80-123,179-185                                                         |
| F-13 | 🟡 P3     | Query/Retry        | `retry: 1` عام يُعيد المحاولة لكل الأخطاء **بما فيها 4xx/401/404** — يضاعف الطلبات المحكوم بالفشل ويؤخر تحويل 401 ~1s                                                                                                                                                                | App.tsx:183-203                                                                      |
| F-14 | 🟡 P3     | ErrorBoundary      | إعادة الضبط عند تغيّر `children` identity — أي re-render للأب (وليس التنقل فقط) يعيد تركيب الصفحة المتعثرة → وميض حلقة خطأ                                                                                                                                                           | ErrorBoundary.tsx:44-49                                                              |
| F-15 | 🟡 P3     | Polling            | TopupWaitingModal: `refetchIntervalInBackground: true` — استقصاء 3s يستمر والتبويب في الخلفية (نمط التطبيق كله `false`)                                                                                                                                                              | TopupWaitingModal.tsx:61-74                                                          |
| F-16 | 🟡 P3     | Forms/UX           | بحث الرئيسية بلا `placeholderData: keepPreviousData` — كل keystroke-commit يبدّل queryKey فيعود `data=undefined` → skeleton كامل لكل حرف (بعد 320ms debounce)                                                                                                                        | home.tsx:202-212                                                                     |
| F-17 | 🟡 P3     | Misc               | لائحة صغرى: `useConfirm` يُنشئ `ConfirmDialog` داخل render (remount anti-pattern) · home.tsx:667 `setTimeout` بلا cleanup · AuthProviders providers-fetch بلا abort · checkout يبقى `navigate()` بعد نجاح حتى لو غادر المستخدم الصفحة أثناء المعالجة                                 | use-confirm.tsx:78-113 · home.tsx:667 · AuthProviders.tsx:221-230 · checkout.tsx:533 |

**الحصيلة: P0=0 · P1=1 · P2=5 · P3=12.** رصيد الجولة 96 حي ومؤكد (انظر §10) — كل النتائج أعلاه إما فجوات جديدة بين الأنظمة أو بقايا lifecycle لم يغلقها إصلاح 96-F3/F4/F6 بالكامل.

---

## 2) المحور 1 — سباقات الشراء والسلة والمحفظة والإشعارات

### F-01 [P1] كاش المال ينجو من انتهاء الجلسة ويُقدَّم للمستخدم التالي

**الأدلة (file:line):**

- `auth.tsx:86-92` — `setToken` يبطل **فقط** `getGetMeQueryKey()`:
  ```ts
  const setToken = useCallback(
    (t: string | null) => {
      setTokenState(t);
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() }); // ← فقط /api/auth/me
    },
    [queryClient],
  );
  ```
- `auth.tsx:126-150` — المسار الصريح (`logout()`) يستدعي `queryClient.clear()` ✅ — لكن:
- `user-session.ts:126-163` — مُوجِّه 401 منتصف الرحلة يستدعي `clearUserSession` = `() => setToken(null)` (user-session.ts:187) **بلا `queryClient.clear()` ولا إبطال wallet/topups/orders**.
- `wallet.tsx:533-546` — `useGetWallet`/`useListTopups` بمفتاح ثابت `getGetWalletQueryKey()` لا يشمل الهوية، `staleTime` الافتراضي 60s (App.tsx:187)، ولا `refetchInterval`.

**سيناريو الفشل الملموس (جهاز مشترك — الحالة النموذجية لانتهاء الجلسة):**

1. المستخدم A على `/wallet`؛ آخر جلب ناجح لـ`/api/wallet` عند T0. يقفل الهاتف.
2. تنتهي الجلسة خادميًا. عند فتح التبويب: `visibilitychange` → `invalidateTransactionalQueries` (SocketInitializer.tsx:139-146) → refetch → 401 → المُوجِّه (user-session.ts) يطلق toast «انتهت الجلسة»، `setToken(null)`، تحويل إلى `/login`. **بيانات A (الرصيد + سجل الشحنات + الطلبات) تبقى في الكاش** — TanStack يُبقي آخر بيانات ناجحة عند الخطأ.
3. خلال أقل من 60s من T0، يدخل المستخدم **B** من نفس التبويب (Google/WhatsApp) → `setToken(B)` → إبطال `me` فقط → تحويل إلى `?redirect=/wallet`.
4. `/wallet` يركّب `useGetWallet`: الكاش يحمل بيانات A بعمر < 60s → **fresh → لا refetch إطلاقًا** → B يرى **رصيد A وسجل شحناته**. لا يوجد `refetchInterval` ولا أي مُبطِّل لاحق والتبويب مرئي — العرض خاطئ إلى أجل غير مسمى عمليًا (حتى resync إعادة-الإظهار التالي ≥30s، أو تنقّل يعيد التركيب بعد 60s).
   - حتى لو كان عمر البيانات >60s: stale-while-revalidate يعرض رصيد A أولًا (نافذة وميض مال).

**الإصلاح المحدد:** في `setToken` داخل AuthProvider — عند تغيّر الهوية (وليس silent rotation)، أبطِل عائلات المستخدم كاملة:

```ts
queryClient.invalidateQueries({ predicate: q =>
  String(q.queryKey[0]).startsWith("/api/orders") ||
  q.queryKey[0] === "/api/wallet" || q.queryKey[0] === "/api/wallet/topups" ||
  q.queryKey[0] === "/api/auth/me");
```

(أبسط بديل: `queryClient.removeQueries` لنفس الـpredicate في مُوجِّه 401 — الحذف يمنع حتى الوميض.) النقطة الجوهرية: **`queryClient.clear()` موجود في `logout()` فقط؛ مسار انتهاء الجلسة 401 هو الأكثر شيوعًا على الأجهزة المشتركة وهو غير مغطى.**

---

### F-02 [P2] مفتاح نية الشراء في product.tsx لا يصمد عبر unmount/refresh/back-navigation

**الأدلة:** `product.tsx:253-261`:

```ts
const buyIntentKeyRef = useRef<string | null>(null);   // ← يضيع مع unmount
...
const intentKey = buyIntentKeyRef.current ?? generateIdempotencyKey();
buyIntentKeyRef.current = intentKey;
```

التعليق (product.tsx:238-252) يوثّق صراحة أن network-failure **يُبقي** المفتاح «لأن إعادة المحاولة يجب أن تعيد الـreplay» — وهذا صحيح **فقط ما دام المُكوِّن حيًا**.

**سيناريو الفشل:** هاتف على شبكة متقطعة (الحالة التي بُني لها الإصلاح):

1. المستخدم يضغط «شراء» على `/product/x` → الطلب يصل الخادم ويُخصم الرصيد، لكن الاستجابة تضيع (نفق/انقطاع) → `TypeError: Failed to fetch` → رسالة خطأ.
2. المستخدم يعمل **refresh** (أو back ثم إعادة دخول للصفحة، أو PWA cold-resume) — `useRef` صفر من جديد.
3. يضغط «شراء» مجددًا → **مفتاح جديد** → الـmiddleware الخلفي لا يجد تطابقًا → **طلب ثانٍ = خصم مزدوج** — عودة كاملة لعلة R96-A4 §2.3 التي أغلقها 96-F4.

لاحظ التباين: checkout.tsx (96-F4 §2.2) خزّن مفاتيحه في **sessionStorage** فنجا من refresh — صفحة المنتج لم تنل نفس المعالجة.

**الإصلاح المحدد:** انقل مفتاح النية إلى sessionStorage بنفس نمط checkout (`subnation_buykey:{productId}`) — توليد lazy، حذف عند الحسم النهائي (2xx أو ApiError)، بقاء عند فشل الشبكة، try/catch حول كل وصول. سطرٌ واحد في `loadCheckoutUnitKey` موجود أصلًا كنمط قابل لإعادة الاستخدام (checkout.tsx:121-143).

---

### F-07 [P3] مفاتيح checkout بلا TTL وبلا intent-binding — مفتاح قديم قد يبتلع نية شراء جديدة

**الأدلة:** `checkout.tsx:115-143` (المفاتيح `subnation_checkout_key:{productId}:{unitIndex}` بلا طابع زمني أو nonce) + `checkout.tsx:423-424` (إعادة استخدام أي مفتاح مخزّن).

**سيناريو الفشل:** فشل شبكي غير محسوم للوحدة 0 من المنتج A (المفتاح يبقى عمدًا — سليم لغرض الـreplay). المستخدم يغادر، ثم **بعد ساعات** في نفس التبويب (SPA حي / sessionStorage حي) يشتري المنتج A مجددًا كنية جديدة → الوحدة 0 تجد المفتاح القديم → الخادم يعيد الرد المخزّن (نافذة 24h) → **لا تُنشأ وحدة جديدة** رغم أن السلة حُسبت ووُجهت. المستخدم دفع مرة واحدة ويستلم مرة واحدة لكن نيته الثانية تُبتلع بصمت.

**الإصلاح المحدد:** خزّن مع المفتاح طابع `Date.now()` وتجاهل/تدوير المفاتيح الأقدم من 15 دقيقة (`loadCheckoutUnitKey` يعيد null عند التقادم)، أو اربط المفاتيح بـ fingerprint للسلة (hash لـ productId×qty) يُولَّد عند كل mount للصفحة.

---

### F-08 [P3] إرسال شحن مزدوج عبر Enter (النموذج يتجاوز disabled)

**الأدلة:** `wallet.tsx:626-693` — `handleSubmit` يبدأ بالتحقق من القيم لكن **بلا** `if (submitting || topupMutation.isPending) return;`؛ والزر (wallet.tsx:1167-1172) `disabled={submitting || topupMutation.isPending}` — لكن **Enter داخل أي input يُرسل `<form onSubmit>` مباشرة** بغضّ النظر عن حالة الزر (زر الإرسال disabled لا يمنع implicit submission لحقل نصي واحد على الأقل).

**سيناريو الفشل:** ضغطتا Enter متتاليتان سريعتان (عادة شائعة مع تردد الشبكة): النداء الأول يُنشئ الشحن (onSuccess: تدوير المفتاح + فتح نافذة الانتظار)، والثاني ينطلق بنفس اللحظة قبل re-render بنفس `Idempotency-Key` → الخادم يرد **409 in-flight** → `onError` يضع بانر خطأ (wallet.tsx:617-619) **فوق نافذة الانتظار المفتوحة** — UX مربك في مسار مال. لا خصم مزدوج (حارس الخادم يعمل) لكن العرض متناقض.

**الإصلاح المحدد:** أول سطر في `handleSubmit`: `if (submitting || topupMutation.isPending) return;` — مع تجاهل أخطاء 409 conflict في onError برسالة هادئة (المعروفة من middleware idempotency).

---

### F-09 [P3] السلة: لا مزامنة multi-tab → lost-update حقيقي

**الأدلة:** `lib/cart.tsx:54-130` — القراءة في `useEffect` عند mount فقط، والكتابة داخل `setItems` — **لا listener لحدث `storage`** (القناة القياسية لبث تغييرات localStorage بين التبويبات).

**سيناريو الفشل (سطح مكتب، مستخدم قدير):** تبويب أ: إضافة منتج X (كتابة `[X]`)؛ تبويب ب كان مفتوحًا قبلها بحالة `[]` داخل `useState`؛ يضيف المستخدم Y في ب → `setItems(prev=[…])` يكتب `[Y]` → **اختفاء X الصامت** (آخر كتابة تكسب). كذلك شارة السلة في Navbar/MobileNav لأي تبويب لا ترى إضافات الآخر حتى refresh.

**الإصلاح المحدد:** في CartProvider:

```ts
useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY || e.newValue === null) return;
    try {
      const parsed = JSON.parse(e.newValue);
      if (Array.isArray(parsed)) setItems(parsed);
    } catch {}
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}, []);
```

(مع العلم أن `storage` لا يُطلق في التبويب الكاتب نفسه — يبقى التزامن أحادي الاتجاه وهو المطلوب).

---

### F-10 [P3] NotificationBell: سباق آخر-كاتب-يكسب + unhandledrejection + optimistic بلا rollback

**الأدلة:**

- `NotificationBell.tsx:139-177` — `fetchAll` نداءات متزامنة ممكنة (socket event + interval 60s + visibilitychange) **بلا AbortController أو رقم تسلسل** — استجابة قديمة تصل بعد الجديدة فتمحوها من الشاشة (الشارة تسقط لحظيًا حتى الدورة التالية).
- `NotificationBell.tsx:179-198` — `markAllRead`/`markRead`: `await fetch(...)` **بلا try/catch**، تُستدعى بـ `void markRead(...)` (الأسطر 202، 309، 547-552) → لمس «تحديد كمقروء» بلا شبكة = **unhandled promise rejection** (يصل buffer الـSentry فيُصبح ضجيج مراقبة، boot-sentry.ts:110-116)؛ والتحديث المتفائل `setNotifs(prev => …is_read: true)` بلا rollback عند فشل الطلب → الجرس «كذب» حتى الدورة التالية.

**الإصلاح المحدد:** (أ) رقم تسلسل تصاعدي `fetchSeqRef` — `if (seq !== ++latest) return;` قبل `setNotifs`؛ (ب) `try/catch` حول fetch مع rollback بسيط أو توست فشل؛ (ج) الاكتفاء بعدم العدّ عند 401 (اليوم `if (!r.ok) return` بصمت — والطلب يعود كل 60s بلا نهاية).

---

## 3) المحور 2 — إعداد TanStack Query + queryKeys + اكتمال الإبطالات

### إعدادات App.tsx مقابل مطالبات r96 — تحقق مطابقة ✅ مع ثغرة retry

`App.tsx:183-203`: `staleTime: 60_000` · `gcTime: 5×60_000` · `retry: 1` · `refetchOnWindowFocus: false` · `refetchOnReconnect: false` — كلها مطابقة لما وثّقته الجولة 96 (وأضافت resync موجّه عبر socket/visibility — SocketInitializer.tsx:43-53 مؤكد حي).

### F-13 [P3] `retry: 1` يُعيد محاولة 4xx أيضًا

TanStack v5 لا يستثني 4xx من retry — مع `retry: 1` عام: كل 401 (يردده مرتين قبل تفعيل مُوجِّه الجلسة — تأخير ~1s للتحويل)، وكل 404 منتج (product.tsx by-slug يضبط `retry:false` بينما byId يرث 1 — عدم اتساق داخل نفس الصفحة). ليست عاصفة (لا retryDelay مخصص = backoff قصير)، لكنها طلبات محكومة بالفشل مضاعفة على الهاتف.

**الإصلاح المحدد:** دالة retry مشتركة في App.tsx:

```ts
retry: (failureCount, error) => {
  const status = (error as { status?: number })?.status;
  if (status && status >= 400 && status < 500) return false;
  return failureCount < 1;
};
```

### F-06 [P2] الشراء المفرد لا يُبطل `/api/wallet` — صفحة المحفظة تكذب بعد الشراء

**الأدلة:** `product.tsx:278-289` يُبطل `getGetMeQueryKey()` (رقاقة الشريط) و`getListOrdersQueryKey()` فقط — **لا `getGetWalletQueryKey()`**. بينما `checkout.tsx:504` يُبطله بعد الشراء المتعدد. صفحة `/wallet` تعرض `wallet.balance` من `/api/wallet` (wallet.tsx:756) — نقطة بيانات **مختلفة** عن `me.wallet_balance`.

**سيناريو الفشل:** شراء مفرد ناجح من صفحة المنتج → رقاقة الرصيد في Navbar تنخفض فورًا (me refreshed) → المستخدم يفتح `/wallet` خلال <60s من آخر جلب → الكاش fresh → **لا refetch** → الصفحة تعرض الرصيد ما قبل الشراء بينما الشريط يقول غير ذلك — على مسار مال، مباشرة بعد الدفع.

**الإصلاح المحدد:** سطر واحد بعد نجاح `createOrder` في product.tsx:
`queryClient.invalidateQueries({ queryKey: getGetWalletQueryKey() });` (استيراد موجود أصلًا في checkout.tsx:26 — نفس الـmodule).

### جرد اكتمال الإبطالات (mutations المؤثرة)

- checkout unit-loop: me+wallet+orders ✅ (+ منع تسميم HTTP cache عبر `cache:"no-store"` — checkout.tsx:330-337 وproduct.tsx:278-285 — تصميم ممتاز).
- topup onSuccess: topups+wallet ✅ (wallet.tsx:609-610).
- socket order-updated: predicate `/api/orders*` ✅ (use-socket.ts:58-63 — يغطي الlist بكل variants والdetail — صحيح لأن مفتاح الdetail نصي `/api/orders/${code}`).
- socket topup-updated: topups+wallet ✅.
- socket-resync: orders+wallet+topups+me ✅.
- **الفجوة الوحيدة المكتشفة = F-06** (product.tsx wallet).

---

## 4) المحور 3 — تسريبات الذاكرة (فحص شامل لكل useEffect/اشتراك/مؤقت)

**الحصيلة الإجمالية: نظيفة شبه كاملة.** فُحص كل `useEffect` في الملفات المستهدفة مع cleanup:

| العنصر                                          | الحالة                                                             | الدليل                              |
| ----------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------- |
| TopupWaitingModal countdown                     | ✅ `clearInterval` في cleanup                                      | TopupWaitingModal.tsx:99-115        |
| OTP cooldown (setTimeout متسلسل)                | ✅                                                                 | WhatsAppPhoneSignIn.tsx:152-156     |
| OTP expiry interval                             | ✅                                                                 | WhatsAppPhoneSignIn.tsx:160-166     |
| settling auto-retry timer                       | ✅ يُلغى عند unmount + resetFlow (منع ghost-request)               | WhatsAppPhoneSignIn.tsx:170,185-190 |
| socket.io handlers (use-socket)                 | ✅ `off()` بالاسم لكل حدث + حارس `active` يمنع التسجيل بعد cleanup | use-socket.ts:133-142 + 39          |
| admin socket handlers                           | ✅ نفس النمط + `active` guard                                      | SocketInitializer.tsx:168-215       |
| socket lifecycle listeners (disconnect/connect) | ✅ تسجيل مرة عند الإنشاء مع off-before-on                          | lib/socket.ts:110-116               |
| online/visibility/resync listeners              | ✅ removeEventListener كامل                                        | SocketInitializer.tsx:148-156       |
| NotificationBell (interval+2 listeners)         | ✅                                                                 | NotificationBell.tsx:239-243        |
| MobileNav visualViewport                        | ✅                                                                 | MobileNav.tsx:49-65                 |
| checkout balance probe                          | ✅ علم `aborted`                                                   | checkout.tsx:238-241                |
| AuthProvider probes                             | ✅ علم `cancelled`                                                 | auth.tsx:282-284                    |
| Firebase refresh listener                       | ✅ unsubscribe + حارس installedRef + إلغاء عند إلغاء قبل التهيئة   | auth.tsx:296-337                    |
| SessionManager                                  | ✅ علم `cancelled`                                                 | SessionManager.tsx:55-57            |
| home debounce + IntersectionObserver            | ✅                                                                 | home.tsx:179-184, 230-240           |
| AuthGate splash timer                           | ✅                                                                 | App.tsx:594-598                     |
| DeferredSocketInitializer timer                 | ✅                                                                 | App.tsx:513-521                     |

**الاستثناءات (F-12 وF-17):**

### F-12 [P3] `disconnectSocket()` يخسر سباق import السوكت الأول

`lib/socket.ts:80-123`: `getSocket()` ينفّذ `await import("socket.io-client")` ثم **بعده** يسند `socket = io(...)`. لو استُدعي `disconnectSocket()` (auth.tsx:147 logout / user-session.ts:157 انتهاء جلسة) أثناء الاستيراد المعلق → `socket` ما زال null → الشرط `if (socket)` يمنع أي شيء → الاستيراد يكتمل لاحقًا → **سوكت يُنشأ ويُوصل بعد الخروج**، بلا كوكي صالح → `connect_error` يدور بلا نهاية (Infinity attempts، backoff 10s، console.warn كل دورة SocketInitializer.tsx:117-121 يظهر فقط بعد mount المتأخر 3.5s) + singleton حي يعني `reviveSocket()` على online/visibility يعيد المحاولة للأبد.

**الإصلاح المحدد:** علم إبطاء في socket.ts:

```ts
let disposed = false;
// في getSocket(): بعد import: if (disposed) return null;
// في disconnectSocket(): disposed = true; socket?.disconnect(); socket = null;
// في connectSocket(): disposed = false; (بداية جديدة شرعية)
```

### F-17 [P3] لائحة بقايا صغرى (بلا أثر ذاكرة فعلي، تُوثَّق للنظافة)

- `use-confirm.tsx:78-113`: `ConfirmDialog = useCallback(() => <AlertDialog…/>, [state, settle])` — مكوِّن يُعرَّف داخل render → تغيّر identity عند كل open/close يعيد تركيب الحوار (فقدان animation الخروج، إعادة init لـfocus-trap). النمط يعمل لكنه anti-pattern معروف. الإصلاح: مكوِّن ثابت يقرأ الحالة من context أو props عادية.
- `home.tsx:667`: `setTimeout(() => setShowSearchHistory(false), 200)` بلا تخزين/إلغاء — setState بعد unmount محتمل (no-op في React 18+، ضجيج فقط).
- `AuthProviders.tsx:221-230`: fetch الـproviders بلا abort/`cancelled` — نفس الصنف.
- `checkout.tsx:533`: بعد نجاح كامل يُستدعى `navigate(/orders/${code})` حتى لو كان المستخدم قد غادر checkout أثناء المعالجة (اللوب قد يمتد ثواني على 3G) — يخطف تنقل المستخدم اللاحق. الإصلاح: علم `abandonedRef` عند unmount أو مقارنة location.

---

## 5) المحور 4 — Error Boundaries والصمود

**مؤكد سليم (لمنع إعادة الفحص):**

- **Chunk failure → recovery:** `lazy-with-retry.ts` يغطي كل أنماط Vite/Webpack/Safari، reload واحد لكل pathname (sessionStorage guard) ثم يترك للأولاد إلى ErrorBoundary — سليم ومصمم جيدًا (lazy-with-retry.ts:45-96).
- **unhandledrejection/error:** مثبّتان تزامنيًا في boot-sentry (boot-sentry.ts:101-117) مع buffer 32 حدثًا وflush بعد تحميل Sentry — لا ضياع. React 19 handlers مثبتة في main.tsx:129-131.
- **لا retry storm:** retry:1 + لا polling عدواني (كل استقصاءات الأدمن 300s fallback مع socket-driven invalidation — dashboard.tsx:222-245).
- **Sentry off critical path** مع buffer — سليم.
- **Splash/AuthGate:** عتبة 250ms ذكية (App.tsx:590-611) — لا flash.

### F-14 [P3] ErrorBoundary يُصفَّر بأي re-render للأب

`ErrorBoundary.tsx:44-49`:

```ts
componentDidUpdate(prevProps) {
  if (this.state.hasError && prevProps.children !== this.props.children) {
    this.setState({ hasError: false, error: undefined });
  }
}
```

`children` identity تتغير عند **كل** render للأب (AppRoutes) — وليس فقط عند التنقل. تعليق الكود يفترض «route change» لكن التطبيق أوسع: تغيّر `token` في useAuth (AppRoutes.tsx:389) أو أي re-render للـAppRoutes. سيناريو: صفحة تتعثر في render (بيانات شاذة) → شاشة الخطأ → أي نبضة context للأب → إعادة تركيب الصفحة المتعطلة → تعثر مجدد → وميض حلقي بين شاشة الخطأ والصفحة (والـSentry يستقبل تكرارات). الإصلاح: قارن `location` فقط (مرِّر `resetKey` من المسار) بدل children identity.

### F-11 [P3] جزر raw-fetch خارج حماية customFetch (مهلة + مُوجِّه 401)

جردٌ بالـgrep وجد **~40 موقعًا** لـ`fetch(/api/…)` مباشرة. الأهم في مسارات المال والجلسة:

- `checkout.tsx:213` (probe الرصيد `/api/auth/me` — بلا مهلة: NAT ميت = `balanceLoading` لا نهائي نظريًا؛ وبلا مُوجِّه 401: جلسة منتهية = بانر «تعذّر التحقق من رصيدك» بدل التحويل للدخول — التحويل لا يحدث إلا إذا ضغط المستخدم «تأكيد الطلب» فيمر createOrder عبر customFetch).
- `checkout.tsx:274,373` + `product.tsx:309` (validate الكوبون) — نفس النقص.
- `NotificationBell.tsx:142-145` — 401 يعود بصمت كل 60s بلا تحويل (الجلسة منتهية والجرس يظل «حيًا» بصمت).

**الإصلاح المحدد:** helper صغير `rawApiFetch(path, init)` في `lib/api-config.ts` يلفّ fetch بـ`AbortSignal.timeout(20_000)` ويستدعي `handleUserUnauthorized(url)` عند 401 — ثم استبدال تدريجي للمواقع الأربع الحرجة أعلاه (البقية إدارية ولها `isAdminUnauthorized` يدوي في معظمها).

---

## 6) المحور 5 — حالة المصادقة

**مؤكد سليم (لمنع إعادة الفحص):**

- **Firebase token rotation:** `suppressNextTokenRefresh` بعد exchange يمنع سباق «أنشأ للتو جلسة ثم أعد تحديثها فورًا» (firebase-auth.ts:108-111,169-175)؛ cooldown 30s + circuit breaker (3 فشل → 5 دقائق) — `setTokenSilently` لا يُبطل me فلا وميض «خروج ودخول» (auth.tsx:94-108). تصميم ممتاز.
- **probe الإقلاع:** `Promise.allSettled` + `cancelled` (auth.tsx:212-288)؛ seeding كاش me من probe — بلا سباق (الشجرة تُركّب بعد initializing=false).
- **Telegram auto-login:** مرة واحدة، فقط لغير المسجلين، فشل صامت (use-telegram-webapp-auto-login.ts:38-88).
- **COOKIE_AUTH_SENTINEL:** "Bearer **cookie_session**" يُرسل كـheader عديم الفائدة من ~18 موقعًا — الخادم يقرأ الكوكي أولًا (موثق ومتحقق r96) — هدر تشخيصي فقط.
- **login أثناء استعلامات مال جارية:** الـqueryFn يُعاد بناؤه من render الجديد بالتوكن الجديد، والمفاتيح ثابتة — التحكم عبر إبطال setToken (وهو موضوع F-01 نفسه — الشفاء من F-01 يشفي هذا المسار).

### F-01 (انظر §2) — قلب هذا المحور.

### F-04 [P2] عزلة جلسة الأدمن: لا مسح كاش عند التبديل/الخروج

**الأدلة:**

- `auth.tsx:110-112` — `setAdminToken` **لا يُبطل شيئًا** (مقارنة بـsetToken الذي يبطل me).
- `auth.tsx:152-169` — `adminLogout` (best-effort fetch) ثم `setAdminToken(null)` — **لا `queryClient.clear()` ولا removeQueries** — عكس `logout()` المستخدم الذي ينظف (auth.tsx:149).
- `admin-session.ts:119-144` — مُوجِّه 401 للأدمن: `setAdminToken(null)` + تحويل — بلا مسح أيضًا.
- الأدمن لا يملك invalidation عند دخول أدمن **جديد**: dashboard يستقصي كل 300s فقط (dashboard.tsx:230-244) ويعرض الكاش فورًا.

**سيناريو الفشل:** أدمن A على لوحة الطلبات (كاش: /api/admin/orders + users مع أرقام هواتف). تنتهي جلسته (أو يخرج عبر adminLogout) → يدخل أدمن B على نفس المتصفح خلال دقائق → `useGetAdminStats`/`useListAdminOrders` تركّب وكاش A **fresh (<60s) أو stale-but-displayed** → لوحة B تعرض إحصاءات/طلبات/مستخدمي A (وخلال >60s تُصلَح بعد refetch خلفي؛ خلال <60s **لا refetch إطلاقًا** وحتى 300s). تسرب PII إداري بين مشغّلين على جهاز مشترك.

**الإصلاح المحدد:** في `adminLogout` وبعد `setAdminToken` في مُوجِّه 401: `queryClient.removeQueries({ predicate: q => String(q.queryKey[0]).startsWith("/api/admin") })` + إبطال `admin-alerts*`؛ وفي صفحة admin/login بعد نجاح الدخول: نفس الـremove قبل التنقل.

---

## 7) المحور 6 — دورة حياة Socket.IO

**مؤكد سليم:**

- **Backoff:** `reconnectionAttempts: Infinity` + `reconnectionDelayMax: 10s` (socket.ts:95-99) — مطابق لإصلاح 96-F3، سليم.
- **تسجيل المعالجات:** off-before-on بأسماء module-level في socket.ts:113-116,135-136,154-155 — لا تكرار أبدًا؛ معالجات use-socket تُزال بالاسم في cleanup (use-socket.ts:133-141) — لا تسريب ولا مضاعفة.
- **Revival:** online/visibilitychange → `reviveSocket()` idempotent (SocketInitializer.tsx:135-146 + socket.ts:172-177) — حي.
- **Resync مرة واحدة لكل دورة انقطاع موثّقة** — علم wasDisconnected مع استثناء «io client disconnect» المدروس (socket.ts:60-78) — تصميم صحيح.
- **التسليم للغرف من الخادم مباشرة من الكوكي** (auto-join عند الاتصال) — أمان الغرف قوي خادميًا (backend socket.ts:34-41, 662+).

### F-03 [P2] الغرفة تُربط عند الاتصال — تبديل حساب بلا خروج يترك السوكت في غرفة القديم

**الأدلة (تقاطع الواجهة/الخلفي):**

- الخادم: «SERVER-DRIVEN room joining on connect… Client-emitted `join-user` payloads are treated as defensive idempotent NO-OPs» — `backend/src/lib/socket.ts:34-41`، و`authorizeJoinUser` مجرد sanity-check (228-241). الغرفة تُشتق من **هوية الكوكي لحظة المصافحة**.
- الواجهة: `lib/socket.ts:18-23` تعليق يدّعي: «after an account switch the room re-join always uses the new identity — never a stale closure» — **ادّعاء مخالف للعقد الفعلي**. و`connectSocket()` على سوكت متصل يكتفي بـ`handleUserConnect()` (emit join-user) — socket.ts:138-145 — الذي هو no-op خادميًا.
- المسارات التي تقطع السوكت عند تبديل الهوية: `logout()` (auth.tsx:147) و401 (user-session.ts:157) ✅. **المسار غير المغطى:** A مسجّل → يفتح `/login` يدويًا (لا redirect للمسجّلين — login.tsx لا يوجد فيه حارس token) → يدخل بـGoogle كحساب B → `setToken(B)` **دون أي disconnect**.

**السيناريو:** السوكت singleton لا يزال متصلًا بهوية A (membership خادمي: `user:A`):

1. B **لا يستقبل** أحداثه (order-updated/topup-updated/notification-new تذهب إلى `user:B` الفارغة) — تتحول اللحظية إلى «ميتة» لبقية الجلسة (حتى refresh).
2. أحداث A المالية (طلب اكتمل، شحن اعتُمد) **تصل إلى شاشة B** — toasts بأكواد طلبات A ورصيده تُعرض لمستخدم آخر — تسرب خصوصية + تُطلق invalidations صحيحة الشكل لكن على هوية خاطئة.
3. لا يوجد أي مسار تعافٍ ذاتي: لا reconnect يحدث (الاتصال سليم)، وliveness الخادم يجيز الجلسة لأن جلسة A ما زالت صالحة.

**الإصلاح المحدد:** في `connectSocket(userId)` — إذا كان السوكت متصلًا **وcurrentUserId تغيّر**: `s.disconnect(); s.connect();` (مصافحة جديدة تحمل كوكي B → auto-join صحيح)، أو ببساطة استدعِ `disconnectSocket()` من داخل `setToken` عند تغيّر قيمة التوكن من هوية لأخرى. ويجب تصحيح تعليق socket.ts:18-23 الكاذب (يمنع اكتشاف الانحدار مستقبلًا).

### F-12 (انظر §4) — ثغرة التهيئة الأولى مقابل الخروج.

---

## 8) المحور 7 — حالات النماذج

**مؤكد سليم (لمنع إعادة الفحص):**

- **OTP auto-submit:** حارس `autoSubmittedFor` يمنع الإرسال المزدوج لنفس القيمة؛ تحرير رقم واحد يولّد قيمة جديدة فيُعاد التحقق — صحيح (WhatsAppPhoneSignIn.tsx:352-365).
- **Paste:** onPaste يستخرج أول 6 أرقام من أي نص (رسالة WhatsApp كاملة) — سليم (503-514).
- **Backspace/حقل واحد:** لا مشكلة صناديق متعددة أصلًا — التصميم أحادي الحقل أبطل فئة مشاكل edge-cases كاملة.
- **البحث (home):** debounce 320ms مع cleanup، والفصل input/committed عبر حالتين، و**العزل بالمفاتيح**: `queryKey = getListProductsQueryKey(params)` يشمل القيم → استجابة قديمة لا يمكن أن تكتب فوق مفتاح أحدث — **لا يوجد سباق older-overwrites-newer** بنيويًا (home.tsx:152-212). ✅
- **كوبون checkout:** زر disabled أثناء couponChecking ولا تداخل نداءين ممكن (finally قبل تمكين جديد) + إبطال النتيجة عند تعديل الحقل أو السلة — سليم (checkout.tsx:268-316, 643-651).
- **تطبيع الهاتف +218/00218/218 وترتيب الفحص** — سليم (WhatsAppPhoneSignIn.tsx:73-78).

### F-05 [P2] أرقام Arabic-Indic تُحذف في مسار الدخول الأساسي

**الأدلة:** `WhatsAppPhoneSignIn.tsx:73-78`:

```ts
let digits = raw.replace(/\D/g, ""); // \d في JS = [0-9] فقط — ٠-٩ تُحذف
```

ونفس الشيء في `extractOtpDigits` (322-324). بالمقابل `wallet.tsx:162` (إصلاح 96-F6) يحوّل:

```ts
.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
```

**سيناريو الفشل:** مستخدم ليبي ينسخ رقمًا من جهة اتصال عربية بصيغة «٠٩١٢٣٤٥٦٧٨» (أو يلصق رمز OTP وصل مكتوبًا بأرقام هندية من تطبيق آخر) → الحقل يستقبل القيمة → normalize يمسح **كل** الأرقام → حقل فارغ → «رقم الهاتف غير صالح». مسار الدخول الأساسي في البلد مقفول أمامه بصمت، والنص الموجود في worklog 96-F2 («12 pure cases (+Arabic-Indic)») لا ينعكس في الكود — الاختبارات لم تغطِّ هذه الحالة فعليًا.

**الإصلاح المحدد:** سطر واحد مشترك (يُصدَّر من validation.ts):

```ts
const AR_DIGITS = /[٠-٩۰-۹]/g;
const toLatin = (s: string) =>
  s.replace(AR_DIGITS, (d) =>
    String("٠١٢٣٤٥٦٧٨٩".indexOf(d) >= 0 ? "٠١٢٣٤٥٦٧٨٩".indexOf(d) : "۰۱۲۳۴۵۶۷۸۹".indexOf(d)),
  );
```

ثم `normalizePhoneInput`/`extractOtpDigits` يبدآن بـ`toLatin(raw)` — مع حالات اختبار فعلية للأرقام الهندية.

### F-16 [P3] بحث بلا keepPreviousData → churn هيكلي

كل commit (بعد debounce) يبدّل queryKey → `data` يصبح undefined → skeleton كامل يعيد رسم الشبكة. على هواتف ضعيفة = وميض بحث «ثقيل». الإصلاح: `placeholderData: keepPreviousData(listProducts...)` في useListProducts (home.tsx:207-212) — يعرض النتائج السابقة أثناء جلب الجديدة (مع `isPlaceholderData` لتعتيم خفيف).

---

## 9) المحور 8 — Flash/CLS/RTL

**مؤكد سليم (لمنع إعادة الفحص):**

- **Auth-gated flash:** AuthGate يحجب الشجرة خلف probe مع عتبة splash 250ms وخلفية مطابقة — لا وميض خروج (App.tsx:590-611 + auth.tsx probe).
- **Theme FOUC:** `public/init.js` يطبّق `light` قبل React — لا وميض مظهر.
- **dir=rtl:** قفل تزامني في main.tsx:35 + useDocumentDirection في App.tsx:536 + direction.ts — لا انقلاب.
- **skeleton shapes:** ROUTE_SHAPES يختار شكل الوجهة (App.tsx:120-149) — تحسين r96 حي؛ البقية اتجاهات أداء موثقة في r96-A3.

لا نتائج جديدة P2+ في هذا المحور — استقرار كامل.

---

## 10) رصيد مؤكد سليم (تحقق مباشر بالكود — يمنع إعادة الفحص في الجولات القادمة)

1. **Idempotency keys للسلة** (96-F4 §2.2): lifecycle كامل موثق ومنفذ — lazy mint، حذف عند الحسم النهائي فقط، بقاء متعمَّد عند فشل الشبكة، try/catch حول sessionStorage (checkout.tsx:84-143, 423-424, 450-453, 482-494) — **الحماية المزدوجة صحيحة داخل عمر الجلسة** (الفجوات F-02/F-07 خارج هذا النطاق).
2. **socket revive + resync** (96-F3): Infinity/10s + online/visibilitychange + resync-one-shot — كلها حية (socket.ts:85-108, SocketInitializer.tsx:128-157).
3. **مهلة 20s + AbortSignal.any** في customFetch مع تمييز timeout-abort وتحويله لـ«Failed to fetch» العربي — ممتاز (custom-fetch.ts:358-441, 523-566).
4. **401 router المزدوج** (additive للمستخدم + slot للأدمن مع dedupe 15s) — معماريًا سليم (custom-fetch.ts:47-78, user-session.ts, admin-session.ts).
5. **TopupWaitingModal:** countdown بمصدر startedAt لكل effect (لا سباق تكتلات)، إبطال wallet عند انقلاب الحالة، رفض إغلاق أثناء الانتظار، aria-live — كله سليم.
6. **cart double-tap locks** (500ms بـ`useRef(null)` المهيأ null لا 0) — product.tsx:354-359 + ProductCard.tsx:166-171 — حي.
7. **coupon pre-flight قبل لوب الوحدات** + إزالة الكوبون الميت من الحقل + تقليص السلة لما حُسب فعلاً — منطق دقيق وسليم (checkout.tsx:357-400, 470-495).
8. **refreshMeBalance بـno-store + setQueryData مباشر** (منع تسميم HTTP cache) — checkout.tsx:318-337, product.tsx:270-285.
9. **منع double-fire في زر الشراء المفرد** (`if (!product || buyPending) return`) — product.tsx:257.
10. **Toast dedupe بمعرّفات مستقرة** (`order-${id}-${status}`, `topup-${amount}-${status}`, `notif-${id}`) — use-socket.ts:80,99,105, NotificationBell.tsx:166.
11. **quota guards + MAX_LINE_QUANTITY=99 + roundToCents** في السلة — سليمة.
12. **refs بدل state في حلقات استقصاء NotificationBell** (إصلاح توست الإعادة) — حي (NotificationBell.tsx:122-135).

---

## 11) خطة الإصلاح المرتبة (جاهزة للتنفيذ كموجة F)

1. **F-01 (P1 — سطران):** أبطال/إزالة عائلات المستخدم في `setToken` عند تغيّر الهوية + في مُوجِّه 401 (أو `queryClient.removeQueries` هناك). يغلق أيضًا مسار login-أثناء-استعلامات-جارية.
2. **F-02 (P2):** نقل مفتاح نية الشراء في product.tsx إلى sessionStorage بنمط checkout — إغلاق نافذة الخصم المزدوج عبر refresh/back.
3. **F-03 (P2):** إعادة مصافحة السوكت عند تغيّر الهوية في connectSocket + تصحيح التعليق الكاذب socket.ts:18-23.
4. **F-04 (P2):** `removeQueries("/api/admin*")` في adminLogout + مُوجِّه 401 + بعد نجاح admin login.
5. **F-05 (P2):** toLatin للأرقام الهندية في normalizePhoneInput/extractOtpDigits + اختبارات فعلية.
6. **F-06 (P2):** سطر إبطال `getGetWalletQueryKey()` في product.tsx بعد الشراء.
7. **F-07→F-17 (P3):** بالترتيب المذكور أعلاه — أغلبها سطور قليلة: TTL للمفاتيح، حارس دخول في handleSubmit، storage listener للسلة، sequence guard للجرس، rawApiFetch بمهلة+401، علم disposed في socket.ts، retry filter للـ4xx، resetKey للـErrorBoundary، inBackground:false للـTopupWaitingModal، keepPreviousData للبحث، مكوِّن ConfirmDialog ثابت.

**البوابات:** اختبارات جديدة لكل بند (نمط `__tests__` القائم) — خاصة: اختبار تسلسلي لمسار 401→login-B→wallet (F-01)، ومحاكاة refresh لمفتاح الشراء (F-02)، وswitch-identity للسوكت (F-03).

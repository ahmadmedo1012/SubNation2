# SubNation Mobile — Implementation Conventions (R191)

Read this before writing any code in `apps/mobile`. It encodes the official Expo
skills (expo-overview, expo-router, expo-design-system, expo-native-ui,
expo-data-fetching) applied to the SubNation brand. Violations will be rejected.

## Structure (expo-project-structure skill)

- `src/app/` — ROUTES ONLY. Never co-locate components/types/utils there.
- `src/screens/<name>/` — screen bodies + private components.
- `src/components/` — shared primitives (already built; consume, don't duplicate).
- `src/theme/` — the only place visual values live.
- `src/lib/` — transport, auth, cart, money, errors, idempotency (already built).
- Kebab-case filenames, no special characters. Route files may be `[slug].tsx`.

## Theme rules (expo-design-system skill)

- Import `{ useColors, spacing, radius, shadows, type }` from `@/theme`.
  `useColors()` inside components (dark default; light pairs automatic).
- NEVER hardcode a hex, fontSize, or spacing multiple in a screen. A value
  used twice belongs in `@/theme`.
- Text: only `<ThemedText variant="...">` from the ramp (largeTitle/title/
  headline/body/callout/subhead/footnote/caption/micro). Never raw fontSize.
  Readex Pro weights 400/600/700 only (fontFamily is set by the ramp).
- Radius via `radius.*` + `rounded()` helper (`borderCurve: "continuous"`).
- Shadows: `shadows.*` (CSS boxShadow strings) — never legacy shadow props.
- Money: `formatCurrency` from `@/lib/money` (LYD idiom: «1,234.50 د.ل»).
  Use `<PriceDisplay>` for prices. `fontVariant: ["tabular-nums"]` on counters.
- Icons: `<Icon sf="..." md="..." />` from `@/components/icon` — SF Symbol on
  iOS + MaterialIcons on Android, both names ALWAYS provided.

## Layout rules (expo-native-ui skill)

- Screens with scrollable content: ScrollView is the FIRST child of the route,
  with `contentInsetAdjustmentBehavior="automatic"`. FlatList screens: no outer
  ScrollView. Set `contentContainerStyle` padding/gap (not on the ScrollView).
- Safe areas: rely on stack headers + contentInsetAdjustmentBehavior +
  react-native-safe-area-context where needed. Never SafeAreaView from RN.
- `flex` gap + spacing tokens for rhythm; padding over margin. 44px minimum
  touch targets (`spacing.touch`).
- RTL: the app is RTL-forced. Use logical padding (paddingStart/End,
  paddingHorizontal). Money/numbers/code rows wrap in `direction: "ltr"`.
- Arabic strings are inline JSX (no i18n system — mirror the web).
- Keyboard: `keyboardShouldPersistTaps="handled"` on scrollable forms.

## Data rules (expo-data-fetching skill)

- Use the generated client hooks from `@workspace/api-client-react`:
  `useListProducts`, `useGetProductBySlug`, `useGetCart`… (plain fetchers
  `listProducts()`, `getWallet()` also exported for imperative use).
- EVERY data screen implements the four states: loading (skeleton/spinner),
  error (retry; keep stale content + InlineError on refresh failure), empty
  (designed EmptyState with a next action), content. Never flash empty during
  the first load. `isLoading` = first fetch; `isFetching` = background.
- Mutations: disable repeat submit while pending, keep drafts on failure,
  clear only on success. Money mutations take an `Idempotency-Key` header via
  the mutation's `request.headers` option — see `@/lib/idempotency`.
- Error messages: `getErrorMessage(err)` from `@/lib/errors` (Arabic mapping).

## Auth rules

- `useAuth()` from `@/lib/auth` — `{ status: "hydrating"|"authenticated"|"guest", user, signIn, signOut, refresh }`.
- Guarded screens: render a sign-in prompt (guest state) rather than crashing.
- Never read the token directly; the transport injects Bearer + Origin.

## Navigation rules (expo-router skill)

- Stacks via `_layout.tsx` + `Stack` from `expo-router` (`expo-router/stack`).
  Screen titles via Stack options (`title`), NEVER a custom header text.
- Navigation with `<Link href="...">`; router.push/router.replace for logic.
- Tabs are NativeTabs in `src/app/(tabs)/_layout.tsx` — 5 fixed tabs,
  already specced: (home) الرئيسية, (wallet) المحفظة, (orders) طلباتي,
  (cart) السلة, (account) حسابي.

## Native slop — banned (expo-design-system skill)

- The Web Modal: no custom centered dialogs for picking/composing — use
  stack-pushed screens or native `Alert.alert` for confirmations.
- Everything's a Card: group with background + hairlines, not boxes-in-boxes.
- Emoji iconography: never.
- Spinner blink: no full-screen spinner between states; skeletons for known
  layouts.

## Quality bar

- Accessibility roles/labels on every interactive element; `selectable` on
  data text; disabled/busy states exposed.
- Every enabled control performs its advertised action (no dead buttons).
- Pressed feedback on every tappable (Pressable style function).

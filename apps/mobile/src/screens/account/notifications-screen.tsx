import { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { useRouter } from "expo-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  listNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  type NotificationItem,
  type NotificationsPage,
} from "@workspace/api-client-native";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { Skeleton } from "@/components/states";
import { ThemedText } from "@/components/themed-text";
import { useAuth } from "@/lib/auth";
import { getErrorMessage } from "@/lib/errors";
import { arabicCount } from "@/lib/money";
import { useColors, radius, spacing } from "@/theme";
import { formatRelativeTime } from "./dates";
import { SignInPrompt } from "./sign-in-prompt";

/**
 * Notifications — the native twin of the web's /notifications page:
 *   • the PAGED envelope contract (useListNotifications's ?page= form):
 *     the accumulating useInfiniteQuery rides the generated plain
 *     fetcher with the page+limit params (the hook form cannot express
 *     accumulating pages), and the envelope's honest hasMore gates
 *     load-more — unlike the orders plain-array contract, the server
 *     TELLS us whether a next page exists;
 *   • the TRUE total chip («عرض X من Y») from the envelope;
 *   • mark-read on tap + mark-all — optimistic overlay with exact
 *     rollback on failure, reconciled by the next refetch (the bell's
 *     silent-reconcile contract);
 *   • link navigation when present — internal routes only
 *     (/product/:slug, /orders/:code, /wallet); anything else is a
 *     no-op that still marks the row read;
 *   • the four states everywhere.
 */

/** The paged branch's default page size (the backend clamps to [1,100]). */
const NOTIFICATIONS_PAGE_SIZE = 20;

const NOTIFICATION_COUNT_FORMS = {
  zero: "إشعارات",
  one: "إشعار",
  two: "إشعاران",
  few: "إشعارات",
  many: "إشعاراً",
  other: "إشعار",
} as const;

/** Per-type presentation (the bell's TYPE_CONFIG, on theme tokens). */
type TypeConfig = { icon: { sf: string; md: string }; color: string };

export function NotificationsScreen() {
  const { status } = useAuth();

  if (status === "guest") {
    return (
      <SignInPrompt message="سجّل دخولك لعرض تنبيهات طلباتك ومحفظتك وردود الدعم في مكان واحد." />
    );
  }
  return <NotificationsContent />;
}

function NotificationsContent() {
  const colors = useColors();
  const router = useRouter();

  const {
    data: pages,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching,
  } = useInfiniteQuery({
    queryKey: ["/api/notifications", "paged"],
    queryFn: async ({ pageParam, signal }): Promise<NotificationsPage> => {
      // Naming the page param at all switches the response to the paged
      // envelope — the shape guard keeps a malformed 200 out of the cache.
      const d = await listNotifications(
        { page: pageParam as number, limit: NOTIFICATIONS_PAGE_SIZE },
        { signal },
      );
      if (!d || !Array.isArray((d as NotificationsPage).notifications)) {
        throw new Error("تعذّر تحميل الإشعارات");
      }
      return d as NotificationsPage;
    },
    initialPageParam: 1,
    // The envelope's honest flag — the server TELLS us whether a next
    // page exists.
    getNextPageParam: (lastPage, allPages) => (lastPage.hasMore ? allPages.length + 1 : undefined),
  });

  // Accumulated list — dedup by id: a notification landing between page
  // requests shifts offset boundaries, so a row can legitimately repeat.
  const rows = useMemo(() => {
    const seen = new Set<number>();
    const acc: NotificationItem[] = [];
    for (const page of pages?.pages ?? []) {
      for (const n of page.notifications) {
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        acc.push(n);
      }
    }
    return acc;
  }, [pages]);

  // The freshest page's total (each page re-counts; the last one is the
  // most current — a notification created mid-browse bumps it).
  const total = pages?.pages.at(-1)?.total ?? 0;

  // Read-state overlay: optimistic flips on the accumulated rows, exact
  // rollback on failure, reconciled by any later refetch (the POST
  // already persisted server-side).
  const [readOverlay, setReadOverlay] = useState<Set<number>>(new Set());
  const unread = useMemo(
    () => rows.filter((n) => !n.is_read && !readOverlay.has(n.id)).length,
    [rows, readOverlay],
  );

  const markReadMutation = useMarkNotificationRead();
  const markAllMutation = useMarkAllNotificationsRead();

  const markRead = useCallback(
    (id: number) => {
      if (readOverlay.has(id)) return;
      setReadOverlay((prev) => new Set(prev).add(id));
      markReadMutation.mutate(
        { id },
        {
          onError: () => {
            // Rollback — the next refetch carries the server truth.
            setReadOverlay((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        },
      );
    },
    [readOverlay, markReadMutation],
  );

  const markAllRead = useCallback(() => {
    if (unread === 0) return;
    const snapshot = readOverlay;
    setReadOverlay(new Set(rows.filter((n) => !n.is_read).map((n) => n.id)));
    markAllMutation.mutate(undefined, {
      onError: () => {
        setReadOverlay(snapshot);
      },
    });
  }, [unread, readOverlay, rows, markAllMutation]);

  // Internal link routing only — anything else is a no-op (the row is
  // still marked read: the tap was real even when the target isn't).
  const openNotification = useCallback(
    (n: NotificationItem) => {
      markRead(n.id);
      const link = n.link?.trim();
      if (!link) return;
      if (link.startsWith("/product/")) {
        const slug = link.slice("/product/".length).split(/[?#]/)[0];
        if (slug) router.push(`/(tabs)/(home)/product/${slug}`);
        return;
      }
      if (link.startsWith("/orders/")) {
        const code = link.slice("/orders/".length).split(/[?#]/)[0];
        if (code) router.push(`/(tabs)/(orders)/${code}`);
        return;
      }
      if (link === "/wallet" || link === "/wallet/") {
        router.push("/(tabs)/(wallet)");
      }
      // Unknown link → no-op (spec: internal routes only).
    },
    [markRead, router],
  );

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} style={{ height: 76, borderRadius: radius.md }} />
        ))}
      </View>
    );
  }

  // A background-refresh failure with stale rows on screen is NOT an
  // error screen — only a failed first load is.
  const loadError = isError && (pages?.pages.length ?? 0) === 0;

  if (loadError) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
          gap: spacing.md,
        }}
        accessibilityRole="alert"
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: `${colors.error}1A`,
            borderWidth: 1,
            borderColor: `${colors.error}38`,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon
            sf="wifi.exclamationmark"
            md="signal_wifi_connected_no_internet4"
            size={28}
            color={colors.error}
          />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          تعذّر تحميل الإشعارات
        </ThemedText>
        <ThemedText
          variant="subhead"
          style={{ textAlign: "center", color: colors.onSurface }}
          selectable
        >
          {getErrorMessage(error)}
        </ThemedText>
        <Button title="إعادة المحاولة" variant="secondary" onPress={() => void refetch()} />
      </View>
    );
  }

  if (rows.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: colors.background,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xxl,
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: radius.full,
            backgroundColor: colors.secondary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Icon sf="bell.slash" md="notifications_none" size={28} color={colors.onSurface} />
        </View>
        <ThemedText variant="headline" style={{ textAlign: "center" }}>
          لا توجد إشعارات
        </ThemedText>
        <ThemedText variant="subhead" style={{ textAlign: "center", color: colors.onSurface }}>
          ستظهر هنا تنبيهات طلباتك وشحن محفظتك وردود الدعم
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header toolbar — the count chip + mark-all */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: spacing.sm,
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.md,
          paddingBottom: spacing.xs,
        }}
      >
        <View
          style={{
            backgroundColor: colors.surfaceCard,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.full,
            paddingHorizontal: spacing.md,
            paddingVertical: spacing.xs,
          }}
        >
          <ThemedText variant="footnote" style={{ color: colors.onSurface }}>
            {/* The envelope carries the TRUE total — «عرض X من Y» until
                the last page lands, then the plain count. */}
            {rows.length < total
              ? `عرض ${arabicCount(rows.length, NOTIFICATION_COUNT_FORMS)} من ${arabicCount(
                  total,
                  NOTIFICATION_COUNT_FORMS,
                )}`
              : arabicCount(total, NOTIFICATION_COUNT_FORMS)}
          </ThemedText>
        </View>
        {unread > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="تحديد الكل كمقروء"
            onPress={markAllRead}
            hitSlop={4}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.xs,
              minHeight: 36,
              paddingHorizontal: spacing.md,
              opacity: markAllMutation.isPending ? 0.4 : pressed ? 0.7 : 1,
            })}
            disabled={markAllMutation.isPending}
          >
            <Icon sf="checkmark.circle.fill" md="done_all" size={14} color={colors.primary} />
            <ThemedText
              variant="footnote"
              style={{ color: colors.primary, fontFamily: "ReadexPro-SemiBold" }}
            >
              تحديد الكل كمقروء
            </ThemedText>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        data={rows}
        keyExtractor={(n) => String(n.id)}
        renderItem={({ item }) => (
          <NotificationRow
            notification={item}
            read={item.is_read || readOverlay.has(item.id)}
            onOpen={() => openNotification(item)}
            onMarkRead={() => markRead(item.id)}
          />
        )}
        contentContainerStyle={{
          paddingHorizontal: spacing.lg,
          paddingTop: spacing.xs,
          paddingBottom: spacing.xl,
          gap: spacing.md,
        }}
        ListFooterComponent={
          hasNextPage ? (
            <View style={{ alignItems: "center", paddingTop: spacing.sm }}>
              <Button
                variant="secondary"
                title="تحميل المزيد"
                loading={isFetchingNextPage}
                disabled={isFetching && !isFetchingNextPage}
                onPress={() => void fetchNextPage()}
              />
            </View>
          ) : undefined
        }
      />
    </View>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────────

function notificationTypeConfig(colors: ReturnType<typeof useColors>, type: string): TypeConfig {
  switch (type) {
    case "wallet":
      return {
        icon: { sf: "creditcard.fill", md: "account_balance_wallet" },
        color: colors.success,
      };
    case "order":
      return { icon: { sf: "bag.fill", md: "shopping_bag" }, color: colors.info };
    case "support":
      return { icon: { sf: "message.fill", md: "chat_bubble" }, color: colors.primary };
    case "loyalty":
      return { icon: { sf: "star.fill", md: "star" }, color: colors.warning };
    case "product":
      return { icon: { sf: "shippingbox.fill", md: "inventory_2" }, color: colors.primaryText };
    default:
      return { icon: { sf: "info.circle.fill", md: "info" }, color: colors.onSurface };
  }
}

function NotificationRow({
  notification,
  read,
  onOpen,
  onMarkRead,
}: {
  notification: NotificationItem;
  read: boolean;
  onOpen: () => void;
  onMarkRead: () => void;
}) {
  const colors = useColors();
  const cfg = notificationTypeConfig(colors, notification.type);
  const hasLink = isInternalLink(notification.link);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={notification.title + (hasLink ? " — افتح" : "")}
      accessibilityHint={hasLink ? "يفتح المحتوى المرتبط بالإشعار" : "يحدّد الإشعار كمقروء"}
      onPress={onOpen}
      style={({ pressed }) => [
        {
          backgroundColor: read ? colors.surfaceCard : `${colors.primary}0D`,
          borderRadius: radius.md,
          borderCurve: "continuous",
          borderWidth: 1,
          borderColor: read ? colors.border : `${colors.primary}4D`,
          borderStartWidth: read ? 1 : 3,
          borderStartColor: read ? colors.border : colors.primary,
          padding: spacing.md,
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: spacing.md }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            borderCurve: "continuous",
            backgroundColor: `${cfg.color}1A`,
            borderWidth: 1,
            borderColor: `${cfg.color}33`,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 2,
            flexShrink: 0,
          }}
        >
          <Icon sf={cfg.icon.sf} md={cfg.icon.md} size={15} color={cfg.color} />
        </View>

        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.xs }}>
            <ThemedText
              variant="subhead"
              numberOfLines={2}
              style={{
                flex: 1,
                fontFamily: read ? "ReadexPro-Regular" : "ReadexPro-SemiBold",
                color: read ? colors.onSurface : colors.foreground,
              }}
            >
              {notification.title}
            </ThemedText>
            {!read ? (
              <View
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: radius.full,
                  backgroundColor: colors.primary,
                  marginTop: 4,
                }}
                accessibilityLabel="إشعار غير مقروء"
              />
            ) : null}
          </View>
          {notification.message ? (
            <ThemedText variant="footnote" numberOfLines={2} style={{ color: colors.onSurface }}>
              {notification.message}
            </ThemedText>
          ) : null}
          <ThemedText variant="micro" style={{ color: colors.onSurface, marginTop: 2 }}>
            {formatRelativeTime(notification.created_at)}
          </ThemedText>
        </View>
      </View>

      {/* The row's trailing affordances */}
      {!read || hasLink ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: spacing.sm,
            marginTop: spacing.sm,
          }}
        >
          {hasLink ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: spacing.xs,
                backgroundColor: `${cfg.color}1A`,
                borderWidth: 1,
                borderColor: `${cfg.color}33`,
                borderRadius: radius.sm,
                borderCurve: "continuous",
                paddingHorizontal: spacing.md,
                minHeight: 36,
                justifyContent: "center",
              }}
            >
              <ThemedText
                variant="micro"
                style={{ color: cfg.color, fontFamily: "ReadexPro-SemiBold" }}
              >
                {linkActionLabel(notification.link)}
              </ThemedText>
              <Icon
                sf="arrow.turn.up.left"
                md="subdirectory_arrow_left"
                size={12}
                color={cfg.color}
              />
            </View>
          ) : null}
          {!read ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="تحديد كمقروء"
              onPress={(e) => {
                e.stopPropagation();
                onMarkRead();
              }}
              hitSlop={8}
              style={({ pressed }) => ({
                minHeight: 36,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "row",
                gap: spacing.xs,
                paddingHorizontal: spacing.sm,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Icon sf="checkmark.circle.fill" md="done_all" size={12} color={colors.onSurface} />
              <ThemedText variant="micro" style={{ color: colors.onSurface }}>
                تحديد كمقروء
              </ThemedText>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Link helpers (internal routes only — anything else is a no-op) ─────────

function isInternalLink(link: string | null | undefined): boolean {
  const value = link?.trim();
  if (!value) return false;
  if (value.startsWith("/product/")) {
    return value.length > "/product/".length;
  }
  if (value.startsWith("/orders/")) {
    return value.length > "/orders/".length;
  }
  return value === "/wallet" || value === "/wallet/";
}

function linkActionLabel(link: string | null | undefined): string {
  const value = link?.trim() ?? "";
  if (value.startsWith("/product/")) return "تصفّح";
  if (value.startsWith("/orders/")) return "تفاصيل الطلب";
  return "المحفظة";
}

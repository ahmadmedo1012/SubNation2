// R158 (hooks lane — decomposition): extracted verbatim from
// components/layout/NotificationBell.tsx — the notifications data
// machine (the notifs/loadState atoms, the poll/socket/resync
// freshness effect, the fetch-sequence + latest-list refs, the new-
// notification toast gate and the optimistic mark-read pair) moved
// here; the bell keeps the open/close UI wiring, the panel and
// TYPE_CONFIG (presentation). Behavior byte-identical: same requests,
// same effect order, same rollback contracts (notification-bell-*
// render suites pin them).
import { useCallback, useEffect, useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { NOTIFICATION_NEW_EVENT } from "@/lib/socket-events";
import { SOCKET_RESYNC_EVENT } from "@/lib/socket";
import { toast } from "@/hooks/useToast";

/**
 * The bell's visible-tab poll cadence.
 *
 * R192 (the Neon compute-quota incident): 60 s → 120 s. The poll is
 * foreground-only and every tab-switch-back refetches immediately
 * (the visibilitychange handler), so the badge still FEELS live; the
 * halved cadence halves the per-open-tab DB-read load against a
 * scale-to-zero database (each poll = session probe + uncached
 * notifications SELECT). The socket accelerators
 * (NOTIFICATION_NEW_EVENT on socket-bearing pages) are unchanged.
 */
const NOTIFICATION_POLL_INTERVAL_MS = 120_000;

export interface Notif {
  id: number;
  type: string;
  title: string;
  message: string | null;
  link: string | null;
  is_read: boolean;
  created_at: string;
}

/**
 * The bell's notifications data machine (R158 extraction): the list +
 * its honest tri-state, the 60 s visible-tab poll, the socket
 * accelerators (NOTIFICATION_NEW_EVENT / SOCKET_RESYNC_EVENT), the
 * latest-request-wins fetch sequencing and the optimistic mark-read
 * pair with exact rollback.
 */
export function useNotifications({ token }: { token: string | null }) {
  const [notifs, setNotifs] = useState<Notif[]>([]);
  // R153: the honest tri-state for the panel body — "loading" (the first
  // fetch is in flight; showing «لا توجد إشعارات» before ANY data arrived
  // overclaims), "ok", and "error" (the fetch failed and we hold no data
  // — an outage must never masquerade as an empty history, the 93-C5 /
  // F-05 class). Subsequent poll failures keep the stale list (still the
  // best data) and reconcile silently on the next successful tick.
  const [loadState, setLoadState] = useState<"loading" | "ok" | "error">("loading");

  // ── Refs (not state) for the polling closure to see the latest values ───
  //
  // The previous version held `prevUnreadIds` and `initialLoadDone` in
  // useState, but the polling effect's setInterval closure was keyed on
  // [token]. Once the effect ran, the closure captured the INITIAL state
  // values. Subsequent state updates re-rendered the component but did NOT
  // re-create the interval, so every 15 s the same stale closure ran with
  // `prevUnreadIds = Set()` and `initialLoadDone = false` — re-firing the
  // toast for every unread notification on every poll.
  //
  // Switching to refs: the polling closure reads `.current` which always
  // returns the latest value, no dep-array gymnastics needed.
  const lastSeenMaxIdRef = useRef<number>(0);
  const initialLoadDoneRef = useRef<boolean>(false);

  // 98-F7 (r97 F-10): request sequence for fetchAll — a slow 60 s poll
  // response that lands AFTER a socket-triggered refetch used to overwrite
  // the fresher list (last-arrival wins). Only the LATEST request may
  // write state.
  const fetchSeqRef = useRef(0);

  // 98-F7 (r97 F-10): latest-list mirror — the mark* callbacks below need
  // the PRE-optimistic snapshot for a failure rollback WITHOUT re-creating
  // their identities on every poll (same rationale as lastSeenMaxIdRef —
  // stable callbacks keep the panel prop identity stable). Synced after
  // every commit; read synchronously at click time (pre-flip state).
  const notifsRef = useRef<Notif[]>([]);
  useEffect(() => {
    notifsRef.current = notifs;
  }, [notifs]);

  const unread = notifs.filter((n) => !n.is_read).length;

  const fetchAll = useCallback(async () => {
    if (!token) return;
    const seq = ++fetchSeqRef.current;
    try {
      // R144-C1 (L16-3): rides customFetch — non-2xx throws into the
      // catch arm (the old `if (!r.ok) return`), a malformed-JSON 200
      // becomes ResponseParseError (the old guarded `.catch(() => null)`
      // + Array guard), and the 20 s bound replaces the unbounded poll.
      const data = (await customFetch<unknown>("/api/notifications", {
        headers: { Authorization: `Bearer ${token}` },
      })) as Notif[] | null;
      // 98-F7 (r97 F-10): late stale response (older poll racing a
      // socket-triggered refetch) must not overwrite the newer list —
      // only the latest request owns the state.
      if (seq !== fetchSeqRef.current) return;
      if (!Array.isArray(data)) return;
      setNotifs(data);
      // R153: data arrived — the panel body is "ok" regardless of length
      // (an empty array IS the honest empty state now, not a guess).
      setLoadState("ok");

      // Compute the max notification id we've now received.
      const currentMaxId = data.reduce((m, n) => Math.max(m, n.id), 0);

      if (initialLoadDoneRef.current) {
        // Show a toast ONLY for genuinely new unread notifications (id is
        // monotonically increasing in the backend; comparing IDs is
        // O(1) and immune to reorderings).
        const brandNew = data.filter((n) => !n.is_read && n.id > lastSeenMaxIdRef.current);
        if (brandNew.length > 0) {
          // Show the most-recent one only — surfacing 5 toasts at once is
          // worse UX than the bell badge plus a single "you have new" hint.
          const latest = brandNew[0];
          toast({
            title: latest.title,
            description: latest.message ?? undefined,
            // Stable id per notification id so a duplicate poll cannot
            // create a duplicate toast even if our gate misfires.
            id: `notif-${latest.id}`,
          });
        }
      } else {
        initialLoadDoneRef.current = true;
      }

      lastSeenMaxIdRef.current = Math.max(lastSeenMaxIdRef.current, currentMaxId);
    } catch {
      // R153: an outage only flips the panel to the error state when we
      // hold NO data — with a stale list on screen the best UX is to keep
      // showing it (the 60 s poll / socket event reconciles silently).
      if (seq === fetchSeqRef.current) {
        setNotifs((current) => {
          if (current.length === 0) setLoadState("error");
          return current;
        });
      }
    }
  }, [token]);

  const markAllRead = useCallback(async () => {
    if (!token) return;
    // 98-F7 (r97 F-10): optimistic flip with EXACT rollback — the POST had
    // no try/catch and no r.ok check, so a network failure or 4xx/5xx left
    // the whole list visually "read" while the server never recorded it
    // (the badge lied until the next poll reverted it — up to 60 s).
    const snapshot = notifsRef.current;
    setNotifs(snapshot.map((n) => ({ ...n, is_read: true })));
    try {
      // R144-C1 (L16-3): customFetch — non-2xx throws into the catch
      // (rollback) arm; the 20 s bound replaces the unbounded POST.
      await customFetch("/api/notifications/read-all", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Roll the bell state back to the pre-click truth. Deliberately No
      // toast: the next 60 s poll / socket event reconciles silently —
      // the existing UX contract for this component.
      setNotifs(snapshot);
    }
  }, [token]);

  const markRead = useCallback(
    async (id: number) => {
      if (!token) return;
      // 98-F7 (r97 F-10): same optimistic + rollback contract per row. The
      // pre-state comes from the ref (the action chip can fire on an
      // already-read row — handleAction is unguarded there — so "unread"
      // cannot be assumed; the exact prior value is restored).
      const wasRead = notifsRef.current.find((n) => n.id === id)?.is_read ?? false;
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
      try {
        // R144-C1 (L16-3): customFetch — non-2xx throws into the catch
        // (rollback) arm; the 20 s bound replaces the unbounded POST.
        await customFetch(`/api/notifications/${id}/read`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: wasRead } : n)));
      }
    },
    [token],
  );

  // Freshness strategy (R153 — corrected): the storefront socket singleton
  // exists only on the pages that mount useSocket (order-detail, wallet),
  // so for every other surface the 60 s visible-tab interval below is the
  // PRIMARY freshness mechanism and NOTIFICATION_NEW_EVENT is the
  // accelerator that fires when a socket-bearing page is mounted. The
  // /notifications page mirrors this contract with its own 60 s
  // refetchInterval + event listener (R153 Phase C). Both stay gated to
  // visible tabs (Round-3 8-c §2.2 — a backgrounded tab fires nothing).
  useEffect(() => {
    if (!token) {
      // Reset refs on logout so a re-login starts clean.
      lastSeenMaxIdRef.current = 0;
      initialLoadDoneRef.current = false;
      return;
    }
    void fetchAll();
    let id: ReturnType<typeof setInterval> | null = setInterval(
      () => void fetchAll(),
      NOTIFICATION_POLL_INTERVAL_MS,
    );
    const onSocketNotification = () => void fetchAll();
    window.addEventListener(NOTIFICATION_NEW_EVENT, onSocketNotification);
    // R154 (P5): the reconnect-resync gap — a same-tab WiFi blip on a
    // socket-bearing page fires SOCKET_RESYNC_EVENT (the socket singleton
    // reconnects and the react-query families refresh) but the bell is a
    // RAW-FETCH surface: without this listener the badge stayed stale for
    // up to the remaining 60 s of the poll interval after the page
    // itself had already refreshed. Rides the same debounced fetchAll
    // (fetch-seq guards make a duplicate fetch harmless).
    const onResync = () => void fetchAll();
    window.addEventListener(SOCKET_RESYNC_EVENT, onResync);
    const onVisibility = () => {
      if (document.hidden) {
        if (id !== null) {
          clearInterval(id);
          id = null;
        }
      } else {
        void fetchAll();
        if (id === null) id = setInterval(() => void fetchAll(), NOTIFICATION_POLL_INTERVAL_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      if (id !== null) clearInterval(id);
      window.removeEventListener(NOTIFICATION_NEW_EVENT, onSocketNotification);
      window.removeEventListener(SOCKET_RESYNC_EVENT, onResync);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [token, fetchAll]);

  return { notifs, unread, loadState, fetchAll, markAllRead, markRead };
}

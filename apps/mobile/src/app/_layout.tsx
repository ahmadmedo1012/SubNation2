import { AppState, I18nManager } from "react-native";
import { useEffect } from "react";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";

import { AuthProvider, useAuth } from "@/lib/auth";
import { CartProvider } from "@/lib/cart";
import { useColors } from "@/theme";
import { initSentry } from "@/lib/sentry";

// R192: crash reporting (DSN-gated — a no-op without the owner's
// EXPO_PUBLIC_SENTRY_DSN; see lib/sentry.ts). First statement of the
// app: capture everything after this line.
initSentry();

// Arabic-first: force the layout direction RTL (applies from next launch
// on non-RTL devices; Arabic-locale devices are RTL from the first frame).
I18nManager.allowRTL(true);
I18nManager.forceRTL(true);

SplashScreen.preventAutoHideAsync().catch(() => {
  // preventAutoHideAsync races on repeated fast refreshes — never fatal.
});

// Mirrors the web's query-client.ts contract.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (failureCount >= 1) return false;
        const status =
          error && typeof error === "object" && "status" in error
            ? (error as { status?: number }).status
            : undefined;
        if (status !== undefined && status >= 500) return true;
        return error instanceof TypeError;
      },
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

/**
 * The native arm of the web's visibilitychange resync (review R7-a
 * P2-2/P2-3): the web parks its socket when hidden and resyncs on
 * visibility — the app's socket (and its event-driven invalidations)
 * misses everything while backgrounded, so returning to the foreground
 * must (a) refetch every on-screen query that went stale meanwhile,
 * and (b) re-probe the session when boot degraded a VALID stored token
 * to "guest" on a network failure (the probe's own catch-promise: the
 * token may still be good for its full 30-day life — never strand a
 * signed-in user behind sign-in walls for a whole app session).
 */
function useForegroundResync(): void {
  const queryClient = useQueryClient();
  const { status, refresh } = useAuth();

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      // refetchOnWindowFocus is deliberately false (web parity) — this is
      // its replacement for native: only ACTIVE queries that are STALE
      // refetch (screens not mounted are untouched; fresh data stays).
      void queryClient.refetchQueries({ type: "active", stale: true });
      if (status === "guest") void refresh();
    });
    return () => subscription.remove();
  }, [queryClient, status, refresh]);
}

/**
 * Root shell: fonts → splash gate → themed navigation.
 * The splash stays visible until fonts load AND the auth hydration gate
 * settles (expo-data-fetching skill: never route on unhydrated state).
 */
function RootShell({ children }: { children: React.ReactNode }) {
  const colors = useColors();
  const scheme = useColorScheme();
  const { status: authStatus } = useAuth();

  useForegroundResync();

  // Metro's asset-module require() is the platform idiom for useFonts.
  const [fontsLoaded, fontsError] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    "ReadexPro-Regular": require("../../assets/fonts/ReadexPro-Regular.ttf"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    "ReadexPro-SemiBold": require("../../assets/fonts/ReadexPro-SemiBold.ttf"),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    "ReadexPro-Bold": require("../../assets/fonts/ReadexPro-Bold.ttf"),
  });

  const ready = (fontsLoaded || fontsError) && authStatus !== "hydrating";

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    // Keep the native splash while fonts + auth hydrate.
    return null;
  }

  // SubNation is dark-first: the brand palette carries the identity, the
  // react-navigation theme follows the same scheme the palette does.
  const navTheme = {
    ...(scheme === "light" ? DefaultTheme : DarkTheme),
    colors: {
      ...(scheme === "light" ? DefaultTheme : DarkTheme).colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surfaceCard,
      text: colors.foreground,
      border: colors.border,
      notification: colors.primary,
    },
  };

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={scheme === "light" ? "dark" : "light"} />
      {children}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CartProvider>
          <RootShell>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "#0a0c10" },
              }}
            >
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="login" options={{ presentation: "modal" }} />
              {/* The Telegram OIDC return leg (cold-start deep link) + the
                  web receipt-URL alias — both root-level, headerless. */}
              <Stack.Screen name="auth/callback" />
              <Stack.Screen name="orders/[orderCode]" />
              <Stack.Screen name="checkout" />
              <Stack.Screen name="onboarding" options={{ presentation: "fullScreenModal" }} />
            </Stack>
          </RootShell>
        </CartProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

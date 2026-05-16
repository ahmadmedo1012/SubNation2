/**
 * Thin pass-through helpers around `@sentry/react`.
 *
 * The actual `Sentry.init()` lives in `frontend/src/instrument.ts` and is
 * loaded as the very first import of `main.tsx` per the official Sentry
 * React skill. Use this file for ergonomic helpers from app code.
 */

import * as Sentry from "@sentry/react";

/**
 * @deprecated kept for backwards compatibility — Sentry now initialises in
 * instrument.ts. Call sites should be migrated to remove this; until then,
 * the function is a no-op (returning immediately) so nothing breaks.
 */
export function initFrontendSentry(_opts?: unknown): void {
  // intentional no-op — see instrument.ts
}

/**
 * Capture a custom error with optional context (tags, extra, user).
 */
export function captureError(
  error: Error | unknown,
  context?: {
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    user?: { id: string | number; email?: string; username?: string };
  },
): void {
  if (context?.user) {
    Sentry.setUser(context.user);
  }
  if (context?.tags) {
    for (const [key, value] of Object.entries(context.tags)) {
      Sentry.setTag(key, value);
    }
  }
  if (context?.extra) {
    for (const [key, value] of Object.entries(context.extra)) {
      Sentry.setExtra(key, value);
    }
  }
  Sentry.captureException(error);
}

/** Set user context for Sentry events (id required, email/username optional). */
export function setSentryUser(
  user: {
    id: string | number;
    email?: string;
    username?: string;
  } | null,
): void {
  if (user) {
    Sentry.setUser(user);
  } else {
    Sentry.setUser(null);
  }
}

/** Append a breadcrumb to the current scope. */
export function addBreadcrumb(breadcrumb: Sentry.Breadcrumb): void {
  Sentry.addBreadcrumb(breadcrumb);
}

export { Sentry };

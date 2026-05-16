/**
 * Correlation ID context management using AsyncLocalStorage.
 * Provides request-scoped correlation context for logging and tracing.
 *
 * @see design.md §3.1.1
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/**
 * Correlation context stored per-request via AsyncLocalStorage.
 *
 * @see design.md §3.1.1
 */
export interface CorrelationContext {
  /** UUID v4 request ID */
  readonly requestId: string;
  /** User ID populated post-auth, never overwritten once set */
  userId?: number;
  /** Express route path, not the resolved URL */
  route: string;
  /** performance.now() at request entry */
  startTime: number;
}

/** Regex for validating x-request-id header format (UUID v4) */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** AsyncLocalStorage instance for correlation context */
const correlationStore = new AsyncLocalStorage<CorrelationContext>();

/**
 * Validates if a string is a valid UUID v4.
 * @param id - The string to validate
 * @returns true if valid UUID v4, false otherwise
 */
function isValidUuidV4(id: string): boolean {
  return UUID_V4_REGEX.test(id);
}

/**
 * Creates a new correlation context with a fresh request ID.
 * @param route - The Express route pattern
 * @param startTime - The request start time from performance.now()
 * @returns A new CorrelationContext instance
 */
export function createCorrelationContext(route: string, startTime: number): CorrelationContext {
  return {
    requestId: randomUUID(),
    route,
    startTime,
  };
}

/**
 * Creates a correlation context from an existing request ID header.
 * If the header is missing or invalid, generates a new UUID v4.
 *
 * @param requestIdHeader - The x-request-id header value (may be undefined or invalid)
 * @param route - The Express route pattern
 * @param startTime - The request start time from performance.now()
 * @returns A CorrelationContext with either the validated or a new request ID
 */
export function createCorrelationContextFromHeader(
  requestIdHeader: string | undefined,
  route: string,
  startTime: number,
): CorrelationContext {
  const requestId =
    requestIdHeader && isValidUuidV4(requestIdHeader) ? requestIdHeader : randomUUID();

  return {
    requestId,
    route,
    startTime,
  };
}

/**
 * Runs a function within a correlation context.
 * The context is accessible via getCorrelationContext() within the callback.
 *
 * @param context - The correlation context to store
 * @param callback - The function to run within the context
 * @returns The return value of the callback
 */
export function runWithCorrelationContext<T>(context: CorrelationContext, callback: () => T): T {
  return correlationStore.run(context, callback);
}

/**
 * Gets the current correlation context from AsyncLocalStorage.
 *
 * @returns The current CorrelationContext, or undefined if not in a request scope
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return correlationStore.getStore();
}

/**
 * Gets the request ID from the current context.
 * Returns undefined if not in a request scope.
 *
 * @returns The request ID string, or undefined if no context exists
 */
export function getCorrelationId(): string | undefined {
  const store = correlationStore.getStore();
  return store?.requestId;
}

/**
 * Updates the user ID in the current correlation context.
 * Should be called after successful authentication.
 * Does nothing if no context exists or if userId is already set.
 *
 * @param userId - The authenticated user's ID
 */
export function setCorrelationUserId(userId: number): void {
  const store = correlationStore.getStore();
  if (store && store.userId === undefined) {
    // Mutate the object - AsyncLocalStorage maintains reference identity
    (store as { userId?: number }).userId = userId;
  }
}

/**
 * Updates the route in the current correlation context.
 * Should be called after route matching is complete.
 *
 * @param route - The Express route pattern (e.g., "/api/products/:id")
 */
export function setCorrelationRoute(route: string): void {
  const store = correlationStore.getStore();
  if (store) {
    (store as { route: string }).route = route;
  }
}

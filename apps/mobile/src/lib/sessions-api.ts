/**
 * Revoke one of the caller's active sessions (the sessions screen's
 * per-device «إنهاء الجلسة» action).
 *
 * DELETE /api/auth/sessions/:id landed in the generated client in this
 * round's codegen (spec R191's predicted swap). This module WAS a
 * hand-written customFetch wrapper bridging the gap; the screens now
 * consume the GENERATED mutation directly (useDeleteSession /
 * deleteSession from @workspace/api-client-native — same transport, same
 * Bearer injection, same ApiError envelope), and this address just
 * re-exports the generated surface so historical import paths keep
 * resolving.
 *
 * The route is ownership-scoped server-side (a foreign or stale id 404s
 * with an Arabic NOT_FOUND envelope — never a silent success).
 */
export {
  deleteSession,
  getDeleteSessionMutationKey,
  getDeleteSessionMutationOptions,
  useDeleteSession,
  type DeleteSessionMutationResult,
  type DeleteSessionMutationVariables,
} from "@workspace/api-client-native";

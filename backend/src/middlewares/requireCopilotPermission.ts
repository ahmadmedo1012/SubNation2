/**
 * Copilot scope matching (010-ai-admin-copilot).
 *
 * R146 (audit finding 2): the requireCopilotPermission middleware factory
 * that lived here had zero call sites — the scope gate actually runs
 * in-handler (ask.ts / draft.ts), which now also writes the spec'd
 * copilot_actions refusal row inline before the 403. Only hasScope (used
 * by copilot/settings.ts) survives.
 */
const SUPER = "all";

export function hasScope(perms: string[], scope: string | string[]): boolean {
  if (perms.includes(SUPER)) return true;
  const need = Array.isArray(scope) ? scope : [scope];
  return need.some((s) => perms.includes(s));
}

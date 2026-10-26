/**
 * R188-7 (E-F5) — per-test env save/restore guard.
 *
 * The openwa/whatsapp family mutates the WHATSAPP_OTP_* and OTP_* env keys
 * per test with no restore, so the tail of the LAST test became the env
 * baseline every later test/file inherits (order dependence). This factors the
 * ENV_KEYS save/restore idiom (health-summary-wedge.test.ts) once for the
 * files that need it: save() at the TOP of beforeEach (before the file's
 * own env writes), restore() at the BOTTOM of afterEach — afterEach runs
 * on assertion failure too, so a red test cannot leak its tail.
 */

export function envGuard(keys: readonly string[]): { save(): void; restore(): void } {
  const saved: Record<string, string | undefined> = {};
  return {
    save() {
      for (const key of keys) saved[key] = process.env[key];
    },
    restore() {
      for (const key of keys) {
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      }
    },
  };
}

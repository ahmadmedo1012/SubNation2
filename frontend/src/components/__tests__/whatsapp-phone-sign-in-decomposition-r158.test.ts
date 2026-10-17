/**
 * R158 (hooks lane) — the WhatsAppPhoneSignIn.tsx decomposition contract.
 *
 * The component was an 881-line two-in-one: the OTP state machine (10
 * useState atoms, the settling auto-retry budget/timer, the cooldown +
 * expiry tickers, the 6-digit auto-submit effect, the start/verify
 * POSTs and the paste/normalizer helpers) AND the two-step form that
 * renders it, all in one function. R158 split it along that seam:
 * presentation (components/WhatsAppPhoneSignIn.tsx) + state machine
 * (@/hooks/useWhatsAppOtp).
 *
 * These are SOURCE-scan pins (the storefront-r128-sweep / r136-r137
 * decomposition idiom — structural invariants a render test only
 * covers incidentally). The RENDER contract (byte-identical DOM, the
 * settling auto-retry, the cooldown/expiry labels, the auto-submit
 * one-shot) is already pinned by whatsapp-phone-sign-in.test.tsx (45
 * tests) plus the login/register suites that mount the component;
 * this file guards the STRUCTURE so the decomposition cannot silently
 * regress:
 *
 *   1. size ceiling — the component stays a presentational shell (it
 *      was 881 lines; the ceiling leaves room to grow without
 *      re-ballooning into the state-machine monolith);
 *   2. delegation — the shell consumes useWhatsAppOtp and carries no
 *      state island of its own (no useState/useRef/useEffect may
 *      regrow in it — duplicated truth on an auth path is how the
 *      96-F2 settling desync class happens);
 *   3. hook ownership — useWhatsAppOtp owns the machine: the atoms,
 *      the settling constants, the auto-submit guard and the two POSTs;
 *   4. address stability — the pure digit/phone normalizers keep
 *      their exported names (the render suite imports them from the
 *      component's address, which re-exports them from the hook).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const component = read("src/components/WhatsAppPhoneSignIn.tsx");
const hook = read("src/hooks/useWhatsAppOtp.ts");

describe("R158 (hooks lane) — WhatsAppPhoneSignIn stays a presentational shell", () => {
  it("components/WhatsAppPhoneSignIn.tsx stays under the 600-line ceiling (was 881 at extraction)", () => {
    const lines = component.split("\n").length;
    expect(lines).toBeLessThan(600);
  });

  it("the shell delegates its OTP state machine to useWhatsAppOtp (deletion guard — a dropped import is a dead form)", () => {
    expect(component).toContain('from "@/hooks/useWhatsAppOtp";');
    expect(component).toContain("useWhatsAppOtp({ onSuccess });");
  });

  it("the shell carries no state island of its own (no useState/useRef/useEffect may regrow in it)", () => {
    // The R136 wallet-extract purity bar, applied to the shell: every
    // atom the form renders rides the hook's return value — a local
    // useState/useRef/useEffect would be duplicated truth on an auth
    // path (the machine in the hook would keep mutating while the
    // island renders a stale copy).
    expect(component).not.toMatch(/useState\(|useRef\(|useEffect\(/);
  });

  it("the pure normalizers keep their exported names at the component's address (the render suite imports them)", () => {
    expect(component).toContain(
      'export { toLatinDigits, normalizePhoneInput } from "@/hooks/useWhatsAppOtp";',
    );
  });
});

describe("R158 (hooks lane) — useWhatsAppOtp owns the OTP state machine", () => {
  it("the hook owns the 10-atom machine (phone/code/step/loading/error/cooldown/settling/expiry pair + their setters)", () => {
    for (const atom of [
      'const [phone, setPhone] = useState("");',
      'const [code, setCode] = useState("");',
      'const [step, setStep] = useState<"pristine" | "phone" | "code">("pristine");',
      "const [loading, setLoading] = useState(false);",
      'const [error, setError] = useState("");',
      "const [cooldown, setCooldown] = useState(0);",
      "const [settling, setSettling] = useState<{",
      "const [expiresAt, setExpiresAt] = useState<number | null>(null);",
      "const [expiryLeft, setExpiryLeft] = useState(0);",
    ]) {
      expect(hook, atom).toContain(atom);
    }
  });

  it("the hook owns the settling auto-retry, the cooldown/expiry tickers and the auto-submit guard", () => {
    // 96-F2 (R96-A4 §1.3E): the settling budget + fallback wait.
    expect(hook).toContain("const SETTLING_MAX_AUTO_RETRIES = 2;");
    expect(hook).toContain("const SETTLING_FALLBACK_WAIT_SEC = 30;");
    expect(hook).toContain("settlingTimerRef.current = window.setTimeout(() => {");
    // The cooldown second-ticker and the M:SS expiry interval.
    expect(hook).toContain("setTimeout(() => setCooldown((s) => Math.max(0, s - 1)), 1000);");
    expect(hook).toContain("const t = setInterval(tick, 1000);");
    // The exactly-once auto-submit ref guard.
    expect(hook).toContain("const autoSubmittedFor = useRef<string | null>(null);");
    // The two POSTs the machine owns.
    expect(hook).toContain('"/api/auth/whatsapp/start"');
    expect(hook).toContain('"/api/auth/whatsapp/verify"');
  });

  it("the hook is a state machine, not a render unit — values + callbacks out, no JSX", () => {
    expect(hook).not.toMatch(/return\s*\(\s*</);
    expect(hook).not.toMatch(/from "lucide-react"/);
  });
});

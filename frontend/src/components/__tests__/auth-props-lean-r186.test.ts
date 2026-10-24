/**
 * R186 (B-F5) — the auth family's dead props stay dead.
 *
 * WhatsAppPhoneSignIn's `enabled` + `dividerLabel` and AuthProviders'
 * `dividerLabel` had ZERO production consumers: login/register decide
 * the WhatsApp surface by conditional MOUNTING (`{whatsappEnabled ? …}`),
 * and the sole `dividerLabel` consumer was the hardening suite's own
 * render helper. The `enabled` docblock even mis-stated the mechanism
 * ("caller decides whether to mount it via the enabled prop").
 *
 * Source-scan pins (the decomposition-suite idiom — structural
 * invariants a render test only covers incidentally): neither
 * component's prop surface may regrow the dead props, and the gating
 * docblock must keep naming the real mechanism (conditional mounting).
 * The render contracts are unchanged and stay pinned by
 * whatsapp-phone-sign-in.test.tsx + auth-providers-hardening.test.tsx
 * + the login/register suites that mount both components.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), "utf8");
const providers = read("src/components/auth/AuthProviders.tsx");
const whatsapp = read("src/components/auth/WhatsAppPhoneSignIn.tsx");

describe("R186 (B-F5) — no dead props on the auth family", () => {
  it("AuthProviders' prop surface carries no dividerLabel (interface, destructure, or render branch)", () => {
    expect(providers).not.toContain("dividerLabel");
  });

  it("WhatsAppPhoneSignIn's prop surface carries neither enabled nor dividerLabel", () => {
    expect(whatsapp).not.toContain("dividerLabel");
    expect(whatsapp).not.toContain("enabled?: boolean");
    expect(whatsapp).not.toContain("if (!enabled)");
  });

  it("the gating docblock names the REAL mechanism — callers conditionally mount the component", () => {
    expect(whatsapp).toContain("conditional mounting");
    expect(whatsapp).not.toContain("via the `enabled` prop");
  });
});

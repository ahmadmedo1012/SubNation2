/**
 * ULID generator for copilot preview IDs (010-ai-admin-copilot, T022).
 *
 * 26-char Crockford-base32, sortable by creation time, URL-safe. We use
 * a tiny inline implementation rather than pulling a dependency since
 * the project already has crypto and we need monotonic-only enough for
 * this feature (one preview per admin per ~2 seconds in the worst case
 * under FR-SAFETY-004 rate limits).
 *
 * Reference: https://github.com/ulid/spec
 */
import { randomBytes } from "node:crypto";

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now: number): string {
  let t = now;
  const out: string[] = new Array(TIME_LEN);
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    out[i] = ENCODING[t % 32]!;
    t = Math.floor(t / 32);
  }
  return out.join("");
}

function encodeRandom(): string {
  const bytes = randomBytes(RANDOM_LEN);
  let out = "";
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! % 32]!;
  }
  return out;
}

export function newPreviewId(): string {
  return encodeTime(Date.now()) + encodeRandom();
}

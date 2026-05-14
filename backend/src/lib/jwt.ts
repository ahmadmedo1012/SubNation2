import jwt from "jsonwebtoken";

const sessionSecret = process.env.SESSION_SECRET ?? process.env.JWT_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

export const JWT_SECRET: string = sessionSecret;
export const ADMIN_JWT_SECRET: string = JWT_SECRET + "_admin";

export function signUserToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export type TokenError = "expired" | "invalid";
export type VerifyResult<T> = { ok: true; payload: T } | { ok: false; reason: TokenError };

export function verifyUserToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

export function verifyUserTokenDetailed(token: string): VerifyResult<{ userId: number }> {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as { userId: number };
    return { ok: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

export function signAdminToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: "8h" });
}

export function verifyAdminToken(token: string): { adminId: number; role: string } | null {
  try {
    return jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: number; role: string };
  } catch {
    return null;
  }
}

export function verifyAdminTokenDetailed(token: string): VerifyResult<{ adminId: number; role: string }> {
  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: number; role: string };
    return { ok: true, payload };
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return { ok: false, reason: "expired" };
    return { ok: false, reason: "invalid" };
  }
}

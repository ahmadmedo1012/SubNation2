import type { CookieOptions } from "express";

/**
 * Cross-origin browser deployments require SameSite=None plus Secure. Keep
 * Lax as the safe default for local/same-origin installations and make the
 * cross-site behavior an explicit Render setting.
 */
export function getAuthCookieSameSite(): "lax" | "none" {
  return process.env.AUTH_COOKIE_SAMESITE?.trim().toLowerCase() === "none" ? "none" : "lax";
}

export function getAuthCookieOptions(maxAge: number): CookieOptions {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: getAuthCookieSameSite(),
    maxAge,
    path: "/",
  };
}

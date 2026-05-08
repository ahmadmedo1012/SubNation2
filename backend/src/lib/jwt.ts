import jwt from "jsonwebtoken";

const sessionSecret = process.env.SESSION_SECRET ?? process.env.JWT_SECRET;

if (!sessionSecret) {
  throw new Error("SESSION_SECRET environment variable is required");
}

export const JWT_SECRET: string = sessionSecret;
export const ADMIN_JWT_SECRET: string = JWT_SECRET + "_admin";

export function signUserToken(payload: object): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });
}

export function verifyUserToken(token: string): { userId: number } | null {
  try {
    return jwt.verify(token, JWT_SECRET) as { userId: number };
  } catch {
    return null;
  }
}

export function signAdminToken(payload: object): string {
  return jwt.sign(payload, ADMIN_JWT_SECRET, { expiresIn: "8h" });
}

export function verifyAdminToken(token: string): { adminId: number } | null {
  try {
    return jwt.verify(token, ADMIN_JWT_SECRET) as { adminId: number };
  } catch {
    return null;
  }
}

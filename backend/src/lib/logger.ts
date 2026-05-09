import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      // HTTP headers
      "req.headers.authorization",
      "req.headers.cookie",
      'res.headers["set-cookie"]',
      // Passwords & secrets
      "password",
      "password_hash",
      "passwordHash",
      "account_password",
      "accountPassword",
      // Tokens
      "token",
      "access_token",
      "refresh_token",
      "id_token",
      // OTP
      "otp",
      // Payment
      "card_number",
      "cvv",
      "sender_account",
      // PII
      "ssn",
      "national_id",
    ],
    censor: "[REDACTED]",
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

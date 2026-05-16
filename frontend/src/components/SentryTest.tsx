/**
 * Sentry verification surface — small test buttons that exercise the
 * frontend SDK end-to-end. Mounted under `/__sentry-test` (see App.tsx).
 *
 * Per the official Sentry React skill (Verification section), this is the
 * recommended way to confirm Sentry is receiving data. Issues should appear
 * in the Sentry dashboard within seconds.
 *
 * Reachable in development always, and in production only when the visitor
 * is an authenticated admin (the wouter route in App.tsx is conditionally
 * registered).
 */

import * as Sentry from "@sentry/react";
import { useState } from "react";

export function SentryTest() {
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="max-w-md mx-auto p-6 space-y-4 text-foreground" dir="ltr">
      <h1 className="text-xl font-bold">Sentry verification</h1>
      <p className="text-sm text-muted-foreground">
        Use these to confirm errors and messages are reaching Sentry. Each
        click should show up in the dashboard within seconds.
      </p>

      <div className="flex flex-col gap-3">
        <button
          className="bg-red-600 hover:bg-red-500 text-white font-semibold py-2 px-4 rounded-lg"
          onClick={() => {
            // Per the skill: a thrown error here is captured by the React 19
            // reactErrorHandler() registered on createRoot.
            throw new Error("Sentry React test error");
          }}
        >
          Throw a test error
        </button>

        <button
          className="bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2 px-4 rounded-lg"
          onClick={() => {
            Sentry.captureMessage("Sentry test message", "info");
            setMsg("Captured info message — check Issues in Sentry.");
          }}
        >
          Capture an info message
        </button>

        <button
          className="bg-amber-600 hover:bg-amber-500 text-white font-semibold py-2 px-4 rounded-lg"
          onClick={() => {
            Sentry.logger.info("Sentry test log line", { source: "frontend-test" });
            setMsg("Sent log line — check Logs in Sentry.");
          }}
        >
          Send a structured log line
        </button>
      </div>

      {msg && <p className="text-sm text-emerald-400">{msg}</p>}
    </div>
  );
}

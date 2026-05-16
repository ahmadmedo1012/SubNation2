// IMPORTANT: This must be the very first import — Sentry auto-instruments
// Express / HTTP / fs by patching modules at require time. Loading
// `instrument.ts` first ensures handlers registered later in `./app`
// are observable in traces.
import "./instrument";

import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { getRedisClient, initRedisClient } from "./lib/redis-client";
import { initSocket } from "./lib/socket";
import { startWebSchedulers } from "./lib/web-scheduler";

const rawPort = process.env["PORT"] || process.env["API_PORT"] || "8080";

const DEFAULT_FALLBACK_ATTEMPTS = 25;

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${value}"`);
  }

  return port;
}

function listen(port: number, remainingAttempts = DEFAULT_FALLBACK_ATTEMPTS): void {
  const httpServer = createServer(app);
  initSocket(httpServer);

  httpServer.listen(port, () => {
    const address = httpServer.address();
    const actualPort = typeof address === "object" && address ? address.port : port;

    logger.info({ port: actualPort }, "Server listening");
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (
      process.env.NODE_ENV !== "production" &&
      err.code === "EADDRINUSE" &&
      port !== 0 &&
      port < 65535 &&
      remainingAttempts > 0
    ) {
      const nextPort = port + 1;

      logger.warn({ port, nextPort }, "Port in use, trying next port");
      listen(nextPort, remainingAttempts - 1);
      return;
    }

    logger.error({ err, port }, "Error listening on port");
    process.exit(1);
  });
}

async function bootstrap(): Promise<void> {
  // Connect the Redis singleton before app.use(...) runs any code that needs it.
  // In production, failure here exits the process (per redis-client policy);
  // in dev we fall back to in-memory rate-limiting and degraded health checks.
  await initRedisClient();

  // Activate worker-tier loops inside this web process when no dedicated
  // worker service is provisioned. Gated by DISABLE_WEB_SCHEDULERS=true
  // (operator flips this once a real worker exists) plus a Redis-backed
  // leader lock that only one instance can hold at a time.
  const schedulers = await startWebSchedulers(getRedisClient());

  // Graceful shutdown — release the leader lock so the next instance can
  // pick up immediately instead of waiting for the 60 s TTL.
  const handleSignal = (signal: string) => {
    logger.info({ signal }, "[server] received shutdown signal");
    schedulers
      .stop()
      .catch((err) => logger.error({ err }, "[server] scheduler stop error"))
      .finally(() => process.exit(0));
  };
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));

  listen(parsePort(rawPort), process.env.NODE_ENV === "production" ? 0 : DEFAULT_FALLBACK_ATTEMPTS);
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

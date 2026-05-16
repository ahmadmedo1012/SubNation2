import { createServer } from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { initRedisClient } from "./lib/redis-client";
import { initSentry } from "./lib/sentry";
import { initSocket } from "./lib/socket";

// Initialize Sentry error tracking before anything that might throw at boot.
initSentry();

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

  listen(parsePort(rawPort), process.env.NODE_ENV === "production" ? 0 : DEFAULT_FALLBACK_ATTEMPTS);
}

bootstrap().catch((err) => {
  logger.error({ err }, "Failed to start server");
  process.exit(1);
});

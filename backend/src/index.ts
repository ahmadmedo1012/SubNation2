import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"] ?? process.env["API_PORT"] ?? "8080";

const DEFAULT_FALLBACK_ATTEMPTS = 25;

function parsePort(value: string): number {
  const port = Number(value);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid PORT value: "${value}"`);
  }

  return port;
}

function listen(port: number, remainingAttempts = DEFAULT_FALLBACK_ATTEMPTS): void {
  const server = app.listen(port, () => {
    const address = server.address();
    const actualPort = typeof address === "object" && address ? address.port : port;

    logger.info({ port: actualPort }, "Server listening");
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE" && port !== 0 && port < 65535 && remainingAttempts > 0) {
      const nextPort = port + 1;

      logger.warn({ port, nextPort }, "Port in use, trying next port");
      listen(nextPort, remainingAttempts - 1);
      return;
    }

    logger.error({ err, port }, "Error listening on port");
    process.exit(1);
  });
}

listen(parsePort(rawPort));

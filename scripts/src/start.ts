import path from "node:path";
import {
  findAvailablePort,
  loadLocalEnv,
  parsePreferredPort,
  repoRoot,
  spawnPnpm,
  stopProcess,
} from "./runtime";

loadLocalEnv();

if (!process.env.SESSION_SECRET && process.env.JWT_SECRET) {
  process.env.SESSION_SECRET = process.env.JWT_SECRET;
}

const missing = ["DATABASE_URL", "SESSION_SECRET"].filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(", ")}. Copy config/env.example to .env and fill the values.`);
}

const port = await findAvailablePort(
  parsePreferredPort(process.env.PORT ?? process.env.API_PORT, 8080, "PORT"),
);
const origin = `http://127.0.0.1:${port}`;

console.log(`SubNation production server: ${origin}`);

const backend = spawnPnpm(["--filter", "@workspace/api-server", "start"], {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(port),
  API_PORT: String(port),
  APP_URL: process.env.APP_URL ?? origin,
  FRONTEND_DIST: path.join(repoRoot, "frontend", "dist", "public"),
});

function shutdown(exitCode = 0): void {
  stopProcess(backend);
  process.exit(exitCode);
}

backend.on("exit", (code) => shutdown(code ?? 1));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

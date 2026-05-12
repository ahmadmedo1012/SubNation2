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
  throw new Error(
    `Missing required environment variables: ${missing.join(", ")}. Copy config/env.example to .env and fill the values.`,
  );
}

const apiPort = await findAvailablePort(
  parsePreferredPort(process.env.API_PORT ?? process.env.PORT, 8080, "API_PORT"),
);

const frontendPreferredPort = parsePreferredPort(
  process.env.FRONTEND_PORT,
  apiPort === 5173 ? 5174 : 5173,
  "FRONTEND_PORT",
);
const frontendPort = await findAvailablePort(frontendPreferredPort);
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const frontendOrigin = `http://127.0.0.1:${frontendPort}`;

console.log(`SubNation local dev`);
console.log(`  Frontend: ${frontendOrigin}`);
console.log(`  API:      ${apiOrigin}/api/healthz`);

const backend = spawnPnpm(
  ["--filter", "@workspace/api-server", "dev"],
  {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(apiPort),
    API_PORT: String(apiPort),
    APP_URL: process.env.APP_URL ?? frontendOrigin,
    FRONTEND_DIST: path.join(repoRoot, "frontend", "dist", "public"),
  },
  { label: "api", color: "cyan" },
);

const frontend = spawnPnpm(
  ["--filter", "@workspace/subnation", "dev"],
  {
    ...process.env,
    NODE_ENV: "development",
    PORT: String(frontendPort),
    FRONTEND_PORT: String(frontendPort),
    BASE_PATH: process.env.BASE_PATH ?? "/",
    API_PROXY_TARGET: apiOrigin,
  },
  { label: "web", color: "magenta" },
);

let shuttingDown = false;

function shutdown(exitCode = 0): void {
  if (shuttingDown) return;
  shuttingDown = true;

  stopProcess(backend);
  stopProcess(frontend);
  process.exit(exitCode);
}

backend.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

frontend.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

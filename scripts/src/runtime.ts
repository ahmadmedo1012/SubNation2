import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { Transform } from "node:stream";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadLocalEnv(): void {
  const protectedKeys = new Set(Object.keys(process.env));

  for (const fileName of [".env", ".env.local", "config/.env", "config/.env.local"]) {
    loadEnvFile(path.join(repoRoot, fileName), protectedKeys);
  }
}

export function parsePreferredPort(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (!value) return fallback;

  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${label} must be a number between 1 and 65535. Received: ${value}`);
  }

  return port;
}

export async function findAvailablePort(preferredPort: number): Promise<number> {
  for (let port = preferredPort; port <= preferredPort + 50 && port <= 65535; port += 1) {
    if (await isPortAvailable(port)) return port;
  }

  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address) {
          resolve(address.port);
          return;
        }

        reject(new Error("Unable to resolve an available port."));
      });
    });
  });
}

export interface SpawnOptions {
  /** Short tag prefixed to each output line (e.g. "api", "web"). */
  label?: string;
  /** ANSI color for the label. */
  color?: "cyan" | "magenta" | "green" | "yellow" | "blue" | "red" | "gray";
}

const COLOR_CODES: Record<NonNullable<SpawnOptions["color"]>, string> = {
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};
const COLOR_RESET = "\x1b[0m";

export function spawnPnpm(
  args: string[],
  env: NodeJS.ProcessEnv,
  options: SpawnOptions = {},
): ChildProcess {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["--dir", repoRoot, ...args], {
    cwd: repoRoot,
    env,
    stdio: options.label ? ["inherit", "pipe", "pipe"] : "inherit",
  });

  if (options.label) {
    const useColor = process.stdout.isTTY || env.FORCE_COLOR === "1";
    const color = options.color && useColor ? COLOR_CODES[options.color] : "";
    const reset = color ? COLOR_RESET : "";
    const prefix = `${color}[${options.label}]${reset} `;

    child.stdout?.pipe(createPrefixStream(prefix)).pipe(process.stdout);
    child.stderr?.pipe(createPrefixStream(prefix)).pipe(process.stderr);
  }

  return child;
}

function createPrefixStream(prefix: string): Transform {
  let atLineStart = true;
  return new Transform({
    transform(
      chunk: Buffer | string,
      _enc: BufferEncoding,
      cb: (err?: Error | null, data?: unknown) => void,
    ) {
      const text = chunk.toString();
      let out = "";
      for (let i = 0; i < text.length; i += 1) {
        if (atLineStart && text[i] !== "\n") {
          out += prefix;
          atLineStart = false;
        }
        out += text[i];
        if (text[i] === "\n") atLineStart = true;
      }
      cb(null, out);
    },
  });
}

export function stopProcess(child: ChildProcess): void {
  if (!child.killed && child.exitCode === null) {
    child.kill("SIGTERM");
  }
}

function loadEnvFile(filePath: string, protectedKeys: Set<string>): void {
  if (!existsSync(filePath)) return;

  const contents = readFileSync(filePath, "utf8");

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (protectedKeys.has(key)) continue;

    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(value: string): string {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed.replace(/\s+#.*$/, "");
}

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}

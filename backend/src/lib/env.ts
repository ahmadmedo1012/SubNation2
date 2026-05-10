import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

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
    const value = parseEnvValue(rawValue);
    if (value === "") continue;
    process.env[key] = value;
  }
}

const protectedKeys = new Set(Object.keys(process.env));
for (const filePath of [
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(process.cwd(), "config", ".env"),
  path.resolve(process.cwd(), "..", "config", ".env"),
]) {
  loadEnvFile(filePath, protectedKeys);
}

/*
 * Environment Variable Support for SWITE
 * Provides import.meta.env replacement for SWITE
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface EnvConfig {
  mode?: "development" | "production";
  prefix?: string; // Default: "SWITE_"
}

/**
 * Load environment variables from .env files.
 * Supports .env, .env.local, .env.[mode], .env.[mode].local
 */
export function loadEnv(
  root: string,
  mode: string = "development",
  prefix: string = "SWITE_",
): Record<string, string> {
  const env: Record<string, string> = {};
  const envFiles = [`.env.${mode}.local`, `.env.${mode}`, `.env.local`, `.env`];

  for (const file of envFiles) {
    const envPath = join(root, file);
    if (!existsSync(envPath)) continue;
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (!match) continue;
      const key = match[1].trim();
      const value = match[2].replace(/^["']|["']$/g, "");
      if (key.startsWith(prefix) || key.startsWith("PUBLIC_")) {
        env[key] = value;
      }
    }
  }

  return env;
}

/**
 * Replace all import.meta.env references in compiled code with their literal values.
 *
 * This is the only correct approach for ES modules — import.meta is sealed and
 * import.meta.env cannot be assigned at runtime. All substitution must happen at
 * transform time (here, after esbuild strips TypeScript).
 *
 * Handles:
 *  - import.meta.env.KEY  → JSON.stringify(env[KEY]) or "undefined"
 *  - import.meta.env.DEV  → true/false literal
 *  - import.meta.env.PROD → true/false literal
 *  - import.meta.env.MODE → "development"/"production" literal
 *  - bare import.meta.env → serialized object literal (for spread, typeof, etc.)
 */
export function inlineEnvReferences(
  code: string,
  env: Record<string, string>,
  mode: string = "development",
): string {
  if (!code.includes("import.meta.env")) return code;

  const isDev = mode !== "production";

  // Named key access first (most specific)
  code = code.replace(/\bimport\.meta\.env\.([A-Z_][A-Z0-9_]*)\b/g, (_, key: string) => {
    if (key === "DEV") return String(isDev);
    if (key === "PROD") return String(!isDev);
    if (key === "MODE") return JSON.stringify(mode);
    if (key === "SSR") return "false";
    if (key in env) return JSON.stringify(env[key]);
    return "undefined";
  });

  // Bare import.meta.env (spread/typeof patterns)
  if (code.includes("import.meta.env")) {
    const envLiteral = buildEnvLiteral(env, mode);
    code = code.replace(/\bimport\.meta\.env\b/g, envLiteral);
  }

  return code;
}

function buildEnvLiteral(env: Record<string, string>, mode: string): string {
  const isDev = mode !== "production";
  const entries: string[] = [
    `MODE:${JSON.stringify(mode)}`,
    `DEV:${isDev}`,
    `PROD:${!isDev}`,
    `SSR:false`,
    ...Object.entries(env).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`),
  ];
  return `({${entries.join(",")}})`;
}

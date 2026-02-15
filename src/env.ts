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
 * Load environment variables from .env files
 * Supports .env, .env.local, .env.[mode], .env.[mode].local
 */
export function loadEnv(
  root: string,
  mode: string = "development",
): Record<string, string> {
  const env: Record<string, string> = {};
  const envFiles = [`.env.${mode}.local`, `.env.${mode}`, `.env.local`, `.env`];

  for (const file of envFiles) {
    const envPath = join(root, file);
    if (existsSync(envPath)) {
      const content = readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          const match = trimmed.match(/^([^=]+)=(.*)$/);
          if (match) {
            const [, key, value] = match;
            // Remove quotes if present
            const cleanValue = value.replace(/^["']|["']$/g, "");
            env[key.trim()] = cleanValue;
          }
        }
      }
    }
  }

  return env;
}

/**
 * Generate import.meta.env replacement code
 * Injects environment variables as a module that can be imported
 */
export function generateEnvModule(
  env: Record<string, string>,
  prefix: string = "SWITE_",
): string {
  // Filter env vars by prefix and expose them
  const switeEnv: Record<string, string> = {};
  const publicEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith(prefix)) {
      // Remove prefix for SWITE_ prefixed vars
      const cleanKey = key.slice(prefix.length);
      switeEnv[cleanKey] = value;
      publicEnv[key] = value;
    } else if (key.startsWith("PUBLIC_")) {
      // PUBLIC_ vars are always exposed
      publicEnv[key] = value;
    }
  }

  // Build env object with all variables
  const allEnvEntries = [
    ...Object.entries(switeEnv).map(([key, value]) => [key, value]),
    ...Object.entries(publicEnv).map(([key, value]) => [key, value]),
    ["MODE", process.env.NODE_ENV || "development"],
    ["DEV", process.env.NODE_ENV !== "production"],
    ["PROD", process.env.NODE_ENV === "production"],
  ];

  return `
// SWITE Environment Variables
// Generated at runtime - do not edit manually
export const env = {
  ${allEnvEntries
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join(",\n  ")},
};

// For import.meta.env compatibility
if (typeof globalThis !== 'undefined') {
  globalThis.__swite_env__ = env;
}
`;
}

/**
 * Inject import.meta.env polyfill into code
 */
export function injectEnvPolyfill(code: string): string {
  // Check if import.meta.env is used
  if (!code.includes("import.meta.env") && !code.includes("__swite_env__")) {
    return code;
  }

  // Inject polyfill at the top - load env module first
  const polyfill = `
// SWITE import.meta.env polyfill
import { env as switeEnv } from '/__swite_env';
if (typeof globalThis !== 'undefined') {
  globalThis.__swite_env__ = switeEnv;
}
if (typeof import !== 'undefined' && import.meta) {
  import.meta.env = switeEnv;
} else if (typeof globalThis !== 'undefined') {
  // Fallback for environments without import.meta
  if (!globalThis.import) {
    globalThis.import = { meta: {} };
  }
  if (!globalThis.import.meta) {
    globalThis.import.meta = {};
  }
  globalThis.import.meta.env = switeEnv;
}
`;

  // Find the first import statement or start of file
  const firstImport = code.match(/^import\s+/m);
  if (firstImport) {
    const insertIndex = firstImport.index!;
    return (
      code.slice(0, insertIndex) + polyfill + "\n" + code.slice(insertIndex)
    );
  }

  return polyfill + "\n" + code;
}

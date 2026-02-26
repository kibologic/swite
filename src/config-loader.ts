import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import type { SwiteUserConfig } from "./config.js";

/**
 * Load swiss.config.ts from the project root.
 * Transpiles to a temp ESM file via esbuild, imports it, then cleans up.
 * Returns empty config if no config file found.
 */
export async function loadUserConfig(root: string): Promise<SwiteUserConfig> {
  const tsConfig = join(root, "swiss.config.ts");
  const jsConfig = join(root, "swiss.config.js");

  const configPath = existsSync(tsConfig)
    ? tsConfig
    : existsSync(jsConfig)
      ? jsConfig
      : null;

  if (!configPath) {
    return {};
  }

  const tempDir = await mkdtemp(join(tmpdir(), "swite-config-"));
  const outFile = join(tempDir, "swiss.config.mjs");

  try {
    await build({
      entryPoints: [configPath],
      bundle: false,
      format: "esm",
      outfile: outFile,
      platform: "node",
      logLevel: "silent",
    });

    const mod = await import(pathToFileURL(outFile).href);
    return (mod.default ?? {}) as SwiteUserConfig;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

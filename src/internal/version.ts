/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { readFileSync } from "node:fs";

let cached: string | null = null;

/**
 * The version of this swite package, read from its own package.json.
 * Same location from src/ (tsx) and dist/ (published): two levels up.
 */
export function getSwiteVersion(): string {
  if (cached) return cached;
  try {
    const pkgUrl = new URL("../../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf-8")) as { version?: string };
    cached = pkg.version ?? "unknown";
  } catch {
    cached = "unknown";
  }
  return cached;
}

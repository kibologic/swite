/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Maps package.json `name` -> absolute package directory for a co-located
 * framework monorepo (e.g. swiss-lib) whose packages live as directly-named
 * top-level directories -- `runtime/`, `compiler/`, `plugins/file-router/` --
 * rather than nested under a single `packages/` directory.
 *
 * Built by reading each candidate directory's own package.json rather than
 * deriving a directory name from the package's unscoped name segment: the
 * two are not always the same string (`@swissjs/core` lives in `runtime/`,
 * not `core/`), and guessing produced silent resolution failures whenever
 * they diverged.
 */

const registryCache = new Map<string, Promise<Map<string, string>>>();

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  ".husky",
  ".github",
  "dist",
  "docs",
  "scripts",
  "etc",
]);

async function readPackageName(dir: string): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(dir, "package.json"), "utf-8");
    const pkg = JSON.parse(raw);
    return typeof pkg?.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

async function scanForPackages(
  dir: string,
  depth: number,
  out: Map<string, string>,
): Promise<void> {
  const name = await readPackageName(dir);
  if (name) {
    // A directory with its own package.json is a leaf package -- its
    // subdirectories (src/, dist/, __tests__/) are that package's internals,
    // not further packages to register.
    out.set(name, dir);
    return;
  }

  if (depth <= 0) return;

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    await scanForPackages(path.join(dir, entry.name), depth - 1, out);
  }
}

async function buildRegistry(monorepoRoot: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let entries;
  try {
    entries = await fs.readdir(monorepoRoot, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    // One level of grouping directories (e.g. plugins/file-router) is
    // supported beyond the top-level scan.
    await scanForPackages(path.join(monorepoRoot, entry.name), 1, out);
  }
  return out;
}

/**
 * Find a package's absolute directory inside a co-located monorepo by its
 * real package.json `name`. Results are cached per monorepo root for the
 * life of the process; pass `forceRefresh` to rebuild (e.g. after a new
 * package directory is added while the dev server is running).
 */
export async function findMonorepoPackageDir(
  monorepoRoot: string,
  packageName: string,
  forceRefresh = false,
): Promise<string | null> {
  if (forceRefresh) registryCache.delete(monorepoRoot);
  let pending = registryCache.get(monorepoRoot);
  if (!pending) {
    pending = buildRegistry(monorepoRoot);
    registryCache.set(monorepoRoot, pending);
  }
  const registry = await pending;
  return registry.get(packageName) ?? null;
}

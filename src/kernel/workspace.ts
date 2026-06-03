/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Find the workspace root by looking for pnpm-workspace.yaml or package.json with workspaces
 * Updated: Now also checks for lib/ directory to ensure we find the correct SWS root
 */
export async function findWorkspaceRoot(root: string): Promise<string | null> {
  const debug = process.env["SWITE_DEBUG"] === "1";
  let current = root;
  for (let i = 0; i < 10; i++) {
    const workspaceFile = path.join(current, "pnpm-workspace.yaml");
    const packageJson = path.join(current, "package.json");
    const libDir = path.join(current, "lib");

    try {
      await fs.access(workspaceFile);
      const packagesDir = path.join(current, "packages");
      try {
        await fs.access(libDir);
        if (debug) console.log(`[workspace] Found workspace root with lib/: ${current}`);
        return current;
      } catch {
        try {
          await fs.access(packagesDir);
          if (debug) console.log(`[workspace] Found workspace root with packages/: ${current}`);
          return current;
        } catch {
          if (debug) console.log(`[workspace] Found workspace file at ${current} but no lib/ or packages/, continuing search...`);
        }
      }
    } catch {
      try {
        const pkgJson = JSON.parse(await fs.readFile(packageJson, "utf-8"));
        if (pkgJson?.workspaces) {
          try {
            await fs.access(libDir);
            if (debug) console.log(`[workspace] Found workspace root with lib/ (via package.json): ${current}`);
            return current;
          } catch {
            // Has workspaces but no lib/, continue searching
          }
        }
      } catch {
        // Continue searching
      }
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (debug) console.warn(`[workspace] No workspace root found starting from: ${root}`);
  return null;
}

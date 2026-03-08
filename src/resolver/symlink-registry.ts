/*
 * Symlink Registry - CG-03 root cause fix
 *
 * fs.realpath() throughout Swite's handler chain resolves symlinks to absolute
 * filesystem paths (e.g. /mnt/c/.../swiss-lib/packages/core/src/index.ts).
 * These leak into toUrl() and hit the startsWith("/") early-return before the
 * proper node_modules/swiss-lib handling logic is reached.
 *
 * At server startup we scan node_modules directories for symlinks and build a
 * map: realpath → /node_modules/<pkg-name>
 * toUrl() consults this registry FIRST and short-circuits back to the correct
 * browser URL.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

// realpath (normalized, forward slashes) → browser URL prefix
const registry = new Map<string, string>();

export async function buildSymlinkRegistry(
  nodeModulesDirs: string[]
): Promise<void> {
  registry.clear();
  for (const dir of nodeModulesDirs) {
    await scanNodeModulesDir(dir);
  }
  console.log(
    `[SWITE] Symlink registry built: ${registry.size} entries from ${nodeModulesDirs.length} node_modules dirs`
  );
}

async function scanNodeModulesDir(nodeModulesDir: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let dirents: any[];
  try {
    dirents = await fs.readdir(nodeModulesDir, {
      withFileTypes: true,
      encoding: "utf8",
    });
  } catch {
    return; // dir doesn't exist — skip silently
  }

  for (const dirent of dirents) {
    if (dirent.name.startsWith(".")) continue;

    if (dirent.name.startsWith("@")) {
      // Scoped scope directory — scan one level deeper
      const scopeDir = path.join(nodeModulesDir, dirent.name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let scopedDirents: any[];
      try {
        scopedDirents = await fs.readdir(scopeDir, {
          withFileTypes: true,
          encoding: "utf8",
        });
      } catch {
        continue;
      }
      for (const scoped of scopedDirents) {
        if (scoped.isSymbolicLink()) {
          await registerSymlink(
            path.join(scopeDir, scoped.name),
            `${dirent.name}/${scoped.name}`
          );
        }
      }
    } else if (dirent.isSymbolicLink()) {
      await registerSymlink(
        path.join(nodeModulesDir, dirent.name),
        dirent.name
      );
    }
  }
}

async function registerSymlink(
  symlinkPath: string,
  pkgName: string
): Promise<void> {
  try {
    const realPath = await fs.realpath(symlinkPath);
    const key = realPath.replace(/\\/g, "/");
    const value = `/node_modules/${pkgName}`;
    registry.set(key, value);
    console.log(`[SWITE] Registry: ${pkgName}: ${key} → ${value}`);
  } catch {
    // broken symlink — ignore
  }
}

/**
 * Look up an absolute filesystem path in the symlink registry.
 *
 * Returns the browser URL if absolutePath is, or is within, a package whose
 * realpath was registered at startup. Returns null if not found.
 *
 * Example:
 *   /mnt/c/.../swiss-lib/packages/core/src/index.ts
 *   → /node_modules/@swissjs/core/src/index.ts
 */
export function lookupInSymlinkRegistry(absolutePath: string): string | null {
  const normalized = absolutePath.replace(/\\/g, "/");
  for (const [realPkgPath, browserPrefix] of registry) {
    if (normalized === realPkgPath) {
      return browserPrefix;
    }
    if (normalized.startsWith(realPkgPath + "/")) {
      return browserPrefix + normalized.slice(realPkgPath.length);
    }
  }
  return null;
}

/*
 * Workspace Package Resolver - Finds packages in workspace
 * Uses dynamic package registry instead of hardcoded paths
 */

import path from "node:path";
import { findSwissLibMonorepo } from "../utils/package-finder.js";
import { getPackageRegistry } from "../utils/package-registry.js";

export interface WorkspacePackageResolverContext {
  root: string;
  getWorkspaceRoot: () => Promise<string | null>;
  fileExists: (filePath: string) => Promise<boolean>;
}

/**
 * Resolve workspace package location
 */
export async function resolveWorkspacePackage(
  pkgName: string,
  context: WorkspacePackageResolverContext
): Promise<string | null> {
  // Build the ordered list of roots to scan for workspace packages.
  // Works for any package name/scope — no hardcoded scope guards.
  const workspaceRoots: string[] = [];

  let workspaceRoot = await context.getWorkspaceRoot();
  if (workspaceRoot) {
    workspaceRoots.push(workspaceRoot);
  } else {
    // Walk up from app root looking for common workspace markers
    for (const candidate of [
      path.join(context.root, ".."),
      path.join(context.root, "..", ".."),
    ]) {
      const normalized = path.resolve(candidate);
      if (
        (await context.fileExists(path.join(normalized, "pnpm-workspace.yaml"))) ||
        (await context.fileExists(path.join(normalized, "modules"))) ||
        (await context.fileExists(path.join(normalized, "libraries")))
      ) {
        workspaceRoot = normalized;
        workspaceRoots.push(normalized);
        break;
      }
    }
    if (!workspaceRoots.length) {
      workspaceRoots.push(path.join(context.root, "..", ".."));
    }
  }

  // Also include any co-located framework monorepo (any workspace with packages/)
  try {
    const monorepo = await findSwissLibMonorepo(context.root);
    if (monorepo && !workspaceRoots.includes(monorepo)) {
      workspaceRoots.unshift(monorepo);
    }
    if (monorepo) {
      const packagesDir = path.join(monorepo, "packages");
      if (await context.fileExists(packagesDir) && !workspaceRoots.includes(packagesDir)) {
        workspaceRoots.unshift(packagesDir);
      }
    }
  } catch {
    // monorepo not found — continue without it
  }

  const registry = getPackageRegistry();
  const primaryRoot = workspaceRoots[0] ?? context.root;
  const additionalRoots = workspaceRoots.slice(1);

  if (!registry.getPackageCount() && primaryRoot) {
    try {
      await registry.scanWorkspace(primaryRoot, additionalRoots);
    } catch (error: any) {
      console.error(`[SWITE] Error scanning package registry:`, error.message);
    }
  }

  let packageInfo = registry.findPackage(pkgName);
  if (packageInfo) {
    return packageInfo.path;
  }

  // Rescan in case the package was added after the initial scan
  await registry.rescan();
  packageInfo = registry.findPackage(pkgName);
  if (packageInfo) {
    return packageInfo.path;
  }

  console.log(`[SWITE] Package ${pkgName} not found in workspace (scanned ${registry.getPackageCount()} packages)`);
  return null;
}

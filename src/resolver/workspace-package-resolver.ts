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
  let workspaceRoot: string | null = null;
  const workspaceRoots: string[] = [];

  if (
    pkgName.startsWith("@swiss-enterprise/") ||
    pkgName.startsWith("@swiss-module/") ||
    pkgName.startsWith("@swiss-package/") ||
    pkgName.startsWith("@swiss-framework/")
  ) {
    console.log(`[SWITE] Looking for SWS root for @swiss-enterprise package...`);
    console.log(`[SWITE] Starting from app root: ${context.root}`);

    const fallbackPaths = [
      path.join(context.root, "..", ".."),
      path.join(context.root, ".."),
      path.join(context.root, "..", "..", "..", "SwissEnterpriseRepo"),
      path.join(context.root, "..", "..", "..", "..", "SwissEnterpriseRepo"),
    ];

    const detectedWorkspaceRoot = await context.getWorkspaceRoot();
    if (detectedWorkspaceRoot) {
      const hasLibraries = await context.fileExists(path.join(detectedWorkspaceRoot, "libraries"));
      const hasModules = await context.fileExists(path.join(detectedWorkspaceRoot, "modules"));
      if (hasLibraries || hasModules) {
        console.log(`[SWITE] ✅ Found SwissEnterpriseRepo via getWorkspaceRoot(): ${detectedWorkspaceRoot}`);
        workspaceRoot = detectedWorkspaceRoot;
        workspaceRoots.push(workspaceRoot);
      }
    }

    for (const fallbackPath of fallbackPaths) {
      const normalizedFallback = path.resolve(fallbackPath);
      console.log(`[SWITE] Checking path: ${normalizedFallback}`);
      const hasWorkspace = await context.fileExists(path.join(normalizedFallback, "pnpm-workspace.yaml"));
      const hasModules = await context.fileExists(path.join(normalizedFallback, "modules"));
      const hasLibraries = await context.fileExists(path.join(normalizedFallback, "libraries"));
      const hasPackages = await context.fileExists(path.join(normalizedFallback, "packages"));
      const hasAiAgents = await context.fileExists(path.join(normalizedFallback, "packages", "ai-agents", "package.json"));

      console.log(`[SWITE]   hasWorkspace: ${hasWorkspace}, hasModules: ${hasModules}, hasLibraries: ${hasLibraries}, hasPackages: ${hasPackages}, hasAiAgents: ${hasAiAgents}`);

      if (hasWorkspace || hasModules || hasLibraries || hasPackages || hasAiAgents) {
        workspaceRoot = normalizedFallback;
        console.log(`[SWITE] ✅ Found SwissEnterpriseRepo at: ${workspaceRoot}`);
        workspaceRoots.push(workspaceRoot);
        break;
      }
    }

    if (!workspaceRoot) {
      console.warn(`[SWITE] ⚠️ Could not find SwissEnterpriseRepo via fallback paths, trying getWorkspaceRoot()...`);
      workspaceRoot = await context.getWorkspaceRoot();
      if (workspaceRoot) {
        console.log(`[SWITE] ✅ Found workspace root via getWorkspaceRoot(): ${workspaceRoot}`);
        workspaceRoots.push(workspaceRoot);
      } else {
        console.warn(`[SWITE] ⚠️ Could not find workspace root, using last resort path...`);
        workspaceRoots.push(path.join(context.root, "..", ".."));
      }
    }
  } else {
    workspaceRoot = await context.getWorkspaceRoot();

    if (!workspaceRoot) {
      console.log(`[SWITE] Workspace root not found via pnpm-workspace.yaml, trying fallbacks...`);
      const fallbackPaths = [
        path.join(context.root, "..", ".."),
        path.join(context.root, ".."),
      ];

      for (const fallbackPath of fallbackPaths) {
        const normalizedFallback = path.resolve(fallbackPath);
        if (
          (await context.fileExists(path.join(normalizedFallback, "pnpm-workspace.yaml"))) ||
          (await context.fileExists(path.join(normalizedFallback, "modules"))) ||
          (await context.fileExists(path.join(normalizedFallback, "libraries")))
        ) {
          workspaceRoot = normalizedFallback;
          console.log(`[SWITE] Found workspace root via fallback: ${workspaceRoot}`);
          break;
        }
      }
    }

    if (workspaceRoot) {
      workspaceRoots.push(workspaceRoot);
    } else {
      workspaceRoots.push(path.join(context.root, "..", ".."));
      workspaceRoots.push(path.join(context.root, "..", "..", ".."));
    }
  }

  // For @swissjs/* packages, also check swiss-lib monorepo
  if (pkgName.startsWith("@swissjs/")) {
    const swissLib = await findSwissLibMonorepo(context.root);
    if (swissLib) {
      console.log(`[SWITE] Found swiss-lib monorepo at ${swissLib}`);
      workspaceRoots.unshift(swissLib);
    }
  }

  console.log(`[SWITE] Searching for workspace package: ${pkgName}`);
  console.log(`[SWITE] Workspace roots: ${workspaceRoots.map((r) => path.resolve(r)).join(", ")}`);

  // Use dynamic package registry instead of hardcoded directory searches
  const registry = getPackageRegistry();
  
  // Determine primary workspace root for scanning
  let primaryRoot: string = workspaceRoots[0] ?? "";
  if (!primaryRoot) {
    primaryRoot = (await context.getWorkspaceRoot()) ?? context.root;
  }
  if (!primaryRoot) {
    primaryRoot = context.root;
  }
  
  const additionalRoots: string[] = workspaceRoots.slice(1);
  
  // Add swiss-lib monorepo if it exists (for @swissjs/* packages)
  if (pkgName.startsWith("@swissjs/")) {
    try {
      const swissLib = await findSwissLibMonorepo(context.root);
      if (swissLib && !additionalRoots.includes(swissLib) && swissLib !== primaryRoot) {
        additionalRoots.unshift(swissLib); // Prioritize swiss-lib
      }
      // Also add swiss-lib/packages to ensure packages are found
      if (swissLib) {
        const swissLibPackages = path.join(swissLib, "packages");
        if (await context.fileExists(swissLibPackages) && !additionalRoots.includes(swissLibPackages)) {
          console.log(`[SWITE] Adding swiss-lib/packages to scan roots: ${swissLibPackages}`);
          additionalRoots.unshift(swissLibPackages);
        }
      }
    } catch (error: any) {
      console.warn(`[SWITE] Error finding swiss-lib monorepo:`, error.message);
    }
  }
  
  // Ensure registry is scanned
  if (!registry.getPackageCount() && primaryRoot) {
    console.log(`[SWITE] Package registry not scanned yet, scanning workspace at ${primaryRoot}...`);
    try {
      await registry.scanWorkspace(primaryRoot, additionalRoots);
    } catch (error: any) {
      console.error(`[SWITE] Error scanning package registry:`, error.message);
      console.error(`[SWITE] Stack:`, error.stack);
    }
  } else if (registry.getPackageCount() && pkgName.startsWith("@swissjs/")) {
    // Registry already scanned but may not have swiss-lib/packages
    // Check if @swissjs/core is missing from registry
    const existingPkg = registry.findPackage(pkgName);
    if (!existingPkg) {
      console.log(`[SWITE] ${pkgName} not in registry, forcing rescan with swiss-lib/packages...`);
      await registry.rescan();
      // After rescan, if still not found, explicitly scan swiss-lib/packages
      const stillMissing = !registry.findPackage(pkgName);
      if (stillMissing) {
        const swissLib = await findSwissLibMonorepo(context.root);
        if (swissLib) {
          const swissLibPackages = path.join(swissLib, "packages");
          if (await context.fileExists(swissLibPackages)) {
            console.log(`[SWITE] Explicitly scanning swiss-lib/packages: ${swissLibPackages}`);
            await registry.scanWorkspace(swissLibPackages, []);
          }
        }
      }
    }
  } else if (!primaryRoot) {
    console.warn(`[SWITE] No workspace root found, cannot scan packages`);
  }

  // Look up package in registry
  let packageInfo = registry.findPackage(pkgName);
  
  if (packageInfo) {
    console.log(`[SWITE] ✅ Found ${pkgName} at ${packageInfo.path} (via dynamic registry)`);
    return packageInfo.path;
  }

  // If not found, try rescanning (in case packages were added or registry was stale)
  console.log(`[SWITE] Package ${pkgName} not in registry, rescanning...`);
  await registry.rescan();
  
  packageInfo = registry.findPackage(pkgName);
  if (packageInfo) {
    console.log(`[SWITE] ✅ Found ${pkgName} at ${packageInfo.path} (after rescan)`);
    return packageInfo.path;
  }

  // Log all found packages for debugging
  const allPackages = registry.getAllPackages().map(p => p.name).join(", ");
  console.log(`[SWITE] ❌ Package ${pkgName} not found in workspace`);
  console.log(`[SWITE] Scanned ${registry.getPackageCount()} packages: ${allPackages}`);
  return null;
}

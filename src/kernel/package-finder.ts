/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Dynamically find package directories by searching up the file tree
 * No hardcoded paths - works from any directory structure
 */

export interface PackageLocation {
  path: string;
  type: 'swiss-lib' | 'workspace' | 'node_modules';
}

/**
 * Find a co-located framework monorepo by scanning sibling directories at each
 * ancestor level for any workspace root (pnpm-workspace.yaml) that also has a
 * packages/ directory. Works for any framework directory name.
 */
export async function findSwissLibMonorepo(startPath: string): Promise<string | null> {
  let current = path.resolve(startPath);

  for (let i = 0; i < 20; i++) {
    const parent = path.dirname(current);
    if (parent === current) break;

    // Scan siblings of `current` at this parent level
    try {
      const entries = await fs.readdir(parent, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === "node_modules") continue;
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const sibling = path.join(parent, entry.name);
        if (path.resolve(sibling) === path.resolve(current)) continue; // skip self

        if (
          await fileExists(path.join(sibling, "pnpm-workspace.yaml")) &&
          await fileExists(path.join(sibling, "packages"))
        ) {
          return sibling;
        }
      }
    } catch {
      // Skip on permission errors
    }

    current = parent;
  }

  return null;
}

/**
 * Find a specific package by name, searching in:
 * 1. node_modules (local and workspace)
 * 2. swiss-lib/packages (if found)
 * 3. workspace packages (lib/, packages/, modules/)
 */
export async function findPackage(
  packageName: string,
  startPath: string,
  workspaceRoot?: string | null
): Promise<PackageLocation | null> {
  // 1. Check local node_modules
  const localNodeModules = path.join(startPath, "node_modules", packageName);
  if (await fileExists(path.join(localNodeModules, "package.json"))) {
    return { path: localNodeModules, type: 'node_modules' };
  }
  
  // 2. Check workspace root node_modules
  if (workspaceRoot) {
    const workspaceNodeModules = path.join(workspaceRoot, "node_modules", packageName);
    if (await fileExists(path.join(workspaceNodeModules, "package.json"))) {
      return { path: workspaceNodeModules, type: 'node_modules' };
    }
  }
  
  // 3. Check co-located framework monorepo packages/ for any scoped package
  if (packageName.startsWith("@")) {
    const monorepo = await findSwissLibMonorepo(startPath);
    if (monorepo) {
      const shortName = packageName.split("/")[1];
      const monorepoPackage = path.join(monorepo, "packages", shortName);
      if (await fileExists(path.join(monorepoPackage, "package.json"))) {
        return { path: monorepoPackage, type: 'swiss-lib' };
      }
    }
  }

  // 4. Check workspace packages (lib/, packages/, modules/)
  if (workspaceRoot) {
    const packageDirs = ["lib", "packages", "modules", "libraries", "apps"];
    for (const dir of packageDirs) {
      const searchDir = path.join(workspaceRoot, dir);
      if (!(await fileExists(searchDir))) continue;
      
      // Try scoped package name
      if (packageName.startsWith("@")) {
        const unscoped = packageName.split("/")[1];
        const packagePath = path.join(searchDir, unscoped);
        if (await fileExists(path.join(packagePath, "package.json"))) {
          return { path: packagePath, type: 'workspace' };
        }
      }
      
      // Try full package name
      const packagePath = path.join(searchDir, packageName);
      if (await fileExists(path.join(packagePath, "package.json"))) {
        return { path: packagePath, type: 'workspace' };
      }
    }
  }
  
  return null;
}

/**
 * Find all possible workspace roots by searching up the tree
 */
export async function findWorkspaceRoots(startPath: string): Promise<string[]> {
  const roots: string[] = [];
  let current = startPath;
  
  for (let i = 0; i < 20; i++) {
    const workspaceFile = path.join(current, "pnpm-workspace.yaml");
    const packageJson = path.join(current, "package.json");
    
    try {
      if (await fileExists(workspaceFile)) {
        roots.push(current);
      } else if (await fileExists(packageJson)) {
        const pkg = JSON.parse(await fs.readFile(packageJson, "utf-8"));
        if (pkg?.workspaces) {
          roots.push(current);
        }
      }
    } catch {
      // Continue
    }
    
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  
  return roots;
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

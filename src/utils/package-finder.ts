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
 * Find swiss-lib monorepo by searching for swiss-lib/package.json or swiss-lib/packages/core
 */
export async function findSwissLibMonorepo(startPath: string): Promise<string | null> {
  let current = startPath;
  for (let i = 0; i < 20; i++) { // Search up to 20 levels
    // Check for swiss-lib directory with packages/core
    const swissLibPath = path.join(current, "swiss-lib");
    const swissLibPackageJson = path.join(swissLibPath, "package.json");
    const corePackage = path.join(swissLibPath, "packages", "core", "package.json");
    
    try {
      // Check if swiss-lib exists and has core package
      if (await fileExists(swissLibPackageJson) || await fileExists(corePackage)) {
        console.log(`[package-finder] Found swiss-lib at: ${swissLibPath}`);
        return swissLibPath;
      }
    } catch {
      // Continue searching
    }
    
    // Also check for legacy SWISS directory
    const swissPath = path.join(current, "SWISS");
    const swissPackageJson = path.join(swissPath, "package.json");
    const swissCorePackage = path.join(swissPath, "packages", "core", "package.json");
    
    try {
      if (await fileExists(swissPackageJson) || await fileExists(swissCorePackage)) {
        console.log(`[package-finder] Found legacy SWISS at: ${swissPath}`);
        return swissPath;
      }
    } catch {
      // Continue searching
    }
    
    const parent = path.dirname(current);
    if (parent === current) break;
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
  
  // 3. Check swiss-lib monorepo (for @swissjs/* packages)
  if (packageName.startsWith("@swissjs/")) {
    const swissLib = await findSwissLibMonorepo(startPath);
    if (swissLib) {
      const packageDir = packageName.replace("@swissjs/", "");
      const swissPackage = path.join(swissLib, "packages", packageDir);
      if (await fileExists(path.join(swissPackage, "package.json"))) {
        return { path: swissPackage, type: 'swiss-lib' };
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

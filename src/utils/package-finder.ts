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
 * Find any Kibologic sibling monorepo (e.g. swiss-lib, alpine-shell) by searching for its package.json
 */
export async function findSiblingRepository(startPath: string, repoName: string): Promise<string | null> {
  let current = startPath;
  for (let i = 0; i < 20; i++) {
    const siblingPath = path.join(current, repoName);
    const pkgJson = path.join(siblingPath, "package.json");
    if (await fileExists(pkgJson)) {
      return siblingPath;
    }

    // Also check for subdirectories if we're at a potential project root
    try {
      const entries = await fs.readdir(current, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === repoName && (entry.isDirectory() || entry.isSymbolicLink())) {
          const subDir = path.join(current, entry.name);
          if (await fileExists(path.join(subDir, "package.json"))) {
            return subDir;
          }
        }
      }
    } catch { /* Continue */ }

    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Find a specific package by name, with priority given based on environment.
 * In development, we prioritize local sibling source code.
 */
export async function findPackage(
  packageName: string,
  startPath: string,
  workspaceRoot?: string | null
): Promise<PackageLocation | null> {
  const isDev = process.env.NODE_ENV !== 'production';

  // 1. In Development: Prioritize @kibologic/* local siblings
  if (isDev && packageName.startsWith("@kibologic/")) {
    const unscoped = packageName.replace("@kibologic/", "");
    
    // We search across all potential sibling repository names
    const potentialRepos = ['swiss-lib', 'alpine-shell', 'swite', 'sws-infra', 'swiss-packages'];
    for (const repo of potentialRepos) {
      const siblingPath = await findSiblingRepository(startPath, repo);
      if (siblingPath) {
        const packagePath = path.join(siblingPath, "packages", unscoped);
        if (await fileExists(path.join(packagePath, "package.json"))) {
          console.log(`[package-finder] Dev Intercept: Serving ${packageName} from local source: ${packagePath}`);
          return { path: packagePath, type: 'swiss-lib' }; // Labeled as 'swiss-lib' for local resolution compatibility
        }
      }
    }
  }

  // 2. Check local node_modules (Standard resolution)
  const localNodeModules = path.join(startPath, "node_modules", packageName);
  if (await fileExists(path.join(localNodeModules, "package.json"))) {
    return { path: localNodeModules, type: 'node_modules' };
  }
  
  // 3. Check workspace root node_modules
  if (workspaceRoot) {
    const workspaceNodeModules = path.join(workspaceRoot, "node_modules", packageName);
    if (await fileExists(path.join(workspaceNodeModules, "package.json"))) {
      return { path: workspaceNodeModules, type: 'node_modules' };
    }
  }
  
  // 4. Fallback search in internal workspace packages (lib/, packages/, modules/)
  if (workspaceRoot) {
    const packageDirs = ["lib", "packages", "modules", "libraries", "apps"];
    for (const dir of packageDirs) {
      const searchDir = path.join(workspaceRoot, dir);
      if (!(await fileExists(searchDir))) continue;
      
      const parts = packageName.split("/");
      const unscoped = parts.length > 1 ? parts[1] : parts[0];
      const packagePath = path.join(searchDir, unscoped);

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

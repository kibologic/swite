/*
 * Package Registry - Dynamic package discovery
 * Scans workspace to find all packages and caches their locations
 * No hardcoded paths - discovers packages by scanning package.json files
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import chalk from "chalk";

export interface PackageInfo {
  name: string;
  path: string; // Full file system path to package directory
  packageJson: any;
}

export class PackageRegistry {
  private packages = new Map<string, PackageInfo>();
  private scanned = false;
  private scanRoots: string[] = [];

  /**
   * Scan workspace for all packages
   */
  async scanWorkspace(
    workspaceRoot: string,
    additionalRoots: string[] = []
  ): Promise<void> {
    if (this.scanned) {
      return; // Already scanned
    }

    // Validate workspace root exists
    if (!workspaceRoot) {
      console.warn(chalk.yellow("[PackageRegistry] No workspace root provided, skipping scan"));
      return;
    }

    try {
      const rootStat = await fs.stat(workspaceRoot);
      if (!rootStat.isDirectory()) {
        console.warn(chalk.yellow(`[PackageRegistry] Workspace root is not a directory: ${workspaceRoot}`));
        return;
      }
    } catch (error: any) {
      console.warn(chalk.yellow(`[PackageRegistry] Cannot access workspace root ${workspaceRoot}:`, error.message));
      return;
    }

    this.scanRoots = [workspaceRoot, ...additionalRoots.filter(root => root && root !== workspaceRoot)];
    console.log(chalk.blue(`[PackageRegistry] Scanning workspace for packages...`));
    console.log(chalk.gray(`[PackageRegistry] Roots: ${this.scanRoots.join(", ")}`));

    for (const root of this.scanRoots) {
      if (root) {
        await this.scanDirectory(root);
      }
    }

    this.scanned = true;
    console.log(
      chalk.green(
        `[PackageRegistry] ✅ Found ${this.packages.size} packages`
      )
    );
  }

  /**
   * Recursively scan directory for package.json files
   */
  private async scanDirectory(dir: string, depth: number = 0): Promise<void> {
    if (depth > 15) return; // Prevent infinite recursion

    // Validate directory exists and is accessible
    try {
      const dirStat = await fs.stat(dir);
      if (!dirStat.isDirectory()) {
        return;
      }
    } catch (error: any) {
      // Directory doesn't exist or permission denied, skip silently
      if (error.code === "ENOENT" || error.code === "EACCES") {
        return;
      }
      console.warn(chalk.yellow(`[PackageRegistry] Cannot access ${dir}:`, error.message));
      return;
    }

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Skip common directories that shouldn't be scanned
          if (
            entry.name === "node_modules" ||
            entry.name === "dist" ||
            entry.name === ".git" ||
            entry.name === ".swite" ||
            entry.name.startsWith(".")
          ) {
            continue;
          }

          const packageJsonPath = path.join(dir, entry.name, "package.json");
          
          try {
            const packageJsonContent = await fs.readFile(packageJsonPath, "utf-8");
            const packageJson = JSON.parse(packageJsonContent);
            
            if (packageJson.name) {
              const packagePath = path.join(dir, entry.name);
              const packageInfo: PackageInfo = {
                name: packageJson.name,
                path: packagePath,
                packageJson,
              };

              // Store package - if duplicate name, prefer the one found first (or closest to workspace root)
              if (!this.packages.has(packageJson.name)) {
                this.packages.set(packageJson.name, packageInfo);
                console.log(
                  chalk.gray(
                    `[PackageRegistry] Found: ${packageJson.name} at ${packagePath}`
                  )
                );
              } else {
                // Log duplicate but don't overwrite (first found wins)
                console.log(
                  chalk.yellow(
                    `[PackageRegistry] Duplicate package ${packageJson.name} found at ${packagePath}, keeping first`
                  )
                );
              }
            }
          } catch (error: any) {
            // Not a package.json or invalid JSON, continue scanning
            // Silently ignore - this is expected for non-package directories
          }

          // Recurse into subdirectories (but skip if we found a package.json here)
          // This allows nested package layouts (e.g. packages/foo/modules/bar)
          await this.scanDirectory(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch (error: any) {
      // Directory read error, log but don't fail
      if (error.code !== "ENOENT" && error.code !== "EACCES") {
        console.warn(chalk.yellow(`[PackageRegistry] Error reading directory ${dir}:`, error.message));
      }
    }
  }

  /**
   * Find package by name
   */
  findPackage(packageName: string): PackageInfo | null {
    return this.packages.get(packageName) || null;
  }

  /**
   * Get all packages
   */
  getAllPackages(): PackageInfo[] {
    return Array.from(this.packages.values());
  }

  /**
   * Clear cache and rescan
   */
  async rescan(): Promise<void> {
    const roots = [...this.scanRoots];
    this.packages.clear();
    this.scanned = false;
    this.scanRoots = [];
    
    if (roots.length > 0) {
      await this.scanWorkspace(roots[0], roots.slice(1));
    }
  }

  /**
   * Get package count
   */
  getPackageCount(): number {
    return this.packages.size;
  }
}

// Singleton instance
let registryInstance: PackageRegistry | null = null;

export function getPackageRegistry(): PackageRegistry {
  if (!registryInstance) {
    registryInstance = new PackageRegistry();
  }
  return registryInstance;
}

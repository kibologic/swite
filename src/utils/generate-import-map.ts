/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Generate pre-resolved import maps at build time
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { ModuleResolver } from "../resolver.js";
import chalk from "chalk";
import { getPackageRegistry } from "./package-registry.js";
import { findSwissLibMonorepo } from "./package-finder.js";

export interface ImportMap {
  version: string;
  generated: number;
  imports: {
    [specifier: string]: string; // "@package/name" -> "/path/to/resolved/file"
  };
}

/**
 * Scan workspace and generate import map
 * This pre-resolves all known packages to eliminate runtime scanning
 */
export async function generateImportMap(
  root: string,
  workspaceRoot: string | null,
): Promise<ImportMap> {
  const resolver = new ModuleResolver(root);
  const importMap: ImportMap = {
    version: "1.0",
    generated: Date.now(),
    imports: {},
  };

  console.log(chalk.blue("[ImportMap] Using dynamic package registry..."));

  // Use dynamic package registry instead of manual scanning
  const registry = getPackageRegistry();
  const scanRoot = workspaceRoot || root;
  
  if (!scanRoot) {
    console.warn(chalk.yellow("[ImportMap] No workspace root or app root provided, cannot scan packages"));
    return importMap;
  }
  
  // Add swiss-lib monorepo if it exists
  const additionalRoots: string[] = [];
  const swissLib = await findSwissLibMonorepo(root);
  if (swissLib) {
    try {
      const swissPackageJson = path.join(swissLib, "package.json");
      await fs.access(swissPackageJson);
      additionalRoots.push(swissLib);
      console.log(chalk.blue("[ImportMap] Including swiss-lib monorepo..."));
    } catch {
      // swiss-lib monorepo not accessible, skip
    }
  }

  // Scan workspace using registry
  try {
    await registry.scanWorkspace(scanRoot, additionalRoots);
  } catch (error: any) {
    console.error(chalk.red(`[ImportMap] Error scanning workspace: ${error.message}`));
    return importMap;
  }
  
  // Get all discovered packages
  const packages = registry.getAllPackages().map(pkg => ({
    name: pkg.name,
    path: pkg.path,
  }));

  console.log(
    chalk.blue(`[ImportMap] Resolving ${packages.length} packages...`),
  );

  // Resolve each package
  let resolved = 0;
  for (const pkg of packages) {
    try {
      // Resolve main export
      const resolvedPath = await resolver.resolve(pkg.name, "");
      if (resolvedPath && !resolvedPath.startsWith("http")) {
        importMap.imports[pkg.name] = resolvedPath;
        resolved++;
      }

      // Also resolve common subpaths (components, tokens, etc.)
      const commonSubpaths = [
        "/components",
        "/tokens",
        "/context",
        "/shell",
        "/jsx-runtime",
        "/jsx-dev-runtime",
      ];

      for (const subpath of commonSubpaths) {
        try {
          const subpathSpecifier = `${pkg.name}${subpath}`;
          const subpathResolved = await resolver.resolve(subpathSpecifier, "");
          if (subpathResolved && !subpathResolved.startsWith("http")) {
            importMap.imports[subpathSpecifier] = subpathResolved;
            resolved++;
          }
        } catch {
          // Subpath doesn't exist, skip
        }
      }
    } catch (error) {
      console.warn(
        chalk.yellow(`[ImportMap] Failed to resolve ${pkg.name}:`, error),
      );
    }
  }

  console.log(
    chalk.green(
      `[ImportMap] ✅ Generated import map with ${resolved} entries`,
    ),
  );

  return importMap;
}

/**
 * Save import map to file
 */
export async function saveImportMap(
  importMap: ImportMap,
  outputPath: string,
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(importMap, null, 2), "utf-8");
  console.log(chalk.green(`[ImportMap] ✅ Saved to ${outputPath}`));
}

/**
 * Load import map from file
 */
export async function loadImportMap(
  filePath: string,
): Promise<ImportMap | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content) as ImportMap;
  } catch {
    return null;
  }
}

/*
 * Module Resolver for SWITE
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import type { ImportMap } from "./utils/generate-import-map.js";
import { findSwissLibMonorepo } from "./utils/package-finder.js";
import { toUrl, type UrlResolverContext, type WorkspacePackageResolverContext } from "./resolver/url-resolver.js";
import { resolveWorkspacePackage } from "./resolver/workspace-package-resolver.js";
import { resolveBareImport, type BareImportResolverContext } from "./resolver/bare-import-resolver.js";

export class ModuleResolver {
  private workspaceRoot: string | null = null;
  private importMap: ImportMap | null = null;

  constructor(private root: string) {}

  /**
   * Set pre-resolved import map (from build-time generation)
   */
  setImportMap(importMap: ImportMap | null): void {
    this.importMap = importMap;
    if (importMap) {
      console.log(
        chalk.green(
          `[Resolver] Loaded import map with ${Object.keys(importMap).length - 2} entries`,
        ),
      );
    }
  }

  private async getWorkspaceRoot(): Promise<string | null> {
    if (this.workspaceRoot) return this.workspaceRoot;

    const findWorkspaceRoot = async (
      startDir: string,
    ): Promise<string | null> => {
      let current = startDir;
      for (let i = 0; i < 5; i++) {
        const workspaceFile = path.join(current, "pnpm-workspace.yaml");
        const packageJson = path.join(current, "package.json");
        if (
          (await this.fileExists(workspaceFile)) ||
          ((await this.fileExists(packageJson)) &&
            JSON.parse(await fs.readFile(packageJson, "utf-8")).workspaces)
        ) {
          return current;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
      return null;
    };

    this.workspaceRoot = await findWorkspaceRoot(this.root);
    return this.workspaceRoot;
  }

  async resolve(specifier: string, importer: string): Promise<string> {
    console.log(
      `[SWITE] resolve CALLED: specifier: ${specifier}, importer: ${importer}`,
    );

    // Check import map first (fast path)
    if (this.importMap && !specifier.startsWith(".") && !specifier.startsWith("/")) {
      const mapped = this.importMap.imports[specifier];
      if (mapped) {
        console.log(
          chalk.green(`[Resolver] ✅ Import map hit: ${specifier} -> ${mapped}`),
        );
        return mapped;
      }
    }

    // CRITICAL: Skip variable references - they should never be resolved as modules
    // Variables like def.componentUrl, someVar, etc. should be left as-is
    // Only resolve actual module specifiers (bare imports starting with @ or valid package names)
    if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
      // Check if this looks like a variable reference (property access, camelCase without @, etc.)
      // Valid module specifiers: @scope/name, package-name, ./relative, /absolute
      // Variable references: def.componentUrl, someVar, obj.prop, etc.
      if (specifier.includes(".") && !specifier.startsWith("@")) {
        // Property access pattern (def.componentUrl) - this is a variable, not a module
        console.warn(
          `[SWITE] resolve: Skipping variable reference: ${specifier}`,
        );
        return specifier; // Return as-is, don't try to resolve
      }

      // Additional check: if it doesn't look like a valid package name, it might be a variable
      // Valid package names: start with letter or @, contain only alphanumeric, -, _, /
      // Also allow file extensions at the end: .js, .ts, .ui, .uix, etc.
      if (
        !/^[@a-zA-Z][a-zA-Z0-9_/@-]*(\.(js|ts|ui|uix|mjs|cjs|jsx|tsx))?$/.test(
          specifier,
        )
      ) {
        console.warn(
          `[SWITE] resolve: Invalid module specifier (likely variable): ${specifier}`,
        );
        return specifier; // Return as-is
      }

      const context: BareImportResolverContext = {
        root: this.root,
        getWorkspaceRoot: () => this.getWorkspaceRoot(),
        fileExists: (p) => this.fileExists(p),
        resolveWorkspacePackage: (pkgName) => this.resolveWorkspacePackage(pkgName),
      };
      const result = await resolveBareImport(specifier, context);
      console.log(`[SWITE] resolve RESULT: ${specifier} -> ${result}`);
      return result;
    }

    // Handle absolute paths (already URLs)
    if (specifier.startsWith("/")) {
      return specifier;
    }

    // Handle relative imports
    // importer might be a URL path (/src/modules/index.ui) or file path
    // Convert URL to file path if needed
    let importerPath = importer;
    if (importer.startsWith("/")) {
      // URL path - convert to file path
      // Prioritize app root for app files (src/, public/, assets/)
      if (
        importer.startsWith("/src/") ||
        importer.startsWith("/public/") ||
        importer.startsWith("/assets/")
      ) {
        // App-specific paths - resolve from app root
        importerPath = path.join(this.root, importer);
      } else {
        // Other paths - try workspace root first (for libraries/, packages/)
        const workspaceRoot = await this.getWorkspaceRoot();
        if (workspaceRoot) {
          const workspacePath = path.join(workspaceRoot, importer);
          if (await this.fileExists(workspacePath)) {
            importerPath = workspacePath;
          } else {
            // Fallback to app root
            importerPath = path.join(this.root, importer);
          }
        } else {
          // No workspace root, use app root
          importerPath = path.join(this.root, importer);
        }
      }
    }
    const importerDir = path.dirname(importerPath);

    // If specifier already has an extension (.ui, .uix, .ts, .js, etc.), try it first
    // This preserves .ui/.uix extensions for SWISS files
    const hasExtension = /\.(ui|uix|ts|tsx|js|jsx|mjs)$/.test(specifier);

    if (hasExtension) {
      // Specifier has extension, resolve it directly
      const resolved = path.resolve(importerDir, specifier);
      console.log(
        `[SWITE] resolve relative (hasExt): ${specifier}, importerDir: ${importerDir}, resolved: ${resolved}, exists: ${await this.fileExists(resolved)}`,
      );
      if (await this.fileExists(resolved)) {
        const url = await this.toUrl(resolved);
        console.log(
          `[SWITE] resolve relative: ${specifier} -> ${resolved} -> ${url}`,
        );
        return url;
      }
    }

    // If no extension or file not found, try adding extensions
    // Strip any existing extension from specifier (but preserve .ui/.uix if present)
    const specifierWithoutExt = specifier.replace(/\.(js|ts|jsx|tsx|mjs)$/, "");
    const resolved = path.resolve(importerDir, specifierWithoutExt);
    console.log(
      `[SWITE] resolve relative (trying extensions): specifierWithoutExt: ${specifierWithoutExt}, resolved: ${resolved}`,
    );

    // Try adding extensions (prioritize .ui and .uix for SWISS files)
    const extensions = [".ui", ".uix", ".ts", ".tsx", ".js", ".jsx", ".mjs"];

    for (const ext of extensions) {
      const withExt = resolved + ext;
      const exists = await this.fileExists(withExt);
      console.log(
        `[SWITE] trying extension ${ext}: ${withExt}, exists: ${exists}`,
      );
      if (exists) {
        const url = await this.toUrl(withExt);
        console.log(`[SWITE] found with ${ext}: ${url}`);
        return url;
      }
    }

    // Try index files
    for (const ext of extensions) {
      const indexFile = path.join(resolved, `index${ext}`);
      if (await this.fileExists(indexFile)) {
        return await this.toUrl(indexFile);
      }
    }

    // Return as-is if nothing found
    return await this.toUrl(resolved);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async resolveWorkspacePackage(
    pkgName: string,
  ): Promise<string | null> {
    const context: WorkspacePackageResolverContext = {
      root: this.root,
      getWorkspaceRoot: () => this.getWorkspaceRoot(),
      fileExists: (p) => this.fileExists(p),
    };
    return resolveWorkspacePackage(pkgName, context);
  }

  // OLD IMPLEMENTATION REMOVED - now uses resolver/workspace-package-resolver.ts

  private async toUrl(filePath: string): Promise<string> {
    const context: UrlResolverContext = {
      root: this.root,
      getWorkspaceRoot: () => this.getWorkspaceRoot(),
      fileExists: (p) => this.fileExists(p),
    };
    return toUrl(filePath, context);
  }

  // OLD IMPLEMENTATION REMOVED - now uses resolver/url-resolver.ts
}

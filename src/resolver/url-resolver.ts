/*
 * URL Resolver - Converts file paths to URLs
 * Extracted from resolver.ts for modularity
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { findSwissLibMonorepo } from "../utils/package-finder.js";

export interface UrlResolverContext {
  root: string;
  getWorkspaceRoot: () => Promise<string | null>;
  fileExists: (filePath: string) => Promise<boolean>;
}

export type WorkspacePackageResolverContext = UrlResolverContext;

/**
 * Normalize result to ensure no /swiss-lib/ paths leak to browser
 */
function normalizeResult(result: string): string {
  const original = result;
  if (result.includes('/swiss-lib/')) {
    console.log(`[SWITE] normalizeResult: Found /swiss-lib/ in "${result}", fixing...`);
    result = result.replace(/\/swiss-lib\/packages\//g, '/swiss-packages/');
    result = result.replace(/\/swiss-lib\//g, '/swiss-packages/');
    console.log(`[SWITE] normalizeResult: Fixed to "${result}"`);
  }
  result = result.replace(/\\/g, '/');
  if (original !== result && original.includes('swiss-lib')) {
    console.log(`[SWITE] normalizeResult: Final result "${result}" (was "${original}")`);
  }
  return result;
}

/**
 * Convert file path to URL for browser
 */
export async function toUrl(
  filePath: string,
  context: UrlResolverContext
): Promise<string> {
  const normalized = filePath.replace(/\\/g, "/");

  // If path is already a URL (starts with / or http), check for source file first
  if (normalized.startsWith("/") || normalized.startsWith("http")) {
    let workingPath = normalized;
    if (normalized.includes("/swiss-lib/packages/")) {
      workingPath = normalized.replace(/\/swiss-lib\/packages\//g, "/swiss-packages/");
      console.log(`[SWITE] toUrl: Converting /swiss-lib/ to /swiss-packages/: ${normalized} -> ${workingPath}`);
      
      if (workingPath.includes("/dist/") && !workingPath.includes("/src/")) {
        const srcPath = workingPath.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
        console.log(`[SWITE] toUrl: Checking for source file: ${srcPath}`);
        const { resolveFilePath } = await import("../utils/file-path-resolver.js");
        const workspaceRoot = await context.getWorkspaceRoot();
        const srcFilePath = await resolveFilePath(srcPath, context.root, workspaceRoot);
        console.log(`[SWITE] toUrl: Resolved source file path: ${srcFilePath}, exists: ${await context.fileExists(srcFilePath)}`);
        if (await context.fileExists(srcFilePath)) {
          console.log(`[SWITE] toUrl: Preferring source over dist: ${srcPath}`);
          return normalizeResult(srcPath);
        }
      }
      return normalizeResult(workingPath);
    }
    
    if (workingPath.includes("/dist/") && !workingPath.includes("/src/")) {
      const srcPath = workingPath.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
      console.log(`[SWITE] toUrl: Checking for source file: ${srcPath}`);
      const { resolveFilePath } = await import("../utils/file-path-resolver.js");
      const workspaceRoot = await context.getWorkspaceRoot();
      const srcFilePath = await resolveFilePath(srcPath, context.root, workspaceRoot);
      console.log(`[SWITE] toUrl: Resolved source file path: ${srcFilePath}, exists: ${await context.fileExists(srcFilePath)}`);
      if (await context.fileExists(srcFilePath)) {
        console.log(`[SWITE] toUrl: Preferring source over dist: ${srcPath}`);
        return normalizeResult(srcPath);
      }
    }
    return normalizeResult(workingPath);
  }

  // If path is absolute, try to make it relative to workspace root or server root
  if (path.isAbsolute(filePath)) {
    const workspaceRoot = await context.getWorkspaceRoot();

    // Check if this is a swiss-lib monorepo package (@swissjs/*)
    const swissLib = await findSwissLibMonorepo(context.root);
    console.log(`[SWITE] toUrl: swiss-lib check - swissLib=${swissLib}, this.root=${context.root}, filePath=${filePath}`);
    if (swissLib) {
      const swissPackagesPath = path.join(swissLib, "packages");
      
      let resolvedSwissPackages: string;
      let resolvedFilePath: string;
      try {
        resolvedSwissPackages = await fs.realpath(swissPackagesPath);
        resolvedFilePath = await fs.realpath(filePath);
      } catch {
        resolvedSwissPackages = path.resolve(swissPackagesPath);
        resolvedFilePath = path.resolve(filePath);
      }
      
      const normalizedSwissPackages = resolvedSwissPackages.replace(/\\/g, "/").toLowerCase();
      const normalizedFilePath = resolvedFilePath.replace(/\\/g, "/").toLowerCase();

      console.log(`[SWITE] toUrl: swiss-lib path comparison - normalizedSwissPackages="${normalizedSwissPackages}", normalizedFilePath="${normalizedFilePath}", startsWith=${normalizedFilePath.startsWith(normalizedSwissPackages)}`);

      if (normalizedFilePath.startsWith(normalizedSwissPackages)) {
        console.log(`[SWITE] toUrl: ✅ swiss-lib path MATCHED! Converting to /swiss-packages/`);
        const origSwissPackages = resolvedSwissPackages.replace(/\\/g, "/");
        const origFilePath = resolvedFilePath.replace(/\\/g, "/");
        const relative = origFilePath.slice(origSwissPackages.length);
        const url = "/swiss-packages" + (relative.startsWith("/") ? relative : "/" + relative);
        
        if (url.includes("/dist/") && !url.includes("/src/")) {
          const srcUrl = url.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
          const srcRelative = srcUrl.replace("/swiss-packages/", "");
          const srcFilePath = path.join(swissPackagesPath, srcRelative);
          console.log(`[SWITE] toUrl: Checking source file: ${srcFilePath}, exists: ${await context.fileExists(srcFilePath)}`);
          if (await context.fileExists(srcFilePath)) {
            console.log(`[SWITE] toUrl: Preferring source over dist: ${srcUrl}`);
            return normalizeResult(srcUrl);
          }
        }

        console.log(`[SWITE] toUrl: ${filePath} -> ${url} (swiss-lib package)`);
        return normalizeResult(url);
      }
    }

    // Check if this is a node_modules path
    const origFilePathNormalized = path.resolve(filePath).replace(/\\/g, "/");
    if (origFilePathNormalized.toLowerCase().includes("/node_modules/")) {
      const nodeModulesIndex = origFilePathNormalized.toLowerCase().indexOf("/node_modules/");
      const afterNodeModules = origFilePathNormalized.slice(nodeModulesIndex + "/node_modules/".length);
      const url = "/node_modules/" + afterNodeModules;
      console.log(`[SWITE] toUrl: ${filePath} -> ${url} (node_modules, preserving case)`);
      return normalizeResult(url);
    }

    // Try relative to app root FIRST
    const normalizedRoot = path.resolve(context.root).replace(/\\/g, "/").toLowerCase();
    const normalizedFilePath = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();

    if (normalizedFilePath.startsWith(normalizedRoot)) {
      const origRoot = path.resolve(context.root).replace(/\\/g, "/");
      const origFilePath = path.resolve(filePath).replace(/\\/g, "/");
      const relative = origFilePath.slice(origRoot.length);
      const url = relative.startsWith("/") ? relative : "/" + relative;
      console.log(`[SWITE] toUrl: ${filePath} -> ${url} (app root: ${context.root})`);
      return normalizeResult(url);
    }

    // Try workspace root
    if (workspaceRoot) {
      const normalizedWorkspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();

      if (normalizedFilePath.startsWith(normalizedWorkspaceRoot)) {
        const origWorkspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/");
        const origFilePath = path.resolve(filePath).replace(/\\/g, "/");
        
        // CRITICAL: Check if this is a swiss-lib path BEFORE computing relative
        const normalizedOrigFilePath = origFilePath.toLowerCase();
        console.log(`[SWITE] toUrl DEBUG: origFilePath="${origFilePath}", normalized="${normalizedOrigFilePath}", checking for swiss-lib...`);
        if (normalizedOrigFilePath.includes("/swiss-lib/packages/") || normalizedOrigFilePath.includes("\\swiss-lib\\packages\\")) {
          console.log(`[SWITE] toUrl DEBUG: ✅ Found swiss-lib in path!`);
          const swissLibIndex = normalizedOrigFilePath.indexOf("/swiss-lib/packages/");
          const swissLibIndexBackslash = normalizedOrigFilePath.indexOf("\\swiss-lib\\packages\\");
          const index = swissLibIndex >= 0 ? swissLibIndex : swissLibIndexBackslash;
          const separator = swissLibIndex >= 0 ? "/swiss-lib/packages/" : "\\swiss-lib\\packages\\";
          const afterSwissLib = origFilePath.slice(index + separator.length);
          const url = "/swiss-packages/" + afterSwissLib.replace(/\\/g, "/");
          console.log(`[SWITE] toUrl: ${filePath} -> ${url} (swiss-lib via workspace root - FIXED)`);
          return normalizeResult(url);
        }
        
        const relative = origFilePath.slice(origWorkspaceRoot.length);
        let url = relative.startsWith("/") ? relative : "/" + relative;
        
        // Prefer src over dist for workspace /packages/ in dev (unbuilt packages)
        if (
          url.includes("/packages/") &&
          url.includes("/dist/") &&
          (await context.fileExists(filePath)) === false
        ) {
          const srcPath = filePath.replace(/[/\\]dist[/\\]/, path.sep + "src" + path.sep).replace(/\.js$/i, ".ts");
          if (await context.fileExists(srcPath)) {
            const srcRelative = path.relative(workspaceRoot, srcPath).replace(/\\/g, "/");
            url = "/" + srcRelative;
            console.log(`[SWITE] toUrl: Preferring src over dist (packages): ${url}`);
          }
        }
        
        console.log(`[SWITE] toUrl DOUBLE CHECK: url="${url}", lowercase="${url.toLowerCase()}", includes="/swiss-lib/"=${url.toLowerCase().includes("/swiss-lib/")}`);
        
        // DOUBLE CHECK: If computed URL contains /swiss-lib/, fix it
        if (url.toLowerCase().includes("/swiss-lib/")) {
          console.log(`[SWITE] toUrl DOUBLE CHECK: ✅ MATCHED! Fixing URL...`);
          const fixedUrl = url.replace(/\/swiss-lib\/packages\//gi, "/swiss-packages/").replace(/\/swiss-lib\//gi, "/swiss-packages/");
          console.log(`[SWITE] toUrl: ${filePath} -> ${fixedUrl} (workspace root - FIXED /swiss-lib/ in URL)`);
          return normalizeResult(fixedUrl);
        }
        
        console.log(`[SWITE] toUrl: ${filePath} -> ${url} (workspace: ${workspaceRoot})`);
        return normalizeResult(url);
      }
    }

    // Fallback
    const fallbackWorkspaceRoot = await context.getWorkspaceRoot();
    const baseRoot = fallbackWorkspaceRoot || context.root;
    const relative = path.relative(baseRoot, filePath);
    const url = "/" + relative.replace(/\\/g, "/");
    console.warn(`[SWITE] toUrl fallback: ${filePath} -> ${url} (may not work if path goes outside root)`);
    return normalizeResult(url);
  }

  // Default: make relative to root
  const relative = path.relative(context.root, filePath);
  return normalizeResult("/" + relative.replace(/\\/g, "/"));
}

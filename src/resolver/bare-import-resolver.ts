/*
 * Bare Import Resolver - Resolves bare module specifiers (@swissjs/core, etc.)
 * Extracted from resolver.ts for modularity
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import chalk from "chalk";
import { findSwissLibMonorepo } from "../utils/package-finder.js";
import type { UrlResolverContext, WorkspacePackageResolverContext } from "./url-resolver.js";
import { resolveWorkspacePackage } from "./workspace-package-resolver.js";
import { toUrl } from "./url-resolver.js";

export interface BareImportResolverContext extends UrlResolverContext {
  resolveWorkspacePackage: (pkgName: string) => Promise<string | null>;
}

/**
 * Resolve bare import specifier (e.g., @swissjs/core, react, etc.)
 */
export async function resolveBareImport(
  specifier: string,
  context: BareImportResolverContext
): Promise<string> {
  console.log(`[SWITE] resolveBareImport CALLED: ${specifier}`);
  try {
    // Handle scoped packages (@swissjs/core) and regular packages
    const parts = specifier.split("/");
    const isScoped = specifier.startsWith("@");
    const pkgName = isScoped ? `${parts[0]}/${parts[1]}` : parts[0];
    const subPath = isScoped
      ? parts.slice(2).join("/")
      : parts.slice(1).join("/");

    console.log(
      `[SWITE] resolveBareImport: ${specifier} -> pkgName: ${pkgName}, subPath: ${subPath}`,
    );

    // Find package.json - check multiple node_modules locations
    let pkgDir: string | null = null;
    let pkgJsonPath: string | null = null;

    const nodeModulesLocations: string[] = [
      path.join(context.root, "node_modules"),
    ];

    // Add workspace root node_modules
    const workspaceRoot = await context.getWorkspaceRoot();
    if (workspaceRoot) {
      nodeModulesLocations.push(path.join(workspaceRoot, "node_modules"));
    }

    // Add swiss-lib monorepo node_modules
    const swissLib = await findSwissLibMonorepo(context.root);
    if (swissLib) {
      const swissNodeModules = path.join(swissLib, "node_modules");
      if (await context.fileExists(swissNodeModules)) {
        nodeModulesLocations.push(swissNodeModules);
        console.log(`[SWITE] Added swiss-lib monorepo node_modules for ${pkgName}`);
      }
    }

    // Try each location
    for (const nodeModulesPath of nodeModulesLocations) {
      const testPkgDir = path.join(nodeModulesPath, pkgName);
      const testPkgJsonPath = path.join(testPkgDir, "package.json");
      if (await context.fileExists(testPkgJsonPath)) {
        pkgDir = testPkgDir;
        pkgJsonPath = testPkgJsonPath;
        console.log(`[SWITE] Found ${pkgName} in ${nodeModulesPath}`);
        break;
      }
    }

    if (!pkgJsonPath || !pkgDir) {
      console.log(
        `[SWITE] Package ${pkgName} not in node_modules, checking workspace...`,
      );
      // Try workspace packages before CDN fallback
      const workspacePkg = await context.resolveWorkspacePackage(pkgName);
      if (workspacePkg) {
        return await resolveWorkspacePackageEntry(
          workspacePkg,
          pkgName,
          subPath,
          specifier,
          context,
        );
      }

      // Not in workspace, use CDN (jsDelivr; esm.sh returns 500 for some packages)
      console.warn(
        `[SWITE] Package ${pkgName} not found, using CDN fallback`,
      );
      return `https://cdn.jsdelivr.net/npm/${specifier}/+esm`;
    }

    // Package found in node_modules
    const pkgJson = JSON.parse(await fs.readFile(pkgJsonPath, "utf-8"));

    // Check if this is a workspace package (symlinked)
    let realPkgDir: string;
    try {
      realPkgDir = await fs.realpath(pkgDir);
    } catch {
      realPkgDir = pkgDir;
    }

    const workspacePkg = await context.resolveWorkspacePackage(pkgName);
    console.log(
      `[SWITE] resolveBareImport (node_modules): workspacePkg=${workspacePkg}, realPkgDir=${realPkgDir}, pkgName=${pkgName}`,
    );
    if (workspacePkg) {
      const normalizedWorkspacePkg = path
        .resolve(workspacePkg)
        .replace(/\\/g, "/")
        .toLowerCase();
      const normalizedRealPkgDir = path
        .resolve(realPkgDir)
        .replace(/\\/g, "/")
        .toLowerCase();

      // If the real path is the workspace package, use workspace resolution
      if (
        normalizedRealPkgDir === normalizedWorkspacePkg ||
        normalizedRealPkgDir.includes(normalizedWorkspacePkg)
      ) {
        console.log(
          `[SWITE] resolveBareImport (node_modules): Using workspace resolution for ${pkgName}`,
        );
        return await resolveWorkspacePackageEntry(
          workspacePkg,
          pkgName,
          subPath,
          specifier,
          context,
        );
      }
    }

    // Handle exports field if present
    if (pkgJson.exports) {
      const exportKey = subPath ? `./${subPath}` : ".";
      const exportEntry = pkgJson.exports[exportKey];

      if (exportEntry) {
        let entryPoint: string;
        if (typeof exportEntry === "string") {
          entryPoint = exportEntry;
        } else if (exportEntry.import) {
          entryPoint = exportEntry.import;
        } else if (exportEntry.default) {
          entryPoint = exportEntry.default;
        } else {
          entryPoint = exportEntry as unknown as string;
        }

        const fullPath = path.join(pkgDir, entryPoint);

        // Prefer source over dist
        const normalizedFullPath = fullPath.replace(/\\/g, "/");
        if (normalizedFullPath.includes("/dist/")) {
          const srcFullPath = normalizedFullPath
            .replace("/dist/", "/src/")
            .replace(/\.js$/, ".ts");
          if (await context.fileExists(srcFullPath)) {
            console.log(
              `[SWITE] resolveBareImport: Using source file instead of dist: ${srcFullPath}`,
            );
            return await toUrl(srcFullPath, context);
          }
        }

        if (await context.fileExists(fullPath)) {
          return await toUrl(fullPath, context);
        }

        // Try extensions
        for (const ext of [".js", ".mjs", ".ts", ".ui", ".uix"]) {
          const withExt = fullPath.replace(/\.(js|mjs|ts|ui|uix)$/, ext);
          if (await context.fileExists(withExt)) {
            return await toUrl(withExt, context);
          }
        }

        // Try case-insensitive match
        const dir = path.dirname(fullPath);
        const fileName = path.basename(fullPath);
        try {
          const files = await fs.readdir(dir);
          const caseInsensitiveMatch = files.find(
            (f) => f.toLowerCase() === fileName.toLowerCase(),
          );
          if (caseInsensitiveMatch) {
            const correctedPath = path.join(dir, caseInsensitiveMatch);
            if (await context.fileExists(correctedPath)) {
              console.log(
                chalk.yellow(
                  `[SWITE] Case-insensitive match for ${pkgName}: ${fileName} -> ${caseInsensitiveMatch}`,
                ),
              );
              return await toUrl(correctedPath, context);
            }
          }
        } catch {
          // Directory doesn't exist, continue to fallback
        }
      }
    }

    // Determine entry point
    let entryPoint: string;
    if (subPath) {
      entryPoint = subPath;
    } else {
      entryPoint = pkgJson.module || pkgJson.main || "index.js";
    }

    const fullPath = path.join(pkgDir, entryPoint);

    // Try the exact path first
    if (await context.fileExists(fullPath)) {
      return await toUrl(fullPath, context);
    }

    // Try with extensions
    for (const ext of [".js", ".mjs", ".ts", ".ui", ".uix"]) {
      if (await context.fileExists(fullPath + ext)) {
        return await toUrl(fullPath + ext, context);
      }
    }

    // Fallback to CDN (jsDelivr; esm.sh returns 500 for some packages)
    console.warn(`[SWITE] Could not resolve ${specifier}, using CDN`);
    return `https://cdn.jsdelivr.net/npm/${specifier}/+esm`;
  } catch (error) {
    console.warn(`[SWITE] Error resolving ${specifier}:`, error);
    return `https://cdn.jsdelivr.net/npm/${specifier}/+esm`;
  }
}

/**
 * Resolve entry point for workspace package
 */
async function resolveWorkspacePackageEntry(
  workspacePkg: string,
  pkgName: string,
  subPath: string,
  specifier: string,
  context: BareImportResolverContext,
): Promise<string> {
  const workspacePkgJson = JSON.parse(
    await fs.readFile(path.join(workspacePkg, "package.json"), "utf-8"),
  );

  // Handle exports field if present
  if (workspacePkgJson.exports) {
    const subPathWithoutExt = subPath
      ? subPath.replace(/\.(js|ts|ui|uix)$/, "")
      : "";
    let exportKey = subPathWithoutExt ? `./${subPathWithoutExt}` : ".";

    console.log(
      `[SWITE] resolveBareImport (workspace): pkgName=${pkgName}, subPath=${subPath}, subPathWithoutExt=${subPathWithoutExt}, exportKey=${exportKey}`,
    );

    // Try to find matching export
    if (subPath && !workspacePkgJson.exports[exportKey]) {
      if (subPathWithoutExt) {
        const withoutExtKey = `./${subPathWithoutExt}`;
        if (workspacePkgJson.exports[withoutExtKey]) {
          exportKey = withoutExtKey;
        }
      }

      if (!workspacePkgJson.exports[exportKey]) {
        const subPathParts = subPathWithoutExt.split("/");
        if (subPathParts.length > 1) {
          const dirPath = subPathParts.slice(0, -1).join("/");
          const dirExportKey = `./${dirPath}`;
          if (workspacePkgJson.exports[dirExportKey]) {
            exportKey = dirExportKey;
          } else {
            const firstDir = subPathParts[0];
            const firstDirExportKey = `./${firstDir}`;
            if (workspacePkgJson.exports[firstDirExportKey]) {
              exportKey = firstDirExportKey;
            } else {
              const lastDir = subPathParts[subPathParts.length - 2];
              const lastDirExportKey = `./${lastDir}`;
              if (workspacePkgJson.exports[lastDirExportKey]) {
                exportKey = lastDirExportKey;
              }
            }
          }
        }
      }
    }

    const exportEntry = workspacePkgJson.exports[exportKey];

    if (exportEntry) {
      let entryPoint: string;
      if (typeof exportEntry === "string") {
        entryPoint = exportEntry;
      } else if (exportEntry.import) {
        entryPoint = exportEntry.import;
      } else if (exportEntry.default) {
        entryPoint = exportEntry.default;
      } else {
        entryPoint = exportEntry;
      }

      const normalizedEntryPoint = entryPoint.startsWith("./")
        ? entryPoint.slice(2)
        : entryPoint;
      const fullPath = path.join(workspacePkg, normalizedEntryPoint);

      // Dev: prefer src over dist for workspace packages (unbuilt or dev mode)
      const normalizedFull = fullPath.replace(/\\/g, "/");
      if (normalizedFull.includes("/dist/")) {
        const srcPath = fullPath.replace(/[/\\]dist[/\\]/, path.sep + "src" + path.sep).replace(/\.js$/i, ".ts");
        if (await context.fileExists(srcPath)) {
          console.log(`[SWITE] resolveBareImport (workspace): preferring src over dist: ${srcPath}`);
          return await toUrl(srcPath, context);
        }
      }

      if (await context.fileExists(fullPath)) {
        return await toUrl(fullPath, context);
      }

      // Try extensions
      for (const ext of [".ui", ".uix", ".ts", ".js"]) {
        const withExt = fullPath.replace(/\.(js|ts|ui|uix)$/, ext);
        if (await context.fileExists(withExt)) {
          return await toUrl(withExt, context);
        }
      }
    }
  }

  // Fallback to old logic
  let entryPoint: string;
  if (subPath) {
    entryPoint = subPath;
  } else {
    entryPoint =
      workspacePkgJson.module || workspacePkgJson.main || "index.js";
  }

  const fullPath = path.join(workspacePkg, entryPoint);

  // Dev: prefer src over dist for workspace packages
  const normalizedFull = fullPath.replace(/\\/g, "/");
  if (normalizedFull.includes("/dist/")) {
    const srcPath = fullPath.replace(/[/\\]dist[/\\]/, path.sep + "src" + path.sep).replace(/\.js$/i, ".ts");
    if (await context.fileExists(srcPath)) {
      console.log(`[SWITE] resolveBareImport (fallback): preferring src over dist: ${srcPath}`);
      return await toUrl(srcPath, context);
    }
  }

  if (await context.fileExists(fullPath)) {
    return await toUrl(fullPath, context);
  }

  // Try extensions
  const ext = path.extname(entryPoint);
  if (ext) {
    const basePath = fullPath.slice(0, -ext.length);
    for (const tryExt of [".js", ".mjs", ".ts", ".ui", ".uix"]) {
      if (await context.fileExists(basePath + tryExt)) {
        return await toUrl(basePath + tryExt, context);
      }
    }
  } else {
    for (const tryExt of [".js", ".mjs", ".ts", ".ui", ".uix"]) {
      if (await context.fileExists(fullPath + tryExt)) {
        return await toUrl(fullPath + tryExt, context);
      }
    }
  }

  // Try index files
  for (const tryExt of [".js", ".ts", ".ui", ".uix"]) {
    const indexFile = path.join(fullPath, `index${tryExt}`);
    if (await context.fileExists(indexFile)) {
      return await toUrl(indexFile, context);
    }
  }

  // Try src/ directory
  const srcDir = path.join(workspacePkg, "src");
  for (const ext of [".ts", ".ui", ".uix", ".js"]) {
    const srcIndex = path.join(srcDir, `index${ext}`);
    if (await context.fileExists(srcIndex)) {
      console.log(
        `[SWITE] Found unbuilt workspace package ${pkgName} at ${srcIndex}`,
      );
      return await toUrl(srcIndex, context);
    }
  }

  console.warn(
    `[SWITE] Entry point not found for ${pkgName} at ${fullPath}, using CDN fallback`,
  );
  return `https://cdn.jsdelivr.net/npm/${specifier}/+esm`;
}

/*
 * URL Resolver - Converts file paths to URLs
 * Extracted from resolver.ts for modularity
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import { findSwissLibMonorepo } from "../utils/package-finder.js";
import { lookupInSymlinkRegistry } from "./symlink-registry.js";

export interface UrlResolverContext {
  root: string;
  getWorkspaceRoot: () => Promise<string | null>;
  fileExists: (filePath: string) => Promise<boolean>;
}

export type WorkspacePackageResolverContext = UrlResolverContext;

function normalizeResult(result: string): string {
  return result.replace(/\\/g, '/');
}

/**
 * Convert file path to URL for browser
 */
export async function toUrl(
  filePath: string,
  context: UrlResolverContext
): Promise<string> {
  const normalized = filePath.replace(/\\/g, "/");

  // CG-03: Check symlink registry FIRST.
  // Absolute filesystem paths (both realpath-resolved and unresolved symlinks)
  // must be mapped back to browser URLs before the startsWith("/") early-return
  // fires and mangled by normalizeResult().
  // The registry maps realpath → /node_modules/<pkg> browser URL prefix.
  if (path.isAbsolute(filePath)) {
    // Direct lookup (path is already a realpath, e.g. from fs.realpath() in ts-handler)
    let registryUrl = lookupInSymlinkRegistry(normalized);

    // Fallback: resolve symlinks and retry (path may still contain symlink segments,
    // e.g. app/node_modules/@alpine/core/... where app/node_modules is itself a symlink)
    if (!registryUrl) {
      try {
        const realPath = (await fs.realpath(filePath)).replace(/\\/g, "/");
        if (realPath !== normalized) {
          registryUrl = lookupInSymlinkRegistry(realPath);
        }
      } catch {
        // file may not exist yet; ignore
      }
    }

    if (registryUrl) {
      console.log(
        `[SWITE] toUrl: symlink registry hit: ${filePath} → ${registryUrl}`
      );
      return registryUrl;
    }

    // If the absolute filesystem path contains /node_modules/, convert it to a
    // browser-relative URL (/node_modules/...) before the startsWith("/") early
    // return below swallows it as an already-resolved URL.
    if (normalized.toLowerCase().includes("/node_modules/")) {
      const nodeModulesIndex = normalized.toLowerCase().indexOf("/node_modules/");
      const afterNodeModules = normalized.slice(nodeModulesIndex + "/node_modules/".length);
      const url = "/node_modules/" + afterNodeModules;
      console.log(`[SWITE] toUrl: abs→node_modules URL: ${filePath} → ${url}`);
      return normalizeResult(url);
    }

    // Convert absolute workspace/app paths to browser-relative URLs before the
    // startsWith("/") early-return below treats them as already-resolved URLs.
    // e.g. /app/modules/pos/src/index.ui → /modules/pos/src/index.ui
    const workspaceRootForAbs = await context.getWorkspaceRoot();
    const normalizedLower = normalized.toLowerCase();
    if (workspaceRootForAbs) {
      const wsRoot = path.resolve(workspaceRootForAbs).replace(/\\/g, "/");
      if (normalizedLower.startsWith(wsRoot.toLowerCase() + "/") || normalizedLower === wsRoot.toLowerCase()) {
        const relative = normalized.slice(wsRoot.length);
        const url = relative.startsWith("/") ? relative : "/" + relative;
        console.log(`[SWITE] toUrl: abs→workspace URL: ${filePath} → ${url}`);
        return normalizeResult(url);
      }
    }
    const appRoot = path.resolve(context.root).replace(/\\/g, "/");
    if (normalizedLower.startsWith(appRoot.toLowerCase() + "/") || normalizedLower === appRoot.toLowerCase()) {
      const relative = normalized.slice(appRoot.length);
      const url = relative.startsWith("/") ? relative : "/" + relative;
      console.log(`[SWITE] toUrl: abs→approot URL: ${filePath} → ${url}`);
      return normalizeResult(url);
    }
  }

  // If path is already a URL (starts with / or http), prefer src over dist for workspace packages
  if (normalized.startsWith("/") || normalized.startsWith("http")) {
    // Only prefer src over dist for workspace packages — never for node_modules
    if (normalized.includes("/dist/") && !normalized.includes("/src/") && !normalized.includes("/node_modules/")) {
      const srcPath = normalized.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
      const { resolveFilePath } = await import("../utils/file-path-resolver.js");
      const workspaceRoot = await context.getWorkspaceRoot();
      const srcFilePath = await resolveFilePath(srcPath, context.root, workspaceRoot);
      if (await context.fileExists(srcFilePath)) {
        return normalizeResult(srcPath);
      }
    }
    return normalizeResult(normalized);
  }

  // If path is absolute, convert to a browser-relative URL
  if (path.isAbsolute(filePath)) {
    const workspaceRoot = await context.getWorkspaceRoot();

    // Check if the file lives in a co-located framework monorepo's packages/ directory.
    // Serve those files under /swiss-packages/ so the browser can request them distinctly
    // from the app's own files. Works for any framework at any directory name.
    const monorepo = await findSwissLibMonorepo(context.root);
    if (monorepo) {
      const packagesPath = path.join(monorepo, "packages");

      let resolvedPackages: string;
      let resolvedFilePath: string;
      try {
        resolvedPackages = await fs.realpath(packagesPath);
        resolvedFilePath = await fs.realpath(filePath);
      } catch {
        resolvedPackages = path.resolve(packagesPath);
        resolvedFilePath = path.resolve(filePath);
      }

      const normalizedPackages = resolvedPackages.replace(/\\/g, "/").toLowerCase();
      const normalizedResolved = resolvedFilePath.replace(/\\/g, "/").toLowerCase();

      if (normalizedResolved.startsWith(normalizedPackages)) {
        const origPackages = resolvedPackages.replace(/\\/g, "/");
        const origFile = resolvedFilePath.replace(/\\/g, "/");
        const relative = origFile.slice(origPackages.length);
        const url = "/swiss-packages" + (relative.startsWith("/") ? relative : "/" + relative);

        if (url.includes("/dist/") && !url.includes("/src/")) {
          const srcUrl = url.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
          const srcRelative = srcUrl.replace("/swiss-packages/", "");
          const srcFilePath = path.join(packagesPath, srcRelative);
          if (await context.fileExists(srcFilePath)) {
            return normalizeResult(srcUrl);
          }
        }

        return normalizeResult(url);
      }
    }

    // node_modules absolute path → browser /node_modules/... URL
    const origFilePathNormalized = path.resolve(filePath).replace(/\\/g, "/");
    if (origFilePathNormalized.toLowerCase().includes("/node_modules/")) {
      const nodeModulesIndex = origFilePathNormalized.toLowerCase().indexOf("/node_modules/");
      const afterNodeModules = origFilePathNormalized.slice(nodeModulesIndex + "/node_modules/".length);
      return normalizeResult("/node_modules/" + afterNodeModules);
    }

    const normalizedFilePath = path.resolve(filePath).replace(/\\/g, "/").toLowerCase();

    // Try relative to app root first
    const normalizedRoot = path.resolve(context.root).replace(/\\/g, "/").toLowerCase();
    if (normalizedFilePath.startsWith(normalizedRoot)) {
      const origRoot = path.resolve(context.root).replace(/\\/g, "/");
      const origFilePath = path.resolve(filePath).replace(/\\/g, "/");
      const relative = origFilePath.slice(origRoot.length);
      return normalizeResult(relative.startsWith("/") ? relative : "/" + relative);
    }

    // Try workspace root
    if (workspaceRoot) {
      const normalizedWorkspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/").toLowerCase();

      if (normalizedFilePath.startsWith(normalizedWorkspaceRoot)) {
        const origWorkspaceRoot = path.resolve(workspaceRoot).replace(/\\/g, "/");
        const origFilePath = path.resolve(filePath).replace(/\\/g, "/");
        const relative = origFilePath.slice(origWorkspaceRoot.length);
        let url = relative.startsWith("/") ? relative : "/" + relative;

        // Prefer src over dist for workspace packages in dev
        if (url.includes("/packages/") && url.includes("/dist/") && !(await context.fileExists(filePath))) {
          const srcPath = filePath
            .replace(/[/\\]dist[/\\]/, path.sep + "src" + path.sep)
            .replace(/\.js$/i, ".ts");
          if (await context.fileExists(srcPath)) {
            const srcRelative = path.relative(workspaceRoot, srcPath).replace(/\\/g, "/");
            url = "/" + srcRelative;
          }
        }

        return normalizeResult(url);
      }
    }

    // Fallback
    const baseRoot = workspaceRoot || context.root;
    const rawRelative = path.relative(baseRoot, filePath);
    // CG-03: guard against absolute result from path.relative() on cross-drive/WSL paths
    let url: string;
    if (path.isAbsolute(rawRelative) || rawRelative.startsWith("..")) {
      const normalizedBase = path.resolve(baseRoot).replace(/\\/g, "/");
      const normalizedFile = path.resolve(filePath).replace(/\\/g, "/");
      const stripped = normalizedFile.startsWith(normalizedBase)
        ? normalizedFile.slice(normalizedBase.length)
        : "/" + normalizedFile;
      url = stripped.startsWith("/") ? stripped : "/" + stripped;
    } else {
      url = "/" + rawRelative.replace(/\\/g, "/");
    }
    console.warn(`[SWITE] toUrl fallback: ${filePath} -> ${url}`);
    return normalizeResult(url);
  }

  // Default: make relative to root
  const rawRelative = path.relative(context.root, filePath);
  // CG-03: guard against absolute result from path.relative() on cross-drive/WSL paths.
  let defaultUrl: string;
  if (path.isAbsolute(rawRelative) || rawRelative.startsWith("..")) {
    const normalizedRoot = path.resolve(context.root).replace(/\\/g, "/");
    const normalizedFile = path.resolve(filePath).replace(/\\/g, "/");
    const stripped = normalizedFile.startsWith(normalizedRoot)
      ? normalizedFile.slice(normalizedRoot.length)
      : "/" + normalizedFile;
    defaultUrl = stripped.startsWith("/") ? stripped : "/" + stripped;
  } else {
    defaultUrl = "/" + rawRelative.replace(/\\/g, "/");
  }
  return normalizeResult(defaultUrl);
}

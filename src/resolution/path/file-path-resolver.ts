/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { findWorkspaceRoot } from "../../kernel/workspace.js";
import { findSwissLibMonorepo, findPackage } from "../../kernel/package-finder.js";

export interface PathResolverContext {
  root: string;
  workspaceRoot: string | null;
  userConfig?: any; // SwiteUserConfig
}

/**
 * Resolve file path from URL, handling SWISS packages, workspace packages, and app files
 */
export async function resolveFilePath(
  url: string,
  root: string,
  workspaceRoot: string | null = null,
  userConfig?: any
): Promise<string> {
  // Consolidate workspace root discovery for consistency across resolution blocks
  const wsRoot = workspaceRoot || (await findWorkspaceRoot(root));

  // /node_modules/ URLs: walk up from app root until we find the package.
  // pnpm may place deps at the app root, one level up (workspace pkg), or at
  // the monorepo root depending on hoisting config and pnpm version.
  if (url.startsWith("/node_modules/")) {
    const urlPath = url.startsWith("/") ? url.slice(1) : url;
    const parts = urlPath.split("/");
    // Handle @scoped/package or standard-package
    const packageName = parts[1].startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1];
      // NEW: PNPM-aware Interceptor. Check if this request is for an "internal" scope package.
      // In development, we always prioritize local siblings if they exist.
      const internalScopes = userConfig?.internalScopes || [];
      const match = internalScopes.length > 0 
        ? url.match(new RegExp(`(${internalScopes.join("|")})\/([^/]+)`))
        : null;

      if (process.env.NODE_ENV !== 'production' && match) {
        const packageName = match[0];
        const remainingPath = url.split(match[0])[1];

        const localLoc = await findPackage(packageName, root, wsRoot);
        if (localLoc && localLoc.type !== 'node_modules') {
          // Found local source! Redirect the base path
          const fullPath = path.join(localLoc.path, remainingPath);
          
          // Re-use workspace fallback logic for dist -> src transition
          if (fullPath.includes("/dist/")) {
            const srcPath = fullPath.replace("/dist/", "/src/").replace(/\.[mc]?js$/, ".ts");
            try {
              await fs.access(srcPath);
              console.log(`[file-path-resolver] Intercept: ${packageName} redirecting to local src: ${srcPath}`);
              return srcPath;
            } catch { /* Fallback to dist if src not found */ }
          }
          
          console.log(`[file-path-resolver] Intercept: ${packageName} redirecting to local source: ${fullPath}`);
          return fullPath;
        }
      }

      // Walk up the directory tree from root, trying node_modules at each level
      let current = path.resolve(root);
    const visited = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const candidate = path.join(current, urlPath);
      if (!visited.has(candidate)) {
        visited.add(candidate);
        try {
          const resolved = await fs.realpath(candidate);
          await fs.access(resolved);
          return resolved;
        } catch {
          // try parent level
        }
      }
      const parent = path.dirname(current);
      if (parent === current) break; // filesystem root
      current = parent;
    }

    // Explicit workspace root (covers hoisted-to-root installs)
    if (wsRoot) {
      const wsPath = path.join(wsRoot, urlPath);
      if (!visited.has(wsPath)) {
        try {
          const resolved = await fs.realpath(wsPath);
          await fs.access(resolved);
          return resolved;
        } catch {
          // not found there either
        }
      }
    }

    return path.join(path.resolve(root), urlPath); // fallback; handler will 404
  }

  // /swiss-packages/ URLs point to files inside the co-located framework
  // monorepo, relative to its root -- packages are directly-named top-level
  // directories (runtime/, compiler/, plugins/file-router/), not nested
  // under a single packages/ directory. Must mirror toUrl()'s encoding in
  // url-resolver.ts exactly.
  if (url.startsWith("/swiss-packages/")) {
    const relativePath = url.replace(/^\/swiss-packages\//, "");
    const monorepo = await findSwissLibMonorepo(root);
    if (monorepo) {
      const fullPath = path.join(monorepo, relativePath);
      try {
        await fs.access(fullPath);
        return fullPath;
      } catch {
        return fullPath; // Return anyway; handler will 404 if missing
      }
    }
    // No co-located monorepo found — return a path that will 404 cleanly
    console.warn(`[file-path-resolver] No framework monorepo found for /swiss-packages/${relativePath}`);
    return path.join(root, "node_modules", relativePath);
  }

  // Workspace-level directories: always resolve from workspace root
  // Updated: lib/ now contains all packages (moved from packages/)
  if (
    url.startsWith("/lib/") ||
    url.startsWith("/libraries/") ||
    url.startsWith("/packages/") ||
    url.startsWith("/modules/")
  ) {
    // Already detected wsRoot at function start
    
    // Normalize URL: path.join with leading slash is wrong on Windows (treats as drive root)
    const urlPath = url.startsWith("/") ? url.slice(1) : url;
    
    // ...

    // CRITICAL: For /lib/ paths, we MUST find the SWS root (which has lib/ directory)
    // Start from app root and walk up until we find a directory with both pnpm-workspace.yaml AND lib/
    if (url.startsWith("/lib/")) {
      let current = root;
      for (let i = 0; i < 10; i++) {
        const workspaceFile = path.join(current, "pnpm-workspace.yaml");
        const libDir = path.join(current, "lib");
        try {
          await fs.access(workspaceFile);
          await fs.access(libDir);
          // Found SWS root!
          const resolved = path.join(current, urlPath);
          console.log(`[file-path-resolver] Found SWS root with lib/: ${current}`);
          console.log(`[file-path-resolver] Resolving ${url} from SWS root: ${current} -> ${resolved}`);
          return resolved;
        } catch {
          // Continue searching up
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
      }
    }
    
    // For other paths, use detected workspace root
    if (wsRoot) {
      let resolved = path.join(wsRoot, urlPath);
      // Dev fallback: if URL is /packages/.../dist/... and file doesn't exist, try src/ (unbuilt workspace packages)
      if (
        (url.startsWith("/packages/") || url.startsWith("/lib/")) &&
        url.includes("/dist/")
      ) {
        try {
          await fs.access(resolved);
        } catch {
          const srcUrl = urlPath.replace("/dist/", "/src/").replace(/\.js$/, ".ts");
          const srcResolved = path.join(wsRoot, srcUrl);
          try {
            await fs.access(srcResolved);
            console.log(`[file-path-resolver] dist not found, serving src: ${resolved} -> ${srcResolved}`);
            return srcResolved;
          } catch {
            // Keep original resolved; handler will 404
          }
        }
      }
      console.log(`[file-path-resolver] Resolving ${url} from workspace root: ${wsRoot} -> ${resolved}`);
      return resolved;
    } else {
      console.warn(`[file-path-resolver] No workspace root found, using app root: ${root}`);
      return path.join(root, urlPath);
    }
  }

  // For app files, check if URL already includes the app path
  if (wsRoot) {
    const appRelativeToWorkspace = path
      .relative(wsRoot, root)
      .replace(/\\/g, "/");
    if (url.startsWith(`/${appRelativeToWorkspace}/`)) {
      // URL already includes app path, use workspace root
      return path.join(wsRoot, url);
    } else if (
      url.startsWith("/src/") ||
      url.startsWith("/public/") ||
      url.startsWith("/assets/")
    ) {
      // App-specific paths (src/, public/, assets/) - resolve from app root
      return path.join(root, url);
    } else if (url.startsWith("/")) {
      // Other absolute URLs, try workspace root first, then app root
      const workspacePath = path.join(wsRoot, url);
      try {
        await fs.access(workspacePath);
        return workspacePath;
      } catch {
        return path.join(root, url);
      }
    } else {
      // Relative to app root
      return path.join(root, url);
    }
  } else {
    return path.join(root, url);
  }
}

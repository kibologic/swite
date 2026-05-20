<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Internals

Implementation notes for the non-obvious parts of SWITE.

---

## Workspace root detection algorithm

Two separate implementations exist: one in `SwiteServer` (used at server startup) and one in `src/kernel/workspace.ts` (used by handlers and resolution code at request time). They are slightly different.

### SwiteServer.findWorkspaceRoot

Walks up to six directory levels from `startDir`. At each level it looks for:
1. A `pnpm-workspace.yaml` file, or
2. A `package.json` with a `workspaces` field

The first directory matching either condition is returned. `SwiteConfig.rootDir` short-circuits this search if set.

### kernel/workspace.findWorkspaceRoot

Walks up to ten directory levels from `root`. At each level it additionally requires the candidate directory to have either a `lib/` or `packages/` subdirectory alongside the workspace marker file. This stricter check ensures the resolved workspace root is the SWS root (the monorepo that owns the `lib/` directory with compiled packages), not an intermediate workspace.

If a directory has `pnpm-workspace.yaml` but no `lib/` or `packages/`, the walk continues upward. This handles nested monorepo layouts where an inner workspace exists inside an outer SWS root.

### file-path-resolver /lib/ path resolution

For `/lib/` URLs specifically, `resolveFilePath` walks from the app root upward looking for a directory that has both `pnpm-workspace.yaml` and a `lib/` subdirectory present simultaneously. This is the most precise check and handles the case where `findWorkspaceRoot` returns an intermediate directory.

---

## Import map generation

`generateImportMap` (`src/internal/generate-import-map.ts`) runs at the request of the CLI or the `generate-import-map` script, not automatically at dev server startup.

The generated file format:

```json
{
  "version": "1.0",
  "generated": 1716211234567,
  "imports": {
    "@scope/pkg": "/swiss-packages/pkg/src/index.ts",
    "@scope/pkg/components": "/swiss-packages/pkg/src/components/index.ts"
  }
}
```

At dev server startup, `setupMiddleware` calls `loadImportMap` to read this file. If found, it is passed to `ModuleResolver.setImportMap()` and becomes the fast path for all bare import resolutions. A cache miss falls through to the full `resolveBareImport` pipeline.

The SPA fallback handler also reads this file directly and merges it into the HTML importmap.

---

## Symlink registry

`buildSymlinkRegistry` (`src/resolution/symlink-registry.ts`) is called once during server startup. It scans up to four `node_modules` directories:

1. `<appRoot>/node_modules`
2. `<parentOfAppRoot>/node_modules`
3. `<workspaceRoot>/node_modules`
4. `<frameworkMonorepoRoot>/node_modules`

For each directory, it reads all entries. For scoped entries (starting with `@`), it recurses one level and registers each symlink found there. For unscoped entries, it registers each symlink directly.

Registration: `fs.realpath(symlinkPath)` is resolved and stored in a `Map<string, string>` as `realpath → /node_modules/<pkgName>`.

`lookupInSymlinkRegistry(absolutePath)` iterates the map and returns the browser URL if the path starts with any registered realpath. This is called by `toUrl` as the very first step when an absolute path is received.

The registry is consulted before any other logic in `toUrl` because `fs.realpath()` is called throughout the handler chain (in `resolveFilePath` for `/node_modules/` URLs, in `NodeModuleHandler`, and elsewhere) and the resulting absolute paths would otherwise bypass all the workspace-relative URL conversion logic.

---

## Package registry

`PackageRegistry` (`src/kernel/package-registry.ts`) is a process-wide singleton. It is first populated when `resolveWorkspacePackage` is called and the registry is empty. After that, it serves as a cache for the workspace scan.

The scan is recursive up to 15 levels deep and skips: `node_modules`, `dist`, `.git`, `.swite`, and hidden directories. Any directory containing a `package.json` with a `name` field is registered. Duplicates keep the first-found entry.

`rescan()` clears the cache and re-scans from the same root directories. It is called when a package is not found after the initial scan, in case new packages were added since the server started.

---

## Compilation cache

`compilationCache` (`src/internal/cache/compilation-cache.ts`) is an in-memory cache keyed by absolute file path. Each entry stores the compiled source output and tracks the set of dependency URLs. Handlers call `compilationCache.get(filePath, getDependencies)` before compiling; if the file's mtime has not changed since the last compile, the cached output is returned.

Cache writes happen after every successful compilation via `compilationCache.set(filePath, rawCompiled, finalCode, getDependencies)`.

---

## path-fixup rationale

`fixSwissLibPaths` exists because `@swissjs/compiler` was originally written when the framework packages directory was named `swiss-lib/packages/`. When the directory was renamed to be served under `/swiss-packages/`, the compiler was not updated at the same time. Rather than forking every handler to patch its own output, a single central fixup is applied once per compilation.

The fixup replaces `/swiss-lib/packages/` before `/swiss-lib/` to avoid double-substitution if the function were called more than once on already-patched output.

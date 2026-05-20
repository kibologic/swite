<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Build Pipeline

`SwiteBuilder` (`src/build-engine/builder.ts`) handles production builds. It is invoked by `swite build` with a fixed entry point of `src/index.ui` and output directory of `dist/`.

---

## Overview

The build runs three sequential phases inside a try/finally block. The temporary directory `.swite-build/` is always removed when the build finishes, whether it succeeded or failed.

```
swite build
  └── SwiteBuilder.build()
        ├── 1. cleanOutputDir()       — rm -rf dist/, mkdir dist/
        ├── 2. compileSwissFiles()    — @swissjs/compiler → .tsx in .swite-build/
        ├── 3. bundle()               — esbuild bundles from .swite-build/
        └── 4. copyPublicAssets()     — cp -r public/ dist/
```

---

## Phase 1: Compile Swiss files

`compileSwissFiles` traverses `src/` and every workspace dependency's `src/` directory.

For each `.ui` or `.uix` file:

1. `UiCompiler.compileAsync(source, filePath)` — transforms SwissJS component syntax to TypeScript/JSX.
2. Relative `.ui`/`.uix` imports in the compiled output are rewritten to `.tsx` (esbuild needs `.tsx` for JSX, not `.ui`).
3. If the compiled output ends with `export { Foo }`, a `export default Foo` line is appended so default imports resolve at bundle time.
4. Written to `.swite-build/<relative-path>.tsx`.

For each `.ts` file, `.ui`/`.uix` imports in `from` clauses are rewritten to `.tsx`, then the file is copied as-is.

CSS files are copied verbatim so that any CSS import stubs in the bundle phase can resolve.

---

## Phase 2: Bundle with esbuild

esbuild is invoked with:

```typescript
{
  bundle: true,
  format: 'esm',
  target: 'es2020',
  minify: true,
  sourcemap: false,
  splitting: true,   // ESM code splitting
  metafile: true,
  platform: 'node',
}
```

Three plugins are registered (see [CLI / build](../cli/build.md) for descriptions). Node built-in modules are marked external. The `absWorkingDir` is set to the workspace root (or app root if no workspace is detected) so esbuild resolves node_modules correctly.

---

## Phase 3: Copy public assets

`public/` is copied recursively to `dist/`. If `public/` does not exist, this phase is skipped silently.

---

## Workspace dependency discovery

`discoverWorkspaceDependencies()` reads the app's `package.json` and collects all `workspace:*` entries from `dependencies`, `devDependencies`, and `peerDependencies`. It also scans source files for `@scope/pkg` import patterns to catch transitive workspace imports not listed in `package.json`.

For each candidate package name, it searches these directories under the workspace root:

```
lib/<pkgName>
packages/<pkgName>
packages/runtime/<pkgName>
packages/plugins/<pkgName>
packages/domain/<pkgName>
```

A match requires the directory to have a `package.json` whose `name` field matches the expected package name, and a `src/` subdirectory.

---

## Workspace resolver plugin

The `workspace-resolver` esbuild plugin handles `@scope/pkg` imports during bundling. It maps each import to the compiled `.tsx` files in `.swite-build/` by:

1. Finding the matching workspace dependency from the discovery step.
2. Reading the package's `package.json` exports field to resolve the subpath.
3. Converting the export path from `./src/Foo.uix` to `.swite-build/<depRelPath>/src/Foo.tsx`.
4. Falling back to `src/index.js` if exports resolution fails.

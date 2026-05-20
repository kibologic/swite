<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# swite build

Compiles the application for production.

```bash
swite build
```

---

## What it does

`swite build` runs `SwiteBuilder` with a fixed configuration derived from the project root:

| Parameter | Value |
|-----------|-------|
| Entry point | `<root>/src/index.ui` |
| Output directory | `<root>/dist` |
| Format | ESM |
| Target | `es2020` |
| Minify | `true` |
| Sourcemap | `false` |

These defaults are not yet configurable via `swiss.config.ts`; the builder reads config only for future extensibility.

---

## Build pipeline

The build runs in three phases:

### Phase 1: Compile Swiss files

All `.ui` and `.uix` files in `src/` are passed through `@swissjs/compiler` (`UiCompiler.compileAsync`), which outputs TypeScript/JSX. The resulting code is written to a temporary `.swite-build/` directory as `.tsx` files. Plain `.ts` files are copied as-is, with `.ui`/`.uix` import references rewritten to `.tsx`. CSS files are copied verbatim.

Workspace dependencies declared as `workspace:*` in `package.json` are discovered and compiled into the same temp directory, preserving the workspace directory structure so esbuild can resolve cross-package imports.

### Phase 2: Bundle with esbuild

esbuild is invoked with `bundle: true`, targeting the compiled entry point in `.swite-build/`. Three custom plugins are active:

- `js-tsx-fallback` — redirects `.js` import resolutions to `.tsx` when the `.tsx` file exists in the temp directory (handles UiCompiler emitting `.js` references)
- `css-stub` — stubs all `.css` imports with `export {}` so they do not block the bundle
- `workspace-resolver` — resolves `@scope/pkg` imports to compiled files in `.swite-build/`, using `package.json` exports fields and falling back to `src/index.js`

Node built-in modules (`fs`, `path`, `os`, etc., including `node:` prefixed forms) are marked external.

### Phase 3: Copy public assets

The contents of `public/` are copied verbatim to `dist/`.

---

## Output

`dist/` contains the bundled JavaScript (one or more chunks for ESM splitting), copied public assets, and any CSS files the build chose to emit. The `.swite-build/` temporary directory is removed regardless of whether the build succeeded or failed.

Build stats (file count and sizes) are printed to stdout after a successful bundle.

---

## Workspace dependencies

The builder scans `package.json` `dependencies`, `devDependencies`, and `peerDependencies` for `workspace:*` entries and also scans source files for `@scope/pkg` import patterns to discover transitive workspace dependencies. For each discovered package, it looks in these directories under the workspace root (in order):

```
lib/<pkgName>
packages/<pkgName>
packages/runtime/<pkgName>
packages/plugins/<pkgName>
packages/domain/<pkgName>
```

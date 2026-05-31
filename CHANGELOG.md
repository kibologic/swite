# Changelog

## 0.3.5

### Patch Changes

- deps: bump @swissjs/core 0.1.10 → 0.1.11 (browser hotfix — guards `process.env` in reconciliation to prevent ReferenceError crash in browser environments)

## 0.3.4

### Patch Changes

- fix(resolution): `findSwissLibMonorepo` now accepts `siblingRepositories` from user config, making sibling repo discovery configurable (#1)
- fix(resolution): Compiler path fixup (`/swiss-lib/` → `/swiss-packages/`) is now configurable via `compilerPathFixup` config key; can be disabled or given custom patterns (#2)
- fix(config): Added `publicDir`, `hmrPort`, `hmrHost`, `aliases`, `excludeFromHmr`, and `entry` to `SwiteUserConfig` (#3)
- fix(resolution): CDN fallback default changed to `false`; unscoped packages no longer fall through to jsDelivr without explicit `SWITE_CDN_FALLBACK_SCOPES` opt-in (#4)
- fix(hmr): HMR watcher now handles `add` and `unlink` events with full-page reload; `excludeFromHmr` patterns added to chokidar `ignored` list (#5)
- fix(dx): Added `--verbose` / `-v` flag and `SWITE_DEBUG=1` env var for resolver diagnostics; unresolved packages now log searched paths (#6)
- fix(static): CSS extraction entry point configurable via `SwiteUserConfig.entry` (defaults to `src/index.ui`); missing entry file no longer crashes server (#7)
- deps: bump `@swissjs/core` 0.1.9 → 0.1.10

## 0.3.3

### Patch Changes

- security: pin qs >= 6.11.0 to satisfy Dependabot scanner (#8)
- deps: bump @swissjs/core 0.1.8 -> 0.1.9 (prop reactivity fix)

## 0.3.2

### Patch Changes

- Generalize resolution system and add internalScopes support

  - Add `findSiblingRepository(startPath, repoName)` — replaces hardcoded swiss-lib discovery with a generic sibling repo finder. `findSwissLibMonorepo` preserved as a backward-compat wrapper.
  - Add `findPackage` with local-first dev precedence — in development, resolves `@scoped/*` packages from local sibling source trees before falling back to `node_modules`.
  - `internalScopes` from `swiss.config.ts` now flows through to all handlers at startup — prevents internal-scoped packages from being routed to jsDelivr CDN.
  - `NodeModuleHandler` rewritten to use `findPackage` — replaces verbose walk-up/swiss-lib fallback chain with unified local-first resolver. Adds dist→src redirect for local sibling packages.
  - CDN blacklist: packages matching `internalScopes` are blocked from jsDelivr fallback with a clear error log.
  - Fix `cli.ts` builder import path (`./build-engine/builder.js`).
  - Fix `url-resolver.ts` dynamic import path for `file-path-resolver`.
  - Update peer deps: `@swissjs/core` → `0.1.8`, `@swissjs/compiler` → `0.1.5`.

## 0.2.31

### Patch Changes

- Fix workspace node_modules static serving for pnpm virtual-store symlinks: replace fs.access+express.static with realpathSync+res.sendFile so CSS and other assets resolve correctly in Railway/pnpm deployments

## 0.2.29 — 2026-04-23

### Fixes

- SPA fallback now serves HTML only for requests with `Accept: text/html`.
  This prevents module/script/style fetches from receiving HTML (strict MIME failures) in production.

## 0.2.28 — 2026-04-23

### Fixes

- Fix pnpm `node_modules` static serving: avoid `path.join(..., req.path)` resetting the root when `req.path` is absolute.
  This restores serving of CSS assets under `/node_modules/*` in production deploys (e.g. Railway).

## 0.2.27 — 2026-04-23

### Fixes

- Disable jsDelivr `+esm` fallback for scoped packages by default to avoid 404s for private registries.
  Use `SWITE_CDN_FALLBACK_SCOPES` to opt in specific public scopes when needed.

## 0.2.0 — 2026-03-26

### Bug Fixes

- **CG-01** — CLI entry hardcoded as `.ts`; now resolves `.ui` correctly (`src/cli.ts` line 76)
- **CG-02** — `@swissjs/*` and `@skltn/*` packages were bundled instead of left as browser imports; added to externals in `src/builder.ts`
- **CG-03** — `findSwissFiles`/`findFiles` did not follow NTFS junctions; added `isSymbolicLink()` check to directory traversal
- **CG-04** — Traversal entered `node_modules` via symlinks; `node_modules` now excluded from junction traversal
- **CG-05** — `UiCompiler` rewrites `.ui` imports to `.js` but emits `.tsx` files; added `jsTsxFallbackPlugin` to resolve `.js` → `.tsx` when `.tsx` exists
- **CG-06** — Compiler emits named exports only; `export default` now injected post-compile when a named export is detected

All fixes were discovered during the alpine-mobile Phase 5 build and initially applied as hotfixes to `dist/`. This release ports them properly to `src/`.

## 0.1.0 — 2026-03-02

Initial release. Core dev server functional. Python service integration scaffolded.

- `SwiteServer` — Express-based dev server with HMR
- `SwiteBuilder` — esbuild-based production bundler
- `swiss.config.ts` — `defineConfig` schema including `services.python` block
- `proxyToPython<T>()` — typed internal proxy utility
- `startPythonDevService` / `stopPythonDevService` — CLI dev process manager
- `swite dev` / `swite build` / `swite start` commands
- CI/CD pipeline via GitHub Actions (ci.yml, release.yml, publish.yml)

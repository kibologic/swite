# Changelog

## 0.4.4

### Patch Changes

- Fix the `/swiss-packages/` URL scheme, which had silently stopped working after the co-located swiss-lib monorepo was flattened from `packages/<pkg>/` to directly-named top-level directories (`runtime/`, `compiler/`, `plugins/file-router/`).

  Two compounding bugs, both in `url-resolver.ts`'s `toUrl()`:

  - The monorepo package lookup still assumed a `packages/` subdirectory that no longer exists, so it never matched any real file.
  - More fundamentally, the whole absolute-path branch containing that lookup sat _after_ an earlier `startsWith("/")` early-return meant to pass through already-resolved URLs — but every absolute filesystem path also starts with `/` and is textually indistinguishable from a resolved URL at that point, so the early-return swallowed every unresolved absolute path first. That branch was unreachable dead code for any actual absolute `filePath`.

  The practical symptom: any swiss-lib source file not already reachable through the node_modules symlink registry (e.g. a package not yet linked, or one added mid-session) had its raw absolute filesystem path — containing the monorepo's own directory name, e.g. `/home/.../swiss-lib/...` — leaked to the browser as if it were a URL. `resolveFilePath()`'s decode side had the matching `packages/`-subdirectory assumption, so even a correctly-formed `/swiss-packages/...` URL would fail to resolve back to a real file.

  Fixes:

  - Added `monorepo-package-registry.ts`, which maps a package's real `package.json` name to its actual directory by reading each candidate directory's manifest, rather than guessing a directory name from the package's unscoped name segment (`@swissjs/core` lives in `runtime/`, not `core/` — string-guessing was already wrong for this exact package before the `packages/` restructuring was even a factor).
  - Moved the monorepo/`/swiss-packages/` resolution into the reachable absolute-path branch of `toUrl()`, ahead of the `startsWith("/")` early-return.
  - Updated `resolveFilePath()`'s `/swiss-packages/` decode to match the new encoding (monorepo-root-relative, not `packages/`-relative).
  - Removed the `fixSwissLibPaths` patch (and its `compilerPathFixup` config option) that had been band-aiding the resulting leaked paths downstream instead of fixing the actual source.
  - Removed two dead regex-based "safety net" fallback passes in `import-rewriter.ts` (confirmed via a full session's real dev-server traffic — every module, hundreds of imports — that neither ever fired; the primary es-module-lexer-based rewrite already handles everything they were guarding against). A genuine unrewritten bare import now throws instead of triggering a blind whole-file string replace, which could otherwise corrupt matching substrings inside unrelated string literals or comments.
  - Removed a vestigial cache-invalidation check in `compilation-cache.ts` for "stale CDN URLs from before the import rewriter fix" — dead in practice (the cache is in-memory and clears on restart) and would have permanently defeated caching for anyone legitimately opting into CDN fallback via `SWITE_CDN_FALLBACK_SCOPES`.
  - Fixed a stale doc comment in `cdn-fallback.ts` that described the opposite of what the (correct, safe) code actually does.

  Covered by a new regression test suite verifying the `/swiss-packages/` encode/decode round-trip against a synthetic monorepo with the current (flattened, name-mismatched) directory layout.

## 0.4.3

### Patch Changes

- 13c164a: Fix: dev server now emits inline source maps for both the plain `.ts` esbuild
  transform path and the post-`UiCompiler` `.ui`/`.uix` transform path. Dev
  builds previously shipped zero source maps, so devtools couldn't map
  compiled output back to source.

## 0.4.2

### Patch Changes

- fix(security): update @swissjs/\* deps to 1.2.1/1.2.3, add pnpm security overrides, fix build script to use standalone tsc (no project references), eliminate as-any casts in middleware

## 0.4.1

### Patch Changes

- security: bind dev server to loopback by default (R-001) — `src/dev-engine/server.ts:171` no longer rewrites a requested `localhost`/`127.0.0.1` host to `0.0.0.0`; all-interfaces binding is now explicit opt-in only (set `host: "0.0.0.0"` in config or pass `--host 0.0.0.0`).
- security: validate HMR WebSocket Origin (R-002) — `src/dev-engine/hmr/hmr.ts` now enforces an origin allowlist on every incoming WebSocket upgrade; connections with a missing or non-allowlisted `Origin` header are closed with code 1008; same-origin dev connections (and the loopback alias pair `localhost`↔`127.0.0.1`) are allowed automatically.
- test: regression suite `__tests__/security-r001-r002.test.ts` added — 18 tests covering both fixes (7 for R-001 including old-behaviour guards, 11 for R-002).

## 0.4.0

### Minor Changes

- fix(S-03): Python service health check timeout corrected from 15s → 30s per DIRECTIVE spec. Python services with slow startup (e.g. model loading, DB connection pool warmup) were being killed before they became healthy.

- fix(css-modules): CSS import handling in the compile pipeline now distinguishes three cases:

  - Named/default imports (`import styles from "./x.module.css"`) → `const styles = {}` — no more `undefined` at runtime
  - Side-effect imports (`import "./x.css"`) → silently stripped
  - Dynamic imports (`import("./x.css")`) → `({})` instead of `undefined`

- fix(test): Stale import paths in `__tests__/import-rewriter-bug.test.ts` updated to reflect post-refactor module locations (`src/resolution/rewriting/import-rewriter.js`, `src/resolution/resolver.js`).

- deps: bump `@swissjs/core` 0.1.11 → 0.2.0 (T-005 reactivity double-render fix)

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

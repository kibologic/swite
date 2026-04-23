# Changelog

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

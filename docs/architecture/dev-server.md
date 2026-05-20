<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# Dev Server

`SwiteServer` (in `src/dev-engine/server.ts`) is the Express application that handles all incoming requests during development.

---

## Startup sequence

When `server.start()` is called:

1. **Symlink registry** — Scans `node_modules` directories at the app root, one level up from the app root, the workspace root (if detected), and the co-located framework monorepo root. Registers every symlink target so that absolute filesystem paths obtained via `fs.realpath()` can later be mapped back to browser-relative URLs.

2. **Middleware setup** — Calls `setupMiddleware()`, which registers the full middleware chain (see below) and initializes the file router, import map, and env variable loading.

3. **HMR** — Calls `hmr.initialize()` (port probe and WebSocket server creation) then `hmr.start()` (chokidar watcher).

4. **HTTP listen** — Binds to the configured port. When `host` is `"localhost"`, SWITE binds to `0.0.0.0` so both `::1` and `127.0.0.1` respond.

---

## Workspace root detection

`SwiteServer.findWorkspaceRoot(startDir)` walks up the directory tree, up to six levels, looking for:

- A `pnpm-workspace.yaml` file, or
- A `package.json` with a `workspaces` field

If found, that directory is the workspace root. The workspace root is used to locate `node_modules`, workspace packages, and the import map.

`SwiteConfig.rootDir` can be set to override auto-detection.

---

## Middleware chain

The middleware is registered in a fixed order that Express processes top-to-bottom:

| Priority | Path | Handler |
|----------|------|---------|
| 1 | all | File router + HMR routes |
| 2 | `/packages` | TypeScript and JavaScript handler (workspace source files) |
| 3 | `/src` | `.ui`, `.uix`, `.ts`, `.js`, `.mjs`, static (CSS, images) |
| 4 | `/lib` | `.ui`, `.uix` source files (pre-static guard) |
| 5 | all | `.ui`/`.uix` MIME-type guard |
| 6 | `/.skltn/modules.css` | Returns 204 (CSS not bundled in dev) |
| 7 | static | `public/`, `node_modules/`, `lib/`, `libraries/`, `modules/` |
| 8 | all | General source-file transformation for all other paths |
| 9 | all | SPA fallback — serves `public/index.html` for HTML-accepting requests |

The SPA fallback refuses to serve HTML for paths under `/src/`, `/swiss-packages/`, and `/lib/` — those return 404 if they reach the fallback, preventing MIME mismatch errors.

---

## File handlers

Each file type has a dedicated handler class that extends `BaseHandler`:

| Handler | Extension(s) | Behaviour |
|---------|-------------|-----------|
| `UIHandler` | `.ui` | Compiles via `UiCompiler`, strips TypeScript via esbuild, fixes swiss-lib paths, inlines `import.meta.env`, strips CSS imports, rewrites bare imports |
| `UIXHandler` | `.uix` | Same pipeline as UIHandler |
| `TSHandler` | `.ts` | esbuild TypeScript strip, inlines env, rewrites imports. Falls back to `.ui` or `.uix` if the `.ts` file does not exist |
| `JSHandler` | `.js` | Rewrites imports. Falls back to `.ts`, `.ui`, `.uix` if `.js` does not exist |
| `MJSHandler` | `.mjs` | Rewrites imports. Falls back to `.js` handler |
| `NodeModuleHandler` | `/node_modules/…` | Walks up the directory tree to find the package. Serves without import rewriting. Falls back to jsDelivr CDN redirect if not found locally |

All handlers check an in-memory compilation cache before compiling. Cached entries are keyed by file path and invalidated when the file's mtime changes.

---

## Static file serving

`setupStaticFiles` registers `express.static` for:

- `public/` at the root URL
- `node_modules/` at `/node_modules/` (app root and workspace root)
- `lib/` at `/lib/` (resolved by walking up from app root looking for a directory that has both `pnpm-workspace.yaml` and `lib/`)
- `libraries/` at `/libraries/` (workspace root, legacy)
- `modules/` at `/modules/` (workspace root, CSS and assets only)

Source files (`.ui`, `.uix`, `.ts`, `.js`, `.mjs`) are excluded from `express.static` by a guard middleware registered before each static mount. This ensures they always go through the compiler pipeline.

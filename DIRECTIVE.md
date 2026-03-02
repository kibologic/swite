# DIRECTIVE — swite
> Last updated: 2026-02-28 · Owner: Kibologic · Repo: kibologic/swite

---

## Status
`IN ACTIVE DEVELOPMENT` — Core dev server functional. Python service integration not yet implemented. This is the primary sprint focus.

---

## Current Sprint

### S-01 — swiss.config.ts Python Service Schema
Define the `services.python` config block type. This is the foundation everything else in this sprint depends on.

Target API:
```ts
export default defineConfig({
  server: { port: 3000 },
  services: {
    python: {
      entry: './services/main.py',
      port: 8000,
      autoStart: true,
      healthCheck: '/health',
      env: {},
    }
  }
})
```

Acceptance: `defineConfig` accepts and types the `services.python` block without errors. Unknown fields are rejected by TypeScript.

---

### S-02 — proxyToPython Utility
Internal proxy function that Node route handlers use to communicate with the Python service. Lives in `packages/swite/src/proxy.ts`.

Requirements:
- Accepts path + RequestInit options
- Reads `PYTHON_SERVICE_URL` from env (default: http://localhost:8000)
- Attaches `X-Internal-Token` header from env
- Throws typed `SwiteProxyError` on non-2xx responses
- Fully typed — no `any`, generic return type

Acceptance: A route handler can call `proxyToPython<MyType>('/some/path')` and get back a typed response.

---

### S-03 — CLI Dev Process Manager
Extend `swite dev` command to spawn and manage the Python process when `services.python.autoStart` is true.

Sequence:
1. Read `swiss.config.ts` — check if `services.python` is defined
2. Spawn Python via `uvicorn services.main:app --port {port} --reload`
3. Poll `healthCheck` endpoint every 500ms — max 30s timeout
4. Once healthy — start Node server
5. Stream both process logs prefixed `[node]` and `[python]`
6. On Python crash — log prominently, continue Node in degraded mode
7. On Ctrl+C — kill both processes cleanly

Acceptance: Running `swite dev` in Alpine ERP boots both servers. Killing one does not orphan the other.

---

### S-04 — Production Mode
`swite start` must not attempt to spawn Python. Reads `PYTHON_SERVICE_URL` from env only.

Acceptance: `swite start` with no `PYTHON_SERVICE_URL` set logs a clear warning but does not crash.

---

### S-06 — Fix module resolver — search parent node_modules
Swite resolver searches `app/node_modules/` but pnpm installs
to `apps/server/node_modules/`. Resolver must walk up the
directory tree to find node_modules, not just check app root.
Currently worked around via Windows directory junction in alpine-erp.

Root cause in `bare-import-resolver.ts`: `nodeModulesLocations` only includes
`path.join(context.root, "node_modules")` and `workspaceRoot/node_modules`.
Must also include `path.join(path.dirname(context.root), "node_modules")`.

---

### ✅ S-08 — Support monorepo rootDir in dev server (COMPLETED 2026-02-28)

Swite's serve root must be configurable to cover the full monorepo.
Apps import from sibling `packages/` and `modules/` directories outside
the app folder. Add `rootDir` to `swiss.config.ts` schema — distinct from
`root` (app source directory). The dev server must be able to resolve and
serve files anywhere within `rootDir`.

**Files modified:**

- `src/server.ts` — added `rootDir` to `SwiteConfig`, exported `defineConfig`, resolves rootDir to absolute
- `src/resolver.ts` — `ModuleResolver` accepts optional `rootDir`, passes to `UrlResolverContext`
- `src/resolver/url-resolver.ts` — `toUrl` checks rootDir before workspace root to generate clean URLs
- `src/utils/file-path-resolver.ts` — `resolveFilePath` uses rootDir as fallback when workspace root is null
- `src/handlers/base-handler.ts` — `HandlerContext` includes rootDir, passes to resolveFilePath
- `src/middleware/middleware-setup.ts` — `MiddlewareConfig` includes rootDir, passes to handlerContext
- `src/index.ts` — exports `defineConfig`
- `src/resolver/bare-import-resolver.ts` — removed dead code (lines 128–262) that blocked build

**Verified in alpine-erp (2026-02-28):**

```text
GET /packages/core/src/index.ui      → 200 ✅
GET /modules/dashboard/src/index.ui  → 200 ✅
GET /modules/users/src/index.ui      → 200 ✅
GET /modules/settings/src/index.ui   → 200 ✅
```

---

### ✅ S-09 — Fix MIME type for .ui/.uix and .ts responses (COMPLETED 2026-02-28)

Swite was returning `text/html` for `.uix` and `.ts` non-cached responses.
`res.send()` in Express defaults to `text/html` when no Content-Type is set.

**Root cause:** `uix-handler.ts` and `ts-handler.ts` set Content-Type on the
cached path but not on the non-cached (compile) path.

**Fix:** Added `res.setHeader("Content-Type", "application/javascript; charset=utf-8")`
before `res.send()` in:

- `src/handlers/uix-handler.ts` (line 175)
- `src/handlers/ts-handler.ts` (line 166)

**Verified:** `App.uix`, `index.ts`, `index.ui` all return `Content-Type: application/javascript`.

---

### S-07 — Fix findSwissLibMonorepo path
`findSwissLibMonorepo` checks for `swiss-lib/` as a direct child of ancestor
directories but the SWS monorepo has it at `SWS/swiss-lib/`. Function must
also check one level deeper (e.g. `{dir}/SWS/swiss-lib`).
Currently worked around via `.swite/import-map.json` fast-path bypass.

Root cause in `utils/package-finder.ts`: Only checks `path.join(current, "swiss-lib")`
and `path.join(current, "SWISS")`. Must also scan immediate subdirectories for
a `swiss-lib/` child.

---

## Blocked
_Nothing blocked currently._

---

## Swiss Gaps
> Gaps discovered in swiss-lib during swite development. Each becomes a swiss-lib task.

_None discovered yet. Populate as development proceeds._

---

## Done
_Nothing completed yet. Append items here as sprints close._

---

## Versioning & Release Strategy (locked 2026-03-01)

### Decisions
- Registry: npm public registry (MIT license)
- Scope: @swissjs/swite
- Cadence: milestone-based, versions with swiss-lib
- Changesets: @changesets/cli
- Pre-v1: publish 0.1.0 NOW alongside swiss-lib

### Pipeline (to be implemented)
File: .github/workflows/ci.yml
Trigger: push to main, all PRs
Jobs: pnpm install → pnpm build

File: .github/workflows/release.yml
Trigger: push to main when .changeset/ has entries
Jobs: changeset version → bump version →
      update CHANGELOG.md → open version bump PR

File: .github/workflows/publish.yml
Trigger: push to main when version bump PR merged
Jobs: pnpm publish --access public
      → GitHub Release → tag vX.X.X

### Secrets required
NPM_TOKEN       — same token as swiss-lib
CHANGESET_TOKEN — same token as swiss-lib
GITHUB_TOKEN    — auto-provided

### Pending tasks
S-05 — Fix workspace:* deps so swite installs
        standalone without swiss-lib monorepo.
        MUST be done before first npm publish.
        Current workaround: link: overrides in
        consuming repos (alpine-erp).

### Known issues (to fix before publish)
- packages/cli has @swissjs/swite workspace:* dep
  fixed to link:../../../swite for local builds
  needs proper peer dep config for npm publish
- @swissjs/css Buffer conflict unrelated to swite

### Brand Rule
Swite is a global build tool.
Remove any regional labels from all docs.

---

## Notes
- Python process manager must use Node `child_process.spawn` not `exec`
- Log streaming must be line-buffered — do not swallow partial lines
- `healthCheck` polling should use exponential backoff after 5 failed attempts
- `X-Internal-Token` is a shared secret between Node and Python — document in README
- Every session starts by reading this file. Every session ends by updating it.

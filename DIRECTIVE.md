# DIRECTIVE — swite
> Last updated: 2026-05-19 · Owner: Kibologic · Repo: kibologic/swite

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

### ✅ S-06 — Fix module resolver — search parent node_modules (COMPLETED 2026-03-26)
Added `path.join(path.dirname(context.root), "node_modules")` to `nodeModulesLocations`
in `src/resolver/bare-import-resolver.ts`. Resolver now checks parent directory node_modules
in addition to app root and workspace root.

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

### ✅ S-07 — Fix findSwissLibMonorepo path (COMPLETED 2026-03-26)
`findSwissLibMonorepo` in `src/utils/package-finder.ts` now scans immediate
subdirectories of each ancestor (excluding node_modules) for a `swiss-lib/` child.
Handles `SWS/swiss-lib/` and any other one-level-deep monorepo layouts.

---

## Blocked
_Nothing blocked currently._

---

## Swiss Gaps
> Gaps discovered in swiss-lib during swite development. Each becomes a swiss-lib task.

_None discovered yet. Populate as development proceeds._

---

## Compiler Gaps
> Discovered during alpine-mobile Phase 5 build (2026-03-26). All fixed as hotfixes in swite/dist/ — need porting to swite source before next version cut.

- **CG-01** CLI entry hardcoded as `.ts` — should resolve `.ui` — FIXED in source `src/cli.ts` line 76
- **CG-02** `@swissjs/*` and `@skltn/*` not in externals — bundled instead of left as browser imports — FIXED in source `src/builder.ts` nodeBuiltins
- **CG-03** `findSwissFiles`/`findFiles` do not follow NTFS junctions (`isSymbolicLink()` check missing) — FIXED in source `src/builder.ts`
- **CG-04** Traversal enters `node_modules` via symlinks — `node_modules` not excluded from junction traversal — FIXED in source `src/builder.ts`
- **CG-05** `UiCompiler` rewrites `.ui` imports to `.js` but emits `.tsx` files — `jsTsxFallbackPlugin` added — FIXED in source `src/builder.ts`
- **CG-06** Compiler emits named exports only — default imports fail at bundle time — `export default` injected post-compile — FIXED in source `src/builder.ts`

---

## Session Log

### 2026-03-26

- Logged CG-01 through CG-06 from alpine-mobile Phase 5 build
- All 6 fixed in swite/dist/ as hotfixes — need porting to swite source before next version cut
- Fixed CG-01 through CG-06 in swite source (src/cli.ts + src/builder.ts)
- swite tsc build fails on swiss-lib project reference errors (pre-existing TD-02) — dist updated via linter auto-compile
- Verified alpine-mobile build passes end-to-end: dist/index.js 30.5kb ✅
- Fixed S-06: parent node_modules added to bare-import-resolver nodeModulesLocations
- Fixed S-07: findSwissLibMonorepo now scans immediate subdirs one level deeper
- alpine-mobile build on Linux blocked by missing NTFS junctions (src/modules, src/packages) — pre-existing Linux env constraint, not caused by these changes
- Commit: 4cf8c6e
- Bumped version to 0.2.0 (commit fd039ce) — wrote CHANGELOG.md covering CG-01–06 and 0.1.0 baseline
- swiss-lib CG fixes committed (commit 6d9c296): CG-03/04/05 in compiler + core hookRegistry alignment + cli traversal

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

### Pipeline (LIVE — commit cefd6ef, 2026-03-02)

File: .github/workflows/ci.yml ✓
Trigger: push to main, all PRs
Jobs: pnpm install → pnpm build → pnpm test
      changeset presence check on PRs (warn only)

File: .github/workflows/release.yml ✓
Trigger: push to main
Jobs: changesets/action — creates "Version Packages" PR
      when .changeset/ has entries; publishes to npm
      when version PR is merged; GitHub releases auto-created

File: .github/workflows/publish.yml ✓
Trigger: manual (workflow_dispatch)
Jobs: emergency re-publish with optional dry-run mode

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

## Kibologic Foundational Decisions (locked 2026-03-01)

### Security & Repository Hardening

Signed commits
  Required on main branch in all kibologic repos
  Enforced via branch protection rules
  No unsigned commits merged to main

SECURITY.md
  Required in every public repo
  Contains: security@kibologic.com contact
  Disclosure timeline: 90 days
  CVE process: GitHub Security Advisories

CODEOWNERS
  Required in every repo
  Founder owns everything initially
  Format: * @themba-kibologic
  Expandable as team grows

CodeQL scanning
  Enabled on all PRs in all repos
  GitHub Advanced Security
  Blocks merge if critical vulnerability found

Pre-commit hooks
  Tool: gitleaks
  Blocks commits containing secrets/tokens
  Applied to all repos on dev machines
  Also runs in CI as second layer

### npm & Publishing Security

Automation tokens only for CI publish
Granular access tokens for human use
No local manual publish ever
2FA mandatory on npm org accounts
Unpublish policy: never after public release
Deprecation only via npm deprecate command

### GitHub Org Security

Dependabot enabled all repos
Secret scanning enabled all repos
CodeQL enabled all repos
Branch protection on main — all repos
  Require 1 PR review
  Require status checks to pass
  Dismiss stale reviews
  No admin bypass
CODEOWNERS required before merge

### License & Legal

BSL 1.1 on Alpine ERP and enterprise packages
Change date: 2029-12-31 → Apache 2.0
Trademark intent-to-use filed for:
  SwissJS, Alpine ERP, Swite
CLA required for all external contributors
SECURITY.md in every public repo
BSL notice in repo root AND in every release

### Enterprise License Architecture

Format: signed JSON payload
Algorithm: ed25519
Private key: offline secure storage
Public key: embedded in backend only
Validation: backend only, never frontend only
Frontend role: feature visibility only
Offline validation: supported
Seat enforcement: hard block new user creation
Module enforcement: backend service layer guard
Self-hosted: license file in server env/config
SaaS: database-driven feature flags

### Deployment

Static sites: Cloudflare Pages
  swissjs.dev, alpineerp.com, kibologic.com
SaaS backend: Fly.io or equivalent
Self-hosted: Docker Compose first
Official distribution: Docker image
Database: managed PostgreSQL provider
Kubernetes: not initially

### Domain & Email

All three domains on Cloudflare
SSL: Full strict
www → root redirect
HTTP → HTTPS
DNSSEC enabled
HSTS enabled
Email: Google Workspace or equivalent
Required addresses:
  hello@kibologic.com
  support@kibologic.com
  legal@kibologic.com
SPF, DKIM, DMARC reject policy

### Community & Support

Initial channels: GitHub Issues only
Discord: after measurable traffic
Governance: founder-led
CONTRIBUTING.md required in all repos
Issue templates required in all repos
Public roadmap: high level only
Support: founder-led email/ticket
SLA: 24 business hours response
Private Slack for enterprise:
  optional after revenue threshold
No 24/7 SLA initially

### Documentation

Primary author: founder
Tooling: VitePress or Starlight
Structure:
  getting_started
  core_concepts
  api_reference
  examples
Versioned docs: after v1
Separate docs for SwissJS and Alpine ERP

### Pricing Model

Model: open-core
Free: dashboard, users, settings, pos
Enterprise: finance, hr, inventory,
            sales, procurement
Pricing dimensions: per user + per module
License validation: required (backend)
Self-hosted vs SaaS: different pricing
License key: signed ed25519 JSON

### Versioning & Release

Tool: Changesets (@changesets/cli)
Linked versioning for @swissjs/* core packages
Milestone-based releases

Milestones:
  v0.1.0 — claim npm scopes, publish foundation
  v0.2.0 — PostgreSQL + real data wiring
  v0.3.0 — FastAPI auth complete
  v0.4.0 — first enterprise module real data
  v1.0.0 — first paying customer

Registry split:
  npm public  → @swissjs/*, @sws/*,
                MIT @swiss-package/*
  GitHub Pkg  → BSL @swiss-package/*
  GitHub only → alpine-erp (no npm)

### Brand Rule (non-negotiable)

Kibologic is a global company.
SwissJS, Alpine ERP, Swite are global products.
Remove all regional superlatives from every file.
"Africa's first" or any regional label is wrong.
Correct on sight in every session.

---

## Manual Actions Pending
| ID   | Action                                              | Scope        | Status  |
|------|-----------------------------------------------------|--------------|---------|
| M-01 | Create @swissjs org on npmjs.com                   | npm          | PENDING |
| M-03 | Add NPM_TOKEN secret to kibologic org GitHub        | GitHub org   | PENDING |
| M-04 | Add CHANGESET_TOKEN secret to kibologic org GitHub  | GitHub org   | PENDING |
| S-05 | Fix link: deps → proper semver deps before publish  | swite repo   | PENDING |

---

## Notes
- Python process manager must use Node `child_process.spawn` not `exec`
- Log streaming must be line-buffered — do not swallow partial lines
- `healthCheck` polling should use exponential backoff after 5 failed attempts
- `X-Internal-Token` is a shared secret between Node and Python — document in README
- Every session starts by reading this file. Every session ends by updating it.

---

## Session Log — 2026-05-19: Architectural Modernization Sprint

**Agent:** Long-term modernization, compiler evolution, and architectural stabilization agent.

### Identified Weaknesses (from prior sprint analysis)
- `import.meta.env` assignment is read-only — polyfill approach broken
- Import rewriter offset tracking unreliable (3 fallback layers signal broken primary logic)
- `/swiss-lib/` → `/swiss-packages/` fixup scattered across 7 places (symptom of unfixed upstream bug)
- HMR client JS embedded as TS string — maintenance trap (6 bugs found last sprint)
- `getDependencies()` duplicated between UIHandler/UIXHandler with empty importer
- CSS stripping with 4 overlapping regexes — edge cases produce broken output
- In-memory-only cache — cold start on every restart
- Emergency `@kibologic/*` path guessing in bare-import-resolver

### Work Executed This Session

#### fix/env-inline
**Problem:** `injectEnvPolyfill()` attempted `import.meta.env = switeEnv`. `import.meta` is read-only in ES modules — assignment silently fails or throws in strict environments. Apps using `import.meta.env.MODE` etc. get `undefined`.
**Decision:** Replace runtime injection with compile-time text replacement. At serve time, run a regex pass that replaces `import.meta.env.KEY` literals with their actual values from the loaded `.env` files. No import needed, no read-only assignment, works everywhere ES modules run.
**Files:** `src/env.ts`, `src/handlers/ui-handler.ts`, `src/handlers/uix-handler.ts`, `src/handlers/ts-handler.ts`
**Status:** FIXED

#### fix/import-rewriter
**Problem:** The offset-tracking approach (`let offset = 0; offset += ...`) accumulates errors when quote stripping/adding adjusts string lengths differently than expected. The 3-layer fallback (force-replace + final regex pass) exists because the primary logic is known to misfire.
**Decision:** Collect-then-apply-right-to-left. All replacements are gathered as `{start, end, replacement}` in original string coordinates (no offset needed). Sorted descending by `start`. Applied right-to-left so later positions are never shifted by earlier substitutions. Eliminates offset variable entirely.
**Files:** `src/import-rewriter.ts`
**Status:** FIXED

#### fix/swiss-lib-paths
**Problem:** `/swiss-lib/` → `/swiss-packages/` path fixup appeared in 7 places: ui-handler.ts ×3, uix-handler.ts ×3, import-rewriter.ts ×1 (inline) + 1 (final pass). Any new handler would need to add it again.
**Decision:** Extract to `src/utils/path-fixup.ts` with a single `fixSwissLibPaths(code)` function. Call it once in each handler, before passing to the import rewriter. Remove all inline fixup blocks from handlers and the duplicate pass from import-rewriter.ts.
**Note:** Root cause is still the compiler emitting wrong paths. This centralizes the workaround until the compiler is fixed at source.
**Files:** `src/utils/path-fixup.ts` (new), `src/handlers/ui-handler.ts`, `src/handlers/uix-handler.ts`, `src/import-rewriter.ts`
**Status:** FIXED

#### fix/hmr-client-file
**Problem:** `getClientScript()` in `src/hmr.ts` returns a plain JavaScript string (served directly to browsers) written inside a TypeScript file. Six TypeScript-specific syntax bugs were found last sprint. The string must be maintained as valid browser JS with no TS syntax — this is invisible to editors and linters.
**Decision:** Extract to `src/hmr-client.js`. This is a real JS file — editors lint it, syntax errors are caught immediately. Port and env are injected via `{{PORT}}` / `{{VERSION}}` template placeholders replaced at read time using `readFileSync`. The main `hmr.ts` reads it once at startup.
**Files:** `src/hmr-client.js` (new), `src/hmr.ts`
**Status:** FIXED

### Open Issues Carried Forward
- S-01 through S-04: Python service integration (not yet started)
- S-05: Fix link: deps → semver before publish
- In-memory cache: persistent disk cache deferred
- CSS modules: currently stripped, should return empty object
- HMR state preservation: full module hot-replacement state transfer deferred
- `@kibologic/*` emergency path guessing in bare-import-resolver: deferred (needs workspace resolver redesign)

---

## Session Log — 2026-05-19 (continued): Context-resumed work

### Work Executed

#### fix/swiss-lib-paths (completed from prior session)
All changes written in prior session were verified (npx tsc --noEmit clean), committed, and shipped to main via development → staging → main.

#### fix/env-inline (completed from prior session)
Same status — context resumed, tsc clean, shipped.

#### fix/hmr-client-file (completed from prior session)
Same status — tsc clean, shipped.

### Open Issues Still Pending
- S-01 through S-04: Python service integration
- S-05: semver dep fix before publish
- Transform pipeline extraction (Lock 3 architecture)
- Resolver stratification (Lock 3)
- Python adapter interface (Lock 3)

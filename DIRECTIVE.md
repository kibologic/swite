# DIRECTIVE — swite
> Last updated: 2025 · Owner: Kibologic · Repo: kibologic/swite

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

## Notes
- Python process manager must use Node `child_process.spawn` not `exec`
- Log streaming must be line-buffered — do not swallow partial lines
- `healthCheck` polling should use exponential backoff after 5 failed attempts
- `X-Internal-Token` is a shared secret between Node and Python — document in README
- Every session starts by reading this file. Every session ends by updating it.

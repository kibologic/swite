<!--
Copyright (c) 2024 Themba Mzumara
SWITE - SWISS Development Server
Licensed under the MIT License.
-->

# swite start

Starts the SWITE server in production mode.

```bash
swite start
```

---

## What it does

`swite start` starts the same `SwiteServer` as `swite dev` but with one critical difference: it calls `setProductionMode()` before the server starts. Production mode changes how `proxyToPython` resolves the Python service URL:

- **Dev mode**: if `PYTHON_SERVICE_URL` is not set, `proxyToPython` falls back to `http://localhost:{python.port}` from the config.
- **Production mode**: if `PYTHON_SERVICE_URL` is not set, `proxyToPython` throws immediately with an error rather than attempting a localhost connection.

`swite start` does not spawn the Python process. It does not start HMR. The HMR WebSocket server is still initialized (as part of `SwiteServer`), but since no file watcher is started and the client script is still served, the client will connect and wait — which is harmless in a production container.

---

## PYTHON_SERVICE_URL warning

If `services.python` is configured in `swiss.config.ts` and `PYTHON_SERVICE_URL` is not set in the environment at startup, SWITE prints a warning:

```
[swite] WARNING: services.python is configured but PYTHON_SERVICE_URL is not set.
        Proxy calls to Python will fail. Set PYTHON_SERVICE_URL to the running service URL.
```

The server starts regardless. The warning is there because proxy calls that happen before `PYTHON_SERVICE_URL` is set will throw at request time.

---

## Production deployment notes

`swite start` serves source files through the same compilation and import-rewriting middleware as `swite dev`. It is not a static file server for pre-built output. If you want to serve the output of `swite build`, use a regular static HTTP server pointed at `dist/`.

`swite start` is intended for fullstack deployments where the Node server handles server-side logic and proxies to a separately deployed Python service, while continuing to serve the SwissJS frontend from source.

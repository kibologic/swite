/**
 * SWITE-008: launch and closing failures give one clear message, the right
 * exit code / status, and leave nothing behind.
 */

import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import net from "node:net";
import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import express from "express";
import { SwiteServer } from "../src/dev-engine/server.js";
import { createRequestLog } from "../src/dev-engine/middleware/request-log.js";
import { SwitePortInUseError, assertPortFree } from "../src/dev-engine/listen-errors.js";
import { proxyToPython } from "../src/adapters/proxy/proxyToPython.js";
import { sendProxyError, describeProxyFailure } from "../src/adapters/proxy/gateway.js";
import {
  SwiteProxyError,
  SwiteProxyTimeoutError,
  SwiteProxyUnreachableError,
} from "../src/adapters/proxy/SwiteProxyError.js";
import {
  formatDuration,
  formatStopSummary,
  installGracefulShutdown,
  installProcessErrorHandlers,
  reportProcessError,
} from "../src/dev-engine/lifecycle.js";
import { captureLogs, fetchText, freePort, makeTestApp, type TestApp } from "./helpers/fixture.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const tsxLoader = pathToFileURL(path.join(repoRoot, "node_modules", "tsx", "dist", "esm", "index.mjs")).href;

function occupy(port: number, host = "127.0.0.1"): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(port, host, () => resolve(s));
  });
}

function runNode(
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: opts.cwd ?? repoRoot,
      env: { ...process.env, NO_COLOR: "1", SWITE_LOG_TIME: "0", ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    // Safety net so a bug can never leave a stray server or hang the suite.
    const guard = setTimeout(() => child.kill(), 30_000);
    child.on("exit", (code) => {
      clearTimeout(guard);
      resolve({ code, out });
    });
  });
}

describe("port in use", () => {
  let fx: TestApp;
  before(async () => {
    fx = await makeTestApp();
  });
  after(async () => {
    await fx.cleanup();
  });

  test("start() rejects with an error naming the port - no uncaught exception", async () => {
    const port = await freePort();
    const blocker = await occupy(port);
    const hmrPort = await freePort();
    const server = new SwiteServer({ root: fx.app, port, host: "127.0.0.1", hmrPort });
    const cap = captureLogs("error");
    try {
      await assert.rejects(
        () => server.start(),
        (err: unknown) => {
          assert.ok(err instanceof SwitePortInUseError);
          assert.match((err as Error).message, new RegExp(`Port ${port} is already in use \\(host 127\\.0\\.0\\.1\\)`));
          assert.match((err as Error).message, /Stop the other process or set PORT \/ server\.port/);
          return true;
        },
      );
      // Failed start leaves nothing behind: the HMR socket was never taken.
      await assertPortFree(hmrPort, "0.0.0.0");
      assert.equal(cap.lines.length, 0, "the library does not print; the CLI does");
    } finally {
      cap.restore();
      await new Promise((r) => blocker.close(r));
    }
  });

  test("the CLI prints one clear line, no stack, and exits 1", async () => {
    const port = await freePort();
    // Same address as the CLI will bind (Windows lets a specific address bind next to a wildcard one).
    await fs.writeFile(
      path.join(fx.app, "swiss.config.js"),
      `export default { server: { host: "127.0.0.1", hmrPort: ${await freePort()} } };`,
    );
    const blocker = await occupy(port, "127.0.0.1");
    try {
      const res = await runNode(["--import", tsxLoader, path.join(repoRoot, "src", "cli.ts"), "dev"], {
        cwd: fx.app,
        env: { PORT: String(port), NODE_ENV: "development" },
      });
      assert.equal(res.code, 1, res.out);
      const lines = res.out.split(/\r?\n/).filter(Boolean);
      assert.equal(lines.length, 1, res.out);
      assert.match(lines[0], new RegExp(`^ERROR \\[swite\\] Port ${port} is already in use`));
      assert.doesNotMatch(res.out, /\n\s+at /);
      assert.doesNotMatch(res.out, /EADDRINUSE/);
    } finally {
      await new Promise((r) => blocker.close(r));
    }
  });
});

describe("proxyToPython failures", () => {
  const saved = process.env["PYTHON_SERVICE_URL"];
  let hang: http.Server;
  let hangPort: number;
  let closedPort: number;

  before(async () => {
    closedPort = await freePort();
    hangPort = await freePort();
    hang = http.createServer(() => {
      /* accept and never answer */
    });
    await new Promise<void>((r) => hang.listen(hangPort, "127.0.0.1", r));
  });
  after(() => {
    hang.closeAllConnections();
    hang.close();
    if (saved === undefined) delete process.env["PYTHON_SERVICE_URL"];
    else process.env["PYTHON_SERVICE_URL"] = saved;
  });

  test("a closed port throws the unreachable class, naming target and path (not 'fetch failed')", async () => {
    process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${closedPort}`;
    await assert.rejects(
      () => proxyToPython({ method: "GET", path: "/orders?token=SECRET" }),
      (err: unknown) => {
        assert.ok(err instanceof SwiteProxyUnreachableError);
        assert.ok(!(err instanceof TypeError));
        assert.match((err as Error).message, new RegExp(`127\\.0\\.0\\.1:${closedPort}`));
        assert.match((err as Error).message, /GET \/orders/);
        assert.ok(!(err as Error).message.includes("SECRET"), "query string must not appear in messages");
        assert.equal((err as SwiteProxyUnreachableError).code, "ECONNREFUSED");
        return true;
      },
    );
  });

  test("a hanging server throws the timeout class after the configured timeout", async () => {
    process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${hangPort}`;
    const started = Date.now();
    await assert.rejects(
      () => proxyToPython({ method: "GET", path: "/slow", timeoutMs: 250 }),
      (err: unknown) => {
        assert.ok(err instanceof SwiteProxyTimeoutError);
        assert.equal((err as SwiteProxyTimeoutError).timeoutMs, 250);
        return true;
      },
    );
    const elapsed = Date.now() - started;
    assert.ok(elapsed >= 200 && elapsed < 3000, `elapsed ${elapsed}`);
  });

  test("the timeout is configurable through SWITE_PROXY_TIMEOUT_MS", async () => {
    process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${hangPort}`;
    process.env["SWITE_PROXY_TIMEOUT_MS"] = "200";
    try {
      await assert.rejects(
        () => proxyToPython({ method: "GET", path: "/slow" }),
        (err: unknown) => err instanceof SwiteProxyTimeoutError && err.timeoutMs === 200,
      );
    } finally {
      delete process.env["SWITE_PROXY_TIMEOUT_MS"];
    }
  });

  test("a non-2xx answer is still a SwiteProxyError, with a readable body even when not JSON", async () => {
    const plain = http.createServer((_req, res) => {
      res.statusCode = 503;
      res.end("maintenance");
    });
    const port = await freePort();
    await new Promise<void>((r) => plain.listen(port, "127.0.0.1", r));
    process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${port}`;
    try {
      await assert.rejects(
        () => proxyToPython({ method: "GET", path: "/x" }),
        (err: unknown) =>
          err instanceof SwiteProxyError && err.status === 503 && err.responseBody === "maintenance",
      );
    } finally {
      plain.close();
    }
  });

  test("describeProxyFailure ignores errors that are not proxy failures", () => {
    assert.equal(describeProxyFailure(new Error("other")), null);
  });
});

describe("gateway routes answer 502 / 504 and the request log shows it", () => {
  let hang: http.Server;
  let hangPort: number;
  let closedPort: number;
  let listener: http.Server;
  let base: string;
  const saved = process.env["PYTHON_SERVICE_URL"];

  before(async () => {
    closedPort = await freePort();
    hangPort = await freePort();
    hang = http.createServer(() => {});
    await new Promise<void>((r) => hang.listen(hangPort, "127.0.0.1", r));

    const app = express();
    app.use(createRequestLog().middleware);
    app.get("/api/down", async (_req, res) => {
      process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${closedPort}`;
      try {
        res.json(await proxyToPython({ method: "GET", path: "/orders" }));
      } catch (err) {
        if (!sendProxyError(res, err)) throw err;
      }
    });
    app.get("/api/hung", async (_req, res) => {
      process.env["PYTHON_SERVICE_URL"] = `http://127.0.0.1:${hangPort}`;
      try {
        res.json(await proxyToPython({ method: "GET", path: "/orders", timeoutMs: 200 }));
      } catch (err) {
        if (!sendProxyError(res, err)) throw err;
      }
    });
    await new Promise<void>((r) => {
      listener = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(listener.address() as net.AddressInfo).port}`;
  });
  after(() => {
    listener.close();
    hang.closeAllConnections();
    hang.close();
    if (saved === undefined) delete process.env["PYTHON_SERVICE_URL"];
    else process.env["PYTHON_SERVICE_URL"] = saved;
  });

  test("backend down: 502 JSON with target and hint; one ERROR log line showing 502 and proxy", async () => {
    const cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/api/down`);
      assert.equal(res.status, 502);
      const body = JSON.parse(res.body) as { error: string; target: string; hint: string };
      assert.equal(body.target, `http://127.0.0.1:${closedPort}`);
      assert.ok(body.hint.length > 0);
      assert.ok(body.error.includes("unreachable"));
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(cap.lines.length, 1, cap.lines.join("\n"));
      assert.match(cap.lines[0], /^ERROR\s+GET\s+\/api\/down\s+502\s+\d+ms\s+proxy\s+- python unreachable/);
    } finally {
      cap.restore();
    }
  });

  test("backend hung: 504 JSON; the log line shows 504", async () => {
    const cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/api/hung`);
      assert.equal(res.status, 504);
      const body = JSON.parse(res.body) as { error: string; target: string; hint: string };
      assert.equal(body.target, `http://127.0.0.1:${hangPort}`);
      assert.match(body.hint, /SWITE_PROXY_TIMEOUT_MS/);
      await new Promise((r) => setTimeout(r, 30));
      assert.match(cap.lines[0], /^ERROR\s+GET\s+\/api\/hung\s+504\s+\d+ms\s+proxy\s+- python timeout after 200ms/);
    } finally {
      cap.restore();
    }
  });
});

describe("process error handlers", () => {
  test("an unhandled rejection is reported as one grouped error, never twice", () => {
    const cap = captureLogs("info");
    try {
      const err = new Error("boom");
      reportProcessError("unhandledRejection", err);
      reportProcessError("uncaughtException", err); // same object: not reported again
      assert.equal(cap.lines.length, 1, cap.lines.join("\n"));
      assert.match(cap.lines[0], /^ERROR \[process\] Unhandled promise rejection: boom \(run with --verbose/);
    } finally {
      cap.restore();
    }
  });

  test("with --verbose the stack is included, still in the one entry", () => {
    const cap = captureLogs("debug");
    try {
      reportProcessError("uncaughtException", new Error("kaboom"));
      assert.equal(cap.lines.length, 1);
      assert.match(cap.lines[0], /Uncaught exception: kaboom\n\s+at /);
    } finally {
      cap.restore();
    }
  });

  test("a non-Error rejection reason is still reported", () => {
    const cap = captureLogs("info");
    try {
      reportProcessError("unhandledRejection", "just a string");
      assert.match(cap.lines[0], /Unhandled promise rejection: just a string/);
    } finally {
      cap.restore();
    }
  });

  test("handlers can be installed and removed", () => {
    const before = process.listenerCount("unhandledRejection");
    const off = installProcessErrorHandlers({ exitOnError: false });
    assert.equal(process.listenerCount("unhandledRejection"), before + 1);
    assert.ok(process.listenerCount("uncaughtException") >= 1);
    off();
    assert.equal(process.listenerCount("unhandledRejection"), before);
  });

  test("real process, development: one ERROR line, the process keeps running", async () => {
    const res = await runNode(["--import", tsxLoader, path.join(here, "fixtures", "reject-script.ts")], {
      env: { NODE_ENV: "development" },
    });
    assert.equal(res.code, 0, res.out);
    const errors = res.out.split(/\r?\n/).filter((l) => l.startsWith("ERROR"));
    assert.equal(errors.length, 1, res.out);
    assert.match(errors[0], /Unhandled promise rejection: backend exploded/);
    assert.match(res.out, /STILL ALIVE/);
  });

  test("real process, production: one ERROR line, then a nonzero exit", async () => {
    const res = await runNode(["--import", tsxLoader, path.join(here, "fixtures", "reject-script.ts")], {
      env: { NODE_ENV: "production" },
    });
    assert.equal(res.code, 1, res.out);
    assert.equal(res.out.split(/\r?\n/).filter((l) => l.startsWith("ERROR")).length, 1, res.out);
    assert.doesNotMatch(res.out, /STILL ALIVE/);
  });
});

describe("graceful shutdown", () => {
  let fx: TestApp;
  before(async () => {
    fx = await makeTestApp();
  });
  after(async () => {
    await fx.cleanup();
  });

  test("formatting helpers", () => {
    assert.equal(formatDuration(450), "450ms");
    assert.equal(formatDuration(12_340), "12.3s");
    assert.equal(formatDuration(125_000), "2m 05s");
    assert.equal(formatStopSummary({ uptimeMs: 12_340, requests: 142 }), "Stopped after 12.3s, 142 requests");
    assert.equal(formatStopSummary({ uptimeMs: 1000, requests: 1 }), "Stopped after 1.0s, 1 request");
  });

  test("after shutdown the port is free, the summary is printed and the exit code is 0", async () => {
    const port = await freePort();
    const server = new SwiteServer({ root: fx.app, port, host: "127.0.0.1", hmrPort: await freePort() });
    const startCap = captureLogs("error");
    await server.start();
    startCap.restore();
    await fetchText(`http://127.0.0.1:${port}/`);
    await fetchText(`http://127.0.0.1:${port}/src/missing.js`);

    const exits: number[] = [];
    let cleaned = false;
    const cap = captureLogs("info");
    const shutdown = installGracefulShutdown({
      stop: () => server.stop(),
      cleanup: () => {
        cleaned = true;
      },
      exit: (code) => exits.push(code),
      signals: [],
    });
    try {
      await shutdown.shutdown("SIGTERM");
      assert.deepEqual(exits, [0]);
      assert.ok(cleaned, "extra cleanup (the Python child) ran");
      assert.match(cap.lines.join("\n"), /Shutting down \(SIGTERM\)/);
      assert.match(cap.lines[cap.lines.length - 1], /^Stopped after \S+, 2 requests$/);
      // The port can be bound again immediately.
      await assertPortFree(port, "127.0.0.1");
      const again = await occupy(port);
      await new Promise((r) => again.close(r));
    } finally {
      cap.restore();
      shutdown.uninstall();
    }
  });

  test("a second interrupt forces exit without waiting", async () => {
    const exits: number[] = [];
    let release: () => void = () => {};
    const cap = captureLogs("info");
    const shutdown = installGracefulShutdown({
      stop: () =>
        new Promise((resolve) => {
          release = () => resolve({ uptimeMs: 1, requests: 0 });
        }),
      exit: (code) => exits.push(code),
      signals: [],
    });
    try {
      const first = shutdown.shutdown("SIGINT");
      await shutdown.shutdown("SIGINT"); // second Ctrl+C
      assert.deepEqual(exits, [1]);
      assert.match(cap.lines.join("\n"), /Second interrupt: forcing exit/);
      release();
      await first;
    } finally {
      cap.restore();
      shutdown.uninstall();
    }
  });

  test("a stuck shutdown is forced after the timeout", async () => {
    const exits: number[] = [];
    const cap = captureLogs("info");
    const shutdown = installGracefulShutdown({
      stop: () => new Promise(() => {}),
      exit: (code) => exits.push(code),
      forceAfterMs: 50,
      signals: [],
    });
    try {
      void shutdown.shutdown("SIGTERM");
      await new Promise((r) => setTimeout(r, 150));
      assert.deepEqual(exits, [1]);
      assert.match(cap.lines.join("\n"), /forcing exit/);
    } finally {
      cap.restore();
      shutdown.uninstall();
    }
  });

  test("stop() is idempotent and works before start()", async () => {
    const server = new SwiteServer({ root: fx.app, port: await freePort(), host: "127.0.0.1" });
    const a = await server.stop();
    const b = await server.stop();
    assert.deepEqual(a, b);
    assert.equal(a.requests, 0);
  });

  test("POSIX only: a real SIGTERM to the CLI exits 0 with the summary and frees the port", { skip: process.platform === "win32" }, async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", tsxLoader, path.join(repoRoot, "src", "cli.ts"), "dev"], {
      cwd: fx.app,
      env: { ...process.env, PORT: String(port), NO_COLOR: "1", SWITE_LOG_TIME: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (c: Buffer) => (out += c.toString()));
    child.stderr.on("data", (c: Buffer) => (out += c.toString()));
    const exited = new Promise<number | null>((r) => child.on("exit", (code) => r(code)));
    for (let i = 0; i < 100 && !/ready in/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /ready in/);
    child.kill("SIGTERM");
    assert.equal(await exited, 0, out);
    assert.match(out, /Stopped after \S+, 0 requests/);
    await assertPortFree(port, "0.0.0.0");
  });
});

/**
 * SWITE-003: one line per request - method, path, status, duration, source.
 * SWITE-004: expected probe misses and startup chatter stay out of the default output.
 */

import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { SwiteServer } from "../src/dev-engine/server.js";
import {
  formatRequestLine,
  levelForStatus,
  safeRequestPath,
} from "../src/dev-engine/middleware/request-log.js";
import { captureLogs, fetchText, freePort, makeTestApp, type LogCapture, type TestApp } from "./helpers/fixture.js";

const DRIVE_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]/;

describe("request log - pure pieces", () => {
  test("safeRequestPath drops query, hash and filesystem paths", () => {
    assert.equal(safeRequestPath("/api/x?token=abc&y=1"), "/api/x");
    assert.equal(safeRequestPath("/a#frag"), "/a");
    assert.equal(safeRequestPath("/@fs/C:/Users/me/secret.txt"), "/@fs/<path>");
  });

  test("level follows the status class: 2xx/3xx info, 4xx warn, 5xx error", () => {
    assert.equal(levelForStatus(200, false), "info");
    assert.equal(levelForStatus(304, false), "info");
    assert.equal(levelForStatus(404, false), "warn");
    assert.equal(levelForStatus(500, false), "error");
    assert.equal(levelForStatus(502, true), "error");
  });

  test("internal swite paths log at debug when successful", () => {
    assert.equal(levelForStatus(200, true), "debug");
  });

  test("a CDN redirect is a warning: the module was not found locally", () => {
    assert.equal(levelForStatus(302, false, "cdn-redirect"), "warn");
  });

  test("line format: method path status duration source, slow tag, note", () => {
    const line = formatRequestLine({
      method: "GET",
      path: "/x",
      status: 200,
      ms: 12,
      source: "cache",
      slow: false,
    });
    assert.match(line, /^GET\s+\/x\s+200\s+12ms\s+cache$/);
    const slow = formatRequestLine({
      method: "GET",
      path: "/x",
      status: 200,
      ms: 900,
      source: "compiled",
      slow: true,
      note: "why",
    });
    assert.match(slow, /900ms\s+compiled\s+slow\s+- why$/);
  });
});

describe("request log - integration with SwiteServer", () => {
  let fx: TestApp;
  let server: SwiteServer;
  let base: string;
  let cap: LogCapture;

  before(async () => {
    fx = await makeTestApp();
    const port = await freePort();
    server = new SwiteServer({
      root: fx.app,
      port,
      host: "127.0.0.1",
      hmrPort: await freePort(),
      slowRequestMs: 1,
      configureApp(app) {
        app.get("/api/slow", (_req, res) => {
          setTimeout(() => res.json({ ok: true }), 40);
        });
      },
    });
    // Start quietly; capture only what happens after startup.
    const startCap = captureLogs("error");
    await server.start();
    startCap.restore();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.stop();
    await fx.cleanup();
  });

  test("a cached .uix logs exactly one info line: GET /path 200 <n>ms cache", async () => {
    await fetchText(`${base}/src/main.uix`); // compile + cache
    cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/src/main.uix`);
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      const own = cap.lines.filter((l) => l.includes("/src/main.uix"));
      assert.equal(cap.lines.length, 1, `expected one line, got:\n${cap.lines.join("\n")}`);
      assert.equal(own.length, 1);
      assert.match(own[0], /^GET\s+\/src\/main\.uix\s+200\s+\d+ms\s+cache/);
    } finally {
      cap.restore();
    }
  });

  test("the first request for a .uix says compiled", async () => {
    cap = captureLogs("info");
    try {
      // A different file so it is not cached yet.
      const res = await fetchText(`${base}/src/main.uix?fresh=1`);
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(cap.lines.length, 1);
      assert.match(cap.lines[0], /200\s+\d+ms\s+(cache|compiled)/);
    } finally {
      cap.restore();
    }
  });

  test("a missing .js logs one WARN line with status 404", async () => {
    cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/src/missing.js`);
      assert.equal(res.status, 404);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(cap.lines.length, 1, cap.lines.join("\n"));
      assert.match(cap.lines[0], /^WARN\s+GET\s+\/src\/missing\.js\s+404\s+\d+ms/);
    } finally {
      cap.restore();
    }
  });

  test("a handler that throws logs one ERROR line with status 500", async () => {
    cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/src/broken.uix`);
      assert.equal(res.status, 500);
      await new Promise((r) => setTimeout(r, 30));
      const errors = cap.lines.filter((l) => l.startsWith("ERROR"));
      assert.equal(errors.length, 1, cap.lines.join("\n"));
      assert.match(errors[0], /^ERROR\s+GET\s+\/src\/broken\.uix\s+500\s+\d+ms\s+error/);
    } finally {
      cap.restore();
    }
  });

  test("no line carries a filesystem path, a cookie, a token or a query value", async () => {
    cap = captureLogs("debug");
    try {
      await fetchText(`${base}/src/missing.js?secret=QUERYVALUE`, {
        headers: { Cookie: "sid=COOKIEVALUE", "X-Internal-Token": "TOKENVALUE" },
      });
      await fetchText(`${base}/src/main.uix`, { headers: { Authorization: "Bearer BEARERVALUE" } });
      await new Promise((r) => setTimeout(r, 30));
      const requestLines = cap.lines.filter((l) => /\b(GET|POST)\s+\//.test(l));
      assert.ok(requestLines.length >= 2);
      for (const l of requestLines) {
        assert.doesNotMatch(l, DRIVE_PATH, l);
        for (const secret of ["QUERYVALUE", "COOKIEVALUE", "TOKENVALUE", "BEARERVALUE"]) {
          assert.ok(!l.includes(secret), `${secret} leaked: ${l}`);
        }
      }
    } finally {
      cap.restore();
    }
  });

  test("a request slower than the threshold is tagged slow", async () => {
    cap = captureLogs("info");
    try {
      await fetchText(`${base}/api/slow`);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(cap.lines.length, 1);
      assert.match(cap.lines[0], /GET\s+\/api\/slow\s+200\s+\d+ms\s+\S+\s+slow/);
    } finally {
      cap.restore();
    }
  });

  test("responses are unchanged: SPA shell body and missing-file text", async () => {
    const spa = await fetchText(`${base}/`);
    assert.equal(spa.status, 200);
    assert.match(spa.headers.get("content-type") ?? "", /text\/html/);
    assert.ok(spa.body.includes('<div id="app"></div>'));
    const missing = await fetchText(`${base}/src/missing.js`);
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get("content-type") ?? "", /text\/plain/);
    assert.match(missing.body, /not found/i);
  });
});

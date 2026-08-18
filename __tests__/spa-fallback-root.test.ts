/**
 * SWITE-001: GET / must serve the SPA shell regardless of Accept header.
 *
 * The SPA fallback in static-files.ts gates HTML responses behind an
 * `Accept: text/html` check, to stop asset requests (scripts/styles/modules)
 * that fall through to the fallback from getting an HTML body with the
 * wrong MIME type (see SG-03). That check has no effect on real browser
 * navigation (browsers always send text/html in Accept), so its only
 * practical effect was 404-ing the literal root URL for any non-browser
 * client (health checks, curl, uptime monitors) that don't set an Accept
 * header favoring text/html.
 *
 * These tests cover both sides of the fix:
 *   1. GET / with a non-HTML/absent Accept header must still get the SPA
 *      shell (200, HTML body) -- this is the regression this task fixes.
 *   2. A missing .js path must still 404 as plain text no matter the
 *      Accept header -- this is the guard against reintroducing SG-03.
 */

import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import type { AddressInfo } from "node:net";
import express from "express";
import { setupSPAFallback } from "../src/dev-engine/middleware/static-files.js";

describe("SPA fallback — root URL Accept-header handling", () => {
  let appRoot: string;
  let server: import("node:http").Server;
  let baseUrl: string;

  before(async () => {
    appRoot = await fs.mkdtemp(path.join(os.tmpdir(), "swite-spa-fallback-"));
    await fs.mkdir(path.join(appRoot, "public"), { recursive: true });
    await fs.writeFile(
      path.join(appRoot, "public", "index.html"),
      "<!DOCTYPE html><html><head></head><body><div id=\"app\"></div></body></html>",
    );

    const app = express();
    await setupSPAFallback(app, { root: appRoot, publicDir: "public" });

    server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await fs.rm(appRoot, { recursive: true, force: true });
  });

  test("GET / with Accept: */* returns 200 with the SPA shell (non-browser client, e.g. a health check)", async () => {
    const res = await fetch(`${baseUrl}/`, { headers: { Accept: "*/*" } });
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.match(body, /<div id="app">/);
  });

  test("GET / with no Accept header at all returns 200 with the SPA shell", async () => {
    // fetch() always sets some Accept by default, so hit the server with raw http
    // to simulate a client that truly sends none.
    const http = await import("node:http");
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        `${baseUrl}/`,
        { method: "GET", headers: {} },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on("error", reject);
      req.end();
    });
    assert.equal(result.status, 200);
    assert.match(result.body, /<div id="app">/);
  });

  test("regression guard: GET /does-not-exist.js still 404s as plain text, even with Accept: text/html", async () => {
    // Without the extension check above the Accept-header gate, this request
    // (Accept: text/html, as a <script> tag fetch can send) would get the HTML
    // shell back for a .js URL -- the exact strict-MIME failure (SG-03) the
    // gate exists to prevent. The extension check must still catch it first.
    const res = await fetch(`${baseUrl}/does-not-exist.js`, {
      headers: { Accept: "text/html,application/xhtml+xml" },
    });
    assert.equal(res.status, 404);
    const contentType = res.headers.get("content-type") || "";
    assert.ok(!contentType.includes("text/html"), `expected non-HTML content-type, got ${contentType}`);
    const body = await res.text();
    assert.ok(!body.includes("<div id=\"app\">"), "must not serve the SPA shell for a missing .js path");
  });

  test("regression guard: GET /does-not-exist.js with Accept: */* also still 404s", async () => {
    const res = await fetch(`${baseUrl}/does-not-exist.js`, { headers: { Accept: "*/*" } });
    assert.equal(res.status, 404);
  });

  test("a genuinely ambiguous deep path with a non-HTML Accept header still 404s (gate still protects non-root paths)", async () => {
    const res = await fetch(`${baseUrl}/some/random/path`, { headers: { Accept: "application/json" } });
    assert.equal(res.status, 404);
  });
});

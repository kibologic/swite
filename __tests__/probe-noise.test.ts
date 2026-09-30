/**
 * SWITE-004: expected probe misses and startup chatter are debug output, and
 * no stale version string ships.
 */

import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { SwiteServer } from "../src/dev-engine/server.js";
import { classifyFsError } from "../src/internal/fs-errors.js";
import { captureLogs, fetchText, freePort, makeTestApp, type TestApp } from "./helpers/fixture.js";

const DRIVE_PATH = /(?<![A-Za-z])[A-Za-z]:[\\/]/;
const here = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(here, "..", "src");

async function listTs(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listTs(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("probe noise", () => {
  let fx: TestApp;
  let server: SwiteServer;
  let base: string;
  let startupLines: string[];

  before(async () => {
    fx = await makeTestApp();
    const port = await freePort();
    server = new SwiteServer({
      root: fx.app,
      port,
      host: "127.0.0.1",
      hmrPort: await freePort(),
    });
    const startCap = captureLogs("info");
    await server.start();
    startupLines = [...startCap.lines];
    startCap.restore();
    base = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.stop();
    await fx.cleanup();
  });

  test("a node_modules file that needs 3 walk-up probes gives no WARN/ERROR and no raw fs text", async () => {
    const cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/node_modules/demo-lib/index.js`);
      assert.equal(res.status, 200);
      await new Promise((r) => setTimeout(r, 30));
      for (const l of cap.lines) {
        assert.doesNotMatch(l, /^(WARN|ERROR)/, l);
        assert.doesNotMatch(l, /Path failed|ENOENT|realpath/, l);
      }
      assert.equal(cap.lines.length, 1, cap.lines.join("\n"));
      assert.match(cap.lines[0], /GET\s+\/node_modules\/demo-lib\/index\.js\s+200\s+\d+ms\s+node_modules/);
    } finally {
      cap.restore();
    }
  });

  test("at debug the same request yields exactly one summary line naming the probe count", async () => {
    const cap = captureLogs("debug");
    try {
      await fetchText(`${base}/node_modules/demo-lib/index.js`);
      await new Promise((r) => setTimeout(r, 30));
      const summaries = cap.lines.filter((l) => /\(probed \d+/.test(l));
      assert.equal(summaries.length, 1, cap.lines.join("\n"));
      assert.match(summaries[0], /^DEBUG \[node_modules\] \/node_modules\/demo-lib\/index\.js -> /);
      assert.match(summaries[0], /\(probed 3, misses: 2 missing\)/);
      assert.doesNotMatch(summaries[0], DRIVE_PATH);
      // No per-probe lines at any level.
      assert.equal(cap.lines.filter((l) => /Trying path|Path failed/.test(l)).length, 0);
    } finally {
      cap.restore();
    }
  });

  test("a genuinely missing node_modules module still warns once, with the 404", async () => {
    const cap = captureLogs("info");
    try {
      const res = await fetchText(`${base}/node_modules/not-installed/index.js`);
      assert.equal(res.status, 404);
      await new Promise((r) => setTimeout(r, 30));
      const loud = cap.lines.filter((l) => /^(WARN|ERROR)/.test(l));
      assert.equal(loud.length, 1, cap.lines.join("\n"));
      assert.match(loud[0], /^WARN\s+GET\s+\/node_modules\/not-installed\/index\.js\s+404/);
    } finally {
      cap.restore();
    }
  });

  test("startup at the default level prints no filesystem path beyond the banner's Root line", () => {
    assert.ok(startupLines.length > 0 && startupLines.length <= 8, startupLines.join("\n"));
    for (const l of startupLines) {
      if (/^\s+Root\s/.test(l)) continue;
      assert.doesNotMatch(l, DRIVE_PATH, l);
    }
    assert.ok(!startupLines.some((l) => /console\.time|Symlink Registry|Middleware Setup/.test(l)));
  });

  test("startup timings are one debug line", async () => {
    const other = new SwiteServer({
      root: fx.app,
      port: await freePort(),
      host: "127.0.0.1",
      hmrPort: await freePort(),
    });
    const cap = captureLogs("debug");
    try {
      await other.start();
      const timings = cap.lines.filter((l) => /startup timings:/.test(l));
      assert.equal(timings.length, 1);
      assert.match(timings[0], /symlink-registry \d+ms, middleware \d+ms, hmr \d+ms, listen \d+ms/);
    } finally {
      cap.restore();
      await other.stop();
    }
  });
});

describe("classifyFsError", () => {
  test("classifies by cause, not by raw fs text", () => {
    assert.equal(classifyFsError(Object.assign(new Error("x"), { code: "ENOENT" })), "missing");
    assert.equal(classifyFsError(Object.assign(new Error("x"), { code: "EACCES" })), "permission");
    assert.equal(classifyFsError(Object.assign(new Error("x"), { code: "ELOOP" })), "symlink-loop");
    assert.equal(classifyFsError(new Error("x")), "io");
    assert.equal(classifyFsError(null), "io");
  });
});

describe("stale strings and stray output", () => {
  test("no source file contains 'VERSION 0.3.5'", async () => {
    for (const file of await listTs(srcDir)) {
      const text = await fs.readFile(file, "utf8");
      assert.ok(!text.includes("VERSION 0.3.5"), `${file} still has a stale version string`);
    }
  });

  test("no server-side source calls console.* directly (only the logger, and browser-bound templates)", async () => {
    // Files whose console.* text is emitted into the browser, not printed by Node.
    const browserBound = new Set(["hmr-client-template.ts", "hmr-routes.ts"]);
    for (const file of await listTs(srcDir)) {
      if (browserBound.has(path.basename(file))) continue;
      if (path.basename(file) === "logger.ts") continue;
      const text = await fs.readFile(file, "utf8");
      assert.ok(!/console\.(log|warn|error|info|debug|time|timeEnd)\(/.test(text), `${file} calls console.*`);
    }
  });

  test("no server-side source contains emoji or pictograph characters", async () => {
    const pictograph = /[\u{1F300}-\u{1FAFF}☀-➿]/u;
    for (const file of await listTs(srcDir)) {
      if (path.basename(file) === "hmr-client-template.ts") continue;
      const text = await fs.readFile(file, "utf8");
      assert.ok(!pictograph.test(text), `${file} contains an emoji/pictograph`);
    }
  });
});

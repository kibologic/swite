/**
 * SWITE-007: a truthful launch banner and the same data as SwiteServer.info().
 */

import { test, describe, before, after } from "node:test";
import { strict as assert } from "node:assert";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { SwiteServer } from "../src/dev-engine/server.js";
import {
  formatBanner,
  listeningUrls,
  resolveFrameworkSource,
  safeTarget,
  type SwiteServerInfo,
} from "../src/dev-engine/server-info.js";
import { getSwiteVersion } from "../src/internal/version.js";
import { captureLogs, freePort, makeTestApp, type TestApp } from "./helpers/fixture.js";

const fakeInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
  lo: [
    { address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "", internal: true, cidr: null },
  ],
  eth0: [
    { address: "192.168.1.50", netmask: "255.255.255.0", family: "IPv4", mac: "", internal: false, cidr: null },
  ],
};

function infoFor(overrides: Partial<SwiteServerInfo> = {}): SwiteServerInfo {
  return {
    name: "@swissjs/swite",
    version: getSwiteVersion(),
    mode: "development",
    root: "/app",
    workspaceRoot: "/ws",
    host: "0.0.0.0",
    port: 6198,
    urls: listeningUrls("0.0.0.0", 6198, fakeInterfaces),
    hmrPort: 24678,
    core: { name: "@swissjs/core", version: "1.2.15", kind: "published", path: null },
    compiler: { name: "@swissjs/compiler", version: "1.3.0", kind: "linked", path: "/x/swiss-lib/compiler" },
    pythonTarget: "http://localhost:8000",
    readyMs: 312,
    ...overrides,
  };
}

describe("listeningUrls", () => {
  test("0.0.0.0 shows localhost AND the network address", () => {
    const urls = listeningUrls("0.0.0.0", 6198, fakeInterfaces);
    assert.deepEqual(urls.local, ["http://localhost:6198/"]);
    assert.deepEqual(urls.network, ["http://192.168.1.50:6198/"]);
  });

  test("loopback hosts show only that host", () => {
    assert.deepEqual(listeningUrls("127.0.0.1", 3000, fakeInterfaces), {
      local: ["http://127.0.0.1:3000/"],
      network: [],
    });
    assert.deepEqual(listeningUrls("localhost", 3000, fakeInterfaces).local, ["http://localhost:3000/"]);
  });

  test("a specific interface address is reported as itself, not as localhost", () => {
    const urls = listeningUrls("192.168.1.50", 3000, fakeInterfaces);
    assert.deepEqual(urls.local, []);
    assert.deepEqual(urls.network, ["http://192.168.1.50:3000/"]);
  });
});

describe("formatBanner", () => {
  test("carries version, mode, port, network line, framework sources; at most 8 lines", () => {
    const lines = formatBanner(infoFor());
    const text = lines.join("\n");
    assert.ok(lines.length <= 8, text);
    assert.ok(text.includes(getSwiteVersion()));
    assert.match(text, /development/);
    assert.match(text, /Local\s+http:\/\/localhost:6198\//);
    assert.match(text, /Network\s+http:\/\/192\.168\.1\.50:6198\//);
    assert.match(text, /ready in 312ms/);
    assert.match(text, /core\s+published 1\.2\.15/);
    assert.match(text, /compiler\s+linked \/x\/swiss-lib\/compiler \(1\.3\.0\)/);
    assert.match(text, /Python\s+http:\/\/localhost:8000/);
  });

  test("the banner version equals package.json", async () => {
    const pkg = JSON.parse(
      await fs.readFile(new URL("../package.json", import.meta.url), "utf-8"),
    ) as { version: string };
    assert.equal(getSwiteVersion(), pkg.version);
    assert.ok(formatBanner(infoFor())[0].startsWith(`swite ${pkg.version}`));
  });

  test("worst case still fits in 8 lines", () => {
    const lines = formatBanner(
      infoFor({
        urls: { local: ["http://localhost:1/", "http://127.0.0.1:1/"], network: ["http://a:1/", "http://b:1/"] },
      }),
    );
    assert.ok(lines.length <= 8);
  });
});

describe("safeTarget", () => {
  test("strips credentials and trailing slash; rejects garbage", () => {
    assert.equal(safeTarget("http://user:pw@localhost:8000/"), "http://localhost:8000");
    assert.equal(safeTarget("not a url"), null);
    assert.equal(safeTarget(undefined), null);
  });
});

describe("resolveFrameworkSource", () => {
  let fx: TestApp;
  before(async () => {
    fx = await makeTestApp();
  });
  after(async () => {
    await fx.cleanup();
  });

  test("a normal install is reported as published, with its version", async () => {
    const src = await resolveFrameworkSource(fx.app, "@swissjs/core");
    assert.equal(src.kind, "published");
    assert.equal(src.version, "1.2.15");
    assert.equal(src.path, null);
  });

  test("a link that resolves outside node_modules is reported as linked, with the path", async () => {
    const target = path.join(fx.base, "swiss-lib", "compiler");
    await fs.mkdir(target, { recursive: true });
    await fs.writeFile(
      path.join(target, "package.json"),
      JSON.stringify({ name: "@swissjs/compiler", version: "9.9.9-dev" }),
    );
    await fs.symlink(target, path.join(fx.base, "node_modules", "@swissjs", "compiler"), "junction");
    const src = await resolveFrameworkSource(fx.app, "@swissjs/compiler");
    assert.equal(src.kind, "linked");
    assert.equal(src.version, "9.9.9-dev");
    assert.equal(path.resolve(src.path ?? ""), await fs.realpath(target));
  });

  test("a package that is not installed is unresolved, not invented", async () => {
    const src = await resolveFrameworkSource(fx.app, "@swissjs/nope");
    assert.deepEqual(src, { name: "@swissjs/nope", version: null, kind: "unresolved", path: null });
  });
});

describe("banner and info() from a real start", () => {
  let fx: TestApp;
  let server: SwiteServer;
  let port: number;
  let bannerLines: string[];

  before(async () => {
    fx = await makeTestApp();
    port = await freePort();
    server = new SwiteServer({
      root: fx.app,
      port,
      host: "0.0.0.0",
      hmrPort: await freePort(),
    });
    const cap = captureLogs("info");
    await server.start();
    bannerLines = [...cap.lines];
    cap.restore();
  });
  after(async () => {
    await server.stop();
    await fx.cleanup();
  });

  test("host 0.0.0.0: banner has the real port and does not claim localhost as the only address", () => {
    const text = bannerLines.join("\n");
    assert.ok(text.includes(`:${port}/`), text);
    const hasExternalIPv4 = Object.values(os.networkInterfaces()).some((list) =>
      (list ?? []).some((a) => a.family === "IPv4" && !a.internal),
    );
    if (hasExternalIPv4) assert.match(text, /Network\s+http:\/\/\d+\.\d+\.\d+\.\d+:\d+\//);
    assert.ok(bannerLines.length <= 8, text);
    assert.ok(!/console\.time|: \d+\.\d+ms/.test(text), "no raw console.time output");
  });

  test("banner framework lines match what resolves from the app", () => {
    const text = bannerLines.join("\n");
    assert.match(text, /core\s+published 1\.2\.15/);
    assert.match(text, /compiler\s+not resolved from node_modules/);
  });

  test("info() returns the same data the banner printed", () => {
    const info = server.info();
    assert.equal(info.version, getSwiteVersion());
    assert.equal(info.port, port);
    assert.equal(info.host, "0.0.0.0");
    assert.equal(info.mode, "development");
    assert.equal(info.core.kind, "published");
    assert.equal(info.core.version, "1.2.15");
    assert.deepEqual(formatBanner(info), bannerLines);
    assert.equal(typeof info.readyMs, "number");
    assert.ok(info.hmrPort && info.hmrPort > 0);
    assert.equal(info.workspaceRoot, fx.base);
  });

  test("before start(), info() has no ready time and no invented framework source", () => {
    const fresh = new SwiteServer({ root: fx.app, port: 1234, host: "127.0.0.1" });
    const info = fresh.info();
    assert.equal(info.readyMs, null);
    assert.equal(info.core.kind, "unresolved");
    assert.deepEqual(info.urls.local, ["http://127.0.0.1:1234/"]);
  });
});

/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * What Swite knows about itself at startup (SWITE-007): its version, mode,
 * where it listens, and which @swissjs framework code it actually resolved.
 * The same object feeds the launch banner and SwiteServer.info(), so a host
 * app can print or serve it instead of hard-coding a port.
 */

import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { getSwiteVersion } from "../internal/version.js";

export interface FrameworkSource {
  name: string;
  /** Version from the resolved package.json, or null when unresolved. */
  version: string | null;
  /** "published" = installed from a registry; "linked" = resolves outside node_modules. */
  kind: "published" | "linked" | "unresolved";
  /** Real path of the resolved package (only set for linked). */
  path: string | null;
}

export interface SwiteServerInfo {
  name: "@swissjs/swite";
  version: string;
  mode: "development" | "production";
  root: string;
  workspaceRoot: string | null;
  host: string;
  port: number;
  urls: { local: string[]; network: string[] };
  hmrPort: number | null;
  core: FrameworkSource;
  compiler: FrameworkSource;
  /** Configured Python proxy target, credentials removed; null when none. */
  pythonTarget: string | null;
  /** Milliseconds from start() to listening; null before the server is ready. */
  readyMs: number | null;
}

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function urlFor(host: string, port: number): string {
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `http://${h}:${port}/`;
}

/** Build the URLs a person can open, from the address the server truly bound. */
export function listeningUrls(
  host: string,
  port: number,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): { local: string[]; network: string[] } {
  if (WILDCARD_HOSTS.has(host)) {
    const network: string[] = [];
    for (const list of Object.values(interfaces)) {
      for (const addr of list ?? []) {
        if (addr.family === "IPv4" && !addr.internal) network.push(urlFor(addr.address, port));
      }
    }
    return { local: [urlFor("localhost", port)], network };
  }
  if (LOOPBACK_HOSTS.has(host)) return { local: [urlFor(host, port)], network: [] };
  // A specific interface address.
  return { local: [], network: [urlFor(host, port)] };
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve where `packageName` is installed for the app at `root`, walking up
 * node_modules the way Node would, and classify it from the realpath alone
 * (no git): a real path inside a node_modules directory is published; a real
 * path outside one means the package was linked to a working copy.
 */
export async function resolveFrameworkSource(
  root: string,
  packageName: string,
): Promise<FrameworkSource> {
  let current = path.resolve(root);
  for (let i = 0; i < 12; i++) {
    const candidate = path.join(current, "node_modules", packageName);
    if (await exists(path.join(candidate, "package.json"))) {
      const real = await fs.realpath(candidate);
      let version: string | null = null;
      try {
        const pkg = JSON.parse(await fs.readFile(path.join(real, "package.json"), "utf-8")) as {
          version?: string;
        };
        version = pkg.version ?? null;
      } catch {
        /* version stays null */
      }
      const inNodeModules = real.split(path.sep).includes("node_modules");
      return {
        name: packageName,
        version,
        kind: inNodeModules ? "published" : "linked",
        path: inNodeModules ? null : real,
      };
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return { name: packageName, version: null, kind: "unresolved", path: null };
}

/** Strip credentials from a URL so it is safe to print. */
export function safeTarget(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    u.username = "";
    u.password = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function describeSource(src: FrameworkSource): string {
  switch (src.kind) {
    case "published":
      return `published ${src.version ?? "?"}`;
    case "linked":
      return `linked ${(src.path ?? "").replace(/\\/g, "/")}${src.version ? ` (${src.version})` : ""}`;
    default:
      return "not resolved from node_modules";
  }
}

/** The launch banner. At most 8 lines. */
export function formatBanner(info: SwiteServerInfo): string[] {
  const lines: string[] = [];
  const ready = info.readyMs === null ? "" : `  ready in ${info.readyMs}ms`;
  lines.push(`swite ${info.version}  ${info.mode}${ready}`);
  info.urls.local.forEach((u, i) => lines.push(`  ${i === 0 ? "Local  " : "       "}  ${u}`));
  if (info.urls.network.length > 0) {
    lines.push(`  Network  ${info.urls.network[0]}`);
  }
  const ws =
    info.workspaceRoot && info.workspaceRoot !== info.root
      ? `  (workspace ${info.workspaceRoot})`
      : "";
  lines.push(`  Root     ${info.root}${ws}`);
  lines.push(`  HMR      ${info.hmrPort === null ? "off" : `ws port ${info.hmrPort}`}`);
  lines.push(`  core     ${describeSource(info.core)}`);
  lines.push(`  compiler ${describeSource(info.compiler)}`);
  if (info.pythonTarget) lines.push(`  Python   ${info.pythonTarget} (proxy)`);
  return lines.slice(0, 8);
}

export function emptySource(name: string): FrameworkSource {
  return { name, version: null, kind: "unresolved", path: null };
}

export function baseInfo(fields: { root: string; host: string; port: number }): SwiteServerInfo {
  return {
    name: "@swissjs/swite",
    version: getSwiteVersion(),
    mode: process.env["NODE_ENV"] === "production" ? "production" : "development",
    root: fields.root,
    workspaceRoot: null,
    host: fields.host,
    port: fields.port,
    urls: listeningUrls(fields.host, fields.port),
    hmrPort: null,
    core: emptySource("@swissjs/core"),
    compiler: emptySource("@swissjs/compiler"),
    pythonTarget: null,
    readyMs: null,
  };
}

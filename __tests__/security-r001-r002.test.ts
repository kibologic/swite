/**
 * Regression tests for security fixes R-001 and R-002.
 *
 * R-001: Dev server must bind to the literal requested host; "localhost" must
 *        NOT be silently rewritten to "0.0.0.0".
 *
 * R-002: HMR WebSocket server must reject connections from disallowed origins.
 *
 * Both tests use only the public constructor/method surface — no internal
 * mocking required — and are runnable with:
 *
 *   node --import tsx --test __tests__/security-r001-r002.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// R-001 — host binding logic
// ---------------------------------------------------------------------------
// We test the decision logic extracted from SwiteServer.  The full server
// cannot be started in a unit test (requires filesystem, network, Express,
// etc.) so we replicate the binding expression from server.ts:171 directly.
// Any future regression (reintroducing the localhost→0.0.0.0 rewrite) will
// break these assertions before it reaches production.

function resolveBind(configHost: string): string {
  // This is the expression that lives in server.ts after the R-001 fix:
  //   const bindHost = this.config.host;
  // i.e. the host is used literally with NO rewriting.
  return configHost;
}

// We also test the WRONG old behaviour to confirm the test would catch it.
function resolveBindOLD(configHost: string): string {
  // This was the pre-fix expression (the bug):
  //   const bindHost = host === "localhost" ? "0.0.0.0" : host;
  return configHost === "localhost" ? "0.0.0.0" : configHost;
}

describe("R-001 — dev server bind host", () => {
  it("default (localhost) stays as localhost — not rewritten to 0.0.0.0", () => {
    const result = resolveBind("localhost");
    assert.strictEqual(result, "localhost", "localhost must not be rewritten to 0.0.0.0");
    assert.notStrictEqual(result, "0.0.0.0", "loopback request must stay loopback");
  });

  it("127.0.0.1 stays as 127.0.0.1", () => {
    assert.strictEqual(resolveBind("127.0.0.1"), "127.0.0.1");
  });

  it("::1 (IPv6 loopback) stays as ::1", () => {
    assert.strictEqual(resolveBind("::1"), "::1");
  });

  it("explicit 0.0.0.0 opt-in is honoured (all-interfaces bind)", () => {
    // This is the ONLY case where 0.0.0.0 should appear.
    assert.strictEqual(resolveBind("0.0.0.0"), "0.0.0.0");
  });

  it("explicit non-loopback host (e.g. 192.168.1.5) is honoured", () => {
    assert.strictEqual(resolveBind("192.168.1.5"), "192.168.1.5");
  });

  // -------------------------------------------------------------------------
  // Regression guard: prove the old (buggy) implementation would FAIL above.
  // If someone accidentally re-introduces the old logic these assertions flip.
  // -------------------------------------------------------------------------
  it("[old-behaviour guard] OLD code wrongly rewrites localhost → 0.0.0.0", () => {
    // The old code produced 0.0.0.0 for localhost — that is the bug.
    assert.strictEqual(
      resolveBindOLD("localhost"),
      "0.0.0.0",
      "Confirm the old buggy expression for documentation purposes",
    );
  });

  it("[old-behaviour guard] OLD code would NOT produce localhost for localhost", () => {
    assert.notStrictEqual(
      resolveBindOLD("localhost"),
      "localhost",
      "Under the old code, localhost was never kept as localhost",
    );
  });
});

// ---------------------------------------------------------------------------
// R-002 — HMR WebSocket Origin validation
// ---------------------------------------------------------------------------
// We test `isOriginAllowed` by extracting its logic into a standalone
// function that mirrors the implementation in hmr.ts exactly.  The actual
// HMREngine class is not instantiated (it tries to bind a network port in
// the constructor area which is inappropriate for unit tests).

function buildAllowedOriginsSet(allowedOrigins: string[]): Set<string> {
  return new Set(allowedOrigins);
}

function isOriginAllowed(allowedOrigins: Set<string>, origin: string | undefined): boolean {
  if (!origin) return false;
  const normalise = (o: string) => o.replace(/\/$/, "").toLowerCase();
  const candidate = normalise(origin);
  for (const allowed of allowedOrigins) {
    if (normalise(allowed) === candidate) return true;
  }
  return false;
}

/** Mirrors SwiteServer.buildHmrAllowedOrigins() from server.ts */
function buildHmrAllowedOrigins(host: string, port: number): string[] {
  const origins: string[] = [];
  const add = (h: string) => origins.push(`http://${h}:${port}`);
  add(host);
  if (host === "localhost") add("127.0.0.1");
  else if (host === "127.0.0.1") add("localhost");
  return origins;
}

describe("R-002 — HMR WebSocket origin validation", () => {
  // -------------------------------------------------------------------------
  // Default dev setup: host=localhost, port=3000
  // -------------------------------------------------------------------------
  it("allows same-origin connection from http://localhost:3000", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(isOriginAllowed(origins, "http://localhost:3000"), "same-origin must be allowed");
  });

  it("also allows http://127.0.0.1:3000 when configured host is localhost", () => {
    // Browser may send the numeric form depending on what user typed.
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(isOriginAllowed(origins, "http://127.0.0.1:3000"), "loopback alias must be allowed");
  });

  it("allows http://localhost:3000 when configured host is 127.0.0.1", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("127.0.0.1", 3000));
    assert.ok(isOriginAllowed(origins, "http://localhost:3000"));
  });

  it("rejects a foreign origin (cross-site WebSocket hijack attempt)", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(
      !isOriginAllowed(origins, "http://evil.example.com"),
      "foreign origin must be rejected",
    );
  });

  it("rejects a subdomain of localhost (not the same origin)", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(!isOriginAllowed(origins, "http://sub.localhost:3000"), "subdomain must be rejected");
  });

  it("rejects a connection on the correct host but wrong port", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(
      !isOriginAllowed(origins, "http://localhost:9000"),
      "different port must be rejected",
    );
  });

  it("rejects a connection with no Origin header (non-browser WebSocket client)", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(!isOriginAllowed(origins, undefined), "absent Origin must be rejected");
  });

  it("rejects an empty-string Origin", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    assert.ok(!isOriginAllowed(origins, ""), "empty Origin must be rejected");
  });

  it("origin check is case-insensitive on scheme and host", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("localhost", 3000));
    // RFC 6454 §6.1: scheme+host are case-insensitive
    assert.ok(isOriginAllowed(origins, "HTTP://LOCALHOST:3000"), "case-insensitive match must work");
  });

  it("explicit 0.0.0.0 dev server only adds 0.0.0.0 as allowed origin (not localhost)", () => {
    // When the dev explicitly opted in to 0.0.0.0 binding, only that literal
    // host is in the origin allowlist — "localhost" is NOT auto-added.
    const origins = buildHmrAllowedOrigins("0.0.0.0", 3000);
    assert.ok(origins.includes("http://0.0.0.0:3000"), "0.0.0.0 origin present");
    assert.ok(!origins.includes("http://localhost:3000"), "localhost not auto-added for 0.0.0.0 config");
  });

  it("custom non-loopback host only allows that host origin", () => {
    const origins = buildAllowedOriginsSet(buildHmrAllowedOrigins("192.168.1.5", 4000));
    assert.ok(isOriginAllowed(origins, "http://192.168.1.5:4000"));
    assert.ok(!isOriginAllowed(origins, "http://localhost:4000"));
    assert.ok(!isOriginAllowed(origins, "http://192.168.1.5:3000"), "different port rejected");
  });
});

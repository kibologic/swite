/**
 * SWITE-002: the one internal logger.
 * Levels, quiet-by-default info, colour rules, text-only markers.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import { strict as assert } from "node:assert";
import path from "node:path";
import {
  configureLogger,
  getLogger,
  getLoggerOptions,
  isDebug,
  relPath,
  resolveLoggerOptions,
  setLogRoot,
  type LogSink,
} from "../src/internal/logger.js";

const ANSI = /\u001b\[/;
// U+1F300-U+1FAFF and U+2600-U+27BF (pictographs, dingbats)
const PICTOGRAPH = /[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u;

function capture(): { lines: string[]; sink: LogSink } {
  const lines: string[] = [];
  return { lines, sink: { write: (_s, l) => lines.push(l) } };
}

describe("logger levels", () => {
  let cap: ReturnType<typeof capture>;
  const before = { ...getLoggerOptions() };
  beforeEach(() => {
    cap = capture();
    configureLogger({ color: false, timestamps: false, sink: cap.sink, level: "info" });
  });
  afterEach(() => configureLogger(before));

  test("at info, debug() writes nothing; at debug it writes", () => {
    const log = getLogger("t");
    log.debug("hidden");
    assert.equal(cap.lines.length, 0);
    configureLogger({ level: "debug" });
    log.debug("shown");
    assert.equal(cap.lines.length, 1);
    assert.match(cap.lines[0], /shown/);
  });

  test("at warn, info() writes nothing but warn() and error() do", () => {
    configureLogger({ level: "warn" });
    const log = getLogger("t");
    log.info("no");
    log.warn("yes");
    log.error("yes too");
    assert.equal(cap.lines.length, 2);
    assert.match(cap.lines[0], /WARN/);
    assert.match(cap.lines[1], /ERROR/);
  });

  test("error is always visible and trace only at trace", () => {
    configureLogger({ level: "error" });
    const log = getLogger("t");
    log.warn("w");
    log.error("e");
    assert.equal(cap.lines.length, 1);
    configureLogger({ level: "debug" });
    log.trace("t");
    assert.equal(cap.lines.length, 1);
    configureLogger({ level: "trace" });
    log.trace("t");
    assert.equal(cap.lines.length, 2);
  });

  test("isDebug() follows the level", () => {
    assert.equal(isDebug(), false);
    configureLogger({ level: "debug" });
    assert.equal(isDebug(), true);
  });

  test("every line has a level word or scope tag and no emoji", () => {
    configureLogger({ level: "trace" });
    const log = getLogger("hmr");
    log.error("a");
    log.warn("b");
    log.info("c");
    log.debug("d");
    log.trace("e");
    assert.equal(cap.lines.length, 5);
    for (const line of cap.lines) {
      assert.match(line, /(ERROR|WARN|DEBUG|TRACE|\[hmr\])/);
      assert.doesNotMatch(line, PICTOGRAPH);
    }
  });

  test("an Error argument prints its message; the stack only at debug", () => {
    const log = getLogger("t");
    const err = new Error("boom");
    log.error("failed:", err);
    assert.equal(cap.lines.length, 1);
    assert.match(cap.lines[0], /failed: boom/);
    assert.doesNotMatch(cap.lines[0], /\n\s+at /);
    configureLogger({ level: "debug" });
    log.error("failed:", err);
    assert.match(cap.lines[1], /\n\s+at /);
  });

  test("warnOnce reports a key only once", () => {
    const log = getLogger("t");
    log.warnOnce("k-unique-1", "first");
    log.warnOnce("k-unique-1", "second");
    assert.equal(cap.lines.length, 1);
    assert.match(cap.lines[0], /WARN .*first/);
  });

  test("timestamps are added when enabled", () => {
    configureLogger({ timestamps: true });
    getLogger("t").info("x");
    assert.match(cap.lines[0], /^\d\d:\d\d:\d\d\.\d{3} /);
  });
});

describe("logger colour", () => {
  const before = { ...getLoggerOptions() };
  afterEach(() => configureLogger(before));

  test("color=false yields no ANSI escape, even for error", () => {
    const cap = capture();
    configureLogger({ color: false, timestamps: false, sink: cap.sink, level: "info" });
    getLogger("t").error("x");
    getLogger("t").warn("x");
    for (const l of cap.lines) assert.doesNotMatch(l, ANSI);
  });

  test("color=true yields ANSI escapes", () => {
    const cap = capture();
    configureLogger({ color: true, timestamps: false, sink: cap.sink, level: "info" });
    getLogger("t").error("x");
    assert.match(cap.lines[0], ANSI);
  });
});

describe("resolveLoggerOptions", () => {
  const tty = { argv: [] as string[], env: {} as Record<string, string>, stdoutIsTTY: true };

  test("defaults: info, colour on for a TTY, timestamps off on a TTY", () => {
    const r = resolveLoggerOptions(tty);
    assert.deepEqual(r, { level: "info", color: true, timestamps: false });
  });

  test("non-TTY: colour off, timestamps on", () => {
    const r = resolveLoggerOptions({ ...tty, stdoutIsTTY: false });
    assert.equal(r.color, false);
    assert.equal(r.timestamps, true);
  });

  test("NO_COLOR disables colour on a TTY", () => {
    assert.equal(resolveLoggerOptions({ ...tty, env: { NO_COLOR: "1" } }).color, false);
  });

  test("FORCE_COLOR enables colour on a non-TTY; FORCE_COLOR=0 disables", () => {
    assert.equal(
      resolveLoggerOptions({ ...tty, stdoutIsTTY: false, env: { FORCE_COLOR: "1" } }).color,
      true,
    );
    assert.equal(resolveLoggerOptions({ ...tty, env: { FORCE_COLOR: "0" } }).color, false);
  });

  test("--no-color beats FORCE_COLOR", () => {
    const r = resolveLoggerOptions({ ...tty, argv: ["--no-color"], env: { FORCE_COLOR: "1" } });
    assert.equal(r.color, false);
  });

  test("--verbose / -v selects debug, --quiet / -q selects warn", () => {
    assert.equal(resolveLoggerOptions({ ...tty, argv: ["--verbose"] }).level, "debug");
    assert.equal(resolveLoggerOptions({ ...tty, argv: ["-v"] }).level, "debug");
    assert.equal(resolveLoggerOptions({ ...tty, argv: ["--quiet"] }).level, "warn");
    assert.equal(resolveLoggerOptions({ ...tty, argv: ["-q"] }).level, "warn");
  });

  test("SWITE_DEBUG=1 still yields debug (compatibility)", () => {
    assert.equal(resolveLoggerOptions({ ...tty, env: { SWITE_DEBUG: "1" } }).level, "debug");
  });

  test("SWITE_LOG_LEVEL is honoured; CLI flag wins over env", () => {
    assert.equal(resolveLoggerOptions({ ...tty, env: { SWITE_LOG_LEVEL: "warn" } }).level, "warn");
    const r = resolveLoggerOptions({
      ...tty,
      argv: ["--verbose"],
      env: { SWITE_LOG_LEVEL: "error" },
    });
    assert.equal(r.level, "debug");
  });

  test("an invalid SWITE_LOG_LEVEL is ignored", () => {
    assert.equal(resolveLoggerOptions({ ...tty, env: { SWITE_LOG_LEVEL: "loud" } }).level, "info");
  });
});

describe("relPath", () => {
  const before = { ...getLoggerOptions() };
  afterEach(() => configureLogger(before));

  test("paths under the root become root-relative with forward slashes", () => {
    const root = path.resolve("/tmp/app-root");
    setLogRoot(root);
    assert.equal(relPath(path.join(root, "src", "a.ui")), "src/a.ui");
    assert.equal(relPath(root), ".");
  });

  test("paths a few levels above the root stay relative; far away stay absolute", () => {
    const root = path.resolve("/tmp/a/b/c/d/e/f/root");
    setLogRoot(root);
    assert.equal(relPath(path.resolve(root, "../../node_modules/x.js")), "../../node_modules/x.js");
    assert.ok(!relPath(path.resolve(root, "../../../../../../elsewhere/x.js")).startsWith(".."));
  });

  test("relative input is only normalised", () => {
    assert.equal(relPath("src\\a.ui"), "src/a.ui");
  });
});

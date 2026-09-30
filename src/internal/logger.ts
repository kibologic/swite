/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 *
 * The one internal logger. Levels, a single sink, colour control.
 *
 * Rules (SWITE-002):
 *  - Level and status are carried by TEXT (ERROR, WARN, 404), never by colour
 *    or a glyph alone. No emoji is ever written.
 *  - Colour is on only for a TTY, off for NO_COLOR / --no-color, forced by
 *    FORCE_COLOR. The global chalk instance follows the same decision, so
 *    any remaining direct chalk use degrades the same way.
 *  - Default level is "info": banner, one line per request, warnings, errors.
 *    Everything else is "debug" and appears only with --verbose.
 *  - All output goes through one sink so tests (and a future overlay/JSON
 *    formatter, SWITE-005) can capture it.
 */

import path from "node:path";
import { inspect } from "node:util";
import chalk, { Chalk } from "chalk";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace";

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const LEVEL_WORD: Record<LogLevel, string> = {
  error: "ERROR",
  warn: "WARN ",
  info: "",
  debug: "DEBUG",
  trace: "TRACE",
};

export interface LogSink {
  write(stream: "out" | "err", line: string): void;
}

export interface LoggerOptions {
  level: LogLevel;
  color: boolean;
  timestamps: boolean;
  sink: LogSink;
  /** Root used to shorten absolute paths in messages. */
  root: string | null;
}

/** Inputs to resolveLoggerOptions - injectable so it can be unit tested. */
export interface LoggerEnvironment {
  argv: readonly string[];
  env: Record<string, string | undefined>;
  stdoutIsTTY: boolean;
}

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && value in LEVEL_ORDER;
}

/**
 * Pure resolution of level / colour / timestamps from CLI flags and env.
 * Precedence for level: CLI flag > SWITE_LOG_LEVEL > SWITE_DEBUG=1 > info.
 */
export function resolveLoggerOptions(
  input: LoggerEnvironment,
): Pick<LoggerOptions, "level" | "color" | "timestamps"> {
  const { argv, env } = input;
  const has = (...flags: string[]) => flags.some((f) => argv.includes(f));

  let level: LogLevel = "info";
  const envLevel = env["SWITE_LOG_LEVEL"]?.toLowerCase();
  if (isLogLevel(envLevel)) level = envLevel;
  else if (env["SWITE_DEBUG"] === "1") level = "debug";
  // CLI flags win over env. --verbose beats --quiet if both are given.
  if (has("--quiet", "-q")) level = "warn";
  if (has("--verbose", "-v")) level = "debug";

  // Colour: --no-color > NO_COLOR > FORCE_COLOR > TTY
  let color = input.stdoutIsTTY;
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "") {
    color = force !== "0" && force.toLowerCase() !== "false";
  }
  const noColor = env["NO_COLOR"];
  if (noColor !== undefined && noColor !== "") color = false;
  if (has("--no-color")) color = false;

  // Timestamps: off on a TTY (keeps lines short), on when output is piped.
  let timestamps = !input.stdoutIsTTY;
  const timeEnv = env["SWITE_LOG_TIME"];
  if (timeEnv === "1") timestamps = true;
  if (timeEnv === "0") timestamps = false;
  if (has("--timestamps")) timestamps = true;

  return { level, color, timestamps };
}

const defaultSink: LogSink = {
  write(stream, line) {
    (stream === "err" ? process.stderr : process.stdout).write(line + "\n");
  },
};

let state: LoggerOptions = {
  ...resolveLoggerOptions({
    argv: [],
    env: process.env,
    stdoutIsTTY: Boolean(process.stdout.isTTY),
  }),
  sink: defaultSink,
  root: null,
};
let paint = new Chalk({ level: state.color ? 1 : 0 });
syncChalk();

function syncChalk(): void {
  paint = new Chalk({ level: state.color ? 1 : 0 });
  // Direct chalk use elsewhere follows the same decision.
  chalk.level = state.color ? (chalk.level > 0 ? chalk.level : 1) : 0;
}

export function configureLogger(options: Partial<LoggerOptions>): void {
  state = { ...state, ...options };
  syncChalk();
}

/** Configure from process argv and env (used by the CLI). */
export function configureLoggerFromProcess(argv: readonly string[]): void {
  configureLogger(
    resolveLoggerOptions({
      argv,
      env: process.env,
      stdoutIsTTY: Boolean(process.stdout.isTTY),
    }),
  );
}

export function getLoggerOptions(): Readonly<LoggerOptions> {
  return state;
}

export function getLogLevel(): LogLevel {
  return state.level;
}

export function isLevelEnabled(level: LogLevel): boolean {
  return LEVEL_ORDER[level] <= LEVEL_ORDER[state.level];
}

/** True when debug output is wanted (replaces direct SWITE_DEBUG reads). */
export function isDebug(): boolean {
  return isLevelEnabled("debug");
}

export function setLogRoot(root: string | null): void {
  state = { ...state, root };
}

/**
 * Shorten an absolute path for display: relative to the configured root (or
 * cwd), forward slashes. Up to four levels above the root stay relative;
 * anything further away (or on another drive) is shown absolute, normalised.
 */
export function relPath(p: string): string {
  if (!p || !path.isAbsolute(p)) return p.replace(/\\/g, "/");
  const base = state.root ?? process.cwd();
  const rel = path.relative(base, p);
  if (rel === "") return ".";
  if (path.isAbsolute(rel)) return p.replace(/\\/g, "/"); // another drive
  const up = rel.split(/[\\/]/).filter((s) => s === "..").length;
  // Near the root, relative is clearer ("../../node_modules/x"); far away, keep it absolute.
  if (up <= 4) return rel.replace(/\\/g, "/");
  return p.replace(/\\/g, "/");
}

const ANSI_RE = /\u001b\[[0-9;]*m/g;
export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function formatExtra(extra: unknown, withStack: boolean): string {
  if (extra instanceof Error) {
    const head = extra.message;
    if (withStack && extra.stack) {
      const stack = extra.stack.split("\n").slice(1).join("\n");
      return stack ? `${head}\n${stack}` : head;
    }
    return head;
  }
  if (typeof extra === "string") return extra;
  return inspect(extra, { depth: 2, breakLength: Infinity });
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function colourLevel(level: LogLevel, text: string): string {
  switch (level) {
    case "error":
      return paint.red(text);
    case "warn":
      return paint.yellow(text);
    case "debug":
    case "trace":
      return paint.gray(text);
    default:
      return text;
  }
}

function emit(level: LogLevel, body: string, scope: string | null): void {
  if (!isLevelEnabled(level)) return;
  const word = LEVEL_WORD[level];
  const parts: string[] = [];
  if (state.timestamps) parts.push(paint.gray(timestamp()));
  if (word) parts.push(colourLevel(level, word));
  if (scope) parts.push(paint.gray(`[${scope}]`));
  parts.push(level === "debug" || level === "trace" ? paint.gray(body) : body);
  const stream = level === "error" || level === "warn" ? "err" : "out";
  state.sink.write(stream, parts.join(" "));
}

export interface Logger {
  readonly scope: string | null;
  error(message: string, ...extra: unknown[]): void;
  warn(message: string, ...extra: unknown[]): void;
  info(message: string, ...extra: unknown[]): void;
  debug(message: string, ...extra: unknown[]): void;
  trace(message: string, ...extra: unknown[]): void;
  /** Like warn(), but a given key is only ever reported once per process. */
  warnOnce(key: string, message: string): void;
  /**
   * Write a caller-formatted line (banner, request line). The level word is
   * still added for warn/error/debug; no scope tag is added.
   */
  out(level: LogLevel, text: string): void;
  isEnabled(level: LogLevel): boolean;
  child(scope: string): Logger;
}

const warned = new Set<string>();

function makeLogger(scope: string | null): Logger {
  const at =
    (level: LogLevel) =>
    (message: string, ...extra: unknown[]): void => {
      if (!isLevelEnabled(level)) return;
      const withStack = isLevelEnabled("debug");
      const tail = extra.map((e) => formatExtra(e, withStack));
      const body = tail.length ? `${message} ${tail.join(" ")}` : message;
      emit(level, body, scope);
    };
  return {
    scope,
    error: at("error"),
    warn: at("warn"),
    info: at("info"),
    debug: at("debug"),
    trace: at("trace"),
    warnOnce(key, message) {
      if (warned.has(key)) return;
      warned.add(key);
      at("warn")(message);
    },
    out(level, text) {
      emit(level, text, null);
    },
    isEnabled: isLevelEnabled,
    child: (s) => makeLogger(s),
  };
}

/** Get a scoped logger, e.g. getLogger("hmr"). */
export function getLogger(scope: string): Logger {
  return makeLogger(scope);
}

/** Unscoped logger for banner / lifecycle lines. */
export const logger: Logger = makeLogger("swite");

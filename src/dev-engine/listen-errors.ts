/*
 * Copyright (c) 2024 Themba Mzumara
 * SWITE - SWISS Development Server
 * Licensed under the MIT License.
 */

import net from "node:net";

/** The HTTP port is already taken. Carries a message meant to be printed as-is. */
export class SwitePortInUseError extends Error {
  readonly port: number;
  readonly host: string;
  readonly code = "EADDRINUSE";

  constructor(port: number, host: string) {
    super(
      `Port ${port} is already in use (host ${host}). ` +
        `Stop the other process or set PORT / server.port.`,
    );
    this.name = "SwitePortInUseError";
    this.port = port;
    this.host = host;
    Object.setPrototypeOf(this, SwitePortInUseError.prototype);
  }
}

/** The HTTP server could not bind for a reason other than a busy port. */
export class SwiteListenError extends Error {
  readonly port: number;
  readonly host: string;
  readonly code: string | undefined;

  constructor(port: number, host: string, cause: NodeJS.ErrnoException) {
    super(`Cannot listen on ${host}:${port} (${cause.code ?? "error"}): ${cause.message}`);
    this.name = "SwiteListenError";
    this.port = port;
    this.host = host;
    this.code = cause.code;
    Object.setPrototypeOf(this, SwiteListenError.prototype);
  }
}

/**
 * Fail fast: check that the HTTP port can be bound before starting anything
 * else (HMR socket, watchers), so a busy port produces one clear message and
 * leaves nothing behind. The real listen() still handles the race where the
 * port is taken between this check and the bind.
 */
export function assertPortFree(port: number, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      reject(err.code === "EADDRINUSE" ? new SwitePortInUseError(port, host) : new SwiteListenError(port, host, err));
    });
    probe.once("listening", () => probe.close(() => resolve()));
    probe.listen(port, host);
  });
}

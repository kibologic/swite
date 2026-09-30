export class SwiteProxyError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(status: number, message: string, responseBody?: unknown) {
    super(message);
    this.name = "SwiteProxyError";
    this.status = status;
    this.responseBody = responseBody ?? null;
    Object.setPrototypeOf(this, SwiteProxyError.prototype);
  }
}

/** Base for failures where no usable HTTP response came back from Python. */
export abstract class SwiteProxyConnectionError extends Error {
  readonly target: string;
  readonly method: string;
  readonly path: string;

  constructor(message: string, target: string, method: string, path: string) {
    super(message);
    this.target = target;
    this.method = method;
    this.path = path;
  }
}

/** The Python service could not be reached (refused, DNS failure, reset). */
export class SwiteProxyUnreachableError extends SwiteProxyConnectionError {
  readonly code: string | null;

  constructor(target: string, method: string, path: string, code: string | null) {
    super(
      `Python service unreachable at ${target} (${method} ${path})${code ? `: ${code}` : ""}`,
      target,
      method,
      path,
    );
    this.name = "SwiteProxyUnreachableError";
    this.code = code;
    Object.setPrototypeOf(this, SwiteProxyUnreachableError.prototype);
  }
}

/** The Python service accepted the request but did not answer in time. */
export class SwiteProxyTimeoutError extends SwiteProxyConnectionError {
  readonly timeoutMs: number;

  constructor(target: string, method: string, path: string, timeoutMs: number) {
    super(
      `Python service at ${target} did not answer ${method} ${path} within ${timeoutMs}ms`,
      target,
      method,
      path,
    );
    this.name = "SwiteProxyTimeoutError";
    this.timeoutMs = timeoutMs;
    Object.setPrototypeOf(this, SwiteProxyTimeoutError.prototype);
  }
}

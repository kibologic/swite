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

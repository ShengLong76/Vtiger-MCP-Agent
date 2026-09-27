export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export class VtigerApiError extends Error {
  readonly code: string;
  readonly instanceId?: string;
  readonly httpStatus?: number;

  constructor(
    code: string,
    message: string,
    extras?: { instanceId?: string; httpStatus?: number },
  ) {
    super(message);
    this.name = "VtigerApiError";
    this.code = code;
    this.instanceId = extras?.instanceId;
    this.httpStatus = extras?.httpStatus;
  }
}

const SESSION_CODES = new Set([
  "INVALID_SESSIONID",
  "AUTHENTICATIONREQUIRED",
  "AUTHREQUIRED",
  "SESSIONID_EXPIRED",
]);

export function isSessionError(error: unknown): boolean {
  return error instanceof VtigerApiError && SESSION_CODES.has(error.code);
}

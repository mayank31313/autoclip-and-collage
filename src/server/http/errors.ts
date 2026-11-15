export type ErrorCode =
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "SSRF_BLOCKED"
  | "QUEUE_UNAVAILABLE"
  | "DEPENDENCY_UNAVAILABLE"
  | "JOB_FAILED"
  | "INTERNAL";

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorBody(err: unknown): {
  status: number;
  body: { error: { code: string; message: string; details?: unknown } };
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: { error: { code: err.code, message: err.message, details: err.details ?? {} } },
    };
  }
  // Unknown errors may carry secrets (connection strings etc.), so never echo them.
  return {
    status: 500,
    body: { error: { code: "INTERNAL", message: "Internal server error", details: {} } },
  };
}

export class GatewayError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

export class ProviderUnavailableError extends GatewayError {
  constructor(provider: string, detail?: string) {
    super(503, "provider_unavailable", `Provider '${provider}' is unavailable${detail ? `: ${detail}` : ""}`);
  }
}

export class ModelNotFoundError extends GatewayError {
  constructor(model: string) {
    super(404, "model_not_found", `Model '${model}' not found. Models must be namespaced as 'provider/native-id'.`);
  }
}

export class BadRequestError extends GatewayError {
  constructor(message: string) {
    super(400, "bad_request", message);
  }
}

export class ProviderError extends GatewayError {
  constructor(provider: string, message: string) {
    super(502, "provider_error", `[${provider}] ${message}`);
  }
}

export function toOpenAIError(err: unknown): { status: number; body: object } {
  if (err instanceof GatewayError) {
    return {
      status: err.status,
      body: { error: { message: err.message, type: err.code, code: err.code } },
    };
  }
  const code = typeof err === "object" && err !== null && "code" in err ? String((err as { code?: unknown }).code) : undefined;
  const message = err instanceof Error ? err.message : String(err);
  if (code === "NOT_FOUND" || message === "NOT_FOUND") {
    return {
      status: 404,
      body: { error: { message: "Not found", type: "not_found", code: "not_found" } },
    };
  }
  if (code === "BAD_REQUEST" || message === "Bad Request") {
    return {
      status: 400,
      body: { error: { message, type: "bad_request", code: "bad_request" } },
    };
  }
  return {
    status: 500,
    body: { error: { message, type: "internal_error", code: "internal_error" } },
  };
}

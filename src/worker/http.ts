import { ZodError, type ZodSchema } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function securityHeaders(headers = new Headers()): Headers {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  return headers;
}

export function json<T>(data: T, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify({ data }), { status, headers });
}

export function rawJson<T>(data: T, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = securityHeaders(new Headers(extraHeaders));
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

export function csv(text: string, filename: string): Response {
  const headers = securityHeaders();
  headers.set("Content-Type", "text/csv; charset=utf-8");
  headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  headers.set("Cache-Control", "no-store");
  return new Response(text, { headers });
}

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return rawJson({ error: error.message, details: error.details }, error.status);
  }
  if (error instanceof ZodError) {
    return rawJson({ error: "Validation failed", details: error.flatten() }, 422);
  }
  console.error(JSON.stringify({ message: "Unhandled request error", error: error instanceof Error ? error.message : String(error) }));
  return rawJson({ error: "Internal server error" }, 500);
}

export async function parseJson<T>(request: Request, schema: ZodSchema<T>): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > 1_000_000) {
    throw new HttpError(413, "Request body is too large.");
  }

  const payload = await request.json().catch(() => {
    throw new HttpError(400, "Request body must be valid JSON.");
  });
  return schema.parse(payload);
}

export function methodNotAllowed(): Response {
  return rawJson({ error: "Method not allowed" }, 405);
}

export function notFound(): Response {
  return rawJson({ error: "Not found" }, 404);
}

export function getPathParts(url: URL): string[] {
  return url.pathname.split("/").filter(Boolean);
}

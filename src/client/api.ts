import type { ApiEnvelope, ApiErrorBody } from "../shared/types";

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

export function getCsrfToken(): string | null {
  return csrfToken;
}

export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase()) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }

  const response = await fetch(path, {
    ...init,
    method,
    headers,
    credentials: "include"
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) {
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as ApiErrorBody;
      throw new ApiClientError(response.status, body.error, body.details);
    }
    throw new ApiClientError(response.status, response.statusText);
  }

  if (contentType.includes("application/json")) {
    const body = (await response.json()) as ApiEnvelope<T>;
    return body.data;
  }
  return (await response.text()) as T;
}

export function jsonBody(value: unknown): BodyInit {
  return JSON.stringify(value);
}

export function downloadUrl(path: string): void {
  window.location.assign(path);
}

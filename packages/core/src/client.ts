import { BACKEND_URL } from "./config";
import type { ApiEnvelope } from "./types";

type TokenGetter = () => string | null | undefined | Promise<string | null | undefined>;

let tokenGetter: TokenGetter = () => null;

/** Register how the client retrieves the backend JWT (set once at app startup). */
export function setTokenGetter(fn: TokenGetter) {
  tokenGetter = fn;
}

/**
 * Read the current backend JWT via the registered getter. Used by the socket
 * layer to authenticate the connection. May return a Promise depending on the
 * registered getter (session.ts registers a synchronous one).
 */
export function getAuthToken(): string | null | undefined | Promise<string | null | undefined> {
  return tokenGetter();
}

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export async function backendRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {}
): Promise<T> {
  const token = await tokenGetter();
  const url = `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10000);

  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });
  } catch (e: any) {
    const timedOut = e?.name === "AbortError";
    throw new ApiError("network_error", timedOut ? "Request timed out. Check your connection." : e?.message || "Network request failed", 0);
  } finally {
    clearTimeout(timeout);
  }

  let json: ApiEnvelope<T> | null = null;
  try {
    json = (await res.json()) as ApiEnvelope<T>;
  } catch {
    // non-JSON response
  }

  if (!res.ok || (json && json.ok === false)) {
    const err = json?.error;
    throw new ApiError(err?.code || "http_error", err?.message || `Request failed (${res.status})`, res.status);
  }

  return (json?.data ?? (json as unknown as T)) as T;
}

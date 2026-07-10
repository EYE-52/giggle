// Resolves the backend base URL across Next.js (process.env) and Expo (extra).
// Falls back to localhost:3001 only outside production.

function readEnv(): string | undefined {
  // Next.js / Node
  if (typeof process !== "undefined" && process.env) {
    return (
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.EXPO_PUBLIC_BACKEND_URL ||
      process.env.BACKEND_API_BASE_URL
    );
  }
  return undefined;
}

function normalize(url: string): string {
  return url.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function isPrivateLanHost(hostname: string): boolean {
  return (
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
  );
}

export function resolveBackendUrl(rawUrl?: string, browserHostname?: string, nodeEnv = process.env.NODE_ENV): string {
  if (!rawUrl && nodeEnv === "production") {
    throw new Error("NEXT_PUBLIC_BACKEND_URL or EXPO_PUBLIC_BACKEND_URL is required in production");
  }

  const normalized = normalize(rawUrl || "http://localhost:3001");
  const currentHost =
    browserHostname ||
    (typeof window !== "undefined" ? window.location.hostname : undefined);

  if (!currentHost || !isLoopbackHost(currentHost)) {
    return normalized;
  }

  try {
    const parsed = new URL(normalized);
    if (isPrivateLanHost(parsed.hostname)) {
      parsed.hostname = "localhost";
      return normalize(parsed.toString());
    }
  } catch {
    return normalized;
  }

  return normalized;
}

export const BACKEND_URL = resolveBackendUrl(readEnv());

export const VIBES = [
  "Chill",
  "Gaming",
  "Music",
  "Deep talks",
  "Comedy",
] as const;

export type Vibe = (typeof VIBES)[number];

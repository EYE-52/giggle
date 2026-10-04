import type { NextConfig } from "next";
import path from "path";

// Proxy ONLY the OAuth path through this domain so Google's consent screen shows
// the brand domain (gigglemeet.com) instead of the backend URL. All other API
// calls + sockets still hit the backend directly via NEXT_PUBLIC_BACKEND_URL.
const AUTH_BACKEND =
  process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_API_BASE_URL;

if (!AUTH_BACKEND && process.env.NODE_ENV === "production") {
  throw new Error("NEXT_PUBLIC_BACKEND_URL is required in production");
}

const AUTH_BACKEND_URL = AUTH_BACKEND || "http://localhost:3001";
const BACKEND_CONNECT_SRC = new URL(AUTH_BACKEND_URL).origin;
const socketUrl = new URL(AUTH_BACKEND_URL);
socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
const BACKEND_SOCKET_CONNECT_SRC = socketUrl.origin;

// Squad games: the one Game Night origin this app may frame. Same shape
// rules as the API's GAMES_PUBLIC_URL (https in production, http only for
// local development, no credentials/query/hash); both must match origin.
function gamesFrameOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_GAMES_URL || "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.protocol !== "https:" && process.env.NODE_ENV === "production") return null;
    if (url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}
const GAMES_FRAME_SRC = gamesFrameOrigin();

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      `img-src 'self' ${BACKEND_CONNECT_SRC} data: blob: https:`,
      "font-src 'self' data:",
      `connect-src 'self' ${BACKEND_CONNECT_SRC} ${BACKEND_SOCKET_CONNECT_SRC} https: wss:`,
      "media-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      ...(GAMES_FRAME_SRC ? [`frame-src 'self' ${GAMES_FRAME_SRC}`] : []),
      "frame-ancestors 'none'",
    ].join("; "),
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  // The floating dev menu covers Home and emoji controls on narrow previews.
  // Errors still show their normal overlay; keep the app's hit targets clear.
  devIndicators: false,
  // Dev-only: Tailnet previews serve this app as http://divyanshs-mac-mini
  // (see allowedDevOrigins in the local Next docs). Production ignores this.
  allowedDevOrigins: ["127.0.0.1", "divyanshs-mac-mini"],
  transpilePackages: ["@giggle/core", "@giggle/ui-tokens", "@giggle/agora"],
  // Monorepo: pin the workspace root so Turbopack/Next file-tracing resolves
  // workspace packages correctly instead of mis-inferring the root.
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  async rewrites() {
    return [
      { source: "/api/auth/:path*", destination: `${AUTH_BACKEND_URL}/api/auth/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;

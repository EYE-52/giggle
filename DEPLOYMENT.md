# Giggle — Deployment (live)

## Live URLs
- **Frontend (web app):** https://giggle-web-seven.vercel.app  (Vercel project `giggle-web`; canonical source: `giggle-app/apps/desktop`)
- **Backend (API + sockets):** https://giggle-server-production.up.railway.app  (Railway project `giggle`)
- **DB:** MongoDB Atlas (existing cluster)  ·  **Redis:** `giggle-redis` (redis:7-alpine on Railway, private net)

Verified end-to-end on production: auth (email exchange) → home with live stats → squad/lobby/encounter all hit the live backend. CORS + Socket.io allow the Vercel origin.

## Adding your domain: gigglemeet.com
CORS already pre-allows `https://gigglemeet.com` and `https://www.gigglemeet.com` (set in the backend `FRONTEND_URL` list), so once DNS points at Vercel it works immediately.

**Steps (you do these):**
1. **Vercel → Project `giggle-web` → Settings → Domains → Add** `gigglemeet.com` (and `www.gigglemeet.com`).
2. Vercel shows DNS records. At your domain registrar (where you bought gigglemeet.com), add them:
   - Apex `gigglemeet.com` → **A record** `76.76.21.21` (or the ALIAS/ANAME Vercel shows).
   - `www` → **CNAME** `cname.vercel-dns.com`.
3. Wait for DNS to verify (minutes–an hour). Vercel auto-issues HTTPS.
4. (Optional) Set `gigglemeet.com` as the **Production domain** in Vercel so it's the primary.
5. Nothing to change on the backend — CORS already allows it. If you later use a *different* domain, add it to the Railway `giggle-server` env var `FRONTEND_URL` (comma-separated list).

## Redeploying
- **Frontend:** from `giggle-app/` run `vercel deploy --prod --yes --archive=tgz` (builds remotely from repo root; root dir = `apps/desktop`).
- **Backend:** from `giggle-server/` run `railway up --service giggle-server --detach`.
- **Frontend runtime:** use `Node 22.13.0` and `pnpm 10.x`, matching `giggle-app/package.json` and `giggle-app/.node-version`.
- **Backend runtime:** use `Node >=20.18 <25` and `npm >=10`, matching `giggle-server/package.json`.

Do not deploy the top-level `giggle-web/` folder for the main product. It is a legacy Phase 1 web app kept for reference; current product work and production deploys live in `giggle-app/apps/desktop`.

## Env (set on the hosts, not in git)
- **Railway `giggle-server`:** `MONGODB_URI`, `JWT_SECRET`, `AUTH_EXCHANGE_SECRET`, `BACKEND_PUBLIC_URL=https://giggle-server-production.up.railway.app`, `FRONTEND_URL=<vercel + gigglemeet origins, comma-separated>`, `REDIS_URL=redis://giggle-redis.railway.internal:6379`, `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE`, `AGORA_TOKEN_EXPIRY_SECONDS`, `MAX_SQUAD_MEMBERS=4`, `MIN_MEMBERS_TO_SEARCH=1`, `NODE_ENV=production`. `JWT_SECRET` and `AUTH_EXCHANGE_SECRET` must each be high-entropy values with at least 32 characters or production startup fails. For provider buttons, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_SERVICE_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY`. Add `RESEND_API_KEY` + `RESEND_FROM` before enabling email magic-link auth. (`PORT` injected by Railway.)
- **Vercel project `giggle-web` running `giggle-app/apps/desktop`:** `NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app`. OAuth provider secrets belong on Railway; the desktop app proxies auth through the backend.

## Notes / gotchas handled
- Redis on Railway is IPv6-only on the private net → `ioredis` configured with `family: 0` (`src/config/redisConfig.js`).
- `rediss://` Redis URLs verify TLS certificates by default. Only set `REDIS_TLS_REJECT_UNAUTHORIZED=false` for a self-signed Redis TLS certificate you explicitly trust; do not add it for managed Redis with a public CA certificate.
- Railway terminates HTTPS before Node, so the backend trusts exactly one proxy hop for client IP/rate-limit handling.
- Vercel deployment protection (auth wall) is **disabled** so the site is public.
- Monorepo type resolution: `@giggle/agora` declares `@giggle/core` as a workspace dependency.
- Google OAuth: to enable real Google sign-in, add the live origin(s) to the OAuth client's **Authorized JavaScript origins** and `https://giggle-server-production.up.railway.app/api/auth/google/callback` to **Authorized redirect URIs** in Google Cloud Console.
- Apple OAuth: configure the Services ID return URL as `https://giggle-server-production.up.railway.app/api/auth/apple/callback`; Apple posts this callback as form data.
- Email magic-link auth requires Resend in production; without `RESEND_API_KEY`, the backend returns `EMAIL_NOT_CONFIGURED` and never logs live sign-in links.

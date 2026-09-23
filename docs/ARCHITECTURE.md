# Architecture, scaling and migration

How the production pieces fit together, what already scales horizontally, and what to change when a host or a single replica is no longer enough. Current hosting and deploy steps live in [DEPLOYMENT.md](../DEPLOYMENT.md).

## Components

| Piece | Code | Runs on today | Portable to |
| --- | --- | --- | --- |
| Web app (Next.js) | `apps/desktop` | Vercel `giggle-meet` | Any Node host that runs `next build && next start`, or any Next.js platform |
| API + realtime (Express, socket.io) | `server/` | Railway `giggle-server`, 1 replica | Any container host: `server/Dockerfile.selfhost` |
| Database | Mongoose models in `server/src/models` | MongoDB replica set (`MONGODB_URI`) | Any MongoDB 8 replica set (Atlas, self-hosted) |
| Cache, queues, presence, socket fan-out | `server/src/config/redisConfig.js` | Railway `giggle-redis` | Any Redis 6+ (`REDIS_URL`) |
| Video | `packages/agora` | Agora (client SDK loaded on demand) | Agora only; tokens are minted by the API |

The browser talks to the API directly at `NEXT_PUBLIC_BACKEND_URL` (REST and a websocket-only socket.io connection). Only `/api/auth/*` is proxied through the web origin so the Google callback stays on `www.gigglemeet.com`.

## What is already horizontally safe

- **Stateless auth.** Clients hold a JWT; any replica can verify it.
- **Socket fan-out.** socket.io uses the Redis adapter, and clients connect with the websocket transport only, so no sticky sessions are needed.
- **Presence.** Online state lives in Redis with a TTL. Heartbeats are one `MULTI` per socket.
- **HTTP rate limits.** When Redis is configured, `express-rate-limit` counters live in Redis (`rl:api:`, `rl:auth:`), so limits hold across replicas. Redis errors fail open.
- **Background sweepers.** The stuck-encounter sweeper and the account-deletion sweeper take a short Redis `SET NX PX` lock per tick, so only one replica runs each pass.
- **Per-socket chat/reaction limits.** These are in-process but keyed by socket id, and a socket lives on exactly one replica.
- **Graceful shutdown.** SIGTERM/SIGINT stop the sweepers, close sockets and the HTTP listener, then disconnect Mongo and Redis. A 10s timeout forces exit.
- **Redis outages.** The command client gives up after 2 retries instead of queueing forever, so API requests fail fast rather than hang.

## Known limits before scaling further

1. **Uploaded squad covers are still stored as base64 inside squad documents** (up to ~2 MB). They are no longer sent in API responses: clients get `GET /api/covers/:squadId/:hash`, served with an immutable cache header, where the hash is a content hash that makes the URL unguessable. Database weight remains. When it matters, move uploads to object storage (S3/R2), point `publicCoverImage` in `server/src/utils/squadCovers.js` at the stored URL, and lower the 3 MB JSON body limit in `server.js`.
2. **Matchmaking uses one global Redis lock.** Throughput is bounded by one pairing loop at a time. Lock per region, or claim candidates atomically, before stranger discovery sees real load.
3. **Notifications and encounters have no TTL index**, so they grow without bound. Add TTL indexes or an archival job.
4. **`/stats` caches for 30s per replica, in memory.** That's fine for a public counter; move it to Redis if exact cross-replica numbers matter.

## Moving off the current hosts

**API (off Railway):**

1. Build `server/Dockerfile.selfhost` (`docker build -f Dockerfile.selfhost -t giggle-server server/`). It is intentionally not named `Dockerfile`, so Railway keeps its current Railpack build. Build and smoke-test the image before relying on it; it has not been built in CI yet.
2. Set every variable listed in `server/.env.example` on the new host. The server validates the required ones at startup and exits with a clear error when one is missing.
3. Give the API a stable domain you own (for example `api.gigglemeet.com`) rather than the `*.up.railway.app` URL. Then a later host move only changes DNS, not the web build.
4. Update `NEXT_PUBLIC_BACKEND_URL` for the web build, `BACKEND_PUBLIC_URL` and `FRONTEND_URL` on the API, and the Google OAuth redirect if the callback host changes. Rebuild the web app, because `NEXT_PUBLIC_*` values are baked in at build time.
5. Scale to more than one replica only after the new host routes websockets. No sticky sessions are needed.

**Web (off Vercel):** run `pnpm --filter @giggle/desktop build` and `next start` on any Node 22 host, with the same two public variables used in `vercel.json`. Nothing else in the app depends on Vercel-specific APIs.

**Database and Redis:** point `MONGODB_URI` and `REDIS_URL` at the new providers. Indexes are declared in the Mongoose models and built on startup.

## Client performance notes

- Polling runs through `apps/desktop/lib/poll.ts`, which pauses while the tab is hidden and refreshes as soon as it becomes visible. The lobby relies on `SQUAD_UPDATED` socket events and polls only every 10s as a fallback.
- The Agora SDK is loaded only on call screens.

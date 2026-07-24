# giggle-server

Backend service for Giggle MVP.

## Run

1. Install dependencies

```bash
npm install
```

2. Configure environment variables

```bash
PORT=3001
MONGODB_URI=mongodb://localhost:27017/giggle
JWT_SECRET=replace-me-with-a-long-random-string
AUTH_EXCHANGE_SECRET=replace-me-with-another-long-random-string
REDIS_URL=redis://127.0.0.1:6379
BACKEND_PUBLIC_URL=http://localhost:3001
FRONTEND_URL=http://localhost:4000
ADMIN_EMAIL=admin@example.com

# Squad settings
MAX_SQUAD_MEMBERS=4
MIN_MEMBERS_TO_SEARCH=2

# Agora (required in production for lobby + encounter video)
AGORA_APP_ID=replace-me
AGORA_APP_CERTIFICATE=replace-me
AGORA_TOKEN_EXPIRY_SECONDS=3600

# OAuth / email sign-in
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
APPLE_SERVICE_ID=
APPLE_TEAM_ID=
APPLE_KEY_ID=
APPLE_PRIVATE_KEY=
RESEND_API_KEY=
RESEND_FROM=Giggle <onboarding@resend.dev>

# Logging
ENABLE_REQUEST_LOGS=true
LOG_REQUEST_BODY=false
```

3. Start server

```bash
npm run dev
```

Swagger docs are served at `/api-docs`.

## Squad APIs (Phase 1)

- `POST /api/squads/create`
- `GET /api/squads/me`
- `POST /api/squads/join`
- `GET /api/squads/:squadId`
- `POST /api/squads/:squadId/ready`
- `POST /api/squads/:squadId/search` (leader only)
- `POST /api/squads/:squadId/search/cancel` (leader only)
- `POST /api/squads/:squadId/members/:memberId/kick` (leader only)
- `POST /api/squads/:squadId/members/:memberId/promote` (leader only)
- `POST /api/squads/:squadId/leave`

## Agora APIs (Phase 1)

- `POST /api/agora/lobby-token/:squadId`

This endpoint is authenticated and squad-member protected. It returns:

- `appId`
- `channelName` (format: `lobby_<squadId>`)
- `rtcToken`
- `uid`
- `expiresIn`
- `expiresAt`

## Access Control Rules

- All squad endpoints require bearer JWT.
- In production, `POST /api/auth/exchange` requires `AUTH_EXCHANGE_SECRET` from trusted server callers.
- User identity is resolved from JWT (`userId` primary).
- JWT `userId` values must be valid Mongo ObjectId strings before controllers or realtime sockets trust them.
- Squad member and leader checks are enforced through dedicated middleware.
- Leader-only actions return `403 LEADER_ONLY` for non-leaders.
- Users may belong to multiple squads simultaneously; "current squad" views use the most recent membership.

## Auto-Deletion Behavior

- When a member leaves and squad becomes empty, squad is automatically deleted.

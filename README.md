# Giggle

This monorepo is the only canonical Giggle source:

- web: `apps/desktop`
- iOS, Android, and native web preview: `apps/mobile`
- API and realtime services: `server/`
- shared client code: `packages/`

Giggle currently ships one verified-adult 18+ service. A 13–17 stranger-discovery mode is not implemented, and teen/adult discovery must not be mixed.

## Local development

Use Node 22, pnpm 10 for the monorepo, and npm 10 for `server/`.

```sh
pnpm install --frozen-lockfile
cd server && npm install && npm run dev
```

In another terminal, from the repository root:

```sh
pnpm dev:desktop
# or
pnpm dev:mobile
```

The web app opens at <http://localhost:4000>; the API defaults to <http://localhost:3001>. Configure the API from the sanitized `server/.env.example` without committing secrets.

## Release boundary

Production stranger discovery stays disabled until every gate in `DEPLOYMENT.md` is evidenced. Public web/native flags only hide build surfaces; `STRANGER_DISCOVERY_ENABLED` on the API is authoritative.

Missing Yoti configuration leaves identity, support, data export, and account deletion available, while all social access fails closed.

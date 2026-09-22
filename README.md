# Giggle

This monorepo is the only canonical Giggle source:

- web: `apps/desktop`
- iOS, Android, and native web preview: `apps/mobile`
- API and realtime services: `server/`
- shared client code: `packages/`

Giggle is an adults-only (18+) service. Production currently uses a temporary date-of-birth declaration while Yoti is being set up. A 13–17 stranger-discovery mode is not implemented, and teen/adult discovery must not be mixed.

## Production deployment

Live site: [www.gigglemeet.com](https://www.gigglemeet.com/).

**Start with [DEPLOYMENT.md](DEPLOYMENT.md#current-production-setup)** for the current Vercel and Railway projects, dashboard links, build settings, environment-variable locations, temporary age-form mode, deployment and rollback steps, and the last verified release. The canonical deployment branch is `main`.

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

With `SELF_DECLARED_AGE_ACCESS=false`, missing Yoti configuration leaves identity, support, data export, and account deletion available while social access fails closed. Production temporarily uses `SELF_DECLARED_AGE_ACCESS=true` to accept adult date-of-birth declarations; see the deployment runbook before changing it.

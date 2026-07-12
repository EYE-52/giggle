# Giggle Desktop

Canonical production web app for Giggle.

Deploy from this repository root. The linked Vercel project uses root directory `.`, runs `pnpm --filter @giggle/desktop build`, and serves `apps/desktop/.next`. The Vercel project may still be named `giggle-web`, but its source is this monorepo, not the legacy `../../giggle-web` repository.

## Run

From `giggle-app/`:

```bash
pnpm dev:desktop
```

Open [http://localhost:4000](http://localhost:4000).

Production builds require `NEXT_PUBLIC_BACKEND_URL`; local development falls back to `http://localhost:3001`.

## Checks

From `giggle-app/`:

```bash
pnpm --filter @giggle/desktop test
pnpm --filter @giggle/desktop build
```

## Deploy

```bash
vercel deploy --yes --archive=tgz --build-env NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app
vercel deploy --prod --yes --archive=tgz --build-env NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app
```

Confirm the Vercel project root directory is `.`.

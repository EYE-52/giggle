# Giggle Desktop

Canonical production web app for Giggle.

Deploy from the `giggle-app/` workspace root with Vercel root directory `apps/desktop`. The Vercel project may still be named `giggle-web`, but the deploy source is this app, not the legacy top-level `../../giggle-web` folder.

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
vercel deploy --prod --yes --archive=tgz
```

Confirm the Vercel project root directory is `apps/desktop`.

# Giggle Web

Canonical production web app for Giggle.

Repository: `/Users/divyansh/Projects/giggle-stack/giggle-web`

## Run

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:4000](http://localhost:4000).

Production builds require `NEXT_PUBLIC_BACKEND_URL`; local development falls back to `http://localhost:3001`.

## Checks

```bash
pnpm test
pnpm --filter @giggle/core test
pnpm test:e2e
NEXT_PUBLIC_BACKEND_URL=https://giggle-server-production.up.railway.app pnpm build
```

## Deploy

```bash
vercel deploy --prod --yes --archive=tgz
```

Deploy from this repository root. The checked-in `vercel.json` supplies the framework, build command, output directory, and public backend URL.

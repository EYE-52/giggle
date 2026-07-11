# Giggle

This is the canonical Giggle repository.

- Web: `apps/desktop`
- Android and iOS: `apps/mobile`
- Shared packages: `packages`

Run the local backend from `../giggle-server` on port `3001`, then start the web app from this repository:

```sh
pnpm dev:desktop
```

Open <http://localhost:4000>. Do not develop or deploy from the legacy `giggle-web` repository.

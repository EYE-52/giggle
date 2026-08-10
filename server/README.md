# Giggle API

Express, MongoDB, Redis, Socket.IO, Agora, and Yoti power the API in this repository's `server/` directory.

## Run locally

```sh
npm install
npm run dev
```

Start from the sanitized `server/.env.example`. Keep JWT, auth-provider, Agora, email, and Yoti values server-side; never copy them into `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*`, `vercel.json`, or `app.json`.

Required verified-adult settings:

```text
YOTI_AGE_API_KEY
YOTI_AGE_SDK_ID
AGE_VERIFICATION_CALLBACK_URL
ADMIN_EMAIL
STRANGER_DISCOVERY_ENABLED=false
```

If any Yoti setting is missing or invalid, age verification and social access fail closed. Identity authentication plus support, export, and deletion remain available while the User record exists.

`STRANGER_DISCOVERY_ENABLED` gates public squad discovery, random joining, queue entry, matching, and automatic encounter requeue. Private squad creation, invite/code joining, profile, support, export, and deletion remain available.

## Checks

```sh
npm test
```

After starting the service, check `GET /health`. Swagger documentation is available at `/api-docs` in environments where it is enabled.

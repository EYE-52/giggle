# Giggle Troubleshooting: Infrastructure Issues

## Redis Connection Refused (`ECONNREFUSED`)
If you see `Redis connection error: Error: connect ECONNREFUSED 127.0.0.1:6379`, it means the backend cannot find a running Redis instance on your local machine.

### Solution 1: Run Redis via Docker (Recommended)
Run the following command to start a fresh Redis container and map it to your local port 6379:
```bash
docker run -d --name giggle-redis -p 6379:6379 redis
```

If you already have a container named `giggle-redis`, start it with:
```bash
docker start giggle-redis
```

### Solution 2: Verify Running Containers
Check if Redis is actually listening:
```bash
docker ps
```
You should see `0.0.0.0:6379->6379/tcp` in the `PORTS` column.

### Solution 3: No Docker? Install via Brew (macOS)
```bash
brew install redis
brew services start redis
```

---

## Verifying Backend Health
You can verify if your backend and its dependencies (MongoDB & Redis) are up by visiting the `/health` endpoint:

**URL:** `https://your-backend-url.onrender.com/health`

### Expected Response:
```json
{
  "ok": true,
  "status": "UP",
  "timestamp": "2026-05-24T20:45:00.000Z",
  "services": {
    "api": "UP",
    "database": "connected",
    "redis": "connected"
  }
}
```
If `ok` is `false`, check your logs and environment variables for connectivity issues.

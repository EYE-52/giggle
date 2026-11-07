# Hosting closer to India

Recommendation only. Nothing here has been bought, created or changed.

## What we measured (2026-11-07, from Patna)

TCP connect time, which is about one round trip. Seven samples each; min / median.

| Datacentre | Endpoint | Min | Median |
| --- | --- | --- | --- |
| Singapore (where the game server runs today) | Vultr `sgp-ping` | 79 ms | 86 ms |
| Singapore | AWS `ap-southeast-1` | 80 ms | 98 ms |
| **Mumbai** | Vultr `bom-in-ping` | **42 ms** | **45 ms** |
| **Mumbai** | AWS `ap-south-1` | **43 ms** | **52 ms** |
| Bangalore | Vultr `blr-in-ping` | 50 ms | 52 ms |
| Delhi | Vultr `del-in-ping` | 64 ms | 76 ms |

Mumbai roughly halves the round trip from Patna: about 40 ms less on every
input, acknowledgement and snapshot. Delhi is geographically closer but
routes worse from here. Players in Mumbai, Pune and Bangalore gain more
than Patna does.

The real-time layer (`REALTIME_GUIDE.md`) is the bigger, free win and
ships first: frames went from 20 Hz to 30 Hz, remote karts render about
40 ms closer to live, and bandwidth fell about 10x. Moving the server
stacks on top of that.

## Options

| Provider | India region | Price (1 to 2 vCPU, 1 to 2 GB, always on) | Fit |
| --- | --- | --- | --- |
| Railway (today) | none (US, EU, Singapore only) | usage-based | no India option |
| AWS Lightsail | Mumbai | $12/mo for 2 vCPU / 2 GB (transfer allowance is halved in Mumbai) | good: plain VM |
| DigitalOcean | Bangalore (BLR1) | $18/mo for 2 vCPU / 2 GB, 3 TB transfer | good: plain VM |
| Vultr | Mumbai, Delhi, Bangalore | about $6 to $12/mo (not verified) | good: plain VM |
| Fly.io | Mumbai (`bom`), availability unclear in 2026 docs | about $7 to $15/mo, India egress $0.12/GB | easy deploys, uncertain region |
| Google Cloud Run | Mumbai, Delhi | about $60/mo always on (not verified) | poor: WebSockets cut at 60 min, rooms live in memory |

Bandwidth after the real-time layer: about 35 KB/s per player at 8 drivers
and 70 KB/s at 32. A busy evening of 50 players for 3 hours is about
20 to 40 GB, inside every plan's included transfer.

## Redis or a cache

Not for latency. Rooms, physics and snapshots live in the server's memory
and every tick is computed there; a Redis hop would add delay, not remove
it. Redis becomes useful only when the game server runs as several
instances and needs to route a room code to the instance that owns it. One
Node process holds about 8 to 12 full 32-driver rooms at 30 Hz (2.3 ms of
CPU per tick each, governor ceiling 55% busy) and far more small rooms; the
tick governor slows rooms to 20 to 15 Hz before anything breaks. That is a
scaling step for later, not a smoothness fix.

## Recommendation

Move the game server (`apps/games`, the WebSocket and API process) to a
**Mumbai VM: AWS Lightsail 2 vCPU / 2 GB at $12/mo**, or Vultr Mumbai if its
price checks out lower. Keep the frontend on Vercel. Keep Railway Singapore
running for a week as a fallback, then retire it. Cost change: roughly
+$12/mo, minus whatever Railway bills today.

## Migration steps (after you approve)

1. Create the Lightsail instance in `ap-south-1` (Ubuntu 24.04, 2 GB), attach
   a static IP, open ports 80 and 443 only.
2. Install Node 24 and Caddy. Caddy terminates TLS for a new hostname such
   as `play-in.<domain>` and proxies HTTP and WebSocket to `localhost:8123`.
3. Deploy `apps/games` exactly as Railway does: `npm ci`, then `npm start`
   under a systemd unit with `Restart=on-failure`. Copy the environment
   variables from Railway (`GAME_BRIDGE_SECRET`, allowed origins, report
   storage path). Health check: `GET /config.json`.
4. Point the frontend's WebSocket target (`config.json`, via
   `netconfig.js`) at the new hostname on a preview deploy first; play a
   match from Patna and confirm about 45 ms in the game's network readout.
5. Switch production config, keep Railway warm for rollback, and update
   `DEPLOYMENT_PLAN.md` and the release recipe with the new target.
6. Rooms are in memory, so cut over between sessions; rooms open on the old
   server finish there.

# Moving the game server to Mumbai

Plan only. No account, instance, DNS record or deploy exists yet. Each step
marked **(approval)** waits for the owner. Why Mumbai: `REALTIME_HOSTING.md`
(Patna round trip 86 ms to Singapore, 45 ms to Mumbai).

## What moves and what stays

| Piece | Today | After |
| --- | --- | --- |
| Game server (`apps/games`: rooms, rules, WebSocket, `/config.json`, reports API) | Railway `giggle-play-production.up.railway.app`, Singapore, 1 replica | Lightsail VM in Mumbai (`ap-south-1`), `rt.gigglemeet.com` |
| Report inbox database | `/data/reports.sqlite` on the Railway volume | `/var/lib/giggle-games/reports.sqlite` on the VM, copied over at cutover |
| Games frontend `play.gigglemeet.com` | Vercel `giggle-play` | unchanged; only its 4 rewrites change target |
| Giggle Meet site and API, Redis, MongoDB | Vercel `giggle-meet`, Railway `giggle-server` | unchanged |
| Bridge secret, allowed origins, public game URL | Railway variables | same values, copied to the VM |

The browser finds the game server through `/config.json`. Vercel rewrites
that route to the backend, and the backend answers with `websocketUrl`.
Switching the rewrite target to the new host is therefore the whole cutover.
Undoing it is the whole rollback. The Meet site's CSP already allows any
`wss:`, and its API still points embeds at `play.gigglemeet.com`, so nothing
in Meet changes.

## Decisions for the owner

1. **Provider (approval).** AWS Lightsail, Mumbai, Linux plan with 2 GB RAM and 2 vCPU: $12/mo. It includes a static IPv4 address and 60 GB SSD. Mumbai plans get half the usual transfer allowance, about 1.5 TB on this plan, and overage costs $0.13/GB. Expected use is 20 to 40 GB per busy evening, so a heavy month is roughly 1 TB, still inside the allowance. You create the AWS account, since I can't create accounts or enter payment details.
2. **Hostname (approval).** Add an A record at Namecheap for `rt.gigglemeet.com`, pointing at the static IP. It sits beside the existing `play` CNAME and doesn't touch apex, www or mail.
3. **Deploy access (approval).** Either keep releases manual over SSH from this Mac, or add an SSH deploy key as a GitHub secret for the Deploy Games workflow. Manual is the default; the second option creates standing access.
4. **Railway after the move.** Keep the Singapore service running for 7 days as a rollback target, then remove it. Railway's billing stops once it's gone.

## Code changes first (one PR, no hosting change)

These keep Railway working exactly as today, so the PR can merge and ship
before any of the move happens. Implementation goes to Codex (gpt-6.1-sol)
and Claude reviews the diff.

1. **Host-neutral deployment identity.** Today `/config.json` reports `deploymentId` from `RAILWAY_DEPLOYMENT_ID`. Change it to read `DEPLOYMENT_ID` first and fall back to the Railway variable. The VM deploy sets `DEPLOYMENT_ID=<sha>-<utc time>`. Also report `region` from `GAME_REGION`, so a release check can confirm where the server runs.
2. **Report rate-limit behind Caddy.** `server/reports.js` trusts `X-Real-IP` only when it runs on Railway. Behind Caddy, every caller would show up as `127.0.0.1` and share one abuse bucket. Add `GAME_REPORT_TRUST_PROXY=loopback`, which trusts `X-Real-IP` only when the socket peer is `127.0.0.1` or `::1`. Caddy sets that header from the real client address. Add a test for it.
3. **Release gate and workflow, with a target switch.** `scripts/release-gate.js`, `scripts/deploy-frontend.js`, `.github/workflows/deploy-games.yml` and `apps/desktop/scripts/verify-release-dependencies.cjs` all hard-code the Railway host. Change them to read `BACKEND_URL` (default: the Railway host). Add a `vm` target that checks:
   - `/config.json` shows the exact release (source, build, version)
   - `deploymentId` matches the one this upload stamped
   - `region` is `ap-south-1`

   The Railway path stays as it is.
4. **VM deploy script** `scripts/deploy-vm.sh`. It runs from a clean, stamped release, the same curated file set the Railway upload sends:
   1. Send the archive with rsync to `/opt/giggle-games/releases/<sha>`.
   2. Run `npm ci --omit=dev` there.
   3. Write `DEPLOYMENT_ID` into `/etc/giggle-games/deploy.env`.
   4. Point the `current` symlink at the new release, then run `systemctl restart giggle-games`.
   5. Poll `/config.json` until the new identity shows up.

   Rollback points the symlink back and restarts. Keep the last 5 releases.
5. **Ops files** in `ops/vm/`: a `giggle-games.service` systemd unit, a `Caddyfile`, and `bootstrap.sh` for first-time setup. Details below.
6. **Tests.** Extend `test/release-gate.js`, `test/splithost.js` and `test/deploy-frontend-session.js` to cover the VM target. `npm test` must exit 0.

## Server setup (after approval 1)

On a new Lightsail instance, Ubuntu 24.04, 2 GB plan, in `ap-south-1a`:

- **Network.** Attach a static IP. Lightsail firewall: allow 22 from the owner's IPs only, plus 80 and 443 from anywhere.
- **Hardening.** Use SSH keys only, disable password login, turn on `unattended-upgrades`, and add a 1 GB swap file.
- **Runtime.** Node 24 from NodeSource, matching the Railway runtime (24.x), and Caddy from the official apt repo.
- **Service user.** Create a `giggle` user that owns `/opt/giggle-games` and `/var/lib/giggle-games`. Logs go to journald, capped at 500 MB.
- **systemd unit.** It runs `npm start` in `/opt/giggle-games/current` as `giggle`, with `Restart=on-failure` and `LimitNOFILE=65536`. It loads two env files: `/etc/giggle-games/env` (secrets, root-owned, mode 600) and `deploy.env`.
- **Environment.** Copy from the Railway games service variables by hand. Secrets never go in the repo or in chat.
  - `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=8123`
  - `GAME_BRIDGE_SECRET`, `GAME_REPORT_ADMIN_TOKEN` and `GIGGLE_LEASE_MS`: same values as Railway
  - `GIGGLE_ALLOWED_ORIGINS` and `STANDALONE_ALLOWED_ORIGINS`: same as Railway
  - `PUBLIC_GAME_URL=https://play.gigglemeet.com`
  - `PUBLIC_WEBSOCKET_URL=wss://rt.gigglemeet.com`
  - `GAME_REPORT_DB=/var/lib/giggle-games/reports.sqlite`
  - `GAME_REPORT_TRUST_PROXY=loopback`, `GAME_REGION=ap-south-1`
- **Caddy.** One site, `rt.gigglemeet.com`, gets automatic Let's Encrypt TLS and proxies `reverse_proxy 127.0.0.1:8123` with `header_up X-Real-IP {remote_host}`. Caddy passes WebSocket upgrades through as-is, with no idle timeout on upgraded connections. Add HSTS.
- **Kernel.** `net.core.somaxconn=4096` and `net.ipv4.tcp_congestion_control=bbr`. Disable Nagle in Node: `ws` already sets `noDelay`.
- **Monitoring.**
  - A free external uptime check on `https://rt.gigglemeet.com/config.json`, every minute.
  - A Lightsail alarm at CPU above 70% for 10 minutes.
  - A Lightsail alarm at 75% of the transfer allowance.
- **Backups.** Automatic daily Lightsail snapshots. They add about $1 to $3 a month for 60 GB; skip them if the cost isn't wanted. Also a nightly `sqlite3 .backup` of the reports database into `/var/lib/giggle-games/backup/`, keeping 14 copies.

## Rehearsal (no user impact)

1. Deploy the current production release to the VM with `deploy-vm.sh`.
2. Check `https://rt.gigglemeet.com/config.json`:
   - the release matches Railway's
   - `websocketUrl` is `wss://rt.gigglemeet.com`
   - the bridge is enabled
3. Run the hosted checks from `DEPLOYMENT_PLAN.md` against the VM directly:
   - four-peer starts for all games
   - an untrusted origin is rejected
   - a report is accepted, survives a restart, and an unauthorised inbox request is rejected
4. Load: a 32-driver kart room from Patna, using `tools/realtime/kart-bot.mjs`.
   - Record RTT, snapshot gaps and server tick time.
   - Target: about 45 ms RTT, and the tick governor holding 33 ms.
   - Then run 3 rooms of 32 at once and confirm the process stays under 55% busy.
5. Build a Vercel **preview** of `giggle-play` with the rewrites pointed at `rt.gigglemeet.com`. Play a real match from Patna on a phone and a laptop, and confirm about 45 ms in the network readout. Then open an embedded game from Meet on that preview (bridge tickets) and check it.

## Cutover (approval: the time slot)

Pick a quiet window. Rooms live in memory, so open rooms finish on whichever
server they started on.

1. **Freeze reports.** Copy the Railway reports database: download `/data/reports.sqlite` with the Railway CLI or a one-off shell, then `sqlite3 .backup`. Install it on the VM and restart.
2. **Switch.** Merge the `vercel.json` change: the 4 rewrites now point at `https://rt.gigglemeet.com`. Deploy the frontend through the normal release helper with the `vm` target, then confirm `play.gigglemeet.com/config.json` shows the VM's deployment ID and region.
3. **Leave Railway running.** Tabs that were already open still hold the Singapore socket, and their rooms finish there. New page loads go to Mumbai.
4. **After 24 hours,** merge any reports filed on Railway after the copy into the VM database, by `id`, skipping rows already present. Then point the inbox tool at the new host.
5. **Update records.** Topology and rollback pair in `DEPLOYMENT_PLAN.md`, the `vm` steps in the release recipe, and the hosting notes in `DEPLOYMENT.md`.

## Rollback

- **Within the 7 days:** revert the `vercel.json` rewrite commit and redeploy the frontend. New page loads go back to Railway Singapore straight away. The only loss is reports filed on the VM in the meantime, which you copy back the same way.
- **A bad VM release:** run `deploy-vm.sh --rollback`, which moves the symlink back and restarts.

## Cost and effort

| Item | Monthly |
| --- | --- |
| Lightsail 2 GB, Mumbai | $12 |
| Snapshots (optional) | $1 to $3 |
| Railway games service | stops after the 7 days |

Effort:
- the code PR: about half a day, through Codex plus review
- server setup and rehearsal: about 2 hours once the instance exists
- cutover: about 30 minutes, plus a 24-hour report merge

## Later, not part of this move

- **Several servers.** Use Redis to route a room code to the server that owns it. Only needed once one process is full, at about 8 to 12 full 32-driver rooms.
- **Railway's config deadline.** Railway's `railway.json` format expires on 1 December 2026, so after the move it matters only while Railway is still kept around.

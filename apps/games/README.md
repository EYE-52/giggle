# Canonical component source

This component lives in `apps/games` of [EYE-52/giggle](https://github.com/EYE-52/giggle). Older standalone repositories are historical only. See [INTEGRATION.md](INTEGRATION.md) for provenance and local checks.

# Giggle Games

Multiplayer browser games at [play.gigglemeet.com](https://play.gigglemeet.com), built on a reusable game framework. Players can use rooms independently or play inside their existing Giggle Meet call.

## Run locally

Use Node.js **24 LTS** and your own GitHub account with access to this private repository.

```sh
git clone git@github.com:EYE-52/giggle.git
cd giggle/apps/games
node scripts/contributor.mjs setup --check
npm run dev:local
```

Open **http://127.0.0.1:8123** in two browser windows to create and join a room. The setup installs locked dependencies, builds the game pages, and creates an isolated local `.env`. Production credentials are optional.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the environment handover, local call integration, game creation, testing, and deployment access. See [GAME_KIT_GUIDE.md](GAME_KIT_GUIDE.md) for the portable framework.

## Project map

| Location | Purpose |
| --- | --- |
| `games/<game>/server.js` | Authoritative rules and private player projections |
| `games/engines/` | Reusable simulations and rule factories |
| `server/` | Rooms, WebSockets, identity and Giggle bridge |
| `public/js/games/` | Game views with their own UI and lifecycle |
| `public/js/toolkit/` | Shared input, canvas, audio, voice and screen helpers |
| `sdk/` | Portable game creation framework |
| `test/` | Rules, race conditions, integration and lifecycle checks |

`main` contains published, reviewed source. Active game rebuilds live on development branches until their checks and playtesting are complete. Read [DEPLOYMENT_PLAN.md](DEPLOYMENT_PLAN.md) before changing a production service.

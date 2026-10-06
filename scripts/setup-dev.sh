#!/usr/bin/env bash
# Prepare an existing Giggle checkout. Does not start services or deploy.
set -euo pipefail
giggle_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
local_auth=false
check_only=false
for argument in "$@"; do
  case "$argument" in
    --local-auth) local_auth=true ;;
    --check) check_only=true ;;
    -h|--help)
      cat <<'HELP'
Usage: scripts/setup-dev.sh [--local-auth] [--check]

Installs locked web/native and server dependencies, creates missing local
environment files and generates local JWT/auth-exchange secrets. Existing
environment files are preserved. Requires Node 20.18–24 and pnpm 10.

--local-auth  Enable synthetic @dev.giggle.local accounts in a NEW server/.env.
              For a private local development server only.
--check       Check tool versions only; do not install or write files.

Next: configure/start MongoDB and Redis, then run:
  npm --prefix server run dev
  pnpm dev:desktop

See docs/HANDOVER.md for provider setup, game integration and deployment.
HELP
      exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; exit 2 ;;
  esac
done
for executable in node npm pnpm; do
  command -v "$executable" >/dev/null 2>&1 || { printf 'Missing %s. Install Node and pnpm 10 first.\n' "$executable" >&2; exit 1; }
done
node -e 'const [major, minor] = process.versions.node.split(".").map(Number); if (major < 20 || major > 24 || (major === 20 && minor < 18)) { console.error("Use Node 20.18–24; Node 22 is recommended."); process.exit(1); }'
pnpm_major="$(pnpm --version)"
[[ "$pnpm_major" == 10.* ]] || { printf 'Use pnpm 10 (found %s).\n' "$pnpm_major" >&2; exit 1; }
printf 'Tools ready: Node %s, pnpm %s\n' "$(node --version)" "$pnpm_major"
[[ "$check_only" == true ]] && exit 0

cd -- "$giggle_root"
pnpm install --frozen-lockfile
npm --prefix server ci
node - "$giggle_root" "$local_auth" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [root, localAuth] = process.argv.slice(2);
for (const folder of ['server', 'apps/desktop']) {
  const target = path.join(root, folder, '.env');
  if (fs.existsSync(target)) {
    console.log(`Preserved ${folder}/.env`);
    continue;
  }
  let content = fs.readFileSync(path.join(root, folder, '.env.example'), 'utf8');
  if (folder === 'server') {
    for (const key of ['JWT_SECRET', 'AUTH_EXCHANGE_SECRET']) {
      content = content.replace(new RegExp(`^${key}=$`, 'm'), `${key}=${crypto.randomBytes(32).toString('hex')}`);
    }
    if (localAuth === 'true') content = content.replace(/^DEV_AUTH_ENABLED=false$/m, 'DEV_AUTH_ENABLED=true');
  }
  fs.writeFileSync(target, content, { mode: 0o600, flag: 'wx' });
  console.log(`Created ${folder}/.env (secret values are not printed)`);
}
NODE
printf '\nSetup complete. Configure MongoDB/Redis and provider keys in server/.env.\n'
printf 'Existing .env.local files may override these defaults; see docs/HANDOVER.md.\n'

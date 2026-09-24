# Giggle: Claude Code handoff

## Start here

You are the manager for this existing project. The user is moving from Codex because their ChatGPT allowance is nearly exhausted. Use Claude mainly for scoping, delegation, integration decisions, and final review; put implementation into the requested worker CLIs. Do not use Codex or the OpenAI API as a fallback.

Read applicable AGENTS.md files, inspect `git status`, and preserve the dirty worktree. Do not reset, clean, stash, overwrite unrelated changes, or assume HEAD includes the current implementation. Existing `.claude/launch.json` belongs to the user. New Git worktrees start from commits and will NOT contain these uncommitted changes.

## Delegation

The following routing is a starting hypothesis, not a benchmark claim:

| Worker | Starting assignment |
| --- | --- |
| Muse Spark through `muse` | Visual direction, avatar/component critique, difficult reasoning and independent review. Attach screenshots only when needed and supported. |
| GLM 5.3 through `opencode` | Substantial implementation, cross-file integration, debugging, backend validation. |
| GLM 5.3 Flash through `opencode` | Bounded CSS changes, straightforward fixes, documentation, running focused checks and summarizing failures. |
| Claude manager | Acceptance criteria, choosing worker/scope, inspecting diffs, resolving disagreements, verifying completion and communicating. |

Check actual model availability and credentials first. Installed `muse exec --help` supports `--model`, `--prompt-file`, `--workspace`, and `--max-model-steps`. Installed `opencode run --help` supports `--model provider/model#variant` and `--file`. Model discovery in interactive zsh now confirms `zai-coding-plan/glm-5.3` and `zai-coding-plan/glm-5.3-flash`. The launcher defaults to these verified Z.AI Coding Plan IDs; these coding workers use that plan, not OpenRouter. Never silently substitute another model. Muse Spark's exact Muse CLI ID still needs verification.

Export a verified `MUSE_SPARK_MODEL`. Optional `GLM_53_MODEL` and `GLM_53_FLASH_MODEL` exports override the verified defaults. Do not put credentials in these variables or in committed files.

Create a short task file with: objective, owned files, context, acceptance checks, forbidden changes, and required final report. Then run from the repo:

```sh
scripts/claude-handoff.sh spark /absolute/path/task.md
scripts/claude-handoff.sh glm /absolute/path/task.md
scripts/claude-handoff.sh flash /absolute/path/task.md
```

Keep one writer at a time in this shared dirty checkout. Parallel read-only reviews are fine; use explicit nonoverlapping ownership if parallel edits become necessary. Inspect results rather than trusting completion claims. Require concise reports with changes, commands/results, and remaining limitations. Escalate a task after an unsuccessful focused attempt instead of looping the cheap model. Avoid repetitive full-suite runs. At the user’s explicit request, the manager launcher runs `claude --dangerously-skip-permissions`, bypassing Claude permission prompts. Muse and OpenCode retain their normal permission settings; their launcher commands do not enable bypass/auto-approval flags. No worker calls or paid jobs were launched by Codex for this handoff.

## User intent and design constraints

Build a distinctive, attractive, stylized Giggle avatar system with editable components, clothes/apparel, colors and expressive animation. No realism. The user disliked pointy chins, generic fonts, numbered marketing sections and AI-sounding promotional copy. Keep the UI simple and responsive. Header branding and clothing emblem use the same official Giggle logo. Artwork is custom code; do not import third-party character packs or claim legal exclusivity for AI-assisted artwork.

Photo matching should eventually choose existing knobs, NOT generate SVG or raster art from scratch. Manual customization stays available. The latest request was to research and test efficient models, including Jev. See `docs/SELFIE_MATCHING_PLAN.md` for sources and the distinction between proposals and implemented features.

## Current local implementation

- `packages/avatars/src/index.tsx`: reusable React SVG renderer; 8 hairstyles, 3 face shapes with softened jaws, glasses/facial hair, 5 clothing options, beanie/cap, studs/hoops, 5 colors, 6 proportion sliders, expressions and reduced-motion-aware animation. Logo paths come from `packages/ui-tokens/src/logo.ts`.
- `apps/desktop/app/avatar-playground/`: editor with Face/Hair/Details/Outfit/Colors sections, palettes/custom colors, preview, presets, save and JSON export. Hair thumbnails deliberately omit hats. Signed-in back link returns to profile.
- `server/src/utils/characterConfig.js` plus `.d.ts`: shared strict configuration validation and versioned `giggle:v1:` string encoding. This stays inside server for Railway packaging.
- `packages/core/src/avatars.ts`, `AvatarArt.tsx`, `AvatarPicker.tsx`, `avatarSync.ts`, server avatar utilities and User model: manual configuration persists in the existing avatar string field; legacy IDs remain valid; friends/squads/public serialization support validated configurations. Failed saves retain editor state.
- Community/landing/sign-in/home changes are also uncommitted. Inspect rather than overwrite them.
- `packages/avatars/prepare-eval.cjs` (28 synthetic fixtures + manifest, offline) and `packages/avatars/run-eval.cjs` (capped paid comparison; `--dry-run` is free). The synthetic pilot has been measured; real-photo likeness has not. Photo matching itself: see Status below.

## Credentials: critical correction

Use ONLY `OPENROUTER_GIGGLE`, available in the user's interactive zsh configuration. The user explicitly forbade using `OPENROUTER_KALTVID`. That other key was checked for existence only and was never used for API calls. Never print, copy into prompts, commit, or report secret values. The launcher maps the Giggle variable to `OPENROUTER_API_KEY` for worker subprocesses and removes KALTVID from their environment. Do not fall back to stored OpenCode credentials belonging to another project; verify intended provider configuration before paid runs. Muse uses its own existing authentication.

To make the Giggle variable available, start in the user's normal interactive zsh and export it by name (`export OPENROUTER_GIGGLE`); do not copy its value into this document. Avoid sourcing all shell configuration in a script just to obtain secrets.

The previous Codex goal was marked blocked because only the standard key name was checked. The user then identified and authorized OPENROUTER_GIGGLE, which was confirmed nonempty. Credential discovery is resolved. The GLM worker IDs are verified; the Muse CLI model ID and live vision comparison remain pending.

## Status (24 September 2026, Claude manager session)

All five items from the previous "Next work" list are done. Nothing is committed or deployed.

- **Workers:** `muse-spark-1.3-contributor` is the user-chosen default (cheaper) and verified. GLM IDs are verified. The launcher passes `--trust-workspace` to headless Muse and accepts optional `IMAGE...` args for Spark. Workers can't write outside the repo; use the git-ignored `.worker-scratch/` (listed in `.git/info/exclude`).
- **Artwork:** removed the stray cheek shading and the hair highlight that reached the skin, and lowered the tee collar trim so it no longer ghosts the neck. The trim is now limited to tee/sweater/hoodie. Spark accepted the before/after renders across all hairstyles and outfits. Someone outside the workers also lengthened the neck path and set `.panel` min-height to 260px; both were kept.
- **Vision pilot:** measured on synthetic images; results are in `docs/SELFIE_MATCHING_PLAN.md`. Qwen3.7 Flash won on nearly every metric at ~$0.00004 per match, and prompt `match-v2` raised hair accuracy to 90%. Total pilot spend was ~$0.007 on the Giggle key (limit $50). Jev was not used (text-only).
- **Photo matching:** implemented behind `SELFIE_MATCHING_ENABLED` (see the plan's implementation update): server contract, endpoint, quotas and budget, a 429/503 fallback, and the editor panel. Spark reviewed the endpoint, and its lock, idempotency, timeout and cost findings were fixed.
- **Validation:** 417/417 server tests (`REDIS_URL=redis://127.0.0.1:16379/15`); 220/220 client/core/render tests; photo-flow Playwright 8/8 (`apps/desktop/e2e/photo-match.spec.ts -c e2e/local-running.config.ts`); a production `next build` passed; `verify:deploy-bundle` passed. A real end-to-end run (production web build on :4000 with a flag-enabled API on :3002) matched, applied and saved successfully.
- **Runtime note:** the manager accidentally stopped the Codex-started :3001 API with a pattern `pkill`, then restarted it with the same command, appending to `/tmp/giggle-character-api.log`. It now runs detached (nohup) with the same command and log, independent of any Claude session. Stop processes by port or PID only.

## Next work

1. Before enabling in production: create a separate capped OpenRouter key for Railway (`AVATAR_MATCH_API_KEY`), review provider retention for real photos, and set `SELFIE_MATCHING_ENABLED=true` for internal accounts only. Follow `DEPLOYMENT.md` and deploy only when the user asks.
2. Evaluate on ~30 consented real photos under the $1 evaluation budget; judge likeness by human review.
3. Optional: a per-command Redis timeout for the match service. Also consider per-hairstyle calibration if real photos show systematic confusions (for example, long read as bob).

## Verification and local runtime

Last observed: Next dev at localhost:4010; API at localhost:3001; local Mongo at 127.0.0.1:17017; Redis at 127.0.0.1:16379. Check live processes/health before restarting. Logs: `/tmp/giggle-preview-4010.log`, `/tmp/giggle-character-api.log`. Never point local tests at production databases.

Node may require this PATH prefix:
`/Users/divyansh/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin`

Evidence already obtained (revalidate changed areas, not every check repeatedly):
- 362 server tests passed, 220 client/core/render tests passed. Logs `/tmp/giggle-character-server-tests.log` and `/tmp/giggle-character-client-tests.log`.
- Five focused renderer/config checks passed after the latest thumbnail/navigation edits.
- Production Next build passed before the last two small UI edits; latest dev rendering verified after them.
- Browser verified save/reload of hoodie, beanie, hoops and custom palette selections, rendering on profile, mobile 390px without overflow, and return-to-profile navigation.
- Deployment bundle verification passed locally. No current avatar changes have been deployed or committed.

Commands from root:
```sh
node --test packages/avatars/render.test.cjs server/test/characterConfig.test.js
node --test apps/desktop/test/*.test.js packages/core/test/*.test.cjs packages/avatars/render.test.cjs
REDIS_URL=redis://127.0.0.1:16379 node --test server/test/*.test.js
node packages/avatars/prepare-eval.cjs /tmp/giggle-avatar-eval
```

Read installed Next docs as required by `apps/desktop/AGENTS.md`. Build from apps/desktop with `node ../../node_modules/next/dist/bin/next build` using appropriate LOCAL API environment. Deployment: read `DEPLOYMENT.md`; repo EYE-52/giggle, frontend Vercel, backend Railway. Do not deploy local environment values. The handoff itself does not request production deployment.

Keep an updated concise handoff/status note with completed work, exact validation, outstanding blockers and next action. Never claim the live model test or photo matcher is complete until it actually works.

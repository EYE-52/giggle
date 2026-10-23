# Game Detail Pages

Per-game URLs live at `/games/<id>/`. The generated detail page is an optional
fallback, not a design requirement. With `manifest.homepage: true`, the build
copies `games/<id>/home/` unchanged: its own complete HTML document, CSS,
scripts, navigation and art. Castle Clash demonstrates this path. Missing
opted-in entries fail the build rather than silently reverting to a template.
See `GAME_AUTONOMY_GUIDE.md` for custom homes and browser exports.

## Owned files

| File | Purpose |
|---|---|
| `scripts/build-game-pages.js` | The only generator. Reads `games/registry.js`, writes pages + sitemap. |
| `public/css/game-page.css` | Page styles. Reuses `style.css` vars/fonts; `gp-*` classes only. |
| `public/games/<id>/index.html` | Build output. Edit a custom home under `games/<id>/home/`, or the fallback generator. |
| `public/sitemap.xml` | Generated. Home + every game URL. |
| `test/game-pages.js` | Suite for the above. Run: `node test/game-pages.js` |
| `GAME_PAGES_GUIDE.md` | This file. |

The fallback CTA needs no JS. Custom pages own their scripts. Plain `Create room` submits
`GET /?game=<id>&name=…`; the `Customize + Create` button is a second native
submit carrying `wantsetup=1`. The only script on the page is the theme
one-liner copied from `index.html`. Non-customizable games (today: trivia)
render no customize button and say so honestly.

## Regenerate

```sh
node scripts/build-game-pages.js
node test/game-pages.js
```

Regenerate after any game add/remove/metadata change, and after the castle
module finishes. The build prunes stale safe-id dirs; unknown slugs are never
generated, so they stay real 404s on both Vercel and the node server (neither
rewrites `/games/*` to the shell — keep it that way).

## Generated fallback content contract

- Facts come from `registry.list()` only: name, tagline, players range, seats,
  spectators (`rooms hold up to LIMITS.ROOM_CAP`), renderer, communication
  hint, schema settings/packs. Nothing invented.
- How-to uses the canonical catalog `howto` with the same sentence split as
  `public/js/howto.js` (`splitHowto`). If that regex changes, mirror it in the
  generator — the dialog and the detail page must agree.
- All interpolated strings are HTML-escaped. Ids are allow-listed
  (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤40 chars); unsafe ids are skipped, never paths.
- Art is local only: manifest `art` when valid and present, else
  `/img/games/<id>.png|svg`, else a CSS initial tile. No remote URLs, no
  broken images. To add art for a new game, drop
  `public/img/games/<id>.svg` (or `.png`) and regenerate.
- The CTA posts to `/` and creates nothing by itself; visiting a detail page
  has zero side effects and needs no account. Room creation, query handling,
  and the Giggle bridge belong to the main app.

## Integrated room entry

1. `package.json` includes `"build:pages": "node scripts/build-game-pages.js"`,
   extends `test` with `&& node test/game-pages.js`, and chains the generator
   into the Vercel `buildCommand` (before/after `vendor`).
2. Local server (`server/server.js`, after audit): resolve `/games/<id>/` to
   `public/games/<id>/index.html` with an allowlisted registered slug. Vercel serves the directory index
   automatically; no `vercel.json` change needed.
3. Main app (`public/js/app.js` + `public/js/game-entry.js`): the entry
   module validates `?game=&name=[&wantsetup=1]` on `/` against the live
   catalog (name 1..16, invalid never creates, bare visits inert). A valid
   explicit form creates ONE room once the socket + catalog are ready
   (overriding the remembered `pb_room` autojoin, clearing the query after
   consumption), never auto-starts; the lobby then shows the game and opens
   its Howto, or the Customizer when `wantsetup=1` is supported. Embed and
   `/r/` flows are unaffected. Catalog cards carry compact native Details
   links (`detailsHref()` in `game-entry.js`). Suite:
   `node test/game-entry.js` (pure validation + real-WS clock/phaseStart
   checks).
4. Keep unknown `/games/*` slugs as real 404s — never rewrite them home.

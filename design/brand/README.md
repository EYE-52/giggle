# Giggle logo family

Review: open `index.html` (or serve the repository root and visit `/design/brand/`).

## Drawing

The two loop paths are copied verbatim from `apps/desktop/app/icon.svg`, with the same rounded caps, joins and 3.5-unit stroke. Meet uses its original `(6, 8)` translation. Games and After Dark use `(6, 6)` to leave room for their expressions. Meet itself is unchanged.

- **Games:** amber `#FFB020`, plum `#2B1220`, pink `#DE1E6A`. A pupil, `<` wink, open smile/tongue and three burst lines follow the selected top-right concept.
- **After Dark:** espresso `#120D0A`, champagne `#D8B26E`, red `#E52249`. Lower-right lips, two burst lines and a light 0.65-unit glow follow the selected bottom-right concept. The solid stroke remains clear without the glow.
- **Favicons:** same loops and stroke; remove the Games pupil and burst lines, remove the After Dark glow and burst lines, and simplify the lips. No blur at small sizes.
- **Wordmarks:** outlined Nunito 800, with `-.055em` spacing, matching `apps/desktop/components/Brand.tsx`. The source font is the existing self-hosted `apps/games/public/fonts/nunito-latin.woff2`. No new font is downloaded. `wordmark.svg` is for light surfaces; `wordmark-dark.svg` is for dark surfaces.

## Files in each product folder

| File | Use |
| --- | --- |
| `icon.svg` | Main rounded tile, 64-unit source |
| `favicon.svg`, `favicon-{16,32,48}.png`, `favicon.ico` | Simplified small mark; ICO contains all three sizes |
| `apple-touch-icon.png` | 180 × 180, full-bleed square for Apple's corner mask |
| `pwa-{192,512}.png` | Standard app icons |
| `maskable.svg`, `pwa-maskable-{192,512}.png` | Full background; art fits within the central safe circle |
| `wordmark.svg`, `wordmark-dark.svg` | Standalone vector lockups, no font dependency |
| `og.svg`, `og.png` | Editable source and 1200 × 630 social image |

`meet/icon.svg` is an unchanged review copy. No Meet app files are edited. After Dark assets are delivered here only. Nothing in `apps/games/adult` is touched.

## Rebuild

Requires Python with `fonttools` and `brotli`, plus the existing Games Playwright dependency and Chromium.

```sh
python design/brand/build-sources.py
node design/brand/render-assets.cjs
npm --prefix apps/games run build
```

The renderer exports both sets and copies only the Games assets into `apps/games/public/`. Generated game detail pages receive the favicon, manifest and OG tags from `apps/games/scripts/build-game-pages.js`.

## Visual review

- Reviewed the icons at 16/32/64/180/512px on light and dark surfaces, including the actual small PNG exports and both OG images.
- Checked the review page at 1920px and 390px. Samples keep their native sizes; large samples have a keyboard-accessible scroll area on narrow screens.
- Checked the live Games home in Day and Night at 1440px and 390px, plus the boot screen, practice, same-room, chess guide and reports page. The icons load with no page errors or horizontal home overflow.
- Checked all PNG dimensions, the exact Meet loop paths, and fully opaque maskable backgrounds. Every visible maskable detail fits the guaranteed central 80%-diameter circle.
- The build passes. The existing release test now checks all three requested ICO sizes and their embedded PNG payloads.
- Full `npm test` in `apps/games` passed, including all 72 games / 1,224 browser fit measurements with zero failures or page errors, plus the final desktop/phone telemetry browser checks. The rewritten launch-transport artifact was restored; no release stamp is included.

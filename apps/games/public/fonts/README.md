# Bundled display/body fonts (SIL Open Font License 1.1)

PartyBox self-hosts its two approved open fonts so the party look never
falls back to a corporate system font when a CDN is blocked. Variable
woff2, latin + latin-ext subsets only (135 KB total); all weights used by
the UI (400–800) come from these four files.

- Baloo 2 — display face (EkType). Primary source:
  https://github.com/EkType/Baloo2
  Subset files fetched from the official Google Fonts css2 API
  (fonts.gstatic.com, Baloo 2 v23) 2026-10-04.
  License/notices: Baloo2-OFL.txt (exact copy of upstream OFL.txt at
  https://github.com/EkType/Baloo2/blob/master/OFL.txt).
- Nunito — body face (Vernon Adams / Cyreal / Jacques Le Bailly).
  Primary source: https://github.com/googlefonts/nunito
  Subset files fetched from the official Google Fonts css2 API
  (fonts.gstatic.com, Nunito v32) 2026-10-04.
  License/notices: Nunito-OFL.txt (exact copy of upstream OFL.txt at
  https://github.com/googlefonts/nunito/blob/main/OFL.txt).

Both families are licensed under the SIL Open Font License, Version 1.1
(http://scripts.sil.org/OFL). Upstream copyright notices, verbatim from
the included files:

- Copyright (c) 2019 Ek Type (www.ektype.in)
- Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)

The full OFL 1.1 text with numbered conditions and disclaimer is included
locally as Baloo2-OFL.txt and Nunito-OFL.txt; the subset woff2 binaries
here are unmodified redistributions of the designers' published fonts.

## Per-game display faces (2026-11)

Each game sets `--font-display` to one hand-picked face in
`public/css/skins.css`; the `@font-face` rules live in
`public/css/game-fonts.css` (font-display: swap, unicode-range, no
preload). Body text stays Nunito and the shared frame (header, buttons,
players row, menus) stays Baloo 2. A browser fetches a face only when a
game's text uses it, so a game adds one latin file (7–24 KB) and the
home page adds nothing. One static weight per family (latin + latin-ext
where the family has it; 186 KB for all 15 files on disk).

Files are unmodified copies from the npm `@fontsource/<family>` 5.3.0
packages (which redistribute the Google Fonts builds named below),
fetched 2026-11-06. Each `*-OFL.txt` is the package's LICENSE file
verbatim: the upstream copyright line(s) plus the full OFL 1.1 text.

| Family | Weight | Files | Google Fonts build | Licence / notice |
| --- | --- | --- | --- | --- |
| Fredoka | 600 | fredoka-latin, fredoka-latin-ext | v17 | Fredoka-OFL.txt — Copyright 2016 The Fredoka Project Authors (https://github.com/hafontia/Fredoka-One) |
| Lilita One | 400 | lilita-one-latin, lilita-one-latin-ext | v17 | LilitaOne-OFL.txt — Copyright (c) 2011 Juan Montoreano, Reserved Font Name "Lilita One" |
| Bungee | 400 | bungee-latin, bungee-latin-ext | v17 | Bungee-OFL.txt — Copyright 2023 The Bungee Project Authors (https://github.com/djrrb/Bungee) |
| Russo One | 400 | russo-one-latin, russo-one-latin-ext | v18 | RussoOne-OFL.txt — Copyright (c) 2011-2012 Jovanny Lemonad, Reserved Font Name "Russo" |
| Righteous | 400 | righteous-latin, righteous-latin-ext | v18 | Righteous-OFL.txt — Copyright (c) 2011 Brian J. Bonislawsky DBA Astigmatic (AOETI), Reserved Font Name "Righteous" |
| Fraunces | 700 | fraunces-latin, fraunces-latin-ext | v38 | Fraunces-OFL.txt — Copyright 2020 The Fraunces Project Authors (github.com/undercasetype/Fraunces) |
| Gochi Hand | 400 | gochi-hand-latin (no latin-ext upstream) | v27 | GochiHand-OFL.txt — Copyright (c) 2011 HT Fonts, Reserved Font Names "Gochi" and "Gochi Hand" |
| Patrick Hand | 400 | patrick-hand-latin, patrick-hand-latin-ext | v25 | PatrickHand-OFL.txt — Copyright (c) 2010-2012 Patrick Wagesreiter |

All are licensed under the SIL Open Font License, Version 1.1. The
Reserved Font Names are kept: the files are not renamed or modified.

# Compact desktop refresh

Base: 5da48aa8a908cc9b90a9b2c61b29553e1dc7c700, reviewed local release candidate. No new game, renderer, account, service or deployment changes.

Choose a targeted refresh. The live Ludo board already occupies 636×636 at1280×720 CSS pixels, and Trivia's prompt/answers fit. The home hero consumes nearly768px before showing playable choices; room invitation and management rows delay discovery. Doodle reserves124px along the entire left side for buttons that only need top clearance. These are layout and hierarchy problems, not evidence of a DPR failure.

## Design system

Retain the established party identity: raspberry #d92972, sunshine #ffbe35, ink #27243b, muted ink #6b677f, paper #ffffff and pale ground #f8f8fc. Reuse theme tokens so Night and Inside Giggle remain coherent. Baloo2 carries game titles; Nunito carries controls and body text. Keep body16–17px, descriptive metadata12–15px and primary interactive controls at least44px. Do not scale the browser, OS, or entire interface to solve density.

Discovery has a1280px content cap with fluid columns,16px card rhythm and a small header. The desktop hero puts the message, room ticket and decorative artwork in three balanced columns. At medium width it uses two columns; phones use one clear task sequence. Artwork is supplementary. Four compact featured choices lead into the searchable shelf. Lobby invitation, roster and player management share a compact band; expanded management can use meaningful vertical space. Game rules, renderer ownership, menus and accessible control semantics stay intact.

Doodle reserves top clearance for Room/Report rather than a full-height blank gutter. The canvas and guesses share remaining space with a bounded readable side column. Drawing coordinates remain880×520. Other full-screen games retain their existing viewport budgets.

Review against brief: changing fonts, palette, all game renderers or site architecture would add migration risk without addressing the measured problem. Compact visual hierarchy plus game-specific defects is the chosen scope. Game catalogue completeness, physical devices, Safari and authenticated Giggle integration need separate coverage; headless CSS emulation does not establish those.

## Verified measurements and regression

At1366×768/DPR1, home hero height632→376px; the three-player invitation band208.25→137.25px. At1280×720/DPR1, Doodle paper685.375×405→787.766×465.5px (32.1% more actual paper area); at1366×768 it grows28.5%. Ludo remains636×636 and684×684 respectively. Its layout is already responsive, so a blanket reduction would be counterproductive. A1366×768/DPR2 control retained the same CSS board dimensions.

`npm run test:compact-browser` is an optional Playwright regression (use the repository's externally installed browser tooling). It exercises actual room creation/join, the server-appointed artist, real pointer strokes, keyboard Room dismissal, compact desktop heights and mobile overflow. It requires no service credentials or new application dependency. Broader screenshot evidence is retained outside public assets in the task workspace.

Integration: this branch is a child of the paused release candidate, not the dirty original checkout. A future release can cherry-pick this isolated patch onto the then-approved release source; resolve any shell/CSS conflicts and rerun browser/build/release gates after rebasing. No remote freshness, publication or deployment is established by these local results.

## Short-landscape review correction

A real568×320 chess result exposed a preexisting overlap: the fixed Room/Report buttons covered the result title and winner after scrolling. The short-landscape board kit now explicitly uses a board/sidebar grid. Its44px launchers sit above the sidebar's clipped scrollport; the board retains the available full height. Sidebar children keep their natural sizes, and the narrow roster uses one readable column. Results, help and actions scroll within that sidebar rather than beneath the launchers. Portrait and normal desktop layouts retain their existing budgets.

The optional `npm run test:board-landscape-browser` regression exercises real legal chess checkmate/rematch, result/winner/action scrolling and focus, nearby Help/Room/Report states, readable roster width, and Ludo controls at568×320,842×388,1280×720,1366×768,1440×900,1920×1080 and390×844.76 checks passed before the final source freeze.

Trivia's80% display at568×320 is the preexisting in-app `autoZoom()` default for heights below520px in `public/js/zoom.js`. That file is unchanged from5da48aa. Fresh local capture contexts have no stored `pb_zoom` override and `visualViewport.scale` remains1. No browser or OS zoom/settings workaround is used.

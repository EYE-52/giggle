# Giggle GLM play-screen review

Reviewed all 458 findings across 70 reported games. Shared code affects the full 72-game catalogue.

Status totals: 79 deferred, 106 false positive, 273 fixed.

## What changed

- Fixed HUD tracks, a deliberate two-row phone HUD, and clearer seconds typography.
- Reserved phone utility space, restored Back, kept the zoom value visible, and bounded practice-tab scrolling.
- Compacted player cards, kept score units together, and moved desktop rosters beside the playfield where useful.
- Fixed Echo Pads zero-level scoring, Five Second no-answer status, the Dots & Boxes margin line, dial label wrapping, and snake/ladder number visibility.
- Kept genuine disabled states; verified Ballpark input and Fleet Duel placement enable the primary action.

## Verification

- Full `apps/games npm test` passed with exit code 0. `NODE_OPTIONS=--require=.../test-ports.cjs` only aliases local listener/client ports into 8320–8340; it does not skip assertions. The log is `npm-test-final.log`.
- Final targeted mounted-view checks passed: game kit, party mobile, layout stability, word/camera quality, the new Five Second reveal case, and all 59 batch-three rule groups.
- All 72 games have desktop 1440×900 and phone 390×844 pairs: 144 independent practice sessions and 288 a/b PNGs, six seconds apart.
- Final capture metrics: zero page errors, zero horizontal document overflows, zero observed layout-shift entries, and no tracked HUD/progress/clock/roster rectangle changes above 1 px between paired shots, including quick phase changes.
- Eighteen focused live checks passed: six timed clock/progress samples, six state/input checks, and six Night phone samples. Night samples were refreshed after layout changes.
- Pocket Karts STARTING has its own phone screenshot and a bounds assertion proving it clears the fullscreen control.
- This is browser emulation, not physical-phone evidence. Browser coverage is initial play plus the next six seconds and the selected enabled/timeout states; it is not every possible custom prompt or every state in Night.
- The longer Number Hunt, Scattergories and Twenty Questions secondary rosters/history can still continue below the fold. Their main controls remain visible; remaining polish is recorded below.
- PNGs remain local under the ignored artifacts directory. The report, decisions, verification summary and repeatable check scripts are committed.

Screenshots stay local in `after/{desktop,phone}/<game>-{a,b}.png`. Each pair is six seconds apart. Native practice uses the real server, separate sessions per device, and real seat frames. Extra enabled/timeout states and Night samples live under `after/`.

The supplied before a/b images and the new images were reviewed as contact sheets, with full-size checks for priority findings. Phase changes are real game transitions; stable HUD/action geometry is checked separately from canvas motion and changing text.

## Finding-by-finding decisions

Indices below are zero-based indices in `issues.json`. Every input finding appears once. “False positive” means the alleged bug is absent or the observed element is intentional; it does not imply every visual detail is ideal. “Deferred” is an explicit remaining item, not a claimed fix.

### 000 · backronyms · medium · both

**false positive** — The DOM contains exactly six li dots for six rounds. The active ring is the first dot, not an extra seventh dot; the live browser assertion verifies 6 == rounds.

> Rounds indicator shows 7 dots (1 active ring + 6 small dots) in the players panel header, but the round label says 'Round 1 of 6' — the dot count does not match the stated 6-round game.

### 001 · backronyms · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Lower half of the desktop page is largely empty: the left column ends at the 'Lock phrase' button (~y770) and the players panel ends around y670, leaving a wide dead pink band across the bottom ~130px of the 900px viewport; the layout looks unbalanced and unfinished.

### 002 · backronyms · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In each players-panel card the score renders as '0' at the far bottom-left and 'pts' at the far bottom-right, separated by the full card width, so the number and its unit read as two unrelated elements.

### 003 · backronyms · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Bottom 'Players' card is clipped by the bottom screen edge — only its header row ('Players' + dots) is visible before the viewport cuts it off at y=844, with no bottom padding, so the panel looks truncated.

### 004 · backronyms · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small solid dark dot sits on the top-right corner of the active 'Player 1'/'P1' pill; its meaning (notification/turn indicator?) is unexplained and at a glance it looks like a rendering artifact or speck.

### 005 · backronyms · low · both

**false positive** — These are labelled utility controls with accessible names/tooltips. Compact icon controls are intentional in the Giggle design rules, and no game action is hidden in this group.

> Multiple unlabeled icon-only buttons in the shell (grid, refresh, list, chat bubble, '?') give no indication of their function; for a casual party-game audience this chrome is unclear.

### 006 · backronyms · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> 'End' in the top bar is plain red text with no background or border — it reads as a text link rather than a button, and its destructive action has no visual weight or confirmation affordance.

### 007 · backronyms · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Lock phrase' is a washed-out grey button with low-contrast grey text on grey; it is presumably disabled because the input is empty, but there is no hint explaining that, so it can read as broken styling.

### 008 · backronyms · low · desktop

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Gap between 'Round 1 of 6' and the 'Write' chip (~35px) is disproportionately large compared with the tight grouping of '0/3 ready' + timer pill on the right — uneven horizontal rhythm in the round header row.

### 009 · backronyms · low · both

**false positive** — The outer ring is the visible focus indicator around a real input, not a duplicate input. Removing keyboard focus feedback would be a regression.

> The focused phrase input renders as two nested rounded rectangles (outer pink focus ring plus an inner white outline), which looks like a doubled or misaligned border rather than a clean focus state.

### 010 · ballpark · medium · both

**fixed** — Lock number is disabled for an empty field. Its hint now starts with Enter a number/whole number; a native input test verifies that entering 42 enables the coloured button.

> Primary CTA 'Lock number' renders as a washed-out pale lavender bar with low-contrast grey text; it reads as a disabled button, and with no visual hint that it activates once a number is entered the main action of the game looks inactive/unclear.

### 011 · ballpark · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel is clipped at the bottom viewport edge (390x844): the score row ('0' / 'pts') of both player cards is cut mid-element at the screen bottom, so scores are unreadable without scrolling and the cut-off looks unpolished.

### 012 · ballpark · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area: content ends around y≈690 leaving roughly the bottom 200px of the 1440x900 viewport as blank background (plus dead space under the Players panel), making the page look unfinished for a game.

### 013 · ballpark · low · both

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> Round-progress dots beside the 'Rounds' label are extremely pale grey on white — all 8 dots are barely visible, so round progress is effectively unreadable.

### 014 · ballpark · low · both

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In each player card the score renders as '0' at the far left and 'pts' at the far right with a large gap between them, so it reads as two disconnected fragments instead of '0 pts'.

### 015 · ballpark · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Status row wraps awkwardly: 'Round 1 of 8', 'Answer' chip and '29s' sit on one line while '0 / 2 locked' is orphaned onto its own left-aligned line below, leaving uneven spacing between the round info and timer.

### 016 · ballpark · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Unexplained small dark dot badge attached to the top-left 'Player 1'/'P1' tab on both devices; its purpose (notification? active indicator?) is unclear.

### 017 · ballpark · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The 'Answer' chip next to 'Round 1 of 8' looks like a tappable button but appears to be a passive phase label — misleading affordance.

### 018 · ballpark · low · both

**false positive** — The small ticket ticks are decorative, not an interactive number line. This estimation game accepts a wide numeric range; unit and input instructions provide the relevant context.

> The tick/ruler scale under the number input has no numeric labels, min/max values, or center marker, so players can't tell what range the '−'/'+' buttons step through or where they are on the scale.

### 019 · banned-words · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control collapses to a bare '- +' pair on phone, dropping the '100%' value shown on desktop, so there is no feedback of the current zoom state.

### 020 · banned-words · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header row, '0 correct' wraps to a second line and hangs right-aligned under the timer pill (on desktop it sits inline to the left of the timer), making the header look ragged and misaligned.

### 021 · banned-words · low · both

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> The 'Rounds' control in the Players panel renders as an orange ring with a separate small gray dot beside it, looking like a broken or half-rendered toggle switch rather than a clean on/off control.

### 022 · banned-words · low · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> The orange underline beneath the 59s/53s timer pill is identical in shot A and shot B despite 6 seconds elapsing; the timer progress indicator does not appear to update with the countdown.

### 023 · banned-words · low · both

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> The drop shadow of the word card overlaps the top edge of the dashed 'Avoid all four words.' hint box directly below it, making the dashed border look clipped/cut where it meets the card shadow.

### 024 · block-stack · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header (both shots), the '0 high' label wraps onto its own line below 'Round 1 of 3' while the timer pill it belongs to sits alone at the far right of the row above, so the stat reads as an orphaned, misaligned fragment instead of the grouped '0 high + timer' cluster shown on desktop.

### 025 · block-stack · medium · desktop

**fixed** — Block Stack groups its controls and compact roster beside the tall arena, removing the large gap between the action and scores.

> Large empty area in the right-hand column below the instruction text and action button (roughly 200px of dead space between the button and the player cards in both shots A and B), making the right side of the play area look unfinished and unbalanced against the tall game canvas.

### 026 · block-stack · low · both

**false positive** — Get ready is a real, briefly disabled countdown state. The visible 3–2–1 and wait instruction explain when dropping unlocks.

> In shot A the 'Get ready…' button is rendered flat gray with low-contrast gray text, so it looks disabled/broken rather than as an intentional waiting-state control; unclear affordance during the 3-2-1 countdown.

### 027 · block-stack · low · both

**false positive** — These are the opponents' platforms/towers in the shared stacking arena, not unsupported UI fragments. Removing them would hide opponent play.

> A pair of blocks (blue slab with an orange block on top) floats unsupported in the sky at the upper right of the game canvas in both shots, with no visible platform or explanation, reading like a rendering artifact rather than intentional scene decoration.

### 028 · block-stack · low · both

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Player cards at the bottom are mostly empty: wide cards contain only a name, '0 blocks' and a score row where the big '0' and the 'pts' label are separated by an odd fixed gap, leaving large blank horizontal space and a slightly misaligned number/unit pairing.

### 029 · block-stack · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> In shot B the instruction text wraps awkwardly, leaving the single word 'block.' orphaned on its own second line under 'Your tower has the white base. Space or Enter drops the'.

### 030 · bluff · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty region at the bottom of the 1440x900 viewport: content ends below the answer input (left column) and below the Players panel (right column) around y=670, leaving roughly the bottom 25% of the page completely blank in both desktop shots; layout is top-heavy and unbalanced.

### 031 · bluff · medium · phone

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area below the Players panel: content stops around y=590 of 844, leaving roughly the bottom 30% of the phone screen blank in both phone shots.

### 032 · bluff · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Players panel (right): 'Player 1 (you)' title is horizontally centered in its card while 'Player 2' and 'Player 3' titles are left-aligned — uneven heading alignment between the three player cards.

### 033 · bluff · low · phone

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Players row (three cards under 'Players'): the active Player 1 card is slightly taller than the Player 2 and Player 3 cards, so card bottoms and the 'Writing' labels sit unevenly across the row.

### 034 · bluff · low · desktop

**false positive** — The outer ring is the visible focus indicator around a real input, not a duplicate input. Removing keyboard focus feedback would be a regression.

> Answer input ('Your fake answer...') renders with a permanent double-ring outline (dark inner border plus purple outer ring) that reads like a stuck keyboard-focus state even before the user clicks it.

### 035 · bluff · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Header next to 'Bluff': the tiny leopard/animal logo icon is very busy and illegible at ~24px, reading as a smudge rather than an icon.

### 036 · bluff · low · desktop

**false positive** — These are labelled utility controls with accessible names/tooltips. Compact icon controls are intentional in the Giggle design rules, and no game action is hidden in this group.

> Top-right of the game area: the '− 100% +' zoom cluster plus the list and chat icon buttons look like document-viewer chrome rather than party-game UI; their purpose is unclear to players.

### 037 · chain-reaction · medium · desktop

**false positive** — Chain Reaction intentionally centres a compact turn/score group beside its full-size board. Empty cells are legal, tappable starting cells, not loading placeholders. No empty bordered sidebar is stretched to the screen bottom.

> Right-side info column is mostly empty: the 'Chain Reaction' / 'Turn 1' / scores block ends at ~y=630, leaving ~270px of blank beige space above the heading and ~250px below the Help button (down to the bottom edge), so the right third of a 1440x900 screen is largely unused and the layout looks unbalanced.

### 038 · chain-reaction · low · desktop

**false positive** — Chain Reaction intentionally centres a compact turn/score group beside its full-size board. Empty cells are legal, tappable starting cells, not loading placeholders. No empty bordered sidebar is stretched to the screen bottom.

> Content group is not horizontally centered: board left margin is ~237px while the info panel leaves ~185px to the right viewport edge, so the composition sits slightly off-center with an asymmetric gutter.

### 039 · chain-reaction · low · desktop

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> 'End' in the header is a bare red text label with no pill/border/background, unlike the bordered icon buttons next to it (grid, refresh, ?); it reads as plain text and its action is unclear.

### 040 · chain-reaction · low · both

**false positive** — Chain Reaction intentionally centres a compact turn/score group beside its full-size board. Empty cells are legal, tappable starting cells, not loading placeholders. No empty bordered sidebar is stretched to the screen bottom.

> Every board cell is an empty white circle with a dashed orange border and very faint connector dots/lines; at first glance the board looks like a skeleton/loading placeholder or broken image slots rather than a finished game, giving a weak first impression.

### 041 · chain-reaction · low · desktop

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> 'Turn 1' status text under the 'Chain Reaction' heading is very small (~12px) light gray on beige — low contrast and easy to miss for a key game-state indicator.

### 042 · chain-reaction · low · both

**false positive** — Practice P1/P2 are deliberate short seat names on phone, and inactive seat tabs remain selectable. They are neither clipped names nor disabled players.

> Inactive player tab (desktop 'Player 2' pill, phone 'P2' chip) is unfilled with light gray text; combined with the same shape as the active tab it can be mistaken for a disabled button rather than a selectable player.

### 043 · chain-reaction · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Floating orange '?' help button sits alone at the right edge (~x=340-375) on the same row as the centered 'Your turn' pill, crowding that row and making the centered header block look asymmetric.

### 044 · chain-reaction · low · phone

**false positive** — Chain Reaction intentionally centres a compact turn/score group beside its full-size board. Empty cells are legal, tappable starting cells, not loading placeholders. No empty bordered sidebar is stretched to the screen bottom.

> Board bottom edge stops at ~y=760 leaving an ~84px empty strip above the bottom of the 390x844 viewport while the score cards and turn banner are tightly packed above; vertical distribution of the content is uneven.

### 045 · charades · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty areas: main column content ends ~200px above the bottom of the 900px viewport, leaving a wide empty purple band, and the right-hand Players card ends around mid-page (~y487), leaving the whole right column empty below it — the 1440x900 layout looks unfinished/bottom-heavy with nothing there

### 046 · charades · low · desktop

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> In the 'Guesses coming in' empty state, the helper sentence 'Every guess the room makes lands here as they type.' wraps with a single orphan word ('type.') alone on the second line — awkward wrapping in the dashed box

### 047 · charades · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> '0 of 2 guessed' wraps onto its own left-aligned line below the 'Turn 1 of 3 / Player 2 acts' row (desktop keeps it right-aligned on the same row), so it looks like an orphaned stray label at top-left

### 048 · charades · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players card is clipped by the bottom viewport edge: the Player 3 row sits right at the 844px cut with the card border invisible, so the initial view looks truncated and requires scrolling

### 049 · charades · low · phone

**fixed** — The restored Back control and separate bounded seat scroller preserve 44px utilities and 8px gaps; seat tabs scroll instead of crowding the action buttons.

> Top bar is crowded at 390px: three player pills (P1/P2/P3) plus four action buttons (grid, refresh, End, ?) sit in one row with tight ~8px gaps, making tap targets look cramped

### 050 · charades · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> The tiny emoji-style icon next to the 'Charades' title (~28px) is very small and hard to identify at a glance, reading as a blurry smudge next to the header text

### 051 · checkers · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Game title 'Checkers' is overlapped and partially hidden behind the floating toolbar buttons (menu/chat/fullscreen) at the top; only '...ckers' is readable, the fullscreen icon sits directly on top of the wordmark

### 052 · checkers · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Subtitle 'English · 8 × 8' is crowded and partially obscured by the toolbar row above it; the title block is positioned behind the floating buttons instead of below them

### 053 · checkers · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Back-navigation arrow visible on desktop header is missing on phone; the 'P1' pill sits flush against the left screen edge (~8px margin), looking cut off

### 054 · checkers · low · phone

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> White content container ends abruptly around y=812 leaving a bare pink strip at the very bottom of the viewport, looks unfinished

### 055 · checkers · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right panel content (title, player cards, Your move card, Flip board, How to play, Resign/Offer draw) ends at ~y=510, leaving a large empty area (~370px) in the bottom half of the right column, layout feels unbalanced

### 056 · checkers · low · desktop

**fixed** — The board/panel group is centred with a larger bottom safe gap. The compact side panel is no longer aligned against one outer edge.

> Board bottom edge sits ~20px from the viewport bottom while the gap above the board is much larger, vertical spacing is asymmetric and the board feels crammed against the bottom edge

### 057 · checkers · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> Subtitle 'English · 8 × 8' is small light-gray text on the pale pink background, low contrast and easy to miss

### 058 · chess · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Floating control cluster (hamburger, chat, fullscreen) overlaps the page heading at the top: the fullscreen button covers 'Che' of the 'Chess' title so only 'ss' is readable, and the button edges clip the 'No time control' subtitle directly beneath it.

### 059 · chess · medium · both

**false positive** — Both b8 and g8 load bn.webp; both b1 and g1 load wn.webp. The screenshot shows the same horse-shaped knights. A live DOM assertion verifies the black knight asset on g8.

> Starting-position piece sprites on the g-file don't match the b-file knights: black g8 renders as a second bishop identical to f8 (two adjacent mitre-shaped pieces), and white g1 looks like a third rook like a1/h1 instead of a knight, so the initial setup looks visually wrong.

### 060 · chess · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small dark dot badge sits half outside the top-right corner of the 'Player 1' / 'P1' header pill, looking like a misplaced or clipped notification dot rather than an intentional badge.

### 061 · chess · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right sidebar is empty from below the 'Resign'/'Offer draw' buttons (approx. y 570) down to the viewport bottom — roughly the bottom third of the column is blank beige, unbalanced against the full-height board.

### 062 · chess · low · desktop

**false positive** — The repeated vertical lines are seams in the authored wooden-floor background, not a scrollbar or a stray sidebar border.

> A faint vertical seam/line runs the full height of the right sidebar around x≈1080, visible in the beige areas above and below the white cards, reading as a stray border or scrollbar-track artifact.

### 063 · chess · low · desktop

**fixed** — The board/panel group is centred with a larger bottom safe gap. The compact side panel is no longer aligned against one outer edge.

> Board frame sits almost flush with the bottom viewport edge (~15px margin) with the a–h coordinate labels crammed into the bottom rail, leaving no bottom breathing room at 1440×900.

### 064 · clue-grid · medium · both

**fixed** — The co-op setup card spans the available column. The setup field is shorter on phone, and the reshuffle/start controls retain their own space.

> Team roster card ('Red co-op crew') is left-aligned and occupies only the left half of the content column, leaving a huge empty area to its right (~440px dead space on desktop, ~195px on phone — nearly half the phone screen is blank). Layout looks unbalanced and unfinished.

### 065 · clue-grid · low · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> 'Players' panel at the bottom of the page is clipped mid-card by the viewport edge (player cards cut roughly in half at the bottom) with no visible scroll indicator or affordance.

### 066 · clue-grid · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Meta row wraps awkwardly: '0 / 8 turns' drops to a second line and floats under the timer pill, right-of-center and aligned to neither the 'Round 1 of 3' row nor the timer, looking orphaned.

### 067 · clue-grid · low · both

**fixed** — The co-op setup card spans the available column. The setup field is shorter on phone, and the reshuffle/start controls retain their own space.

> Excess unused vertical space inside the team card: ~70-80px of empty area below the last player chip before the card's bottom edge, making the card look stretched.

### 068 · clue-grid · low · both

**fixed** — The co-op setup card spans the available column. The setup field is shorter on phone, and the reshuffle/start controls retain their own space.

> The 'Reshuffle teams' button sits very close to the team card's bottom edge (~6-10px gap), much tighter than the surrounding vertical rhythm, so it nearly touches the card.

### 069 · color-clash · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The '1 / 20' (and '4 / 20') counter wraps onto a second line and floats below-left of the pink timer circle; it is not baseline-aligned with the 'Round 1 of 3' row and the timer cluster is not flush with the right content margin (roughly 60px dead gap to the screen's right rail). Desktop aligns the counter inline neatly, so the phone row looks broken by comparison.

### 070 · color-clash · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> The Players panel is clipped by the bottom edge of the 390x844 viewport: both player cards are cut mid-content ('Playing' visible, score row below the fold), so scores are not visible at all without scrolling and there is no fade or affordance hinting more content exists.

### 071 · color-clash · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area in the right-hand column (roughly x 885-1200, y 230-650): the two small hint blocks ('One answer per card...' and '5 points + speed bonus') float in the vertical middle with big blank space above and below, making the desktop layout feel half-empty and unbalanced against the dense left column.

### 072 · color-clash · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> The Players panel spans the full content width but its right half (right of the Player 2 card, roughly 480px wide) is completely empty.

### 073 · color-clash · low · both

**false positive** — The timer is the deadline for the current card. It resets for each new card while the 1/20 counter advances; unchanged scores mean no answer was sent.

> Timer affordance is confusing: the pink alarm-style ring suggests a countdown, yet the value increases between shots (1s -> 3s) while progress jumps 1/20 -> 4/20 in 6 seconds with both scores still 0, implying cards auto-advance; the meaning of the number (elapsed vs remaining) is unclear.

### 074 · color-clash · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> The back/exit chevron visible top-left on desktop is missing from the phone top bar, leaving 'End' as the only apparent way to leave the game.

### 075 · color-clash · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small black dot badge sits on the corner of the 'Player 1'/P1 pill but is unexplained - it reads as a stray notification indicator with no visible purpose.

### 076 · color-clash · low · both

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Inside each player card the score renders as a large '0' pinned to the left edge and a small 'pts' pinned to the right edge with a wide gap; it reads as two unrelated elements instead of '0 pts'.

### 077 · color-clash · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> 'End' in the top bar is a plain red text label among icon buttons - a destructive action with weak affordance; it is unclear whether it ends the round or quits the game for everyone.

### 078 · compliment-battle · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area: the write column ends just below the input/Send row (~y455) and the Players panel ends ~y670, leaving the entire lower third of the 900px viewport as bare patterned background; layout looks unfinished and not vertically balanced.

### 079 · compliment-battle · low · phone

**fixed** — The short phone round and roster now centre within the available stage instead of packing against the top.

> ~180px of unused empty background at the bottom of the 844px screen below the Players panel; content is top-packed instead of filling or centering the viewport.

### 080 · compliment-battle · low · phone

**fixed** — The phone player name retains the (you) suffix in the compact shared roster.

> Player 1 card in the Players panel is labeled just 'Player 1' without the '(you)' suffix shown on desktop, so the self-identification cue is lost on mobile.

### 081 · compliment-battle · low · phone

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> Round-progress dots in the Players panel header appear without the 'Rounds' label that desktop shows next to the same dots; the unlabeled dots are ambiguous.

### 082 · compliment-battle · low · both

**fixed** — Phase text uses the ink token on its soft family fill, improving contrast.

> The pink 'Write' phase badge (next to 'Round 1 of 3') uses medium-pink text on a pale pink fill; contrast is soft and it reads as slightly washed out / low emphasis.

### 083 · countdown-word · medium · desktop

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Between shot A and shot B the small dark status dot moved from the top-right corner of the 'Player 1' pill to a position floating above/right of the 'Player 2' pill, where it looks detached and unanchored to any element; no turn or other game-state change explains it, and the phone shots keep the dot on P1 at the same moment.

### 084 · countdown-word · medium · phone

**fixed** — The phone Countdown Word stack now centres within the available viewport instead of ending with one large unused bottom band.

> Large empty area at the bottom of the phone layout: nothing below the collapsed 'Rules' row (roughly the bottom 20% of the screen is blank), making the page look unfinished and unbalanced.

### 085 · countdown-word · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Large empty band below the collapsed 'Rules' row (~140px down to the bottom edge) plus a ~75px empty gap between the 'Save a word, then lock in' helper text and the 'THE TABLE' card; the lower half of the page feels sparse.

### 086 · countdown-word · low · both

**false positive** — The ellipsis is intentional prompt punctuation, not clipped text.

> Input placeholder reads 'TAP TILES OR TYPE...' — the trailing ellipsis makes it look like a truncated/cut-off sentence rather than an intentional hint.

### 087 · countdown-word · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game logo icon to the left of 'WORD COUNTDOWN' in the page header renders as a tiny noisy pixel mosaic — looks like a broken or illegibly low-resolution image.

### 088 · countdown-word · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Uneven horizontal spacing in the secondary button row under the input: Save→eraser gap ≈10px, eraser→Clear gap ≈17px, Clear→Pass gap ≈10px.

### 089 · countdown-word · low · both

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> '0 of 2 locked in' status text is small, light gray on the peach background — low contrast and easy to miss next to the timer pill.

### 090 · dare-roulette · medium · both

**false positive** — The badge reads 44s→38s, not 445→385. Live checks lose six seconds in about 6006 ms and show the progress fraction decreasing.

> Countdown badge (top-right of round bar: 435→375 desktop, 445→385 phone between shots A and B) drops 60 units in 6 seconds with no unit label; if the value is seconds it is counting ~10x too fast, and players cannot tell what the number means.

### 091 · dare-roulette · medium · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> Red progress bar under the countdown badge appears identical in shot A and shot B even though the numeric value decreases by 60, so the bar does not visibly reflect the timer state.

### 092 · dare-roulette · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel at the bottom is cut off by the bottom screen edge: the three player cards are truncated mid-height and the panel's bottom border/padding is not visible; if the page does not scroll, player scores are unreachable.

### 093 · dare-roulette · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty pink band (~150px) below the 'Spin the wheel' button down to the viewport bottom; the lower part of the main column is dead space and the layout feels vertically unbalanced.

### 094 · dare-roulette · low · desktop

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> In the Players panel, the 'Rounds' label plus 8 tiny gray dots is crammed between the 'Players' heading and the first player card, sits on a lower baseline than the heading, and the dots are very small and low-contrast; none of the dots indicates the current round despite 'Round 1 of 8' being active.

### 095 · dare-roulette · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Instruction pill under 'WHO TAKES THE DARE?' wraps awkwardly, leaving the single word 'dare.' orphaned on the second line.

### 096 · dare-roulette · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> Two competing spin affordances: the small 'Spin' pill next to 'Round 1 of 8' and the large primary 'Spin the wheel' button; unclear whether they do the same thing or which one should be used.

### 097 · dare-roulette · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The small 'Spin' pill is light pink with red text on a pink background, so it blends into the page and looks washed out / potentially disabled.

### 098 · dare-roulette · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Notification-style dot on the 'Player 1' / 'P1' pill in the top nav is clipped by the pill's rounded top-right corner and has no explained meaning.

### 099 · dare-roulette · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Inside each player card the name is horizontally centered but the '0 pts' line is left-aligned beneath it, producing ragged internal alignment in all three cards.

### 100 · dare-roulette · low · both

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> The logo emblem before 'DARE ROULETTE' is a detailed multicolor badge rendered at ~24px, where it reads as a muddy smudge rather than a recognizable icon.

### 101 · dare-roulette · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Vertical spacing between the instruction pill and the wheel's yellow pointer tip is very tight (only a few pixels), making the two elements feel cramped.

### 102 · dial-in · high · desktop

**fixed** — Dial endpoint labels wrap between words, with a readable named text style and enough chip width. Complex machine no longer splits inside a word.

> In the left dial panel, the right-hand spectrum chip renders as 'Comple × machin e' — 'Complex machine' is clipped mid-word ('Comple') and 'machine' breaks as 'machin/e' across four lines with no ellipsis or hyphen; unreadable and clearly broken. The two chips also have wildly uneven heights (2-line 'Simple tool' vs 4-line broken chip), making the row look ragged.

### 103 · dial-in · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel at the bottom is cut off mid-card at the screen edge: 'Player 1' and 'Player 2' card headers are truncated by the viewport with no visual hint that more content is scrollable.

### 104 · dial-in · low · desktop

**false positive** — The dial and private clue are vertically centred as one desktop group. Equal top and bottom edges are not needed for two different game pieces.

> The 'Secret target · 90' panel is not aligned with the dial panel beside it — its top edge starts roughly 75px lower and its bottom ends ~80px higher, leaving uneven spacing in the row.

### 105 · dial-in · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the toolbar shows only '−' and '+' with an empty gap where the '100%' label sits on desktop, making it look like two disconnected buttons instead of one control.

### 106 · dial-in · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> The game icon beside 'Dial In' in the header looks like a low-resolution, pixelated image that renders blurry next to crisp text.

### 107 · dial-in · low · phone

**false positive** — Practice P1/P2 are deliberate short seat names on phone, and inactive seat tabs remain selectable. They are neither clipped names nor disabled players.

> Top-bar player pills are truncated to 'P1' / 'P2' while desktop shows full 'Player 1' / 'Player 2' labels; abbreviation looks like clipped text.

### 108 · dial-in · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Send clue' button renders as a flat pale grey bar with low-contrast text, looking disabled/unclear; there is no affordance showing it will become active once a clue is typed.

### 109 · dial-in · low · both

**deferred** — The field is labelled and accepts input. The optional example/placeholder copy remains a small per-game writing improvement.

> Input placeholder 'What belongs here?' is styled bold and dark, so it reads as already-entered text rather than a placeholder.

### 110 · dial-in · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large unbalanced empty areas: ~150px of blank space below 'Send clue' and a tall empty region under the Players panel (panel ends ~290px above the viewport bottom), leaving the right column looking unfinished.

### 111 · dial-in · low · desktop

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> A thin darker strip is visible along the very bottom edge of the viewport, looking like a cut-off element peeking into the frame.

### 112 · dial-in · low · desktop

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> 'Rounds' toggle switch in the Players panel is very low contrast (white knob on a barely visible track), making its on/off state unclear.

### 113 · dice-fibs · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Round header wrap: '10 dice' drops to its own second line at the far left while its partner '29s' timer stays on the first line at the right, splitting the timer/dice-count pair and leaving uneven, awkward spacing under 'Cup round 1 / Bid'

### 114 · dice-fibs · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Call Liar' button renders as washed-out gray-on-gray text that looks disabled or non-interactive; its availability is only explained by the small hint line below it, giving it a weak affordance

### 115 · dice-fibs · low · both

**false positive** — Ceiling to whole seconds plus screenshot overhead can show a seven-second boundary change during an approximately six-second interval. There is no accumulating clock drift.

> Timer discrepancy between shots: '29s' → '22s' over a stated 6-second gap (a 7-second drop), suggesting slight timer drift or off-by-one in the countdown display

### 116 · dice-fibs · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Noticeable empty band (~125px of plain background) below the two player score cards at the bottom of the 1440x900 viewport; layout is top-heavy with unused space

### 117 · doodle-guess · medium · phone

**fixed** — Choosing remains visible in Doodle Guess on phone instead of being hidden by its game CSS.

> The 'Choosing' status label shown next to the 'Round 1 of 6' pill on desktop is completely missing on the phone header row, so phone players lose the phase indicator.

### 118 · doodle-guess · medium · phone

**false positive** — This is the word-picking wait state. The message names the chooser and explains what happens next; a fake drawing canvas would suggest that drawing is already open.

> Bottom half of the phone screen (~y430 to 844, below the info card) is one large empty area with no content or board placeholder, making the page look unfinished during the wait state.

### 119 · doodle-guess · low · desktop

**false positive** — This is the word-picking wait state. The message names the chooser and explains what happens next; a fake drawing canvas would suggest that drawing is already open.

> Large empty bands above (~y100-320) and below (~y660-900) the centered content; the dotted canvas is almost entirely blank, which reads as broken rather than intentionally idle.

### 120 · doodle-guess · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Small black dot badge on the active player pill ('Player 1' desktop / 'P1' phone) floats above and outside the pill's top-right corner, detached from the pill and with no clear meaning; it can look like a rendering artifact.

### 121 · doodle-guess · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Right edge of the '14s' timer pill (~x1121) does not align with the right edge of the info card below it (~x1098); the header row extends ~23px past the card, an uneven column alignment.

### 122 · dots-boxes · medium · both

**fixed** — Removed the decorative notebook-margin line. It could be mistaken for a played edge; actual game edges are unchanged.

> Stray vertical pink/salmon line runs along the inside-left edge of the board card for nearly its full height (desktop x≈228, y≈170–860; phone left edge of card). It does not connect any dots, is not aligned with the grid columns, extends above the top dot row and below the bottom dot row, and appears frozen in both shot A and shot B — looks like a stuck rendering artifact / leftover drag-preview line that could be mistaken for a played move.

### 123 · dots-boxes · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area in the right sidebar: content ends below the Resign / Offer draw buttons at roughly y≈510, leaving an empty column of ~390px down to the bottom of the 900px viewport; layout looks unfinished and unbalanced against the tall board.

### 124 · dots-boxes · low · phone

**deferred** — The full board fits the phone. Its scaled art caption/coordinates remain small; enlarging them needs extra space in the board frame without crowding cells or the action row.

> Caption 'A little line goes a long way' at the bottom of the board card is rendered very small (~9–10px), barely legible on a phone screen.

### 125 · dots-boxes · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Tiny black dot attached to the top-right corner of the active 'Player 1' / 'P1' header pill has no label or tooltip and reads as a stray artifact or unexplained notification badge.

### 126 · dots-boxes · low · both

**false positive** — The practice host mark is not a turn indicator. Turn state on the player and board status is useful in separate places, including when the roster scrolls.

> Turn state is communicated redundantly in three places at once (highlighted header pill, '• Your turn' inside the Player 1 card, and the 'Your turn. Join two dots.' panel), which feels cluttered.

### 127 · draw-off · high · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Player list row overflows the viewport: the third card is cut off at the right screen edge and its text truncates to 'Play' / 'Draw' (should be 'Player 3' / 'Drawing'); no right margin remains. Present in both phone shots A and B.

### 128 · draw-off · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Status row wraps awkwardly: '0 ready' drops to its own line under 'Round 1 of 4' (left-aligned orphan), while the timer '59s' sits alone at the far right, leaving a large uneven gap around the 'Draw' chip — unlike desktop where '0 ready' groups with the timer.

### 129 · draw-off · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Large empty band below the player cards (~120px on desktop, ~80px on phone) leaves the bottom of the page blank and the layout vertically unbalanced / unfinished-looking.

### 130 · draw-off · low · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> Timer pill's blue underline appears identical in shot A (59s) and shot B (52s / 53s); if it is meant to be a countdown progress bar it never advances, and if it is pure decoration it reads as a broken progress indicator.

### 131 · draw-off · low · phone

**fixed** — The player row now fits the phone grid; the old clipped sideways rail/line is gone.

> Thin stray horizontal line near the bottom-left screen edge, below the player list, with nothing else around it (visible in both phone shots) — looks like a clipped element or rendering artifact.

### 132 · draw-off · low · both

**false positive** — The icon is the game's existing illustrated cover thumbnail, not a placeholder animal emoji or broken image.

> Header icon next to the 'Draw Off' title is a spotted wild-animal (leopard/giraffe) emoji, visually unrelated to a drawing/party-game theme; feels like placeholder art rather than a game logo.

### 133 · draw-phone · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area: the write card and 'At the table' panel end around 2/3 of the viewport height, leaving ~280px of blank dotted background across the entire bottom third of the 1440x900 page; content is top-aligned instead of vertically balanced

### 134 · draw-phone · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Small unexplained dark dot at the top-right edge of the active 'Player 1'/'P1' chip (desktop top bar, phone top bar); reads like a stray pixel or ambiguous notification badge with no legend

### 135 · draw-phone · low · phone

**false positive** — Phone progress is visible in the writing card as 0 of 3 phrases saved, even though the compact toolbar only carries the clock.

> The '0 of 3 written' progress indicator shown in the desktop toolbar is missing entirely from the phone toolbar (only the timer remains), dropping progress context on mobile

### 136 · draw-phone · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Heading wraps awkwardly to 3 lines as 'Write something / funny for someone / else to draw', splitting the phrase 'someone else' across lines in the card at the top

### 137 · draw-phone · low · phone

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Suggestion chips have uneven heights: 'An elephant squeezing into a phone booth' and 'A time traveler photographing dinosaurs' wrap to two lines inside the pill while the third chip is one line, giving a ragged stacked list

### 138 · draw-phone · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Suggestion chips wrap unevenly (two chips on the first row, one on the second) leaving an asymmetric ragged arrangement under 'or borrow an idea'

### 139 · draw-phone · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> 'or borrow an idea' uses a light-gray handwritten script font that contrasts with the UI sans-serif elsewhere and is slightly low-contrast against the white card

### 140 · echo-pads · medium · both

**fixed** — Timer progress is clipped inside a fixed pill. Clock text uses the body-font button style, making the s unit clearer.

> The '1s' timer badge in shot A has a clipped, partially-rendered pink ring sliver sticking out at its bottom edge (visible on desktop and phone), looking like a broken progress-ring artifact rather than a clean badge.

### 141 · echo-pads · medium · both

**fixed** — Echo Pads now uses four simple pad shapes in its play title instead of a reduced full-cover raster thumbnail.

> The small game icon next to the 'Echo Pads' title renders as a garbled multi-color pixel blob; it is illegible and looks like a broken or extremely low-resolution image.

### 142 · echo-pads · medium · both

**false positive** — The result uses the reserved pad-stage height, with the result group centred inside it. Resizing it on reveal would move the action and roster.

> In shot B the results card is top-heavy: content (shapes, '0', 'Levels cleared') ends well above the card's bottom border, leaving a large empty dead area inside the panel on both desktop and phone.

### 143 · echo-pads · medium · both

**fixed** — Fixed authority scoring: a player who clears zero levels earns zero points even when all players time out together. The rule, full-match test, and live timeout screenshot agree.

> Shot B messaging is contradictory: the scorecard shows '0 Levels cleared' yet the side panel says 'You earned +100 points' and both player cards award 100 pts with 'Out' status, which is confusing for the player.

### 144 · echo-pads · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In shot A the 'Level 1 / 15' label wraps to its own line and is center-aligned, while 'Round 1 of 3' above it is left-aligned and the '1s' timer floats at the right edge; the resulting header row looks misaligned and unevenly spaced.

### 145 · echo-pads · low · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> In all four shots the Players panel and its player cards are clipped mid-card at the bottom edge of the viewport, cutting off the cards' bottom borders and points row.

### 146 · emoji-spotter · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Round header cluster wraps awkwardly: the '0 locked' label drops below the '19s'/'13s' timer circle and floats between rows (roughly x≈240–290, y≈195–205), aligned neither with the 'Round 1 of 8' row, nor with the right screen edge, nor centered — it looks like stray text with uneven whitespace above it. On desktop '0 locked' sits inline with the timer, so the phone stacking looks like a layout glitch rather than a deliberate arrangement.

### 147 · emoji-spotter · low · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players card is clipped by the bottom screen edge on first view: on desktop only the 'Players'/'Rounds' header row and a sliver of the next card (partial rounded rectangle at y≈893–900) are visible; on phone the 'Players' text and round progress dots are cut mid-height, so the panel looks truncated rather than inviting scroll.

### 148 · emoji-story · low · phone

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> Large empty background strip (~110px) below 'The table' card at the bottom of the 390x844 viewport; content ends high leaving a big blank area before the screen edge.

### 149 · emoji-story · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Back arrow ('<') shown at top-left on desktop is absent on the phone header, leaving no visible way back on mobile.

### 150 · emoji-story · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Small dark dot badge hanging over the top-right corner of the active player chip ('Player 1' / 'P1') has no label or affordance; its meaning is unclear and it looks like a stray artifact.

### 151 · emoji-story · low · both

**false positive** — This is the game skin's round badge colour, not disabled/action state. Round text and phase remain separately visible.

> 'Round 1 of 3' label uses amber/gold text on the pale cream background; contrast is borderline for its small size, slightly hard to read.

### 152 · emoji-story · low · both

**false positive** — These are labelled utility controls with accessible names/tooltips. Compact icon controls are intentional in the Giggle design rules, and no game action is hidden in this group.

> Header zoom control ('− 100% +') reads like a document/PDF-viewer widget rather than a party-game control, making the UI feel utilitarian and less playful.

### 153 · five-row · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large dead space in the right sidebar: ~120px empty gap between the 'Your turn. Place a stone.' panel and the 'How to play' link, and the entire region below the Resign/Offer draw buttons (~y570 to the bottom of the 900px viewport) is completely empty, making the sidebar look unfinished and unbalanced against the tall board.

### 154 · five-row · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> The back/navigation arrow ('<') shown at the top-left of the desktop header is missing on the mobile header; the header starts directly with the 'P1' pill, leaving no visible way to go back on phone.

### 155 · five-row · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> The '0 stones placed' / 'Turn 1' status row is small, light-gray text floating in whitespace above the board with no container or stronger hierarchy, so it reads as stray labels rather than game status.

### 156 · five-row · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> The header on phone is cramped into two stacked rows (icon nav row plus title row with menu/chat/fullscreen buttons squeezed beside the 'Five in a Row' title), which looks tight compared to the roomy desktop header; a small empty band also remains at the very bottom below the Resign/Offer draw row.

### 157 · five-second · medium · both

**fixed** — Five Second only labels the performer Answered when answers exist. A timeout says No answer; spoken play uses Spoken answers. Mounted-view and live timeout checks pass.

> Judge phase (shot B): answer panel says 'No answer was sent in time.' while the answering player's card in the Players panel is labeled 'Answered' with a star (desktop: Player 3; phone: Player 2) — contradictory status wording for the same state.

### 158 · five-second · medium · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the header collapses to only '−/+' on phone; the '100%' readout shown on desktop is missing, so the current zoom level is unlabeled (and a zoom control is odd clutter for a party game).

### 159 · five-second · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area: content (main card + Players panel) ends around y≈670 of the 900px-tall viewport in both shots, leaving the bottom ~25% of the screen as blank striped background; layout is not vertically balanced.

### 160 · five-second · low · phone

**fixed** — Five Second keeps a stable bottom roster on phone across answer and judge states.

> Large empty area below the Players panel (panel ends ≈y605 in shot A / ≈y740 in shot B of an 844px screen), leaving a big blank region at the bottom in both shots.

### 161 · five-second · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Small unexplained dark dot on the top-right corner of the active 'Player 1'/'P1' pill in the top bar — looks like a stray artifact or an unlabeled badge.

### 162 · five-second · low · desktop

**false positive** — The shared utility bar deliberately spans the app width while each game stage has its own centred width. The edges do not need to match; no control overlaps the playfield.

> Header row (icon/title and its divider, spanning ~x185–1253) is wider than the content column below (~x242–1199); the header's left edge does not align with the main card / 'Round 1 of 3' text beneath it.

### 163 · five-second · low · phone

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> Round-progress dots next to 'Players' have no label on phone (desktop shows a 'Rounds' label), so three tiny dots alone are unclear.

### 164 · fleet-duel · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Floating fullscreen/expand button at top-left is drawn on top of the 'Fleet Duel' heading, covering its first letters (reads like '...et Duel'); it also overlaps the '10 × 10 · 5 ships' subtitle beneath it. Title row layout collides with the toolbar.

### 165 · fleet-duel · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Bottom fleet-selector row is clipped by the viewport: the ship cards (Carrier/Cruiser/Frigate) and the ship icons inside them are cut off mid-card at the bottom screen edge, with no visible affordance that more content lies below.

### 166 · fleet-duel · medium · both

**fixed** — Confirm Carrier is genuinely disabled until a valid square is chosen. Its placement reason is visible above the button. A native tap enables Confirm; all five ship cards fit on phone.

> 'Confirm Carrier' primary action button looks disabled/unclear: light gray text on a pale lavender background with very low contrast, so it reads as a broken or inactive button at a glance.

### 167 · fleet-duel · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> 'Frigate 3' card in the ship selector is cut off at the right screen edge; only 3 of 5 ships (Carrier, Cruiser, Frigate) are visible and Patrol/Cutter are off-screen with no scroll hint.

### 168 · fleet-duel · low · desktop

**fixed** — The board/panel group is centred with a larger bottom safe gap. The compact side panel is no longer aligned against one outer edge.

> Right-hand panel column ends around x≈1230, leaving a large empty margin (~200px) along the right edge of the 1440px viewport; the panel is not centered or widened to use the available space.

### 169 · fleet-duel · low · desktop

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> A thin dark strip runs the full width along the very bottom edge of the viewport under the board, looking like a clipped element or overflow artifact rather than intentional spacing.

### 170 · fleet-duel · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Ship-picker grid is ragged: 'Cutter 2' wraps alone onto a third row leaving an empty gap beside it, making the 2-column layout look uneven.

### 171 · fleet-duel · low · phone

**deferred** — The full board fits the phone. Its scaled art caption/coordinates remain small; enlarging them needs extra space in the board frame without crowding cells or the action row.

> Board coordinate labels (A–J rows, 1–10 columns) are rendered very small on the phone (~9px) inside the chips, borderline hard to read for a casual game audience.

### 172 · four-in-a-row · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Page title 'Four in a Row' is overlapped/clipped by the floating toolbar buttons at top-left: the fullscreen button sits directly on top of the heading, so only '...r in a Row' is readable. Title collides with the menu/chat/fullscreen button row below the top bar.

### 173 · four-in-a-row · low · phone

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Dashed column-4 drop indicator renders through the board interior: dashed segments are visible crossing between the holes down multiple rows (on desktop the guide is neatly confined to the top/bottom of the column), looking like a z-order/rendering artifact.

### 174 · four-in-a-row · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right sidebar has a large empty area below the 'Resign' / 'Offer draw' buttons (~350px of blank beige down to the bottom of the screen) while the board column extends full height, making the layout feel unbalanced/unfinished.

### 175 · four-in-a-row · low · phone

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> Content ends at 'How to play', leaving an empty beige strip (~60px) at the bottom of the viewport instead of the layout filling the screen, minor unpolished spacing.

### 176 · funny-answer · medium · both

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty dead zone at the bottom of the page: on desktop everything ends ~230px above the fold (below the Players panel) and on phone ~240px above the bottom (below the Players row), leaving roughly a quarter of the viewport blank; content is top-anchored instead of vertically centered/balanced.

### 177 · funny-answer · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Helper text under the prompt wraps awkwardly, leaving a short orphan second line ('the vote.') centered under the longer first line — could fit on one line or wrap more evenly.

### 178 · hot-potato · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Fuse counter misalignment: '2 left' wraps onto its own line below the 'Fuse 1 / Pass' row and floats near horizontal center (~x250) instead of right-aligning with the row or panel edges — detached and uneven spacing.

### 179 · hot-potato · medium · phone

**fixed** — Pass the potato is completely visible without scrolling. The shorter history and compact roster also fit on the first screen; native phone captures verify the bounds.

> Primary CTA 'Pass the potato' is clipped by the bottom viewport edge (only the top sliver of the button visible at the fold), so the main action is not fully visible without scrolling.

### 180 · hot-potato · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> 'Players' panel and both player cards ('Player 1 (you)', 'Player 2') are cut mid-card by the bottom viewport edge at y=900.

### 181 · hot-potato · low · both

**fixed** — The empty answer-history card is shorter, leaving the Pass the potato button and player cards visible together.

> 'No answers yet' empty-state panel is oversized: ~60–80px of blank space below 'The holder starts the chain.' with no content filling it.

### 182 · hot-potato · low · desktop

**fixed** — On desktop the action and compact roster are grouped beside the playfield, aligned from the top instead of floating in a tall empty side column.

> Right column alignment: 'Pass the potato' button sits ~40px lower than the answer input (bottoms 616 vs 575), with the 'Keep it fresh…' helper floating between them — ragged two-column alignment.

### 183 · hot-potato · low · desktop

**false positive** — The shared utility bar deliberately spans the app width while each game stage has its own centred width. The edges do not need to match; no control overlaps the playfield.

> Game header row is not aligned with the content column: 'Hot Potato' title starts left of the banner edge (~x186 vs x240) and the comment icon ends right of it (~x1256 vs x1199), so top and body edges don't line up.

### 184 · hot-potato · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty region in the right column below 'Pass the potato' (nothing from y~616 down to the Players panel), producing uneven vertical whitespace versus the denser left column.

### 185 · hot-potato · low · both

**false positive** — The fuse is deliberately secret in Hot Potato. The server owns expiry; Pass is the phase label and the count is remaining players. Showing a fuse clock would change the game rules.

> 'Fuse 1' + 'Pass' chip + '2 left' cluster is ambiguous: unclear whether 'Pass' is a button or a status badge and what '2 left' counts.

### 186 · hot-potato · low · both

**false positive** — The fuse is deliberately secret in Hot Potato. The server owns expiry; Pass is the phase label and the count is remaining players. Showing a fuse clock would change the game rules.

> No visible fuse timer or countdown anywhere; the two desktop shots taken 6 seconds apart are pixel-identical, so the hot-potato screen shows no live or animated feedback.

### 187 · hot-potato · low · both

**deferred** — The field is labelled and accepts input. The optional example/placeholder copy remains a small per-game writing improvement.

> Answer input is completely empty with no placeholder or example text, and its thick brown double-ring border reads as a permanent focus state — looks unfinished.

### 188 · hot-potato · low · both

**false positive** — The potato is intentional simple game art with the straight-down sticker lip used by Giggle, not a duplicate DOM shape or missing asset.

> Potato illustration is a flat beige oval with a hard, offset gray shadow that reads like a duplicated-shape artifact — rough placeholder-style art for a party game.

### 189 · hot-takes · high · both

**false positive** — The pixels read 44s, 38s and 37s, not 4:45/3:85. Both desktop and phone live checks lose six seconds in about 6005 ms. Clock typography now makes the s clearer.

> Timer displays impossible mm:ss values with seconds > 59: desktop goes 4:45 → 3:85 and phone 4:45 → 3:75 after only 6 real seconds. The countdown math is broken (subtracts ~60-70s per 6s, ~10x too fast) and renders non-existent times like 3:85/3:75.

### 190 · hot-takes · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The '0 of 3 takes in' caption wraps onto its own line below the 'Round 1 of 1 / Write / timer' row, so the label is visually disconnected from the timer chip it describes (timer sits alone, right-aligned on the row above). Looks broken.

### 191 · hot-takes · low · both

**false positive** — The pixels read 44s, 38s and 37s, not 4:45/3:85. Both desktop and phone live checks lose six seconds in about 6005 ms. Clock typography now makes the s clearer.

> Timer chip renders as '445' / '385' / '375' with no visible colon separator, so it reads as a plain number rather than a time.

### 192 · hot-takes · low · desktop

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> The red ring next to 'Rounds' in the Players panel looks like an empty/broken radio or toggle with no visible state or explanation of what it does.

### 193 · hot-takes · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Unbalanced vertical spacing: ~150px empty gap between the 'Round 1 of 1' row and the 'DROP YOUR HOT TAKE' card, and ~170px of empty space below the 'Your take' card before the viewport bottom.

### 194 · hot-takes · low · phone

**fixed** — The short phone round and roster now centre within the available stage instead of packing against the top.

> Large empty band (~100px) below the Players panel at the bottom of the screen containing only faint background art; content ends high and the page feels unfinished.

### 195 · hot-takes · low · phone

**fixed** — The fixed HUD rows reserve space above the round; the hot-take sticker no longer crowds the progress caption.

> The rotated 'HOT TAKE' sticker's top edge nearly touches the '0 of 3 takes in' caption directly above the card — cramped spacing that risks collision at other text lengths.

### 196 · kalah · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Page title 'Kalah' is overlapped by the floating toolbar: the fullscreen button sits directly on top of the wordmark below the top bar, hiding 'Kal' and leaving only 'ah' readable; the header block and the menu/chat/fullscreen icon row occupy the same space.

### 197 · kalah · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Subtitle 'Mancala · 6 bowls · 4 seeds' is jammed against the bottom edge of the fullscreen toolbar button (top of the text touches/clips the button) and is small, low-contrast gray-on-beige text.

### 198 · kalah · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Bottom control row ('Flip board' / 'How to play') ends ~4px from the bottom screen edge with no margin or safe-area padding, so the buttons look clipped by the viewport.

### 199 · kalah · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large dead area below the board: the board ends around y=740 leaving an empty beige band roughly 160px tall at the bottom of the 900px viewport; the board column is not vertically centered, making the page look unbalanced/unfinished.

### 200 · kalah · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right sidebar is half empty: content stops after the 'Resign'/'Offer draw' row (~y=505), leaving roughly 400px of empty column space alongside the board.

### 201 · kalah · low · desktop

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> Seed-count labels ('4') for the top bowl row sit in the gap directly above the bottom-row bowls, so a count can easily be misread as belonging to the bowl beneath it.

### 202 · kalah · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> 'Your move' status card is oversized for its single line of text, leaving a visually vacant tall white box in the sidebar.

### 203 · know-me · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel at the bottom is cut off by the screen edge: the 'Player 1 / Hot seat' and 'Player 2 / Thinking' cards are truncated mid-card and their score rows ('0 pts') are not visible at all, with no visible indication there is more content below.

### 204 · know-me · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty band at the bottom of the 1440x900 viewport: all content ends just below the 'Lock my answer' button (~y690), leaving roughly the bottom 25% of the screen blank pink; layout is top-aligned instead of vertically balanced/centered.

### 205 · know-me · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Lock my answer' primary CTA is a pale gray-lavender fill with muted styling; before any option is selected it reads as disabled/unclear whether it is clickable, weakening the main action of the screen.

### 206 · know-me · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game icon left of the 'Know Me' header title looks like a blurry, jumbled multicolor blob rather than a legible mascot/logo — appears broken or badly rendered at header size.

### 207 · know-me · low · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> The red underline/progress bar inside the timer chip looks the same length at 24s (shot A) and 17s (shot B), so it does not visibly reflect the elapsed/remaining time between the two screenshots.

### 208 · know-me · low · both

**false positive** — These are the authored sofa armrests in the hot-seat illustration, not detached controls.

> Hot-seat illustration: two pale gray rounded rectangles stick straight out from the left and right sides of the dark-red sofa shape, looking like detached/misplaced elements or broken artwork rather than deliberate armrests.

### 209 · letter-lock · medium · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> The Players panel is clipped by the bottom edge of the viewport: the 'Player 1 (you)' and 'Player 2' cards and their P1/P2 avatars are cut off mid-element (desktop fold at ~900px, phone fold at ~844px), so the roster looks broken on first load and the avatars are half-visible.

### 210 · letter-lock · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> '0 / 6 tries' wraps onto its own line below the 119s timer pill and floats unaligned (indented right of center, not aligned with any element), unlike desktop where it sits beside the timer; it also sits only 2-3px above the 'Crack the five-letter lock' banner, looking cramped and like a broken flex row.

### 211 · letter-lock · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The 'Solve' chip next to 'Round 1 of 5' is very low contrast (pale lavender background with washed-out gray-purple text) and reads as a disabled button rather than an actionable control.

### 212 · letter-lock · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> The 'Check word' primary action button is rendered pale gray with light gray text on a white background; it looks disabled/uninviting for the main game action, with weak affordance even where it should invite a tap/click.

### 213 · letter-lock · low · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> The timer pill ('119s'/'112s' desktop, '119s'/'113s' phone) has a solid dark bar directly under the digits that hugs the pill's bottom-left and does not clearly read as a progress indicator; it looks like a stray underline or a clipped progress bar artifact.

### 214 · letter-lock · low · both

**false positive** — The straight-down coloured lip is intentional in the Giggle sticker design system, not a duplicate border.

> The offset 'hard shadow' on the title banner and the board container renders as harsh dark bands along the right and bottom edges, which at first glance reads as a rendering artifact or double border rather than intentional styling.

### 215 · letter-lock · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> The zoom control shows only '−' and '+' buttons with the '100%' value label hidden (desktop shows '− 100% +'), making the stepper's purpose ambiguous and the two buttons look orphaned mid-header.

### 216 · ludo · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small dark dot sits on the top-right edge of the 'Player 1'/'P1' header tab, overlapping the pill's border; it reads as a stray notification badge or rendering artifact rather than a clear turn indicator.

### 217 · ludo · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right control column ends just below the Resign button (~y 640), leaving a large empty pink region (~250px tall) at the bottom-right of the 900px viewport next to the full-height board, making the layout feel bottom-heavy/unbalanced.

### 218 · ludo · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> The four pawn-choice buttons (1–4) are grayed out with very muted, low-contrast pawn glyphs; the helper text explains they unlock after rolling, but at first glance they look broken or dead UI.

### 219 · lyric-fill · high · desktop

**deferred** — The supplied pair suggests an old clock/transition problem, but fresh desktop and phone sessions did not reproduce it. Measured six-second checks stayed in fill and changed 21s→14s / 20s→14s. The existing deadline math was retained; the progress rail now updates. Original capture timing is not available to identify a root cause safely.

> Shot A round timer shows '19s' remaining, but shot B taken only 6 seconds later already shows the finished-round reveal ('The true line', 'You did not answer this line.', both players 'No answer', '0 of 2 scored'). With 19s on the clock the round cannot have timed out — the countdown runs far faster than real time or jumps straight to round end.

### 220 · lyric-fill · high · phone

**deferred** — The supplied pair suggests an old clock/transition problem, but fresh desktop and phone sessions did not reproduce it. Measured six-second checks stayed in fill and changed 21s→14s / 20s→14s. The existing deadline math was retained; the progress rail now updates. Original capture timing is not available to identify a root cause safely.

> Timer pill reads '12s' in shot A and still reads '12s' in shot B taken 6 seconds later; the rest of the screen is identical. The countdown appears frozen/stuck and would never reach 0.

### 221 · lyric-fill · low · desktop

**fixed** — The shared fixed-width clock track stays inside the same HUD width as the play column.

> Shot A: the white '19s' timer pill in the round bar overhangs the right edge of the prompt card, the 'Lock in' button and the table card below it by ~20px, so the right edge of the round bar is misaligned with the content column.

### 222 · lyric-fill · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Shot B reveal screen: content ends around 60% of the 900px viewport, leaving a large empty pink band across the entire bottom third of the page.

### 223 · lyric-fill · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Answering state (shots A): the content column ends well above the fold (~165px empty on desktop, ~210px on phone), leaving a noticeable dead zone at the bottom of the screen with no footer or filler.

### 224 · lyric-fill · low · phone

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Prompt line '“Old MacDonald had a ____ ”': the closing quotation mark sits flush against the card's right padding, nearly touching the card border, with no breathing room.

### 225 · lyric-fill · low · both

**false positive** — The dot is part of the musical note/blank illustration, not an input cursor or detached UI status.

> A small pink dot floats detached above the blank underline in the prompt ('black ____' / 'had a ____'); it looks like a stray artifact or misplaced cursor rather than an intentional input indicator.

### 226 · lyric-fill · low · both

**fixed** — Lyric Fill uses the crisp initial play-title mark instead of the small detailed cover crop.

> The app icon left of the 'Lyric Fill' title is a chunky pixel-art sprite that renders blurry/jagged at UI size — looks like a low-resolution image scaled up rather than a crisp icon.

### 227 · lyric-fill · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> The small black dot on the top-right corner of the 'Player 1'/'P1' pill has no label or affordance; its meaning (active player? unread badge?) is unclear to users.

### 228 · math-dash · medium · phone

**fixed** — The solved count occupies the fixed progress slot directly beside the clock on row two of the phone HUD.

> The '0 solved' label floats detached below-left of the round timer circle (between the 'Round 1 of 3 / Sprint' row and the 'Solve the next one' banner); it aligns with neither the timer above nor the round text, and looks orphaned compared to the desktop layout where it sits beside the timer.

### 229 · math-dash · medium · desktop

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel at the bottom (below the keypad) is clipped by the bottom viewport edge: the 'Player 1 (you)' and 'Player 2' cards are cut off mid-card with only the avatar/heading sliver visible and no visual hint that more content is below the fold.

### 230 · math-dash · low · desktop

**fixed** — On desktop the action and compact roster are grouped beside the playfield, aligned from the top instead of floating in a tall empty side column.

> Large empty area in the right column: below the 'Check answer' button there is a big blank region (~150px tall down to the Players panel), plus a ~125px dead gap between the keypad card and the helper text; the right side feels sparse and unbalanced against the tall question/keypad card.

### 231 · math-dash · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> The 'Check answer' button is very pale (near-white fill, light gray-blue label, faint border); it is hard to tell whether it is enabled or disabled, and it reads as a washed-out secondary element rather than the primary action of the game.

### 232 · math-dash · low · phone

**fixed** — Check answer and the compact roster now have visible room below them on phone, rather than ending on the viewport edge.

> The 'Check answer' button sits flush against the bottom viewport edge with almost no bottom margin/safe-area padding, making it look cut off at the screen edge and awkward to tap.

### 233 · math-dash · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A tiny black dot overlaps the top edge of the Player 1 chip (on the 'Player 1' pill on desktop and the 'P1' avatar circle on phone); it has no label or legend, clips the chip border, and looks like a rendering artifact or unexplained badge.

### 234 · math-dash · low · desktop

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> In the Players panel header, the 'Rounds ● ○ ○' indicator renders like three radio buttons (one blue-filled, two gray outlines); its meaning as round progress is unclear and it invites mis-clicks.

### 235 · mega-tic-tac-toe · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right sidebar has a large empty area (~380px) below the 'Resign'/'Offer draw' buttons down to the viewport bottom, making the panel look unfinished and unbalanced versus the tall board.

### 236 · mega-tic-tac-toe · medium · both

**false positive** — All nine sub-boards are legal at the opening, so all nine have the same open-board rim. Later forced turns highlight the legal sub-board; the initial state does not imply only one legal board.

> Status copy says 'Pick a bright board' but no sub-board is actually highlighted or bright — all nine boards and all 81 cells render identically, so the instruction contradicts the visuals.

### 237 · mega-tic-tac-toe · medium · phone

**false positive** — The separate turn banner explicitly names whose turn it is, and the player chips identify X/O. The phone state is not conveyed only by border colour.

> Player cards drop the desktop-only details: no '• Your turn' status under Player 1 and no 'O' symbol under Player 2; turn state is conveyed only by the card border color.

### 238 · mega-tic-tac-toe · low · desktop

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Status message wraps awkwardly as 'Your turn. Pick a bright' / 'board.' leaving a one-word widow line, and the purple bullet dot is vertically centered between the two lines instead of aligned to the first line.

### 239 · mega-tic-tac-toe · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small black dot sits half outside the top-right edge of the 'Player 1' pill, overlapping the pill border — looks like a misplaced badge or rendering artifact.

### 240 · mega-tic-tac-toe · low · both

**fixed** — Mega Tic-Tac-Toe cell outlines use the stronger line token while retaining the legal-board family-colour rims.

> Empty-cell outlines are extremely faint light gray on white, making the 81-cell grid hard to read; on phone the cells are barely visible.

### 241 · mega-tic-tac-toe · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> 'Any open board' / 'Turn 1' header row is neither centered over the board nor aligned to its edges — 'Turn 1' ends well short of the board's right edge and the label sits left of the board's center.

### 242 · mega-tic-tac-toe · low · both

**false positive** — The square SVG playfield includes its own frame/caption in the measured outer container. Cells use the SVG viewBox and remain square.

> Mega-board container is slightly non-square (desktop ~695x710, phone ~354x378), so sub-boards and cells are subtly rectangular instead of square.

### 243 · mega-tic-tac-toe · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> ~110px of empty background band at the bottom of the viewport below the Resign / Offer draw row, while the board and cards are compressed above.

### 244 · mega-tic-tac-toe · low · phone

**false positive** — An entire 3x3-of-3x3 board must fit the phone. Cells occupy the available board grid; enlarging all 81 to 44 px would require a board wider than the viewport.

> Individual cells are roughly 28px tap targets — well below comfortable touch-target size — with thick purple gutters further shrinking the playable area.

### 245 · mega-tic-tac-toe · low · both

**false positive** — The subtitle is ordinary explanatory copy, not a broken rendering or game-state error.

> Subtitle 'Nine boards - One big plan' uses a spaced hyphen instead of an en/em dash — unpolished typography in the game's tagline.

### 246 · mega-tic-tac-toe · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> 'End' is a plain red text button mixed in with neutral utility icons (grid, refresh, help) in the top bar; the destructive action looks ambiguous and could be mistaken for a disabled or inactive control.

### 247 · memory-tray · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header row, '8 items' wraps onto its own line below 'Round 1 of 3' (left-aligned, y~198) while the 'Study' badge and 11s timer stay on the line above, producing an awkward two-line stack with uneven alignment between the four header elements.

### 248 · memory-tray · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Large empty area below the Players panel: content ends ~150px above the bottom on desktop (y~745 of 900) and ~100px above the bottom on phone (y~745 of 844), leaving trailing blank patterned background and a top-heavy layout.

### 249 · memory-tray · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A tiny dark dot badge overlaps the top-right corner of the 'Player 1' pill in the top bar; it looks like a clipped notification dot or rendering artifact and its meaning is unclear.

### 250 · memory-tray · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game icon next to the 'Memory Tray' title is a tiny raster-style image that looks pixelated/emoji-like next to the flat vector icons used everywhere else (zoom, list, comment, top bar).

### 251 · memory-tray · low · both

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> 'Rounds' progress dots in the Players panel header (top right) are very small (~8px) light-gray outline circles on white, low contrast and easy to miss.

### 252 · memory-tray · low · phone

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Inside the Player 1 and Player 2 cards, '0 pts' sits on the same line as the name while 'Studying' is pinned to the card bottom, leaving a large uneven vertical gap in the middle of each card compared with the stacked layout on desktop.

### 253 · moonlit-village · medium · desktop

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players sidebar (right panel): the Player 5 card is clipped by the bottom edge of the panel — its score row ('0' and 'pts') is cut in half mid-text and unreadable, with no visible scrollbar or fade indicating more content.

### 254 · moonlit-village · medium · phone

**fixed** — The practice seat strip is a bounded scroller with a visible scrollbar. Player tabs no longer occupy the utility buttons’ space.

> Top player bar: player pills overflow the screen — a fourth pill is clipped mid-render behind the grid button at the right edge (only a sliver visible), so Players 4 and 5 are cut off/inaccessible in the tab strip.

### 255 · moonlit-village · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Redundant copy stacked in the center column: 'Your role has no night action. Watch for dawn.', then 'No night action. Wait for dawn.', then a 'Waiting for dawn' button all repeat the same message three times in a row — looks unpolished.

### 256 · moonlit-village · low · desktop

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> The 'Waiting for dawn' element at the bottom of the center column is styled as a large full-width button but has disabled gray styling and no action; unclear whether it is a control or a status label.

### 257 · moonlit-village · low · desktop

**false positive** — The yellow orb is a moon/lit village detail in the authored night scene, not a day-phase indicator.

> The night illustration (houses row) includes a bright yellow sun-like orb during the 'Night' phase — reads as daytime and contradicts the 'Night' badge and moonlit theme.

### 258 · moonlit-village · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Status header spacing is uneven: 'Day 1', 'Night' badge and timer pill share one row, but '5 lanterns lit' wraps alone to a second row on the far left, orphaned from the timer/status it belongs with (on desktop they sit together on one line).

### 259 · moonlit-village · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Bottom of screen: the 'Players' panel is cut off by the screen edge showing only its title bar with empty space beneath — looks truncated rather than like intentionally scrollable content.

### 260 · moonlit-village · low · phone

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> The 'Protect lantern' primary action button is very low contrast (pale gray text on near-white) and reads as disabled/unclear before a player is selected, weakening the main call-to-action.

### 261 · most-likely · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area in the main column: content ends just below the two vote buttons (~55% of page height), leaving roughly 400px of blank beige background down to the bottom edge; the layout looks top-heavy and unbalanced.

### 262 · most-likely · medium · phone

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area at the bottom of the screen: the Players panel ends around 82% of viewport height, leaving ~145px of blank background below it with no content or footer.

### 263 · most-likely · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Awkward round-header spacing: the 'Vote' chip floats in the middle of the row far from 'Round 1 of 8', and '0 of 3 locked in' wraps onto its own line below, leaving the timer pill isolated at the far right; on desktop these elements sit together inline, so the phone grouping looks disjointed.

### 264 · most-likely · low · desktop

**false positive** — The faint changes are the authored skin background pattern, not a layout seam or overflow element.

> Faint vertical banding/light stripes visible in the background along the far left and far right edges of the page (roughly at x≈120–160 and x≈1280–1330) running the full viewport height; looks like an unintentional gradient/rendering artifact rather than deliberate decoration.

### 265 · never-ever · medium · both

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty dead zone at the bottom of the page: on desktop roughly the bottom 25% of the 1440x900 viewport (below the prompt/buttons and Players panel, y~672 to 900) is blank patterned background, and on phone roughly the bottom 22% (~190px below the Players panel) is empty. Content is top-packed, making the screen look unfinished and unbalanced for a party game.

### 266 · never-ever · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Hint pill text wraps awkwardly near the bottom of the prompt area: 'Answers stay secret until the' breaks to a second line leaving the lone word 'reveal.' orphaned.

### 267 · never-ever · low · phone

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In the three-across player card row, the highlighted 'Player 1' card is slightly taller/larger than the 'Player 2' and 'Player 3' cards, so the row's top and bottom edges are visibly uneven.

### 268 · never-ever · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The small 'Vote' chip next to 'Round 1 of 8' looks like an inert/disabled button (faint purple outline, no clear affordance), making it unclear whether it is clickable or just a label.

### 269 · number-hunt · medium · both

**false positive** — The ruler ends are boundary markers inside a clipped track. No element extends outside the board or covers input.

> Number-line ruler: dark vertical end-cap stubs at the extreme left and right edges poke out past the track's rounded corners and look clipped/cut off, like a rendering artifact on the central game board.

### 270 · number-hunt · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Main guess card: roughly 60px of dead empty space at the bottom of the card beneath the 'No guess yet / ? TRY A NUMBER' divider row, making the card look bottom-heavy and unbalanced.

### 271 · number-hunt · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the game header shows only '-' and '+' buttons with no '100%' readout, unlike the desktop header — the current zoom level is not visible on mobile.

### 272 · number-hunt · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> The 'Guess' button sits only a few pixels from the 1–100 stepper (they nearly touch), much tighter than the comfortable gap on desktop; the row looks cramped.

### 273 · number-hunt · low · phone

**deferred** — Guess stays visible. The secondary Players panel still needs a short vertical scroll on phone; making the full hint log and roster fit needs a denser game-specific layout.

> Players panel is sliced off at the bottom viewport edge — only the 'Players' heading and round-dots row are visible before the screen ends, with the player cards below the fold.

### 274 · odd-one-out · medium · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control pill in the top header shows only '-' and '+' with a large empty gap between them; the '100%' value visible on desktop is missing/truncated on phone.

### 275 · odd-one-out · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> No players/scores panel and no 'Rounds' progress dots anywhere on the phone screen — scores (0 pts) and round progress are only visible on desktop.

### 276 · odd-one-out · medium · both

**fixed** — Target cards use a compact control height and a bounded choice tray instead of tall mostly empty cards.

> Player target cards are mostly empty space: on desktop each ~600x145 pastel card contains only a small name pill vertically centered on the left, leaving large blank areas in the main play zone.

### 277 · odd-one-out · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> 'Ask out loud' label sits on its own line under 'Round 1 of 4' while its timer pill (149s) is at the far right of the line above — label and timer are visually detached and misaligned.

### 278 · odd-one-out · low · phone

**false positive** — Detailed cover thumbnails are intentionally hidden at narrow widths to preserve the game title and utilities.

> Game title icon (emoji next to 'Odd One Out') present on desktop is missing on the phone header.

### 279 · odd-one-out · low · both

**false positive** — The circles are intentional ticket perforations, not leftover resize handles.

> Two small white circles overlap the dashed border at the left and right midpoints of the 'Your place card' box, looking like leftover handles or broken/partially clipped icons.

### 280 · odd-one-out · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Ask this player' button is low-contrast pale lavender with muted gray text and reads as disabled; unclear whether it is tappable.

### 281 · odd-one-out · low · desktop

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In the Players panel cards, score '0' is flush far left and 'pts' is flush far right on the same row with a wide gap between them, reading as two disconnected elements.

### 282 · odd-one-out · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Back chevron ('<') shown at top-left of the desktop top bar is absent on the phone top bar, leaving no visible way back.

### 283 · odd-one-out · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game title icon next to 'Odd One Out' is a busy, cluttered emoji that reads as visual noise at ~24px size.

### 284 · penalty-kicks · medium · desktop

**false positive** — The shared utility bar deliberately spans the app width while each game stage has its own centred width. The edges do not need to match; no control overlaps the playfield.

> Header row is wider than the content column: the game icon/title starts at ~x183 and the menu/chat buttons end at ~x1256, while all content below (status row, banner, board, player cards) spans ~x240–x1200. Left and right edges are misaligned by ~56px, which looks unpolished.

### 285 · penalty-kicks · medium · both

**false positive** — The goalkeeper is playfield art behind live DOM goal targets. The full target hit areas remain above the canvas and tappable; centre targets intentionally share the keeper’s scene position.

> Center-column target reticles on the goal overlap the goalkeeper sprite (one sits on his head, another on his torso), partially obscuring the primary clickable targets and making them hard to see/tap.

### 286 · penalty-kicks · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> Primary action buttons ('Lock shot' in shot A, 'Next' in shot B) are very pale lavender with grey text, so they read as disabled/unclear rather than as the main call-to-action.

### 287 · penalty-kicks · low · both

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> The small game thumbnail icon next to the 'Penalty Kicks' title in the header looks pixelated/low-resolution at its rendered size.

### 288 · penalty-kicks · low · desktop

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Hint text 'Tap a target on the goal, choose power, then lock.' wraps awkwardly in the right panel, leaving a short orphaned second line ('then lock.').

### 289 · penalty-kicks · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Score '0 : 0' sits alone on its own row below 'Kick 1 / 10' with a large empty area to its right, while the timer pill is on the row above — an unbalanced, mostly-empty row (desktop keeps score and timer together on one line).

### 290 · penalty-kicks · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The status chip is not anchored: it sits at ~x137 as 'Pick 0/2' in shot A but shifts right to ~x163 as 'Kick' in shot B, so the layout jumps when the label text changes (desktop keeps it left-anchored).

### 291 · penalty-kicks · low · phone

**deferred** — This floating feedback/help placement remains. It needs an interaction check during real play and transitions so moving it does not cover another control.

> In shot B the 'Getting everyone ready...' toast crowds and slightly overlaps the bottom edge of the player-card area and sits very close to the bottom screen edge, looking cramped.

### 292 · penalty-kicks · low · both

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In the player cards there is an awkwardly large gap between the score number ('0') and the 'pts' label, so they read as two disconnected elements instead of '0 pts'.

### 293 · pick-one · medium · desktop

**false positive** — The room has entered its real readiness transition. The clock is intentionally hidden while controls are paused; voting is not silently open with a missing deadline.

> Shot B: the countdown timer pill next to '0 of 3 locked in' (visible in shot A as '4s') has disappeared entirely, leaving an empty gap, while the round badge still says 'Vote' and the hint still reads 'Pick A or B before the clock runs out.' — the copy references a clock that is not displayed.

### 294 · pick-one · medium · desktop

**false positive** — The room has entered its real readiness transition. The clock is intentionally hidden while controls are paused; voting is not silently open with a missing deadline.

> Shot B shows contradictory phase signals simultaneously: 'Vote' badge and the active-voting hint pill are still shown while the bottom of the screen displays a 'Getting everyone ready...' loader, so it is unclear whether voting is open or the round is transitioning.

### 295 · pick-one · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the header shows only '−' and '+' buttons without the '100%' percentage readout that desktop displays between them; current zoom level is not visible on phone.

### 296 · pick-one · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty band across the lower third of the viewport (below the hint pill, roughly the bottom 220px) contains only faint background art, leaving the center content feeling sparse and top-heavy on the 1440x900 layout.

### 297 · pig-dice · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large unbalanced empty area: all content ends at y≈660 and the right sidebar ends at y≈505, leaving the bottom ~28% of the 1440x900 viewport completely blank pink; both columns are top-aligned instead of vertically balanced.

### 298 · pig-dice · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> ~110px empty band at the bottom of the 390x844 viewport below the Resign / Offer draw / How to play row (y≈730-844); page content is not vertically balanced.

### 299 · pig-dice · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Player score cards row is uneven: the Player 2 card ends at x≈253 of 390, leaving a large empty gap on the right side of that row instead of the cards filling or centering across the width.

### 300 · pig-dice · low · phone

**false positive** — The coins are part of the authored pig illustration, not an interactive control collision.

> The rightmost floating gold coin decoration touches/slightly overlaps the tip of the pig's ear (around x≈165-200, y≈205-245); reads as an accidental overlap at this scale.

### 301 · pig-dice · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> 'Pig Dice' title is top-aligned with the menu/chat/fullscreen icon buttons to its left rather than vertically centered on the same row (title center ≈y84 vs icon row center ≈y95), so the row looks misaligned.

### 302 · pig-dice · low · desktop

**deferred** — The shared layout is fixed, but this secondary art/detail remains. Changing its shape or position needs a focused board/scene art pass.

> 'Round 1' and 'Turn 1 29s' header row spans x≈360-906, offset right relative to the pig play area beneath it (decorative ellipse spans x≈258-848), so the round/timer labels do not align with the edges of the play column.

### 303 · pig-dice · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Unexplained small black dot badge on the top-right corner of the active 'Player 1' / 'P1' tab in the top bar; looks like a stray notification dot with no clear meaning.

### 304 · pig-dice · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> Small light-gray helper caption 'The turn timer auto-holds.' under the Roll/Hold buttons has borderline contrast on the pale pink background at its very small size.

### 305 · pig-dice · low · both

**false positive** — A 1 means a die result of one. This is valid rule copy, not a typo.

> Rule copy 'A 1 loses this turn's total.' in the status card reads like a typo ('A 1' instead of 'a roll of 1') and is easy to misread at a glance.

### 306 · pocket-karts · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Shot A: the centered 'STARTING...' countdown banner is overlapped by the left HUD fullscreen icon button — the opening letters ('STA') are hidden behind the button so the title reads as '...ARTING...'. The HUD button row and the title share the same row on a 390px viewport with no reserved safe zone for centered text.

### 307 · pocket-karts · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Shot B: the race timer '2:55' is crammed directly against the right edge of the fullscreen button with virtually no gap (near-collision). The layout only avoids overlap because the timer string is short; it confirms the top-center HUD area has no clearance on phone.

### 308 · pocket-karts · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Shot A: the right end of the 'STARTING...' title sits only ~10px from the 'P1 0 КО ▾' badge, leaving the whole top HUD row overcrowded edge-to-edge.

### 309 · pocket-karts · low · both

**false positive** — The inventory ring communicates the real readiness/cooldown state. It does not change a target's position or hit area.

> Item slot button (bottom-left, '35' badge) changes border treatment between shot A (solid light ring) and shot B (dashed ring) with no tooltip, icon change, or other feedback explaining the new state — reads as an unexplained style flip rather than a clear game-state signal.

### 310 · pocket-karts · low · both

**false positive** — KO is the game's knockout score. The caret opens the live score/driver panel; it is a working HUD control.

> Top-right HUD badge reads 'P1 0 КО ▾' — the abbreviation is ambiguous (unclear whether it means knockouts), the pixel font's wide letter-spacing makes '0 КО' look truncated/garbled, and the dropdown caret suggests options that aren't obviously needed.

### 311 · pocket-karts · low · both

**deferred** — This floating feedback/help placement remains. It needs an interaction check during real play and transitions so moving it does not cover another control.

> A floating circular '?' help button sits inside the bottom control cluster immediately right of the 'Nitro 100%' pill; it is styled like a game control but is a help affordance, inviting mis-taps (especially on phone) and cluttering the driving HUD.

### 312 · pose-party · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Huge empty area: all content ends about two-thirds down the 900px viewport, leaving roughly 330px of blank pink background across the full width below the caption; layout looks sparse and unbalanced for a party game

### 313 · pose-party · medium · phone

**fixed** — The phone camera-game timer has its own correctly sized relative container and row; its SVG cannot expand over the prompt.

> Countdown ring (29/23) at the top-right of the prompt card crowds and appears to touch/clip the first line of the prompt heading near the word 'like'; no clearance between timer badge and heading text

### 314 · pose-party · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Helper sentence wraps awkwardly, splitting the quoted button name across lines: '...then tap "Done, / judge me".'

### 315 · pose-party · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> 'Round 1 of 2' pill looks stretched, with a wide empty pink area to the right of the label inside the pill

### 316 · pose-party · low · desktop

**false positive** — The shared utility bar deliberately spans the app width while each game stage has its own centred width. The edges do not need to match; no control overlaps the playfield.

> Top game-header row is misaligned with the content column: the Pose Party logo starts slightly left of the 'Round 1 of 2' pill below it, and the zoom/chat controls extend slightly past the right edge of the 'On stage' panel

### 317 · pose-party · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> Small gray caption 'Show it on your call. Giggle Meet puts your friends on the game stage.' is low-contrast on the pink background; on desktop it also floats detached, centered under the left column only in the middle of empty space

### 318 · pose-party · low · phone

**deferred** — The full board fits the phone. Its scaled art caption/coordinates remain small; enlarging them needs extra space in the board frame without crowding cells or the action row.

> About 100px of empty space at the bottom of the 844px viewport below the caption

### 319 · rank-it · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel is cut off at the bottom viewport edge: only the 'Players' header row and rounds dots are visible at y~830-844, with all player cards pushed below the fold right after the Lock ranking button, giving no hint of scrollable content.

### 320 · rank-it · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> Disabled arrow buttons are extremely faint: the up arrow on the first row (Flying/Dog) and the down arrow on the last row (Mind reading/Fish) nearly disappear into the light grey pill and can look broken or missing rather than intentionally disabled.

### 321 · rank-it · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Right-hand Players column ends at roughly y=670, leaving a large empty area (~230px tall) below it while the left ranking column runs to the bottom, making the layout bottom-unbalanced.

### 322 · rank-it · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> The 'Your ranking' label and the five ranking rows are inset ~65px relative to the 'Best superpowers' and instruction cards above them, so left edges inside the main column do not align.

### 323 · rank-it · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> The 'End' button in the top toolbar is styled as bare red text on white and reads more like a status label than a clearly tappable (and destructive) action.

### 324 · rank-it · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header row the 'Rank' badge floats between 'Round 1 of 5' and the timer pill with large, uneven gaps and is aligned to neither, looking arbitrarily placed.

### 325 · rank-it · low · desktop

**false positive** — The faint changes are the authored skin background pattern, not a layout seam or overflow element.

> The star-pattern background shows a subtle vertical tone shift/seam near the right edge (roughly the last 140px of the viewport), visible in both desktop shots.

### 326 · rapid-polls · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The 'Anyone can ask' caption wraps onto its own left-aligned line below the 'Round 1 of 8' row, visually detached from the timer pill ('44s'/'38s') it describes at the far right; on desktop the label sits next to the timer, so the phone layout looks disconnected and misaligned.

### 327 · rapid-polls · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> The Players panel at the bottom of the viewport is clipped mid-card: the Player 1 and Player 2 cards are cut off at the bottom screen edge, truncating the P1/P2 badges and '0 pts' text, which looks broken rather than cleanly scrollable.

### 328 · rapid-polls · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty band (~180px) of bare background with faint chart shapes across the bottom of the page below the form; the right Players panel also ends around y≈560 while the main card extends to y≈720, leaving uneven dead space in the right column.

### 329 · rapid-polls · low · desktop

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> In the Players panel header, the 'Rounds ●●●●●●●●' progress dots are tiny, pale gray on white (low contrast) and squeezed onto a right-aligned second line just under the 'Players' heading, creating cramped, uneven spacing.

### 330 · rapid-polls · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small dark dot on the top-right corner of the 'Player 1' pill overlaps the pill edge and reads as a stray artifact or undefined notification indicator; its meaning is unclear.

### 331 · rapid-polls · low · both

**false positive** — The die is a monochrome utility icon, not a broken image. It is intentionally quieter than the game cover.

> The dice icon in the 'Use a starter' button renders dark/monochrome and washed out, unlike the colorful chart emoji next to the 'Rapid Polls' title — looks like a faded or partially broken icon in an otherwise playful style.

### 332 · rapid-polls · low · both

**false positive** — These are labelled utility controls with accessible names/tooltips. Compact icon controls are intentional in the Giggle design rules, and no game action is hidden in this group.

> Two icon-only header buttons (list icon and speech-bubble icon) beside the zoom control have no visible labels or affordances, making their purpose unclear at a glance.

### 333 · reaction-tap · medium · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Wait-state screen (shot A): the Players panel is cut off by the bottom viewport edge — desktop shows only its 'Players'/'Rounds' header row, phone clips the two player cards mid-content — so the fold lands inside a component.

### 334 · reaction-tap · medium · both

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Results screen (shot B): all content ends after the Players panel (~635px of 900 on desktop, ~560px of 844 on phone), leaving the bottom ~30% of the viewport completely blank green background.

### 335 · reaction-tap · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Phone top bar has no back/exit chevron (desktop shows '<' at far left); the row starts directly with the P1 tab, so back navigation appears missing on mobile.

### 336 · reaction-tap · low · both

**fixed** — The phone cabinet uses the available middle stage; its instruction/status rows are compact and the roster stays anchored through results.

> Wait-state layout is sparse: the white game card is very large but its traffic-light/circle content occupies only the center third, and there are ~100px empty gaps between card, tip line, and Players panel, which pushes the panel below the fold.

### 337 · reaction-tap · low · both

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Duplicate copy on the wait screen: subtitle 'Tap too early and you foul out of the round.' and bottom tip 'Tip: An early tap knocks you out of this round.' convey the same instruction twice on one screen.

### 338 · reaction-tap · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Results screen (shot B): the '0 tapped' label wraps to its own line at far left under 'Round 1 of 5' while its paired countdown pill ('4s') stays on the row above at far right, splitting the group that desktop keeps together ('0 tapped 2s').

### 339 · reaction-tap · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Title row drops the game icon shown next to 'Reaction Tap' on desktop, and the zoom control loses its '100%' readout, leaving only '−' and '+' buttons whose purpose is ambiguous.

### 340 · read-my-lips · medium · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> Primary call-to-action button 'Mouth the phrase silently' (below the instruction text) has a very pale lavender fill and faint border, so it reads as disabled/inactive rather than the main game action.

### 341 · read-my-lips · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Status row layout is unbalanced: 'Round 1 of 4' is left-aligned and the 44s timer pill is right-aligned, but '0 / 1 guessed' drops onto its own centered line between them, floating with no anchor and looking misaligned compared to the single-row layout on desktop.

### 342 · read-my-lips · low · both

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Logo icon next to the 'Read My Lips' title in the game header is a tiny pixelated image that reads as visual noise / a broken or unreadable favicon at header size.

### 343 · read-my-lips · low · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel at the bottom is clipped mid-card by the bottom screen edge: the 'Player 1 (you)' and 'Player 2' chips are cut off through their avatars with no visible scroll affordance, so the section looks truncated rather than continuing.

### 344 · reversi · high · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Floating fullscreen/expand button in the left toolbar directly overlaps the 'Reversi' page title below the top bar; only '…ersi' is visible, the start of the word ('Rev') is hidden behind the button circle

### 345 · reversi · medium · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Hamburger, chat and expand toolbar row is positioned on the same line as the page heading, colliding with the header area instead of sitting clearly above or below it

### 346 · reversi · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area in the right sidebar below the Resign / Offer draw buttons (~380px tall, from below the buttons to the bottom of the viewport); sidebar content is top-heavy and unbalanced

### 347 · reversi · low · desktop

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> Status box text 'Your turn. Place a disc on a dot.' wraps awkwardly, leaving the single orphan word 'dot.' on the second line

### 348 · reversi · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Small black disc bullet icon in the status box sits visibly low, aligned near the bottom of the first text line instead of vertically centered with it

### 349 · reversi · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Tiny dark dot badge on the top-right edge of the highlighted Player 1 / P1 pill in the top bar is half-clipped by the pill edge and looks like a stray artifact; on phone it is also nearly cut off by the screen top edge

### 350 · reversi · low · phone

**false positive** — The whole Reversi square is the tap target. The small disc is a legal-move hint, not the size of the hit area.

> Legal-move hint dots on the green board are very small and low-contrast, making them hard to notice and presenting very small tap targets on a touch screen

### 351 · roast-toast · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area below the content: prompt banner, helper text and input end around y≈700 of a 900px viewport, leaving ~200px of unused blank background; the write phase feels sparse and vertically unbalanced.

### 352 · roast-toast · medium · phone

**fixed** — The phone round and compact roster form one centred group; the HUD retains a fixed row above it.

> Large empty area below the Players panel: content ends around y≈620 of an 844px viewport, leaving ~220px of blank patterned background with no content.

### 353 · roast-toast · medium · phone

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In the Players row, the Player 1 card is visibly taller than the Player 2 and Player 3 cards, so the card bottoms are misaligned and the row looks uneven.

### 354 · roast-toast · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> '0 of 2 written' is stranded alone on its own left-aligned row below 'Round 1 of 3'/'Write'/'59s', whereas desktop groups it next to the timer; the orphaned label looks awkward and unbalanced against the empty right side of its row.

### 355 · scattergories · medium · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game icon next to the 'Scattergories' title (top-left, next to header) renders as a blurry, low-resolution beige blob instead of a crisp icon; looks like a broken or heavily compressed image.

### 356 · scattergories · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the title bar shows only '−' and '+' buttons with the '100%' value label hidden, leaving an ambiguous pair of buttons whose state/purpose is unclear.

### 357 · scattergories · low · both

**deferred** — The five-answer form keeps all inputs and Lock in reachable; the secondary table continues below the fold. A denser roster/form redesign is still needed for a complete first-screen table.

> 'The table' card is clipped mid-row at the bottom edge of the viewport (the 'Player 1 (you) Writing' row is half cut off) with no visible scroll affordance, so the truncation looks like a rendering bug rather than scrollable content.

### 358 · scattergories · low · both

**false positive** — These are notebook binding/perforation details on the game art, not clipped control rails.

> Short vertical dotted line segments protrude from the left edge of every category card (left of the numbered badges), reading as stray border/dashed-rule artifacts rather than intentional decoration.

### 359 · sketchy-impostor · high · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Bottom player score strip is cut off at the right screen edge: the Player 3 card is clipped mid-word (name truncated to 'Play') and Player 4 is entirely off-screen, with no visible scroll indicator.

### 360 · sketchy-impostor · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Top bar: a fourth player pill is partially visible and overlapped/clipped by the grid toolbar icon immediately right of the 'P3' pill — elements collide at the header's right edge.

### 361 · sketchy-impostor · medium · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Lift to end your stroke' — apparently the primary action button — is pale grey with a hairline border and centered grey text, so it reads as disabled/unclear rather than tappable.

### 362 · sketchy-impostor · medium · both

**false positive** — These are notebook binding/perforation details on the game art, not clipped control rails.

> Column of small purple squares along the left edge of the drawing canvas is clipped in half by the canvas border, looking like a broken/cut-off toolbar or binding graphic.

### 363 · sketchy-impostor · medium · desktop

**fixed** — The desktop drawing stage centres its complete field/action/roster group in the available height.

> Large empty lavender band (~110px, full width) below the player score strip; content does not fill the 900px-tall viewport, leaving the page bottom bare.

### 364 · sketchy-impostor · medium · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> Timer pill's purple progress underline is the same width at 19s (shot A) and 13s (shot B), so the progress indicator does not visually reflect the decreasing time.

### 365 · sketchy-impostor · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> 'Lap 1/2' wraps onto its own line below 'Round 1 of 4' instead of sitting inline beside the timer as on desktop, producing uneven header spacing.

### 366 · sketchy-impostor · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Large vertical gap (~55px) between the two instruction lines 'Keep the word secret. Draw a clue with one stroke.' and 'Drag one continuous stroke. Lift to pass the pen.' looks like a missing element / uneven spacing.

### 367 · sketchy-impostor · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Black notification dot overlaps/clips the top-right edge of the pink 'Player 1'/'P1' pill in the top bar.

### 368 · sketchy-impostor · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> 'Draw' pill next to 'Round 1 of 4' is greyed-out with faint text and border, reading as a disabled button of unclear purpose.

### 369 · snakes-ladders · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Board is pushed hard against the right sidebar: a ~200px-wide empty vertical strip runs down the entire left side below the icon row (x≈0-210), while the gap between board edge and sidebar is only ~35px. The board is not centered in its column, making the layout look lopsided at 1440x900.

### 370 · snakes-ladders · medium · both

**fixed** — Square numbers are painted above snake/ladder art with a contrasting outline. Pawns remain above the numbers.

> Many square numbers are completely hidden behind snake/ladder artwork and unreadable: 82 (ladder), 84/85/86 (teal snake), 59 and 44 (purple snake), 56, 48/49, 28/29 (ladders), 31 (red snake head), 16, 4/6 (purple snake tail). Players cannot read roughly a dozen cell numbers on the core play surface.

### 371 · snakes-ladders · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Huge empty area in the bottom-right region: the right sidebar content ends at the Resign/Offer draw buttons (~y=590), leaving ~310px of blank column down to the viewport bottom, which makes the page look unfinished.

### 372 · snakes-ladders · low · phone

**deferred** — The full board fits the phone. Its scaled art caption/coordinates remain small; enlarging them needs extra space in the board frame without crowding cells or the action row.

> Board cell numerals are very small (~8-9px) and tightly cramped on the 390px board (e.g. top row '100 99 98...'), borderline unreadable for a numbers-based game.

### 373 · snakes-ladders · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> The green turn-indicator dot next to 'Your turn. Roll the die.' sits right on / slightly outside the status card's left border instead of inside the card padding, so it appears to poke through the card edge.

### 374 · snakes-ladders · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> '0 explorers home' label floats awkwardly in the toolbar row: it starts ~150px right of the icon cluster and aligns with neither the board's left edge nor the column center.

### 375 · snakes-ladders · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> 'End' button in the top bar is bare red text with no icon among neutral utility buttons; unclear whether it ends the turn or forfeits/quits the game, and its red styling reads as an alarming destructive action.

### 376 · snakes-ladders · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Bottom action row (Resign / Offer draw / How to play) sits only ~10px above the viewport bottom edge with no safe-area margin, feeling cramped and at risk of looking cut off.

### 377 · story-builder · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area in the lower ~25% of the page: below the 'Player 2 is writing the next line' pill there is only faint background illustration with no content from ~y500 to the bottom edge.

### 378 · story-builder · low · both

**false positive** — The live timer rail drains. The two images show a small fraction change on a short rail; the clock is not frozen. Live six-second checks record decreasing progress fractions.

> Teal underline inside the timer pill appears to be the same length in shot A (29s) and shot B (23s); if it is a countdown progress indicator it is not updating with the timer.

### 379 · story-builder · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Round/line header alignment is uneven: 'Round 1 of 3', the 'Writing' badge and the timer share one row while 'Line 1 of 3' hangs alone on a second row at the left, unlike desktop where 'Line 1 of 3' pairs with the timer.

### 380 · think-alike · medium · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> Primary CTA 'Lock thought' looks disabled (very pale fill, low-contrast gray label) even though the round is active and 0/2 locked — players cannot tell the button is clickable.

### 381 · think-alike · medium · both

**fixed** — Removed the thought-bubble tails that crossed the answer card border.

> Stray decorative bubble/pill shapes overlap the answer card: desktop shows two ellipses breaking through the card's bottom edge (below the input, around x≈540–580, y≈530–560); phone shows one ellipse crossing the card's bottom-left border (~x70, y493). Looks like misplaced/orphaned decoration.

### 382 · think-alike · low · desktop

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Game logo icon next to 'Think Alike' in the header renders as a pixelated/garbled emoji blob — looks like a broken or low-resolution image.

### 383 · think-alike · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> Back arrow ('<') present at far left of the desktop top bar is missing on the phone top bar — navigation control absent/possibly clipped on mobile.

### 384 · think-alike · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Round meta row wraps unevenly: 'Answer' badge and 24s timer sit on the first row while '0 / 2 locked' drops alone to a second row — unbalanced compared to desktop's single-row layout.

### 385 · think-alike · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> Red 'End' text-only button is placed directly among neutral utility icons (grid, refresh, help) in the top bar with no button chrome — a destructive action looks like a regular control and is easy to hit by accident.

### 386 · trivia · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty dead zone at the bottom of the viewport: content ends just below the 'Pick one answer' chip (~y620 of 900px), leaving ~280px of blank gradient background; the play area is top-aligned instead of vertically centered.

### 387 · trivia · low · phone

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> In the Players panel header, the 'Rounds' label next to the progress dots (present on desktop) is missing on phone, leaving the row of dots unexplained.

### 388 · trivia · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> No back/exit chevron in the phone top bar (desktop has '‹' at top-left before the player pills); exit navigation is absent on mobile.

### 389 · trivia · low · desktop

**false positive** — The shared utility bar deliberately spans the app width while each game stage has its own centred width. The edges do not need to match; no control overlaps the playfield.

> Header edges don't align with the content column: 'Trivia Blitz' logo starts at ~x180 while the question card and 'Question 1 of 8' start at ~x240, and the right-side toolbar ends at ~x1256 while the Players panel ends at ~x1200.

### 390 · trivia · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Uneven vertical spacing in the play area: ~80px gap between the answer grid and the 'Pick one answer' chip, but only ~23px between the chip and the Players panel.

### 391 · trivia · low · phone

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Empty band (~100px) of plain background at the bottom of the screen below the Players panel, making the layout feel unfinished.

### 392 · truth-dare · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area at the bottom of the viewport in both desktop shots: the game card and Players panel end around y~650 of a 900px-tall screen, leaving ~250px of blank pink background with no content or footer

### 393 · truth-dare · medium · phone

**fixed** — The phone round and compact roster form one centred group; the HUD retains a fixed row above it.

> Large empty vertical gap between the game card and the bottom-anchored Players panel (~120px in shot A, ~235px in shot B), making the middle of the 390x844 screen look unfinished

### 394 · truth-dare · low · phone

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> Shot B: the Player 2 card becomes taller than the Player 1 card once the 'Spotlight' line appears, so the two side-by-side cards in the Players panel have misaligned bottom edges

### 395 · truth-dare · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The small pill next to 'Round 1 of 2' ('Spin' in shot A, 'Choose' in shot B) is styled like a clickable button (bordered, colored background) but appears to be a passive phase label, which can confuse users

### 396 · truth-dare · low · desktop

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> Shot B: the 'Classic' deck card's orange outline is the only signal it is selected; no checkmark or 'selected' text, so it is unclear whether it is chosen or merely highlighted compared to the plain 'Funny' and 'Wild' cards

### 397 · truth-dare · low · phone

**deferred** — This readable per-game text wrap remains. Removing the orphan or shortening the label needs a copy/layout pass across changing prompts; it does not hide the primary action.

> The wheel's center 'T or D' badge stacks three very small lines of text in a tiny circle on the 390px layout, borderline readability at typical viewing distance

### 398 · twenty-questions · medium · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control next to '20 Questions' in the header shows only '−' and '+' with an empty gap where the '100%' readout appears on desktop, leaving an awkward, half-empty oversized pill control.

### 399 · twenty-questions · medium · phone

**fixed** — The decorative question mark is inset further on phone, clear of the card edge.

> The large decorative '?' watermark inside the blue 'No questions waiting.' panel is clipped by the panel's right edge (top-right corner); on desktop it renders fully inside the panel.

### 400 · twenty-questions · medium · phone

**fixed** — Question, queue and answer-history wells keep stable but shorter heights. Ask/Guess stay visible; the empty archive no longer stretches into a mostly blank column.

> 'No other questions queued.' sits flush against the very bottom viewport edge with no bottom padding or safe-area spacing, so the line appears cut off / risks being clipped.

### 401 · twenty-questions · medium · desktop

**fixed** — Question, queue and answer-history wells keep stable but shorter heights. Ask/Guess stay visible; the empty archive no longer stretches into a mostly blank column.

> The right 'Answered' panel is mostly empty: a large blank area (~60% of the panel height) below 'No answers yet.', making the right column look unbalanced against the dense left column.

### 402 · twenty-questions · low · desktop

**fixed** — Question, queue and answer-history wells keep stable but shorter heights. Ask/Guess stay visible; the empty archive no longer stretches into a mostly blank column.

> Large vertical dead space inside the blue 'No questions waiting.' panel between the heading text and the 'Ask the first question.' pill button; the panel looks stretched with no content filling it.

### 403 · twenty-questions · low · both

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> The 20-segment progress track under 'Ask yes/no questions, or guess the word outright.' is extremely faint/low-contrast, barely visible against the pale background.

### 404 · twenty-questions · low · desktop

**fixed** — Question, queue and answer-history wells keep stable but shorter heights. Ask/Guess stay visible; the empty archive no longer stretches into a mostly blank column.

> The 'Up next' section heading sits right at the bottom viewport edge with its content cut off below the fold, and there is an uneven large gap between the 'Guess the word...' row and this heading.

### 405 · twenty-questions · low · both

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> The small game icon next to the '20 Questions' title renders as a tiny, pixelated/garbled emoji, looking low-fidelity and unclear at header size.

### 406 · twenty-questions · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The 'Ask' chip in the round header row floats in the middle of the row with uneven spacing — not attached to 'Round 1 of 3' as on desktop and not aligned to the timer, so it looks misplaced.

### 407 · twenty-questions · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> The 'End' button in the top bar is plain red text on a light pill, which can read as an error/alert label rather than a clearly tappable button.

### 408 · two-truths · medium · phone

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Bottom ~third of the phone screen (below the Players panel, roughly 280px from y≈560 to the bottom) is completely empty; all content is crammed into the top half, leaving a large dead area.

### 409 · two-truths · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty band (~220px) below the 'Lock in' button and the Players panel; content occupies only the top ~75% of the 1440x900 viewport with nothing anchoring the lower area.

### 410 · two-truths · low · both

**fixed** — Play titles now use a crisp token-based initial mark instead of a tiny detailed cover crop. Echo Pads uses its four pad shapes; full cover art remains on the game shelf.

> Small game icon next to the 'Two Truths & a Lie' title is a pixelated/low-resolution image that looks broken or unpolished at its rendered size.

### 411 · two-truths · low · phone

**fixed** — Phone utilities reserve a row above the game heading. The back arrow is visible, tabs have a real scroll area, and safe-area padding is retained. Pocket Karts places its clock below the utility row.

> The round '?' help button in the top bar sits nearly flush with the right screen edge (only a few px margin) and appears partially clipped, unlike the other top-bar controls which keep comfortable margins.

### 412 · two-truths · low · desktop

**deferred** — This secondary label/control keeps its existing skin treatment. A colour/size change still needs focused Day and Night checks for this game and its selected/disabled states.

> The dashed 'Lie?' toggle pills on Statements 1 and 2 use light gray text and borders on white, low contrast and easy to miss as interactive controls.

### 413 · typing-race · medium · desktop

**false positive** — The target sentence begins with capital I. The display font makes it resemble punctuation; the source text and live target contain I opened, not ! opened.

> The desktop prompt sentence starts with a stray '! ' ('! opened the fridge...'), which reads like a typo of 'I opened the fridge' - an awkward/broken sentence in the main content area.

### 414 · typing-race · low · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control in the header loses its '100%' readout on phone (only '-' and '+' pills shown next to the list/chat icons), unlike desktop; users can't see the current zoom level and the two buttons look cramped/unclear.

### 415 · typing-race · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round info row, the 'Race' badge floats near the horizontal center of the screen with a large arbitrary ~68px gap after 'Round 1 of 4', instead of sitting adjacent to it as on desktop; the row looks misaligned.

### 416 · typing-race · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Uneven vertical rhythm: the gap between the typing input field and the race-track panel (~55-60px) is roughly 3x the gap between the prompt and the input (~18-20px), creating a large empty band across the page between the input and the tracks.

### 417 · undercover · medium · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Share clue' button is extremely low contrast (pale lavender fill on a pale green background with faint text) and reads as disabled/unclear; players cannot tell it will become tappable once a clue is typed.

### 418 · undercover · low · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area at the bottom of the page: all left-column content ends around 85% of viewport height, leaving ~130px of blank space below the 'Share clue' button and an unbalanced overall composition.

### 419 · undercover · low · both

**false positive** — The outer ring is the visible focus indicator around a real input, not a duplicate input. Removing keyboard focus feedback would be a regression.

> Clue input field renders a doubled border: an outer thick green focus ring plus a separate inner outlined white field, which looks like a duplicated/overlapping outline rather than one clean focus state.

### 420 · undercover · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Vertical rhythm in the main column is uneven: the gap between the input helper text ('One word. No secret words or repeated clues.') and the 'Give a new clue…' paragraph is several times larger than every other section gap, making the form feel loosely assembled.

### 421 · undercover · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> Round header grouping is awkward: the timer pill ('19s'/'13s') aligns with the 'Round 1 of 4 / Clue' row while 'Cycle 1/3' drops to its own line bottom-left, leaving a stray orphaned label and uneven spacing.

### 422 · undercover · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel is cut off at the bottom viewport edge: only the 'Players' header row and round dots are visible with the player cards clipped, and there is no affordance hinting there is more content below.

### 423 · undercover · low · both

**false positive** — The folder tab is part of the secret-word card illustration, not a floating control.

> The green folder-tab element on the word card floats slightly above the card's top edge and left-inset from the card's corner with no visible connection, reading at first glance as a stray or clipped shape.

### 424 · undercover · low · both

**deferred** — The field is labelled and accepts input. The optional example/placeholder copy remains a small per-game writing improvement.

> Clue input is completely empty with no placeholder text, so the field looks unfinished/broken before typing rather than inviting input.

### 425 · warm-words · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header row, the '0 guesses' label wraps onto its own second line, left-aligned under the 'Round 1 of 3' chip and visually detached from the '89s' timer pill it belongs with; on desktop it sits inline next to the timer, so the phone header looks broken/uneven.

### 426 · warm-words · low · phone

**deferred** — This minor per-game copy/state treatment remains. It needs a focused design and interaction check; the shared fit fixes do not change that behaviour.

> The '↕ Closest first' pill sits noticeably higher than the 'Shared guesses' heading instead of being vertically centered on the same row (desktop centers the two correctly).

### 427 · warm-words · low · both

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> The timer pill ('89s') is not aligned to the content column edge: on desktop it overhangs the right edge of the card/input/Guess-button column by ~20px, while on phone it stops ~15px short of the right edge every other element aligns to.

### 428 · warm-words · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> A small dark dot badge sits on the top-right corner of the active 'Player 1' chip with no label, tooltip, or legend explaining it, so it reads as an unexplained notification or rendering glitch.

### 429 · whisper · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty cream-colored areas: ~150px of blank space below the 'Whisper this name' button and ~220px of blank space under the Players panel at bottom-right; the 1440x900 viewport is not filled, making the page look unfinished.

### 430 · whisper · medium · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players/scores panel is entirely below the fold; only a thin sliver of its top edge peeks out and is cut off at the very bottom screen edge, so scores/status ('Thinking', points) are invisible without scrolling and the clipped element looks broken.

### 431 · whisper · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Whisper this name' primary CTA looks disabled (pale lavender fill, washed-out grey text) with no icon or state indication; at a glance it reads as broken rather than 'waiting for a selection'.

### 432 · who-wrote · medium · phone

**fixed** — The current zoom percentage is visible on phone. The utility row can use its own second line where a long title needs room.

> Zoom control pill in the sub-header (right of 'Who Wrote It') shows only '−' and '+' with an empty gap between them; the '100%' label shown on desktop is missing/clipped on phone, so current zoom level is unreadable

### 433 · who-wrote · medium · desktop

**fixed** — The round now uses a viewport-aware stage or a compact, centred sidebar. The roster no longer leaves a tall empty column; desktop and phone captures were reviewed.

> Large empty area below the 'Seal note' button: the bottom ~20% of the 1440x900 viewport is blank cream background; page content is top-packed and looks unbalanced/unfinished

### 434 · who-wrote · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Seal note' button renders pale lavender with muted text and no border emphasis, so it reads as disabled/unclear; even if intentionally disabled while the textarea is empty, the enabled state affordance is weak

### 435 · who-wrote · low · both

**false positive** — The outer ring is the visible focus indicator around a real input, not a duplicate input. Removing keyboard focus feedback would be a regression.

> Textarea has a double-frame look: an inner white rectangle with its own thin border sits inset inside the outer rounded brown/orange border, creating a visible seam that looks unpolished

### 436 · who-wrote · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> '0 / 3 locked' wraps onto its own line below the 'Round 1 of 5 / Write / 59s' row, producing an uneven two-row header unlike the single-row layout on desktop

### 437 · who-wrote · low · phone

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Player 3 card is clipped mid-card at the bottom edge of the viewport (only its header and top of avatar visible); acceptable only if the page scrolls, otherwise content is cut off

### 438 · who-wrote · low · both

**fixed** — Shared roster cards now have fixed rows, a compact phone layout, and adjacent number/unit text. They fill the available row without a loose points label.

> In each player card the score renders as '0' flush left and 'pts' flush right with a large gap between them, so '0 pts' reads as two disconnected elements at opposite edges

### 439 · who-wrote · low · both

**false positive** — The envelope is decorative card art, not an interactive icon button.

> Envelope icon button at the right of the 'A LITTLE NOTE. A BIG GIVEAWAY?' card is very light gray on cream, low contrast and easy to miss

### 440 · word-chain · medium · both

**fixed** — Urgent clock text uses ink on a danger tint. Word Chain now updates the shared progress fraction on each tick instead of leaving a decorative full-width rail.

> Timer urgency state (shot B): the '3s' value renders as small red text on an orange pill; red-on-orange contrast is marginal for text that size, hurting readability exactly when time is most critical.

### 441 · word-chain · low · both

**fixed** — Urgent clock text uses ink on a danger tint. Word Chain now updates the shared progress fraction on each tick instead of leaving a decorative full-width rail.

> Timer value is underlined in both shots ('9s' and '3s'); it reads like a hyperlink, and the underline length does not visibly shrink between 9s and 3s, so if it is meant as a time-progress indicator it does not reflect remaining time.

### 442 · word-chain · low · both

**false positive** — Link 1 labels the current first turn/window. The seed word does not imply the second player-created link has already happened.

> Header pill says 'Link 1' while the chain already contains 1 link and the player is prompted to add the next one ('link a word to rocket/anchor') — ambiguous, possibly off-by-one turn label.

### 443 · word-chain · low · both

**false positive** — The small starting chain and duplicated alive count are intentional context. The chain card grows as real links arrive; it is not an empty/broken board.

> '3 of 3 still in' appears twice on the same screen — once in the top row next to the timer and again in the Players card — redundant duplicate status.

### 444 · word-chain · low · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the link header row the '3 of 3 still in' label wraps to its own second line, left-aligned under the 'Link 1' pill, while the timer pill stays on the first row — patchy, misaligned header block at 390px width, with the label in very small type.

### 445 · word-chain · low · desktop

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Word prompt card has noticeably more empty space below 'Link by meaning. No repeats.' than above the 'Your turn' chip — vertically unbalanced padding inside the card.

### 446 · word-chain · low · desktop

**fixed** — The zoom percentage is visible in the phone utility row.

> At the bottom viewport edge the top (dashed) border of a further card is clipped mid-border with no scroll affordance, so it reads as a stray dashed line across the page at 100% zoom.

### 447 · word-chain · low · both

**fixed** — The practice End action now has a danger tint and border, separate from the neutral utilities.

> 'End' button (top-right) is a small white pill with plain red text, styled very similarly to the inactive player tabs — low affordance for a destructive game-ending action; could be mistaken for a passive/disabled tab.

### 448 · word-chain · low · both

**deferred** — The shared stage and roster are improved. This smaller local gap/alignment remains; changing it needs layout checks in the game’s other states.

> Player status copy is terse and asymmetric in the Players card: active player shows 'Linking' while others show only 'In' — unclear labels.

### 449 · word-chain · low · both

**false positive** — The small starting chain and duplicated alive count are intentional context. The chain card grows as real links arrive; it is not an empty/broken board.

> 'The chain' card spans the full content width but holds a single small chip, leaving a large empty area across its right half.

### 450 · word-chain · low · both

**fixed** — The floating host speck was removed from practice tabs. Hosting is still named in the tab tooltip and accessible label; an in-tab underline stays anchored.

> Active-player notification dot (on the 'Player 1' desktop tab and the P1 phone avatar) sits within a few pixels of the screen's top edge — clipping risk — and has no legend explaining what the dot means.

### 451 · word-grid · medium · phone

**fixed** — Shared HUD slots now use fixed tracks. Phone status deliberately uses two rows, with progress beside the clock on row two. Changing values keep the same geometry.

> In the round header (top right), '0 found' wraps onto a second line below the '89s' pill and floats misaligned next to it, while desktop keeps '0 found 89s' on one line — awkward stacked layout.

### 452 · word-grid · low · phone

**fixed** — Shortened the helper to Trace touching tiles or type. Shared words cancel. It no longer leaves out. on an orphaned line.

> Hint sentence 'Trace touching tiles, or type. Shared words cancel out.' wraps with the single orphan word 'out.' alone on the second line, centered below.

### 453 · word-grid · low · both

**false positive** — The control is genuinely unavailable until the stated input/selection/phase condition is met, or is a direct-play instruction. The nearby instruction explains what to do. It is not an enabled button with disabled styling.

> 'Save word' button is very pale lavender with washed-out text, so it looks disabled/unclickable; its style also clashes with the solid white 'Clear' and 'Done finding' buttons in the same action group.

### 454 · word-grid · low · both

**fixed** — The shared roster and play tracks were compacted. The after captures show complete player cards or a clearly bounded seat scroller; primary actions stay ahead of secondary content.

> Players panel is cut off by the bottom edge of the viewport: the 'Player 1 (you)' and 'Player 2' cards and their P1/P2 avatars are sliced in half at the fold on desktop (900px) and phone (844px).

### 455 · word-grid · low · desktop

**fixed** — The desktop letter grid shares a narrower play column with its compact roster alongside, reducing the previous wide empty gutters.

> Letter grid (~270px wide) floats centered in a ~900px content column, leaving large empty margins on both sides between the banner and the input row — page looks sparse and unbalanced for a party game.

### 456 · word-grid · low · phone

**fixed** — Round dots have stronger contrast, a visible Rounds label on phone, and a current-round mark even during the initial spin phase.

> Rounds progress indicator beside 'Players' shows only the single green ring; the two remaining gray dots visible on desktop are nearly invisible / missing on phone due to very low contrast.

### 457 · word-grid · low · both

**false positive** — This is a passive phase span, not a button. It has no click handler or pointer cursor. The actual primary action is separately labelled.

> The small 'Find' chip next to 'Round 1 of 3' reads as a passive badge rather than a tappable button — unclear affordance in the round header.

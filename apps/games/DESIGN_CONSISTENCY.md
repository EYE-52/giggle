# UI polish plan

Day starts with white and Night starts with neutral black. A soft rose gradient
lights the page edges. Cards, fields and menus use neutral surfaces. Rose marks
the main action. Game art, board squares, player markers and result colours
keep their meaning. Use the shared components and existing fonts.

## One workspace pattern

- Header: let the game title wrap. Keep Room and Full screen within reach.
  Put Report in the labelled Room menu. In a moving 3D scene, give controls
  enough contrast to read over the track.
- Panel: one surface around one task. Use the existing card background, rim,
  corner and spacing values. Avoid another card around every small label.
- Game picker: use the artwork, full title, short description and player count
  in one clickable row. The row opens the game guide or setup.
- Players: name and current state together; score and unit on the same line.
  Reserve score space so timer/score updates do not move the controls.
- Actions: tools next to the game; one main action immediately below its task.
  Wrap small tool groups instead of cutting a button at a scrollport edge.
- Drawing: a square sheet inside its own frame, with a clear caption gutter.
  Tools stay below the sheet on phones and in a side rail on wide screens.
  Preserve the canvas and its input coordinates when the viewport changes.
- Motion: state changes may give brief feedback; routine network updates must
  not replay entrances. Respect reduced motion. Never animate layout sizes.

## Verification order

1. Record current defects with real browser measurements and screenshots.
2. Fix one shared issue and inspect it at 1440×900, 1024×768, 390×844,
   and 375×667, in Day and Night.
3. Check actual pointer input, keyboard focus, menu open/close and next states.
4. Extend only after that pattern works. Run the existing full test suite.
5. Record measured results and remaining gaps in GPT-UI-REPORT.md.

External guidance is advisory: prioritise legibility, touch targets, focus,
content fit and predictable controls over decorative changes. No new UI
framework or animation dependency is needed.

# UI polish plan

This is a refinement of the current app, not a new visual theme. The owner's
11 November direction retires the Giggle design skill. Keep the working
colours, fonts, game art and existing shared components.

## One workspace pattern

- Header: a flexible title, then separate full-screen, room and report slots.
  No control may sit outside the header or on top of a title.
- Panel: one surface around one task. Use the existing card background, rim,
  corner and spacing values. Avoid another card around every small label.
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

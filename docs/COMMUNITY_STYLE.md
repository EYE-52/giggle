# Giggle: good to be together

The first community direction keeps the app simple while giving it a recognizable voice and cast of characters.

## Look and feel

- Warm paper backgrounds and ink text; terracotta for the main action.
- Sage, lilac, apricot and sky accents belong to people and gathering spaces.
- Cabinet Grotesk for clear UI and strong headings; occasional italic serif words for warmth.
- Soft illustrated heads, curved shapes, a small hand-drawn flourish. Avoid realistic stock portraits and decorative dashboard metrics.
- One clear next step per area: start a squad, join with a code, or return to a squad. Preserve the product term “squad.”
- Community copy talks about actual people and everyday hangouts. Never invent member counts, testimonials, or online activity.

## Implemented surfaces

Landing page, sign-in, squad home, and friends-page copy. `HangoutIllustration` composes the portable character renderer for welcome surfaces. The call UI and existing avatar selection/storage behavior are unchanged.

`/avatar-playground` is the public character experiment. `packages/avatars` contains the reusable React/SVG source and usage documentation. Users can try hairstyles, colors, expressions and motion without sending a photo or changing their profile. Motion respects the user's reduced-motion setting and can be disabled in the playground.

## What is still a prototype

The heads are manually illustrated and customized. They do not yet derive a likeness from a selfie, save a chosen character to the user's profile, or animate from voice. The next step is to judge the character style with a real photo reference, then implement the photo-generation and persistence flow. Do not label the current playground an AI avatar generator.

Keep the source renderer independent of Giggle accounts so it can be reused in another React app. This is not yet a published npm package or a React Native renderer.

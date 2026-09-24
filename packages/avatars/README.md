# Giggle people

A small React/SVG character renderer: illustrated heads with subtle blinking, head movement, and four expressions. No Giggle accounts, API, storage, animation engine, or image service required. Respects reduced-motion preferences.

```tsx
import { GiggleAvatar } from "@giggle/avatars";

<GiggleAvatar
  hair="curls"
  skin="#bd815e"
  hairColor="#39302e"
  accent="#dfd0ec"
  expression="laugh"
  size={96}
  label="Your character"
/>
```

Hair: `crop`, `curls`, `bob`, `swoop`, `buzz`, `bald`, `long`, `bun`. Expressions: `smile`, `laugh`, `wink`, `surprised`. Colors accept CSS colors. Use `animated={false}` for a still character, and `label=""` when decorative. Each instance uses unique SVG IDs.

## Try it

Run the desktop app and open `/avatar-playground`. The editor provides manual customization, starter looks, color palettes, and profile saving for signed-in users. It is reachable through the existing avatar picker.

## Reuse

This is a source workspace package, not a published npm distribution. React 18+ is its only peer dependency. Consumers need TypeScript/TSX compilation; alternatively copy `src/index.tsx` and the shared `packages/ui-tokens/src/logo.ts` data into another React project, updating that import. Animation styles travel inside the SVG; there is no external stylesheet to install. No Next.js dependency is used in the renderer.

## Scope

These are hand-built vector characters, not characters generated from a user's photo. Photo matching and voice-driven animation are not connected; profile persistence is integrated. The current traits let us explore Giggle's character style before choosing a photo generation pipeline.

## Artwork provenance

The current character artwork was created for Giggle during AI-assisted development, directly as SVG geometry in `src/index.tsx`. Faces, hair, clothing, expressions, and CSS animation are defined in that source file. The landing page composes four variants in `apps/desktop/components/HangoutIllustration.tsx`.

No stock illustrations, emoji artwork, downloaded character assets, traced reference images, or third-party avatar generators were used to create these characters. React is a rendering dependency, not the source of the artwork. These are not Apple Memoji/Genmoji or Avaturn assets.

This records the creation process, not a legal clearance or a guarantee that no similar character exists elsewhere. The traits are shared across variants, so they also do not guarantee a unique avatar for every user. Any future imported artwork should have its source and license documented separately before inclusion.

## Component editor (version 1)

The playground now supports `face` (`soft`, `round`, `angular`), `glasses` (`none`, `round`, `square`), `facialHair` (`none`, `stubble`, `beard`, `mustache`), `freckles`, and `shirtColor`.

Six numeric controls accept 0–100 with a neutral value of 50: `faceWidth`, `eyeSize`, `eyeSpacing`, `browTilt`, `noseSize`, and `mouthWidth`. The renderer bounds them and falls back to neutral for non-finite inputs. Facial layers share a width transform to preserve alignment. Existing callers retain their original defaults.

Export character downloads a version-1 JSON settings file. Export is separate from Save to profile. Saving uses the authenticated profile endpoint and survives refresh; there is no file import flow yet. Future selfie matching should return validated catalog choices and these bounded numbers, not generated SVG or executable markup. The application must validate any untrusted configuration before rendering it.

The shirt emblem uses the same `logoPaths` and `logoViewBox` as the app header, from `packages/ui-tokens/src/logo.ts`; do not redraw it separately.

## Wardrobe and profile integration

Clothing: `tee`, `hoodie`, `sweater`, `jacket`, `collared`. Headwear: `none`, `beanie`, `cap`. Earrings: `none`, `studs`, `hoops`. `shirtColor` colors clothes; `accessoryColor` colors hats, earrings and jacket inserts. All parts are SVG geometry created for this project. Headwear hides front hair while preserving the chosen hairstyle for removal.

`server/src/utils/characterConfig.js` is the dependency-free shared configuration contract, including validation and the `giggle:v1:` serialized format. It lives inside the server deploy boundary and is re-exported by `@giggle/core`. Profile `avatar` remains a string so all existing friends, squads and call payloads carry it without a new field. Legacy avatar IDs and local-only uploaded photos remain supported. Only validated catalog values, hex colors, booleans, and bounded integer proportions can be saved—never arbitrary SVG or URLs.

`AvatarArt` renders saved characters wherever the web app already displays avatars. List/profile thumbnails are still images to avoid animating every member at once. The editor retains animation previews. This does not add a native React Native renderer.

The editor includes eight preset colors per palette (skin, hair, clothes, accessories, and background), plus arbitrary custom hex colors. Color choices persist with the saved profile configuration.

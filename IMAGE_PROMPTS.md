# Giggle — Image Generation Prompts

Generate each image, then **dump the file into** `apps/desktop/public/img/` using the
**exact filename** in each section. The screens already reference these paths and will
pick them up on reload. (Same files also work for mobile later.)

- Format: **JPG** for photos, PNG fine for the square avatar.
- Each prompt below is self-contained (style baked in) — copy the whole block.
- Aspect ratios are what the layout expects; close is fine (CSS uses cover-crop).
- Keep faces slightly off-center / lower so overlaid badges & text stay readable.
- Tip for a cohesive set: generate one image first, then use it as a **style reference**
  for the rest so they all feel like one shoot.

---

## 1. `venue-neon-nights.jpg`  —  landscape ~16:10 (e.g. 1600×1000)
```
A packed downtown lounge dance floor glowing in violet and pink neon, silhouettes of a
small group of friends laughing together, disco haze, cinematic 35mm photo, moody neon
nightlife lighting with violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black
background, high-energy candid, shallow depth of field, no text, no logos, no watermark.
```

## 2. `venue-midnight-gamers.jpg`  —  landscape ~16:10 (e.g. 1600×1000)
```
A dim gaming lounge with blue and teal monitor glow, several friends at a couch setup
with controllers, esports energy, cinematic 35mm photo, moody neon nightlife lighting
with violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black background,
high-energy candid, shallow depth of field, no text, no logos, no watermark.
```

## 3. `match-your-squad.jpg`  —  portrait ~3:4 (e.g. 1200×1500)
```
Four stylish young friends crowded together taking a group selfie at a neon rooftop
party, violet light, joyful, cinematic 35mm photo, moody neon nightlife lighting with
violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black background, high-energy
candid, shallow depth of field, no text, no logos, no watermark.
```

## 4. `match-opponent-squad.jpg`  —  portrait ~3:4 (e.g. 1200×1500)
```
A different group of four confident friends posing at a neon-lit bar, lime and pink
light, playful rivalry energy, cinematic 35mm photo, moody neon nightlife lighting with
violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black background, high-energy
candid, shallow depth of field, no text, no logos, no watermark.
```

## 5. `avatar-alex.jpg`  —  square 1:1 (e.g. 1024×1024)
```
Portrait of a stylish gen-z person with an undercut, half-lit by violet and lime neon,
looking at camera, confident, cinematic 35mm photo, moody neon nightlife lighting with
violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black background, shallow depth
of field, no text, no logos, no watermark.
```

## 6. `onboarding-hero.jpg`  —  portrait ~4:5 (e.g. 1200×1500)
```
Overhead shot of a diverse squad of friends huddled in a circle looking up at the camera,
neon floor glow, celebratory, cinematic 35mm photo, moody neon nightlife lighting with
violet (#7C5CFF) and lime (#C2FF3D) rim light, deep near-black background, high-energy
candid, shallow depth of field, no text, no logos, no watermark.
```

---

### After you dump the files
Tell me "images are in" and I'll reload the desktop app (and wire the same files into the
mobile screens). Destination folder, again: `apps/desktop/public/img/`
</content>

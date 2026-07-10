/**
 * Curated preset cover images for squad banners.
 * Gradient values are CSS background strings.
 * Photo values are paths under /img (relative to the web root).
 */
export interface PresetCover {
  id: string;
  name: string;
  type: "gradient" | "photo";
  value: string; // CSS gradient string OR /img/... path
}

export const PRESET_COVERS: PresetCover[] = [
  // --- Gradients (12) ---
  {
    id: "grad-aurora",
    name: "Aurora",
    type: "gradient",
    value: "linear-gradient(135deg, #7C5CFF 0%, #3DD6C0 100%)",
  },
  {
    id: "grad-neon",
    name: "Neon",
    type: "gradient",
    value: "linear-gradient(135deg, #C2FF3D 0%, #00E5FF 100%)",
  },
  {
    id: "grad-sunset",
    name: "Sunset",
    type: "gradient",
    value: "linear-gradient(135deg, #FF8A5C 0%, #FF5C9A 100%)",
  },
  {
    id: "grad-cyber",
    name: "Cyber",
    type: "gradient",
    value: "linear-gradient(135deg, #0D0D1A 0%, #7C5CFF 50%, #00E5FF 100%)",
  },
  {
    id: "grad-velvet",
    name: "Velvet",
    type: "gradient",
    value: "radial-gradient(ellipse at 30% 30%, #9B59B6 0%, #2C0A37 100%)",
  },
  {
    id: "grad-lagoon",
    name: "Lagoon",
    type: "gradient",
    value: "linear-gradient(135deg, #0F2027 0%, #203A43 50%, #2C5364 100%)",
  },
  {
    id: "grad-ember",
    name: "Ember",
    type: "gradient",
    value: "linear-gradient(135deg, #FF5C5C 0%, #FF8A5C 50%, #FFC85C 100%)",
  },
  {
    id: "grad-frost",
    name: "Frost",
    type: "gradient",
    value: "radial-gradient(ellipse at 60% 40%, #A8EDEA 0%, #3DD6C0 40%, #1A1A2E 100%)",
  },
  {
    id: "grad-mardi",
    name: "Mardi",
    type: "gradient",
    value: "linear-gradient(135deg, #7C5CFF 0%, #C2FF3D 50%, #FF5C9A 100%)",
  },
  {
    id: "grad-galaxy",
    name: "Galaxy",
    type: "gradient",
    value: "radial-gradient(ellipse at 20% 80%, #7C5CFF 0%, #0B0B1F 60%), radial-gradient(ellipse at 80% 20%, #3DD6C0 0%, transparent 50%)",
  },
  {
    id: "grad-citrus",
    name: "Citrus",
    type: "gradient",
    value: "linear-gradient(135deg, #C2FF3D 0%, #FF8A5C 100%)",
  },
  {
    id: "grad-orchid",
    name: "Orchid",
    type: "gradient",
    value: "linear-gradient(135deg, #FF5C9A 0%, #7C5CFF 60%, #3DD6C0 100%)",
  },

  // --- Photos (6) —- paths under /img
  {
    id: "photo-neon-nights",
    name: "Neon Nights",
    type: "photo",
    value: "/img/venue-neon-nights.jpg",
  },
  {
    id: "photo-midnight-gamers",
    name: "Midnight Gamers",
    type: "photo",
    value: "/img/venue-midnight-gamers.jpg",
  },
  {
    id: "photo-match-your-squad",
    name: "Match Your Squad",
    type: "photo",
    value: "/img/match-your-squad.jpg",
  },
  {
    id: "photo-match-opponent",
    name: "Opponent Squad",
    type: "photo",
    value: "/img/match-opponent-squad.jpg",
  },
  {
    id: "photo-hero",
    name: "Hero",
    type: "photo",
    value: "/img/onboarding-hero.jpg",
  },
  {
    id: "photo-alex",
    name: "Alex",
    type: "photo",
    value: "/img/avatar-alex.jpg",
  },
];

const DEFAULT_COVER = "linear-gradient(135deg, #7C5CFF 0%, #3DD6C0 100%)";

/**
 * Resolve a coverImage value (preset id, data URL, or https URL) to a
 * CSS `background` value suitable for inline styles.
 */
export function resolveCover(coverImage?: string | null): string {
  if (!coverImage) return DEFAULT_COVER;

  // Preset id lookup
  const preset = PRESET_COVERS.find((p) => p.id === coverImage);
  if (preset) {
    if (preset.type === "gradient") return preset.value;
    return `url(${preset.value}) center/cover no-repeat`;
  }

  // Data URL or https URL → wrap in url()
  if (coverImage.startsWith("data:") || coverImage.startsWith("https://") || coverImage.startsWith("http://")) {
    return `url(${coverImage}) center/cover no-repeat`;
  }

  return DEFAULT_COVER;
}

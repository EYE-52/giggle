export interface CharacterConfig {
  hair: "curls" | "crop" | "bob" | "swoop" | "buzz" | "bald" | "long" | "bun";
  face: "soft" | "round" | "angular";
  glasses: "none" | "round" | "square";
  facialHair: "none" | "stubble" | "beard" | "mustache";
  expression: "smile" | "laugh" | "wink" | "surprised";
  clothing: "tee" | "hoodie" | "sweater" | "jacket" | "collared";
  headwear: "none" | "beanie" | "cap";
  earrings: "none" | "studs" | "hoops";
  skin: string; hairColor: string; accent: string; shirtColor: string; accessoryColor: string;
  faceWidth: number; eyeSize: number; eyeSpacing: number; browTilt: number; noseSize: number; mouthWidth: number;
  freckles: boolean; animated: boolean;
}
export const CHARACTER_DEFAULTS: Readonly<CharacterConfig>;
export const CHARACTER_OPTIONS: { [K in "hair" | "face" | "glasses" | "facialHair" | "expression" | "clothing" | "headwear" | "earrings"]: readonly CharacterConfig[K][] };
export function validateCharacter(input: unknown): CharacterConfig | null;
export function parseCharacter(value: unknown): CharacterConfig | null;
export function encodeCharacter(input: unknown): string;

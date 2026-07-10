export const SQUAD_CODE_PATTERN = /^[A-Z]{3}-\d{3}$/;

export function formatSquadCodeInput(value: string): string {
  const upper = value.toUpperCase();
  const embeddedCode = upper.match(/[A-Z]{3}\s*-?\s*\d{3}/);
  if (embeddedCode) {
    const compact = embeddedCode[0].replace(/\s+/g, "").replace("-", "");
    return `${compact.slice(0, 3)}-${compact.slice(3, 6)}`;
  }

  const letters = (upper.match(/[A-Z]/g) ?? []).slice(0, 3).join("");
  const digits = (upper.match(/\d/g) ?? []).slice(0, 3).join("");
  return digits ? `${letters}-${digits}` : letters;
}

export function isValidSquadCode(value: string): boolean {
  return SQUAD_CODE_PATTERN.test(value);
}

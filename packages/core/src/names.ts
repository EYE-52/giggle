// Cool random name generators for squads and players (used when none provided).

const ADJECTIVES = [
  "Neon", "Midnight", "Cosmic", "Electric", "Velvet", "Turbo", "Lunar", "Savage",
  "Golden", "Crimson", "Frost", "Hyper", "Wild", "Rogue", "Solar", "Nova",
  "Phantom", "Chaos", "Vivid", "Radiant", "Stormy", "Dizzy", "Feral", "Sonic",
];

const SQUAD_NOUNS = [
  "Owls", "Wolves", "Foxes", "Sharks", "Ravens", "Tigers", "Vipers", "Falcons",
  "Goblins", "Comets", "Rebels", "Bandits", "Phoenix", "Dragons", "Hornets", "Sirens",
];

const PLAYER_NOUNS = [
  "Otter", "Tiger", "Raven", "Comet", "Wolf", "Falcon", "Panda", "Lynx",
  "Viper", "Koala", "Hawk", "Bison", "Gecko", "Heron", "Jackal", "Orca",
];

function pick<T>(arr: T[]): T {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.getRandomValues) {
    const value = cryptoObj.getRandomValues(new Uint32Array(1))[0];
    return arr[value % arr.length];
  }

  // Last-resort fallback for very old/non-browser runtimes. Modern web,
  // native, and Node runtimes all provide global crypto.
  const fallback = Date.now() + (pickFallbackCounter += 1);
  return arr[fallback % arr.length];
}

let pickFallbackCounter = 0;

export function randomSquadName(): string {
  return `${pick(ADJECTIVES)} ${pick(SQUAD_NOUNS)}`;
}

export function randomPlayerName(): string {
  return `${pick(ADJECTIVES)} ${pick(PLAYER_NOUNS)}`;
}

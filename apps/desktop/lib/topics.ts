import { classifyVibe } from "@giggle/core";

export const SUGGESTED_TOPICS = ["Gaming", "Music", "Chill", "Comedy", "Deep Talks", "Late Night", "Sports", "Art", "Study", "Hype", "Fitness", "Foodies"];
export const MAX_TOPICS = 5;

export function normalizeTopics(values: string[] = []) {
  const topics = new Map<string, string>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const label = raw.normalize("NFKC").replace(/^[#\s]+/, "").replace(/\s+/g, " ").trim().slice(0, 15);
    if (label && classifyVibe(label) === "ok") topics.set(label.toLowerCase(), topics.get(label.toLowerCase()) ?? label);
    if (topics.size === MAX_TOPICS) break;
  }
  return [...topics.values()];
}

/** Current open-squad counts, not historical trend scores or fabricated activity. */
export function popularTopics(squads: { squadId: string; tags?: string[] }[]) {
  const counts = new Map<string, { key: string; label: string; count: number }>();
  const seenSquads = new Set<string>();
  for (const squad of squads) {
    if (seenSquads.has(squad.squadId)) continue;
    seenSquads.add(squad.squadId);
    for (const label of normalizeTopics(squad.tags)) {
      const key = label.toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { key, label, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 8);
}

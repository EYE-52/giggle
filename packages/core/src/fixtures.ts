import type { Squad, SquadMember } from "./types";

const m = (id: string, name: string, extra: Partial<SquadMember> = {}): SquadMember => ({
  id,
  name,
  initial: name[0],
  micOn: true,
  camOn: true,
  isReady: true,
  ...extra,
});

export const mockSquad: Squad = {
  id: "sq_night_owls",
  name: "Night Owls 🦉",
  code: "WGK-025",
  leaderId: "u_alex",
  status: "idle",
  visibility: "private",
  reputation: 820,
  tags: ["Gaming", "Comedy"],
  members: [
    m("u_alex", "Alex", { isLeader: true }),
    m("u_sam", "Sam"),
    m("u_maya", "Maya", { micOn: false }),
    m("u_jordan", "Jordan", { isReady: false }),
  ],
};

export const mockOpponent: Squad = {
  id: "sq_chaos",
  name: "Chaos Crew",
  code: "CHA-781",
  leaderId: "u_kai",
  status: "idle",
  visibility: "private",
  reputation: 760,
  tags: ["Gaming", "Comedy"],
  members: [
    m("u_kai", "Kai", { isLeader: true }),
    m("u_rae", "Rae"),
    m("u_theo", "Theo"),
    m("u_evan", "Evan"),
  ],
};

export const mockProfile = {
  name: "Alex Rivera",
  handle: "@alexr",
  reputation: 820,
  tier: "Trusted ✦",
  stats: { encounters: 47, squads: 12, hours: 38 },
};

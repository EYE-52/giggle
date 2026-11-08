import {
  partyGame,
  people,
  choices,
  person,
  esc,
  stamp,
} from "./b2-party-kit.js";
const lantern =
  '<svg class="moon-lantern" viewBox="0 0 120 100" aria-hidden="true"><path d="M40 24V16a20 12 0 0 1 40 0v8M34 26h52l-6 56H40Z"/><path class="moon-glow" d="M46 36h28v34H46Z"/><path d="M30 84h60M46 27l4 55m20-55-4 55"/></svg>';
const roleName = (role) =>
  ({ wolf: "Wolf", seer: "Seer", healer: "Healer", villager: "Villager" })[
    role
  ] || "Village watcher";
function villageStory(copy) {
  return `<div class="moon-story"><svg viewBox="0 0 320 88" aria-hidden="true"><circle class="moon-window" cx="274" cy="16" r="12"/><path class="moon-house" d="M20 80V44L44 24l24 20v36M84 80V34l30-24 30 24v46M160 80V48l22-18 22 18v32M220 80V48l30-22 30 22v32"/><path class="moon-window" d="M36 52h16v20H36ZM104 44h20v24h-20ZM176 56h12v16h-12ZM240 54h20v18h-20Z"/><path d="M8 82h304"/></svg><div>${copy}</div></div>`;
}
function events(S) {
  return (S.events || [])
    .map(
      (e) =>
        `<p>${e.pid ? person(S, e.pid) : ""} ${e.type === "lantern" ? "lost their lantern and is out." : e.type === "home" ? "was sent home." : e.type === "tie" ? "The vote tied. Nobody went home." : "Every lantern stayed safe."}</p>`,
    )
    .join("");
}
export default partyGame({
  id: "moonlit-village",
  prefix: "moon",
  title: "Moonlit Village",
  progress: (S) => `${S.alive?.length || 0} lanterns lit`,
  finalTitle: (S) => S.last?.winner === "wolves"
    ? "The wolves win"
    : S.last?.winner === "village" ? "The village wins" : "Final scores",
  finalNote: (S) => {
    const outcome =
      S.last?.winner === "wolves"
        ? "The wolves win."
        : S.last?.winner === "village"
          ? "The village wins."
          : "The host ended the game.";
    return (
      outcome +
      " Roles: " +
      (S.players || [])
        .map((p) => p.name + ": " + roleName(S.roles?.[p.id]))
        .join("; ") +
      "."
    );
  },
  describe({ S, local, send }) {
    const alive = people(S).filter((p) => S.alive?.includes(p.id)),
      role = S.role;
    const piece = `<div class="moon-village">${lantern}${stamp(S.ghost ? "Ghost view" : "Your role", esc(roleName(role)))}</div>`;
    const roles = S.ghost
      ? Object.fromEntries(
          Object.entries(S.roles || {}).map(([pid, r]) => [pid, roleName(r)]),
        )
      : {};
    if (S.phase === "reveal")
      return {
        title: "The village settles in",
        piece,
        message: villageStory(events(S)),
        roles,
      };
    if (S.ghost)
      return {
        title: "Your lantern is resting",
        piece,
        message: villageStory(events(S) + "<p>Watch quietly. Every role is shown below.</p>"),
        status: "You are out. The living village keeps playing.",
        button: "Watching the village",
        roles,
      };
    if (S.phase === "night") {
      const can = ["wolf", "seer", "healer"].includes(role);
      const ids = alive
        .filter((p) =>
          role === "wolf"
            ? S.roles?.[p.id] !== "wolf"
            : role === "seer"
              ? p.id !== S.me
              : p.id !== S.previousProtection,
        )
        .map((p) => p.id);
      const pack =
        role === "wolf"
          ? `<p class="t-caption">Your pack: ${Object.keys(S.roles || {})
              .map((pid) => person(S, pid))
              .join(" ")}</p><p class="t-caption">${Object.entries(
              S.packVotes || {},
            )
              .map(
                ([pid, target]) =>
                  person(S, pid) + " picked " + person(S, target),
              )
              .join(" ")}</p>`
          : "";
      return {
        title:
          role === "wolf"
            ? "Whose lantern will you take?"
            : role === "seer"
              ? "Whose side will you check?"
              : role === "healer"
                ? "Whose lantern will you guard?"
                : "The village is sleeping",
        piece,
        options: can ? choices(S, ids) : [],
        message: !can
          ? villageStory(`<p>${esc(S.scene || "The lanterns glow until dawn.")}</p><p>Your role has no night action. Watch for dawn.</p>`)
          : pack,
        locked: !!S.myTarget,
        ready: can && !S.myTarget && local.selected !== null,
        button:
          role === "seer"
            ? "Peek at their side"
            : role === "healer"
              ? "Protect lantern"
              : can ? "Choose lantern" : "Waiting for dawn",
        status: S.seen
          ? `Your peek: ${S.seen === "wolves" ? "Wolves" : "Village"}. Keep it secret.`
          : S.myTarget
            ? "Choice locked. Night ends with the timer."
            : can
              ? role === "healer" && S.previousProtection
                ? "Pick a lantern. You cannot guard the same player two nights in a row."
                : "Choose one living player. Night choices stay secret."
              : "No night action. Wait for dawn.",
        action: () => send({ target: local.selected }),
        roles,
      };
    }
    if (S.phase === "day")
      return {
        title: "Morning in the village",
        piece,
        message: villageStory(events(S)),
        button: "Ready to vote",
        ready: !S.acted?.includes(S.me),
        roles,
        status: S.acted?.includes(S.me)
          ? "You are ready. Waiting for the living village."
          : "Talk it over. Discussion ends early when every living player is ready.",
        action: () => send({ ready: true }),
      };
    return {
      title: "Who should go home?",
      piece,
      options: choices(
        S,
        alive.filter((p) => p.id !== S.me).map((p) => p.id),
      ),
      locked: !!S.myVote,
      ready: !S.myVote && local.selected !== null,
      button: "Lock vote",
      roles,
      status: S.myVote
        ? "Vote locked. Waiting for the village."
        : "A single top vote sends someone home. A tie sends nobody.",
      action: () => send({ vote: local.selected }),
    };
  },
});

import { esc } from "../util.js";
import { faceHtml } from "../kit.js";
import { partyRound, setHtml } from "./party-round-kit.js";

function noteCard(note, index, local, reveal) {
  const active = note.id === local.noteId;
  const tag = note.mine ? "YOUR NOTE" : `NOTE ${index + 1}`;
  const body = `<span class="who-note-label">${tag}</span><p>${esc(note.text)}</p><small class="who-more${note.text.length > 40 ? "" : " is-empty"}">Tap again to read</small><span class="who-assigned" data-assigned="${esc(note.id)}">${reveal ? "Opening…" : note.mine ? "This one is yours" : "Who could it be?"}</span>`;
  return reveal
    ? `<button type="button" class="who-note" data-reveal-note="${esc(note.id)}" aria-label="Read note ${index + 1} in full">${body}</button>`
    : `<button type="button" class="who-note ${active ? "is-active" : ""}" data-note="${esc(note.id)}" aria-pressed="${active}" ${note.mine ? "disabled" : ""}>${body}</button>`;
}

function readNote(el, text) {
  const reader = el.querySelector(".who-reader");
  reader.querySelector("p").textContent = text;
  reader.querySelector("button").onclick = () => reader.close();
  reader.showModal();
}

export default partyRound({
  id: "who-wrote",
  prefix: "who",
  name: "Who Wrote It?",
  field(S, local) {
    if (S.phase === "write")
      return `<div class="who-envelope"><span class="who-stamp" aria-hidden="true">✉</span><span class="who-kicker">A LITTLE NOTE. A BIG GIVEAWAY?</span><label><span>Leave a clue to your personality</span><textarea data-input rows="3" maxlength="160" aria-label="Your note" placeholder="Something only you would say…"></textarea></label><p>1–160 characters · We’ll hide your name</p></div>`;
    const reveal = S.phase === "reveal";
    const notes = reveal ? S.last?.notes || [] : S.notes || [];
    local.noteId = notes.find((note) => !note.mine)?.id;
    return `<dialog class="who-reader"><h4>Full note</h4><p></p><button type="button" class="tb-btn tb-secondary">Close note</button></dialog><div class="who-notes">${notes.map((note, i) => noteCard(note, i, local, reveal)).join("")}</div>${reveal ? "" : '<div class="who-match"><h4>Who wrote the selected note?</h4><div class="who-names" role="group" aria-label="Choose a writer"></div><p class="who-count"></p></div>'}`;
  },
  describe({ S, local }) {
    const write = S.phase === "write";
    // A submitted note is independent of the matching ballot.
    const locked = write ? S.myAnswer != null : S.myMatches != null;
    const count = (S.notes || []).filter((note) => !note.mine).length;
    return {
      title: S.prompt || "",
      phase: write ? "Write" : S.phase,
      button: locked ? "✓ Locked in" : write ? "Seal note" : "Lock matches",
      ready:
        !locked &&
        (write
          ? local.text.trim().length > 0 && local.text.trim().length <= 160
          : count > 0 && Object.keys(local.matches).length === count),
      status: locked
        ? "✓ Locked in · waiting for the others."
        : write
          ? "Be specific. Your friends will try to spot your note."
          : "Tap a note, then a name. Use each name once.",
    };
  },
  submit({ S, local, send }) {
    send(
      S.phase === "write"
        ? { answer: local.text.trim() }
        : { matches: { ...local.matches } },
    );
  },
  patch({ el, S, local, watching, refresh }) {
    const input = el.querySelector("[data-input]");
    if (input) {
      input.disabled = watching || S.myAnswer != null || !!S.preparing;
      return;
    }
    if (S.phase === "reveal") {
      for (const note of S.last?.notes || []) {
        const card = [...el.querySelectorAll("[data-reveal-note]")].find(
          (node) => node.dataset.revealNote === note.id,
        );
        if (!card) continue;
        card.onclick = () => readNote(el, note.text);
        if (!note.author || card.dataset.opened === note.author) continue;
        card.dataset.opened = note.author;
        card.classList.add("who-flip");
        setHtml(
          card.querySelector(".who-assigned"),
          faceHtml(S, note.author, { name: true }),
        );
      }
      return;
    }
    const locked = watching || S.myMatches != null || !!S.preparing;
    const matches = S.myMatches || local.matches;
    for (const button of el.querySelectorAll("[data-note]")) {
      const id = button.dataset.note;
      button.setAttribute("aria-pressed", String(id === local.noteId));
      button.classList.toggle("is-active", id === local.noteId);
      const chosen = matches[id];
      if (chosen)
        setHtml(
          button.querySelector(".who-assigned"),
          faceHtml(S, chosen, { name: true }),
        );
      button.onclick = () => {
        const note = (S.notes || []).find((note) => note.id === id);
        if (local.noteId === id && note?.text.length > 40) {
          readNote(el, note.text);
          return;
        }
        local.noteId = id;
        refresh();
      };
    }
    const names = el.querySelector(".who-names");
    setHtml(
      names,
      (S.authors || [])
        .map((pid) => {
          const used = Object.entries(matches).some(
            ([id, author]) => author === pid && id !== local.noteId,
          );
          return `<button class="tb-btn tb-chip who-name" type="button" data-author="${esc(pid)}" aria-pressed="${matches[local.noteId] === pid}" ${locked || used || !local.noteId ? "disabled" : ""}>${faceHtml(S, pid, { name: true })}<span class="who-used">${used ? "✓" : matches[local.noteId] === pid ? "✓" : ""}</span></button>`;
        })
        .join(""),
    );
    for (const button of names.querySelectorAll("[data-author]"))
      button.onclick = () => {
        if (locked || !local.noteId) return;
        local.matches[local.noteId] = button.dataset.author;
        const next = (S.notes || []).find(
          (note) => !note.mine && !local.matches[note.id],
        );
        if (next) local.noteId = next.id;
        refresh();
      };
    el.querySelector(".who-count").textContent =
      `${Object.keys(matches).length} of ${(S.notes || []).filter((note) => !note.mine).length} matched${locked ? " · Your ballot is sealed" : ""}`;
  },
});

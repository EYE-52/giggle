/* Final screen for every kart arena (classic and elevated): a winner line,
 * a short reason, then the ranked list. Equal scores share a rank, the
 * viewer's row is marked, drivers who dropped out are tagged "Left", and
 * each row shows the points earned (300 / 200 / 100 / 0, 150 in a draw). */

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function joinNames(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

// Older snapshots carry standings without rank/points: rank them here so
// the screen never breaks a tie by list order.
export function rankedRows(result) {
  const rows = (result?.standings || []).map((s) => ({ ...s }));
  rows.forEach((row, i) => {
    if (Number.isInteger(row.rank)) return;
    const prev = rows[i - 1];
    row.rank = prev && !prev.out && !row.out && prev.score === row.score ? prev.rank : i + 1;
  });
  return rows;
}

/* opts: { result, you, nameOf(pid), unit(n) -> '3 KOs', target, targetUnit } */
export function kartResultView({ result, you, nameOf, unit, target, targetUnit }) {
  const rows = rankedRows(result);
  const active = rows.filter((r) => !r.out);
  const winners = result?.winners || (result?.winner ? [result.winner] : []);
  const names = winners.map((pid) => nameOf(pid));
  const top = active.length ? active[0].score : 0;
  const reason = result?.endReason || 'timeout';
  let title;
  let line = '';
  if (winners.length === 1) {
    title = `${names[0]} wins`;
    line = reason === 'players-left' ? 'Everyone else left the match.'
      : reason === 'goal' ? `First to ${target} ${targetUnit}.`
      : `Most ${targetUnit} when time ran out: ${unit(top)}.`;
  } else if (winners.length > 1) {
    title = "It's a tie";
    line = top > 0 ? `${joinNames(names)} share first place with ${unit(top)}.`
      : `${joinNames(names)} finish level with ${unit(0)}.`;
  } else {
    title = 'Match over';
  }
  const items = rows.map((r) => {
    const self = r.pid === you;
    const points = Number.isFinite(r.points) ? `<span class="pk-final-points">${r.points > 0 ? '+' : ''}${r.points} pts</span>` : '';
    return `<li class="pk-final-row${self ? ' pk-final-self' : ''}${r.out ? ' pk-final-out' : ''}"${self ? ' aria-current="true"' : ''}>` +
      `<span class="pk-final-rank" aria-label="Rank ${r.rank}">${r.rank}</span>` +
      `<span class="pk-final-name">${escape(nameOf(r.pid))}${self ? ' <small>(you)</small>' : ''}${r.out ? ' <small class="pk-final-left">Left</small>' : ''}</span>` +
      `<span class="pk-final-score">${escape(unit(r.score))}</span>${points}</li>`;
  }).join('');
  return {
    title,
    line,
    html: `<h3 class="pk-final-title">${escape(title)}</h3>` +
      `<p class="pk-final-line">${escape(line)}</p>` +
      `<p class="pk-final-head">Final scores</p><ol class="pk-final-list">${items}</ol>`,
  };
}

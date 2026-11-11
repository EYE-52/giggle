'use strict';
// Shared guess streams never echo the secret, including inside longer messages.
function normalized(text) {
  return String(text).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function containsAnswer(text, answers) {
  const message = ' ' + normalized(text) + ' ';
  return answers.some(answer => { const secret = normalized(answer); return secret && message.includes(' ' + secret + ' '); });
}
function awardPending(state, pid, pts) {
  state.pendingAwards[pid] = (state.pendingAwards[pid] || 0) + pts;
}
function settlePending(state, ctx) {
  for (const [pid, pts] of Object.entries(state.pendingAwards || {})) ctx.award(pid, pts);
  state.pendingAwards = {};
}
module.exports = { containsAnswer, awardPending, settlePending };

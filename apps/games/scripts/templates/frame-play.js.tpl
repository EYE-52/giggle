import { createGameClient } from '/js/game-client.js';
const client = createGameClient();
const root = document.querySelector('#play');
const again = document.querySelector('#again'), lobby = document.querySelector('#lobby');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
client.subscribe((state, context) => {
  again.hidden = lobby.hidden = state.phase !== 'done';
  again.disabled = lobby.disabled = !context.isHost;
  if (state.phase === 'answer') {
    if (state.myAnswer) root.innerHTML = '<h2>Answer sent</h2><p>Waiting for your friends.</p>';
    else if (!root.querySelector('form')) {
      root.innerHTML = `<h2>${escape(state.prompt)}</h2><form><label>Your answer<input required maxlength="120"></label><button>Send answer</button></form>`;
      root.querySelector('form').onsubmit = event => {
        event.preventDefault(); client.send({ answer: root.querySelector('input').value });
      };
    }
  } else if (state.phase === 'vote') {
    root.innerHTML = '<h2>Pick your favorite</h2>';
    for (const option of state.options) {
      const button = document.createElement('button'); button.textContent = option.text;
      button.disabled = state.spectator || state.myVote != null;
      button.onclick = () => client.send({ vote: option.aid }); root.append(button);
    }
  } else {
    root.innerHTML = `<h2>${state.phase === 'done' ? 'Final scores' : 'Round results'}</h2>`;
    for (const player of state.players) {
      const row = document.createElement('p'); row.textContent = `${player.name}: ${state.scores[player.id] || 0}`; root.append(row);
    }
  }
  root.querySelectorAll('input,button').forEach(el => { if (state.spectator) el.disabled = true; });
});
again.onclick = () => client.rematch(); lobby.onclick = () => client.lobby();
window.addEventListener('pagehide', () => client.dispose(), { once: true });
// Replace this document with your engine's export when ready. Only
// client.subscribe(state => engine.applyState(state)) and client.send(intent)
// connect it to the room; no prescribed markup, HUD, renderer or inputs.

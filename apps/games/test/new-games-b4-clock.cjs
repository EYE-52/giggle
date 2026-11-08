"use strict";
// Browser-test clock control, loaded ONLY into the test's child process.
// Uses production Room deadlines and scheduling; no game rules are replaced.
const { Room } = require("../server/room");
const { actionWindow } = require("../games/_sdk");
const rooms = new Set();
const start = Room.prototype.startGame;
Room.prototype.startGame = function (...args) {
  rooms.add(this);
  return start.apply(this, args);
};
process.on("message", (message) => {
  if (message?.type !== "b4-deadline") return;
  for (const room of rooms) {
    const game = room.game;
    if (!game || game.preparing || game.state.phase === "done") continue;
    const timers = [...room.timers].filter(
      (t) =>
        !t.cancelled &&
        t.captured &&
        t.game === game &&
        t.window === actionWindow(game.state),
    );
    const deadline = Math.min(...timers.map((t) => t.deadline));
    if (!Number.isFinite(deadline)) continue;
    game.clockOffset -= Math.max(0, deadline - room._gameNow(game));
    for (const timer of timers) {
      clearTimeout(timer.handle);
      timer.handle = null;
      room._scheduleTimer(timer);
    }
    room.broadcastState();
  }
  setTimeout(
    () => process.send?.({ type: "b4-clock-ready", seq: message.seq }),
    30,
  );
});

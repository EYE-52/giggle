'use strict';
const crypto = require('node:crypto');
const duel = require('../engines/board-duel');
const id = 'fleet-duel';
const LENGTHS = [5,4,3,3,2];
const manifest = {
  name: 'Fleet Duel', tagline: 'Find their fleet before they find yours',
  howto: 'Place five ships of lengths 5, 4, 3, 3 and 2 horizontally or vertically on your 10×10 harbor. Ships may touch, but cannot overlap. Confirm each ship, then Ready. Take one shot per turn, even after a hit. Aim at a square, then Fire. Sink every enemy ship to win. You can resign at any time. With a move timer, running out of time on a shot loses the game. Two play; everyone else watches masked charts.',
  cat: 'board', renderer: 'svg', layout: 'immersive', runtime: { type: 'module', waitForResult: true },
  players: { min: 2, max: 24 }, seats: 2, realtime: false, art: 'img/games/fleet-duel.svg',
  settings: [{ ...duel.MOVE_TIMER_SETTING }],
};
function create(ctx) {
  const seats = ctx.allPlayers().slice(0,2).map(p => p.id);
  return { phase: 'place', seats, fleets: seats.map(() => Array(5).fill(null)), ready: [false,false],
    shots: [Array(100).fill(0),Array(100).fill(0)], turn: 0, rev: 0, placementRev:[0,0], turnNo: 0, lastMove: null, result: null,
    scores: {}, moveTimerMs: duel.moveTimerMs(ctx), endsAt: null };
}
function cells(ship, index) {
  if (!ship || !Number.isInteger(ship.at) || ship.at < 0 || ship.at >= 100 || typeof ship.vertical !== 'boolean') return null;
  const n = LENGTHS[index], row = Math.floor(ship.at/10), col = ship.at%10;
  if ((ship.vertical ? row : col) + n > 10) return null;
  return Array.from({length:n},(_,i) => ship.at + i * (ship.vertical ? 10 : 1));
}
function canPlace(fleet, ship, index) {
  const wanted = cells(ship,index); if (!wanted) return false;
  const occupied = new Set(fleet.flatMap((s,i) => i === index || !s ? [] : cells(s,i)));
  return wanted.every(c => !occupied.has(c));
}
function sunk(state, side, index) { return !!state.fleets[side][index] && cells(state.fleets[side][index],index).every(c => state.shots[1-side][c] === 2); }
function finish(state, ctx, side, reason) {
  if (state.phase === 'done') return;
  state.phase = 'done'; state.endsAt = null; state.result = { winner: side, winnerPid: state.seats[side], reason };
  duel.awardAll(state, ctx, duel.duelPoints(state.seats, state.seats[side]));
}
/* Shots only: placement has no move timer. */
function armShot(state, ctx) { if (state.phase === 'play') duel.armMoveTimer(state, ctx); else state.endsAt = null; }
function onAction(state, ctx, pid, a) {
  if (state.phase === 'done' || !a || typeof a !== 'object' || Array.isArray(a) ||
      !Number.isSafeInteger(a.rev)) return false;
  const side = state.seats.indexOf(pid);
  if (side < 0 || ['place','undo','auto','ready','fire','resign'].filter(k => a[k] !== undefined).length !== 1) return false;
  // Independent placement windows allow both captains to Ready concurrently.
  // Play uses the global revision; a placement command cannot cross that phase.
  if (a.rev !== (state.phase === 'place' ? state.placementRev[side] : state.rev)) return false;
  if (state.phase === 'play' && duel.moveTimedOut(state, ctx)) { state.rev++; state.turnNo = state.rev; finish(state,ctx,1-state.turn,'timeout'); return; }
  if (a.resign === true) { state.rev++; state.turnNo = state.rev; finish(state,ctx,1-side,'resign'); return; }
  if (state.phase === 'place' && !state.ready[side]) {
    if (a.place && Number.isInteger(a.place.ship) && a.place.ship >= 0 && a.place.ship < 5 && canPlace(state.fleets[side],a.place,a.place.ship)) {
      state.fleets[side][a.place.ship] = { at:a.place.at, vertical:a.place.vertical };
    } else if (Number.isInteger(a.undo) && a.undo >= 0 && a.undo < 5 && state.fleets[side][a.undo]) state.fleets[side][a.undo] = null;
    else if (a.auto === true) {
      const fleet = Array(5).fill(null);
      for (let ship=0;ship<5;ship++) {
        const legal=[]; for(let at=0;at<100;at++) for(const vertical of [false,true]) if(canPlace(fleet,{at,vertical},ship)) legal.push({at,vertical});
        fleet[ship]=legal[crypto.randomInt(legal.length)];
      }
      state.fleets[side] = fleet;
    } else if (a.ready === true && state.fleets[side].every(Boolean)) {
      state.ready[side] = true;
      if (state.ready.every(Boolean)) { state.phase = 'play'; armShot(state, ctx); }
    } else return false;
    state.rev++; state.placementRev[side] = state.rev;
    state.turnNo = state.phase === 'place' ? 0 : state.rev; return;
  }
  if (state.phase !== 'play' || side !== state.turn || !Number.isInteger(a.fire) || a.fire < 0 || a.fire >= 100 || state.shots[side][a.fire]) return false;
  const other = 1-side, ship = state.fleets[other].findIndex((s,i) => cells(s,i).includes(a.fire));
  state.shots[side][a.fire] = ship < 0 ? 1 : 2;
  state.rev++; state.turnNo = state.rev;
  state.lastMove = { side, at:a.fire, hit:ship>=0, sunk:ship>=0 && sunk(state,other,ship) ? ship : null, rev:state.rev };
  if (state.fleets[other].every((_,i) => sunk(state,other,i))) finish(state,ctx,side,'fleet');
  else { state.turn = other; armShot(state, ctx); }
}
/* The move timer ran out on a shot: the shooter loses on time. */
function onTick(state, ctx) {
  if (state.phase !== 'play' || !duel.moveTimedOut(state, ctx)) return;
  state.rev++; state.turnNo = state.rev; finish(state, ctx, 1 - state.turn, 'timeout'); ctx.broadcast();
}
/* Room hook: a seated captain left or stayed away 60 s — they forfeit. */
function onPlayerGone(state, ctx, pid) {
  const side = state.seats.indexOf(pid);
  if (side < 0 || state.phase === 'done') return false;
  state.rev++; state.turnNo = state.rev;
  finish(state, ctx, 1 - side, 'forfeit');
  return true;
}
function projectedFleet(state, side, owner) {
  return state.fleets[side].flatMap((ship,i) => ship && (owner || sunk(state,side,i)) ? [{ship:i,length:LENGTHS[i],...ship,sunk:sunk(state,side,i)}] : []);
}
function view(state,pid) {
  const you = state.seats.indexOf(pid), owner = you >= 0;
  return { phase:state.phase,seats:state.seats.slice(),youAre:owner?you:null,ready:state.ready.slice(),turn:state.turn,
    rev:state.rev,actionRev:owner?(state.phase==='place'?state.placementRev[you]:state.rev):null,turnNo:state.turnNo,lengths:LENGTHS.slice(),shots:state.shots.map(s=>s.slice()),
    ownFleet:owner?projectedFleet(state,you,true):[],
    enemyFleet:owner?projectedFleet(state,1-you,false):[],
    publicFleets:owner?null:state.seats.map((_,i)=>projectedFleet(state,i,false)),
    remaining:state.seats.map((_,side)=>LENGTHS.filter((_,i)=>!sunk(state,side,i)).length),
    lastMove:state.lastMove?{...state.lastMove}:null,result:state.result?{...state.result}:null,
    scores:{...state.scores},endsAt:state.endsAt,moveTimerMs:state.moveTimerMs };
}
module.exports={id,manifest,minPlayers:2,maxPlayers:24,create,onAction,onTick,onPlayerGone,view};

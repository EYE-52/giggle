const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

const response = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; } });
function fixture(file, beforeLease = () => {}) {
  const filename = path.join(__dirname, '../src/controllers', file);
  const realRequire = createRequire(filename);
  const member = { userId: 'requester', memberId: 'member', role: 'leader' };
  const state = { members: [member], writes: 0, removals: 0, ends: 0, beforeWrite: null };
  const squad = { squadId: 'squad', status: 'searching', currentEncounterId: file === 'squadController.js' ? null : 'encounter',
    __v: 0, searchQueuedAt: new Date(1000),
    get members() { return state.members; }, async save() { state.writes++; } };
  const access = {
    getRequesterIdentity: req => req.user,
    isSameMember: (candidate, identity) => candidate.userId === identity.userId,
    getSquadAccessContext: async () => ({ squad, member }),
  };
  const matchmaking = {
    getEncounterById: async () => ({ encounterId: 'encounter', squadAId: 'squad', squadBId: 'other', status: 'active' }),
    endEncounterAsymmetric: async ({ shouldEnd }) => {
      beforeLease(state);
      if (!await shouldEnd({ disconnectingSquad: squad })) return false;
      state.ends++;
      return true;
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, process, Buffer, console: { error() {}, warn() {} },
    require(id) {
      if (id === '../app/squadAccess') return access;
      if (id === '../models/Squad') return { Squad: {
        findOne: async () => squad,
        updateOne: async (filter, update) => {
          state.beforeWrite?.(squad);
          const same = Object.entries(filter).every(([key, value]) => value?.getTime
            ? squad[key]?.getTime() === value.getTime() : squad[key] === value);
          if (!same) return { matchedCount: 0 };
          Object.assign(squad, update.$set);
          squad.__v += update.$inc.__v;
          state.writes++;
          return { matchedCount: 1 };
        },
      } };
      if (id === '../services/matchmakingService') return matchmaking;
      if (id === '../services/queueService') return { getQueueAdmission: async () => ({ admissionId: 'owner' }), removeIfAdmission: async () => { state.removals++; } };
      if (id === '../services/socketService') return { emitToSquad() {} };
      if (id === '../services/sessionService') return {};
      if (id === '../config/redisConfig') return { withMatchmakingLock: async routine => {
        beforeLease(state);
        return routine({ aborted: false });
      } };
      if (id === '../services/squadAdmissionService') return {};
      return realRequire(id);
    },
  }, { filename });
  return { state, controller: module.exports, req: { user: { userId: 'requester' },
    body: { squadId: 'squad', encounterId: 'encounter' }, squadAccess: { squad, member } } };
}

test('a removed or demoted leader cannot cancel search after waiting for the lease', async () => {
  for (const members of [[], [{ userId: 'requester', memberId: 'member', role: 'member' }]]) {
    const f = fixture('squadController.js', state => { state.members = members; });
    const res = response();
    await f.controller.cancelSearchHandler(f.req, res);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error.code, 'LEADER_ONLY');
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.removals, 0);
  }
});

test('the current leader can still cancel the search', async () => {
  const f = fixture('squadController.js');
  const res = response();
  await f.controller.cancelSearchHandler(f.req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.state.writes, 1);
  assert.equal(f.state.removals, 1);
});

test('a removed member receives 403 instead of ending the encounter after the lease wait', async () => {
  const f = fixture('encounterController.js', state => { state.members = []; });
  const res = response();
  await f.controller.disconnectEncounterHandler(f.req, res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  assert.equal(f.state.ends, 0);
});

test('a current member can still end the encounter', async () => {
  const f = fixture('encounterController.js');
  const res = response();
  await f.controller.disconnectEncounterHandler(f.req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(f.state.ends, 1);
});


test('cancel cannot overwrite a match, newer search or roster version changed before its write', async () => {
  for (const change of [
    squad => { squad.status = 'matched'; squad.currentEncounterId = 'new'; },
    squad => { squad.searchQueuedAt = new Date(2000); },
    squad => { squad.__v++; },
  ]) {
    const f = fixture('squadController.js');
    f.state.beforeWrite = change;
    const res = response();
    await f.controller.cancelSearchHandler(f.req, res);
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error.code, 'SQUAD_CHANGED');
    assert.equal(f.state.writes, 0);
    assert.equal(f.state.removals, 0);
  }
});

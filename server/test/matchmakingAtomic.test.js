const assert = require('node:assert/strict');
const { test, after, afterEach } = require('node:test');
const mongoose = require('mongoose');
const config = require('../src/config/redisConfig');
const { Squad } = require('../src/models/Squad');
const { Encounter } = require('../src/models/Encounter');
const service = require('../src/services/matchmakingService');
const queue = require('../src/services/queueService');
const sessions = require('../src/services/sessionService');
const sockets = require('../src/services/socketService');
const restores = [];
const stub = (object, key, value) => { const old = object[key]; object[key] = value; restores.push(() => { object[key] = old; }); };
afterEach(() => { while (restores.length) restores.pop()(); });
after(() => { config.redis.disconnect(); config.subClient.disconnect(); config.pubClient.disconnect(); });
const clone = value => structuredClone(value);

function store({ failSquad, failCreate, loseLease } = {}) {
  const signal = { aborted: false };
  const squads = new Map(['a', 'b'].map(id => [id, {
    squadId: id, status: 'searching', currentEncounterId: null, __v: 0,
    members: [{ memberId: `m_${id}`, userId: `u_${id}`, role: 'leader' }],
  }]));
  const encounters = new Map();
  const effects = [];
  let committed = false;
  stub(mongoose.connection, 'transaction', async work => {
    const session = { squads: clone(squads), encounters: clone(encounters) };
    const result = await work(session);
    squads.clear(); for (const [id, value] of session.squads) squads.set(id, value);
    encounters.clear(); for (const [id, value] of session.encounters) encounters.set(id, value);
    committed = true;
    return result;
  });
  stub(Squad, 'updateOne', async (filter, update, { session }) => {
    assert.ok(session, 'both squad writes participate in the Mongo transaction');
    const squad = session.squads.get(filter.squadId);
    if (filter.squadId === failSquad || !squad || Object.entries(filter).some(([key, value]) => {
      if (key === 'members') return squad.members.length !== value.$size || value.$all.some(({ $elemMatch: expected }) => !squad.members.some(member => Object.entries(expected).every(([field, entry]) => member[field] === entry)));
      return JSON.stringify(squad[key]) !== JSON.stringify(value);
    })) return { matchedCount: 0 };
    Object.assign(squad, update.$set);
    if (update.$inc?.__v) squad.__v += update.$inc.__v;
    return { matchedCount: 1 };
  });
  stub(Encounter, 'create', async ([data], { session }) => {
    assert.ok(session, 'encounter insert uses the same transaction');
    if (failCreate) throw new Error('encounter insert failed');
    const encounter = { ...data, ackBySquad: new Map(Object.entries(data.ackBySquad)) };
    session.encounters.set(data.encounterId, encounter);
    if (loseLease) { signal.aborted = true; signal.error = new Error('lease lost before commit'); }
    return [encounter];
  });
  stub(Encounter, 'findOneAndUpdate', async (filter, update, { session }) => {
    assert.ok(session);
    const encounter = session.encounters.get(filter.encounterId);
    if (!encounter || encounter.status !== filter.status) return null;
    for (const [key, value] of Object.entries(update.$set)) {
      if (key.startsWith('ackBySquad.')) encounter.ackBySquad.set(key.slice('ackBySquad.'.length), value);
      else encounter[key] = value;
    }
    return encounter;
  });
  for (const [object, key] of [[queue, 'removeIfAdmission'], [sessions, 'setSessionField']]) {
    stub(object, key, async (...args) => { assert.equal(committed, true, 'external writes start after Mongo commit'); effects.push([key, args]); });
  }
  stub(sockets, 'emitToSquad', (...args) => { assert.equal(committed, true); effects.push(['emit', args]); });
  return { squads, encounters, effects, signal };
}

for (const failure of [{ failSquad: 'b' }, { failCreate: true }, { loseLease: true }]) {
  test(`atomic match rolls both squads back on ${Object.keys(failure)[0]}`, async () => {
    const state = store(failure);
    const before = clone(state.squads);
    await assert.rejects(service.createEncounterForSquads(clone(state.squads.get('a')), clone(state.squads.get('b')), state.signal));
    assert.deepEqual(state.squads, before);
    assert.equal(state.encounters.size, 0);
    assert.deepEqual(state.effects, []);
  });
}

test('atomic match rejects a roster changed after its eligibility snapshot', async () => {
  const state = store();
  const a = clone(state.squads.get('a')); const b = clone(state.squads.get('b'));
  state.squads.get('b').members.push({ memberId: 'late', userId: 'unverified' });
  await assert.rejects(service.createEncounterForSquads(a, b, state.signal), { code: 'MATCH_SNAPSHOT_CHANGED' });
  assert.equal(state.squads.get('a').status, 'searching');
  assert.equal(state.encounters.size, 0);
});

test('a successful atomic match cannot be claimed again from an older searching snapshot', async () => {
  const state = store();
  const a = clone(state.squads.get('a')); const b = clone(state.squads.get('b'));
  const encounter = await service.createEncounterForSquads(clone(a), clone(b), state.signal);
  assert.equal(state.encounters.size, 1);
  assert.equal(state.squads.get('a').currentEncounterId, encounter.encounterId);
  assert.equal(state.squads.get('b').currentEncounterId, encounter.encounterId);
  await assert.rejects(service.createEncounterForSquads(a, b, state.signal), { code: 'MATCH_SNAPSHOT_CHANGED' });
  assert.equal(state.encounters.size, 1);
});

test('match finalization waits for every started Redis write before surfacing a failure', async () => {
  const state = store();
  let release; const pending = new Promise(resolve => { release = resolve; });
  stub(queue, 'removeIfAdmission', id => id === 'a' ? Promise.reject(new Error('queue unavailable')) : pending);
  let finished = false;
  const outcome = service.createEncounterForSquads(clone(state.squads.get('a')), clone(state.squads.get('b')), state.signal).finally(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release(); await assert.rejects(outcome, /queue unavailable/);
  assert.equal(state.encounters.size, 1, 'external failure cannot undo an already committed match');
});

test('ack activation rolls back its first squad update when the other squad left', async () => {
  const state = store();
  const encounter = await service.createEncounterForSquads(clone(state.squads.get('a')), clone(state.squads.get('b')), state.signal);
  encounter.ackBySquad.set('a', true);
  state.encounters.get(encounter.encounterId).ackBySquad.set('a', true);
  state.squads.get('b').status = 'idle'; state.squads.get('b').currentEncounterId = null;
  const result = await service.ackEncounterForSquad({ encounter, squadId: 'b', signal: state.signal });
  assert.equal(result.error.code, 'ENCOUNTER_CHANGED');
  assert.equal(state.squads.get('a').status, 'matched');
  assert.equal(state.squads.get('b').status, 'idle');
  assert.equal(state.encounters.get(encounter.encounterId).status, 'awaiting_ack');
  assert.equal(state.encounters.get(encounter.encounterId).ackBySquad.get('b'), false);
});

test('ack and both squad activations commit together', async () => {
  const state = store();
  const encounter = await service.createEncounterForSquads(clone(state.squads.get('a')), clone(state.squads.get('b')), state.signal);
  const first = await service.ackEncounterForSquad({ encounter, squadId: 'a', signal: state.signal });
  assert.equal(first.allAcked, false);
  const second = await service.ackEncounterForSquad({ encounter, squadId: 'b', signal: state.signal });
  assert.equal(second.allAcked, true);
  assert.equal(state.encounters.get(encounter.encounterId).status, 'active');
  assert.equal(state.squads.get('a').status, 'in_encounter');
  assert.equal(state.squads.get('b').status, 'in_encounter');
});

test('asymmetric disconnect guard reloads under the pair lease and can veto all effects', async () => {
  const encounter = { encounterId: 'e', status: 'active', squadAId: 'a', squadBId: 'b' };
  const freshSquad = { squadId: 'a', status: 'in_encounter', currentEncounterId: 'e', members: [] };
  let locked = false;
  stub(config.redlock, 'using', async (resources, _ttl, work) => {
    assert.deepEqual(resources, config.matchmakingLeaseResources(['a', 'b']));
    locked = true; try { return await work({ aborted: false }); } finally { locked = false; }
  });
  stub(Encounter, 'findOne', async () => { assert.equal(locked, true); return encounter; });
  stub(Squad, 'findOne', async () => { assert.equal(locked, true); return freshSquad; });
  for (const [object, key] of [[Squad, 'updateOne'], [Encounter, 'findOneAndUpdate'], [queue, 'addToQueue'], [sessions, 'clearMemberSession'], [sessions, 'setSessionField'], [sockets, 'emitToSquad'], [sockets, 'closeEncounterRoom']]) {
    stub(object, key, () => assert.fail(`veto must not run ${key}`));
  }
  assert.equal(await service.endEncounterAsymmetric({ encounter: { ...encounter, status: 'awaiting_ack' }, disconnectingSquadId: 'a', shouldEnd: async context => {
    assert.equal(locked, true); assert.equal(context.encounter, encounter); assert.equal(context.disconnectingSquad, freshSquad); return false;
  } }), false);
});

test('lease loss before or during the routine never returns success', async () => {
  let workCalls = 0;
  stub(config.redlock, 'using', async (_r, _d, work) => work({ aborted: true, error: new Error('expired') }));
  await assert.rejects(config.withMatchmakingLock(() => { workCalls++; }, { squadIds: ['a'] }), /expired/);
  assert.equal(workCalls, 0);
  stub(config.redlock, 'using', async (_r, _d, work) => {
    const signal = { aborted: false }; return work(signal);
  });
  await assert.rejects(config.withMatchmakingLock(async signal => { signal.aborted = true; signal.error = new Error('renewal lost'); }, { squadIds: ['a'] }), /renewal lost/);
});

test('ack lease loss after its first write aborts the whole activation', async () => {
  const state = store();
  const encounter = await service.createEncounterForSquads(clone(state.squads.get('a')), clone(state.squads.get('b')), state.signal);
  encounter.ackBySquad.set('a', true);
  state.encounters.get(encounter.encounterId).ackBySquad.set('a', true);
  const update = Squad.updateOne;
  stub(Squad, 'updateOne', async (...args) => {
    const result = await update(...args);
    state.signal.aborted = true; state.signal.error = new Error('ack lease lost');
    return result;
  });
  await assert.rejects(service.ackEncounterForSquad({ encounter, squadId: 'b', signal: state.signal }), /ack lease lost/);
  assert.equal(state.squads.get('a').status, 'matched');
  assert.equal(state.squads.get('b').status, 'matched');
  assert.equal(state.encounters.get(encounter.encounterId).status, 'awaiting_ack');
});

test('matcher scans without a lease and skips a contended oldest candidate immediately', async () => {
  const seeker = { squadId: 'seeker', status: 'searching', members: [], searchRegion: 'global' };
  const candidates = [{ squadId: 'oldest', size: '1', queuedAt: '1' }, { squadId: 'next', size: '1', queuedAt: '2' }];
  const oldMode = process.env.MEET_SCOPED_MATCHMAKING_LOCKS;
  process.env.MEET_SCOPED_MATCHMAKING_LOCKS = 'true';
  restores.push(() => { if (oldMode === undefined) delete process.env.MEET_SCOPED_MATCHMAKING_LOCKS; else process.env.MEET_SCOPED_MATCHMAKING_LOCKS = oldMode; });
  let locked = false; const attempts = []; const removed = [];
  stub(Squad, 'findOne', async ({ squadId }) => squadId === 'seeker' ? seeker : null);
  stub(queue, 'getQueuedSquadsByRegion', async () => { assert.equal(locked, false, 'candidate scan is outside lease'); return candidates; });
  stub(queue, 'getQueueAdmission', async squadId => ({ squadId, admissionId: squadId }));
  stub(queue, 'removeIfAdmission', async squadId => removed.push(squadId));
  stub(config.redlock, 'using', async (resources, _ttl, options, work) => {
    assert.equal(options.retryCount, 0, 'candidate contention never waits for Redlock retries');
    attempts.push(resources);
    if (attempts.length === 1) throw Object.assign(new Error('contended'), { name: 'ExecutionError' });
    locked = true; try { return await work({ aborted: false }); } finally { locked = false; }
  });
  assert.equal(await service.tryMatchmakeForSquad(seeker), null);
  assert.deepEqual(attempts, [config.matchmakingLockResources(['seeker', 'oldest']), config.matchmakingLockResources(['seeker', 'next'])]);
  assert.deepEqual(removed, ['next']);
});

test('an invalid-seeker cleanup cannot reset a newer match after its eligibility read', async () => {
  const User = require('../src/models/User');
  const previous = { squadId: 'old-search', status: 'searching', currentEncounterId: null, searchQueuedAt: new Date(), __v: 2,
    members: [{ memberId: 'm', userId: 'missing', role: 'leader' }] };
  const durable = clone(previous);
  stub(config.redlock, 'using', async (_r, _d, optionsOrWork, work) => (work || optionsOrWork)({ aborted: false }));
  stub(Squad, 'findOne', async () => clone(previous));
  stub(queue, 'getQueuedSquadsByRegion', async () => []);
  stub(queue, 'getAllQueuedSquads', async () => []);
  stub(queue, 'getQueueAdmission', async () => ({ admissionId: 'old-generation' }));
  stub(User, 'find', () => {
    durable.status = 'matched'; durable.currentEncounterId = 'new-call'; durable.__v = 3;
    return { select: async () => [], lean: async () => [] };
  });
  stub(Squad, 'updateOne', async filter => {
    assert.equal(filter.status, 'searching'); assert.equal(filter.currentEncounterId, null);
    assert.equal(filter.__v, 2); assert.equal(+filter.searchQueuedAt, +previous.searchQueuedAt);
    return { matchedCount: 0 };
  });
  stub(queue, 'removeIfAdmission', () => assert.fail('newer queue state must survive rejected cleanup'));
  stub(sockets, 'emitToSquad', () => assert.fail('rejected cleanup emits no idle update'));
  assert.equal(await service.tryMatchmakeForSquad(previous), null);
  assert.equal(durable.status, 'matched'); assert.equal(durable.currentEncounterId, 'new-call'); assert.equal(durable.__v, 3);
});

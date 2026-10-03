const { io } = require('socket.io-client');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const base = process.env.GIGGLE_TEST_URL || 'http://localhost:3001';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname))
    throw Error('This test creates development accounts and only runs against a local API');
const sockets = [];
const sessions = [];
const squads = [];
async function api(path, session, body, method = body ? 'POST' : 'GET') {
    const response = await fetch(base + '/api' + path, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(session ? { Authorization: 'Bearer ' + session.token } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
        throw Error(path + ': ' + response.status + ' ' + JSON.stringify(result.error));
    }
    return result.data ?? result;
}
const delay = ms => new Promise(r => setTimeout(r, ms));
(async () => {
    const run = Date.now();
    for (let i = 0; i < 4; i++) {
        const s = await api('/auth/exchange', null, { email: `qa-${run}-${i}@giggle.local`, name: `QA ${i + 1}` });
        await api('/me/age', s, { birthDate: '2000-01-01' });
        s.user = { ...s.user, ...await api('/me/profile', s) };
        sessions.push(s);
        const socket = io(base, { auth: { token: s.token }, transports: ['websocket'], reconnection: false });
        sockets.push(socket);
        await new Promise((res, rej) => { const timer = setTimeout(() => rej(Error('Socket connection timed out')), 10000); socket.once('connect', () => { clearTimeout(timer); res(); }); socket.once('connect_error', e => { clearTimeout(timer); rej(e); }); });
    }
    console.log('Four local adult test sessions connected');
    for (let side = 0; side < 2; side++) {
        const leader = sessions[side * 2], friend = sessions[side * 2 + 1];
        const squad = await api('/squads/create', leader, { squadName: `QA squad ${run}-${side}`, tags: ['Music'] });
        squads.push(squad);
        await api('/squads/join', friend, { squadCode: squad.squadCode });
        for (let i = side * 2; i < side * 2 + 2; i++) {
            sockets[i].emit('join_squad', squad.squadId);
            await api(`/squads/${squad.squadId}/ready`, sessions[i], { ready: true });
            await api(`/squads/${squad.squadId}/lobby-video`, sessions[i], { inLobbyVideo: true });
        }
    }
    console.log('Two squads created and joined; media presence simulated for backend test');
    await delay(150);
    for (let side = 0; side < 2; side++)
        await api(`/squads/${squads[side].squadId}/search`, sessions[side * 2], {});
    let status;
    for (let i = 0; i < 30; i++) {
        status = await api('/matchmaking/status/' + squads[0].squadId, sessions[0]);
        if (status.match?.encounterId)
            break;
        await delay(200);
    }
    assert(status.match?.encounterId);
    const enc = status.match.encounterId;
    for (let side = 0; side < 2; side++)
        await api(`/matchmaking/encounters/${enc}/ack`, sessions[side * 2], { squadId: squads[side].squadId });
    assert.equal((await api('/matchmaking/encounters/' + enc, sessions[0])).status, 'active');
    sockets.forEach(s => s.emit('join_encounter', enc));
    await delay(150);
    const received = [[], [], [], []];
    sockets.forEach((s, i) => s.on('new_message', m => received[i].push(m)));
    function send(scope, text, id) { return new Promise((res, rej) => sockets[0].timeout(5000).emit('send_message', { ...scope, text, clientMessageId: id }, (e, a) => e ? rej(e) : res(a))); }
    const everyone = await send({ encounterId: enc }, 'Hello everyone', 'message-' + run);
    assert(everyone.ok);
    await delay(100);
    assert(received.every(ms => ms.some(m => m.id === everyone.message.id)));
    const privateMsg = await send({ squadId: squads[0].squadId }, 'Only our squad', 'private-' + run);
    assert(privateMsg.ok);
    await delay(100);
    assert(received[1].some(m => m.id === privateMsg.message.id));
    assert([2, 3].every(index => !received[index].some(m => m.id === privateMsg.message.id)));
    const retry = await send({ encounterId: enc }, 'Hello everyone', 'message-' + run);
    assert.equal(retry.message.id, everyone.message.id);
    console.log('Matchmaking, acknowledgements, everyone chat, private squad chat, retry IDs passed');
    const reportPayload = { squadId: squads[0].squadId, reportedSquadId: squads[1].squadId, encounterId: enc, category: 'other', details: 'Synthetic local QA report' };
    const report = (socket, payload) => new Promise((res, rej) => socket.timeout(5000).emit('report_squad', payload, (error, result) => error ? rej(error) : res(result)));
    const savedReport = await report(sockets[0], reportPayload);
    assert.equal(savedReport.ok, true);
    assert.equal((await report(sockets[0], reportPayload)).reportId, savedReport.reportId);
    assert.equal((await report(sockets[1], { ...reportPayload, squadId: squads[1].squadId, reportedSquadId: squads[0].squadId })).ok, false);
    const exportedReports = (await api('/me/export', sessions[0])).safetyReports;
    assert.equal(exportedReports.filter(r => r.id === savedReport.reportId).length, 1);
    assert.equal(exportedReports.find(r => r.id === savedReport.reportId).details, reportPayload.details);
    assert.equal((await api('/me/export', sessions[2])).safetyReports.length, 0);
    console.log('Report persistence, idempotent retry, forged membership rejection and reporter privacy passed');
    await api(`/squads/${squads[0].squadId}/encounter-video`, sessions[1], { inEncounterVideo: false });
    assert.equal((await api('/matchmaking/encounters/' + enc, sessions[0])).status, 'active');
    console.log('Personal leave preserves the encounter');
    if (process.argv.includes('--keep')) {
        console.log('Keeping this local fixture encounter for browser checks');
    }
    else if (process.argv.includes('--skip')) {
        const transitions = [[], [], [], []];
        sockets.forEach((socket, index) => socket.on('ENCOUNTER_ENDED', event => transitions[index].push(event)));
        const results = await Promise.all([0, 1].map(() => api('/matchmaking/skip', sessions[0], { squadId: squads[0].squadId, encounterId: enc })));
        assert(results.every(r => r.queueStatus === 'searching'));
        await delay(300);
        assert(transitions.every(events => events.some(event => event.encounterId === enc && event.reason === 'next_squad' && event.queueStatus === 'searching')));
        for (let side = 0; side < 2; side++) {
            const current = await api('/matchmaking/status/' + squads[side].squadId, sessions[side * 2]);
            assert.equal(current.state, 'searching');
            assert(!current.match?.encounterId);
            await api('/squads/' + squads[side].squadId + '/search/cancel', sessions[side * 2], {});
        }
        console.log('Concurrent Next squad requests passed; previous opponents stayed apart; queues cancelled');
    }
    else {
        await api('/encounters/disconnect', sessions[0], { squadId: squads[0].squadId, encounterId: enc });
        assert.equal((await api('/matchmaking/encounters/' + enc, sessions[0])).status, 'ended');
        console.log('End encounter persisted');
    }
    // Create and delete only this disposable local identity. Existing fixture
    // participants stay available for inspection and --keep browser checks.
    const disposable = await api('/auth/exchange', null, { email: `qa-delete-${run}@dev.giggle.local`, name: 'Disposable QA account' });
    await api('/me/age', disposable, { birthDate: '2000-01-01' });
    const disposableId = String(disposable.user.id);
    await api('/friends/request', disposable, { userId: String(sessions[0].user.id) });
    await api('/friends/accept', sessions[0], { userId: disposableId });
    await api('/friends/request', disposable, { userId: String(sessions[1].user.id) });
    await api('/friends/request', sessions[2], { userId: disposableId });
    await api('/users/block', sessions[0], { userIds: [disposableId] });
    const disposableSquad = await api('/squads/create', disposable, { squadName: `Delete QA ${run}`, tags: ['Study'] });
    const deletion = await api('/me/account', disposable, undefined, 'DELETE');
    assert.equal(deletion.status, 'deleted');
    const denied = await fetch(base + '/api/friends', { headers: { Authorization: 'Bearer ' + disposable.token }, signal: AbortSignal.timeout(5000) });
    assert([401, 403, 404].includes(denied.status));
    for (const participant of sessions) {
        const account = await api('/me/export', participant);
        assert(!account.friends.some(f => f.userId === disposableId));
        assert(!account.blocks.some(b => b.userId === disposableId));
        assert(!account.notifications.some(n => n.fromUserId === disposableId));
        const requests = await api('/friends/requests', participant);
        assert(!JSON.stringify(requests).includes(disposableId));
    }
    const formerSquad = await fetch(base + '/api/squads/' + disposableSquad.squadId, { headers: { Authorization: 'Bearer ' + sessions[0].token }, signal: AbortSignal.timeout(5000) });
    assert([403, 404].includes(formerSquad.status));
    console.log('Disposable account deletion revoked access and removed friendship, request, block and notification references');
    if (process.env.GIGGLE_TEST_SESSION_FILE) {
        const file = fs.openSync(process.env.GIGGLE_TEST_SESSION_FILE, 'w', 0o600);
        try {
            fs.fchmodSync(file, 0o600);
            fs.writeFileSync(file, JSON.stringify({ sessions, squads, enc }));
        } finally {
            fs.closeSync(file);
        }
    }
    console.log('PASS: real API, MongoDB, Redis and four authenticated socket clients; Agora not tested');
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => sockets.forEach(s => s.disconnect()));

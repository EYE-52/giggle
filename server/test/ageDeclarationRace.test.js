'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const mongoose = require('mongoose');
const User = require('../src/models/User');
const { setMyAge } = require('../src/controllers/authController');

const response = () => ({ statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; } });
const declare = (id, birthDate, res) => setMyAge({ user: { userId: id.toString() }, body: { birthDate } }, res);

// Pause after a real read, so the pending request really holds a stale document.
function pauseFirstRead() {
  const original = User.findById;
  let release, observed, first = true;
  const waiting = new Promise(resolve => { release = resolve; });
  const read = new Promise(resolve => { observed = resolve; });
  User.findById = async function (...args) {
    const user = await original.apply(this, args);
    if (first) { first = false; observed(); await waiting; }
    return user;
  };
  return { read, release, restore: () => { User.findById = original; } };
}

test('first DOB wins against a stale normal request and a shared-account writer', async t => {
  const dbName = 'giggle_dob_race_' + crypto.randomBytes(6).toString('hex');
  try { await mongoose.connect('mongodb://127.0.0.1:27017', { dbName, serverSelectionTimeoutMS: 1000 }); }
  catch { await mongoose.disconnect(); t.skip('Local Mongo is unavailable'); return; }
  t.after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });
  const minorDate = new Date(); minorDate.setUTCFullYear(minorDate.getUTCFullYear() - 15);
  const minorDOB = minorDate.toISOString().slice(0, 10);
  let user = await User.create({ email: 'parallel-dob@example.test', name: 'Race' });
  let pause = pauseFirstRead();
  try {
    const staleResponse = response(), winnerResponse = response();
    const pending = declare(user._id, '1990-01-01', staleResponse);
    await pause.read;
    await declare(user._id, minorDOB, winnerResponse);
    assert.equal(winnerResponse.statusCode, 403);
    pause.release(); await pending;
    assert.equal(staleResponse.statusCode, 403);
    assert.equal(staleResponse.body.error.code, 'AGE_RESTRICTED');
    const saved = await User.findById(user._id);
    assert.equal(saved.birthDate.toISOString().slice(0, 10), minorDOB);
    assert.equal(saved.isAdult, false); assert.equal(saved.ageVerified, false);
  } finally { pause.release(); pause.restore(); }

  // Another app can persist a declaration/receipt while normal Meet is waiting.
  // The stale normal request must return that winner and preserve its receipt.
  user = await User.create({ email: 'shared-dob@example.test', name: 'Shared' });
  pause = pauseFirstRead();
  try {
    const res = response(), pending = declare(user._id, minorDOB, res);
    await pause.read;
    await User.findOneAndUpdate({ _id: user._id, ageConfirmed: { $ne: true } }, { $set: {
      birthDate: new Date('1990-01-01'), ageConfirmed: true, isAdult: true, ageVerified: true,
      ageVerification: { provider: 'yoti', status: 'verified', sessionId: 'stored-session', referenceId: 'stored-reference',
        evidenceId: 'stored-evidence', method: 'DOC_SCAN', threshold: 18, policyVersion: 'verified-adult-v1', verifiedAt: new Date() },
    } }, { new: true, runValidators: true });
    pause.release(); await pending;
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.data, { isAdult: true, ageConfirmed: true, ageVerified: true });
    const saved = await User.findById(user._id);
    assert.equal(saved.birthDate.toISOString().slice(0, 10), '1990-01-01');
    assert.equal(saved.ageVerified, true); assert.equal(saved.ageVerification.evidenceId, 'stored-evidence');
  } finally { pause.release(); pause.restore(); }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const page = name => readFileSync(path.join(__dirname, '../app/(app)', name, 'page.tsx'), 'utf8');

test('the lobby self-view plays into whichever seat element mounts, even after the call started', () => {
  const lobby = page('lobby');
  // The seat appears only after the squad loads; a ref object would be read
  // once, before it exists, and leave a live camera with an empty tile.
  assert.doesNotMatch(lobby, /localVideoRef/);
  assert.match(lobby, /useState<HTMLDivElement \| null>\(null\)/);
  assert.match(lobby, /ref=\{setLocalVideoHost\}/);
  assert.match(lobby, /media\.client\?\.playLocal\(localVideoHost\)/);
  assert.match(lobby, /\}, \[camOn, localVideoHost, media\.client\]\);/);
  assert.match(lobby, /const showVideo = isMe \? camOn : !!remote\?\.hasVideo;/);
});

test('a dropped lobby call still turns devices off instead of reconnecting', () => {
  const lobby = page('lobby');
  assert.match(lobby, /if \(!videoJoined && next\) \{\s*await enableLobbyMedia/);
});

test('encounter "Retry devices" asks again for a blocked or missing device of the open call', () => {
  const encounter = page('encounter');
  const retry = encounter.slice(encounter.indexOf('function retryVideo()'), encounter.indexOf('useEffect(', encounter.indexOf('function retryVideo()')));
  assert.match(retry, /await joinVideo\(\);/);
  assert.match(retry, /call\.capture\[kind\] !== "denied" && call\.capture\[kind\] !== "unavailable"/);
  assert.match(retry, /await squadCall\.setDevice\(squadId, kind, true\);/);
  assert.match(retry, /call\.encounterId !== encId \|\| !call\.joined/);
});

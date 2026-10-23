/* Pocket Karts shipped-sample integrity tests (pack v5).
 * No browser, no server, no new deps: pure node:fs parsing of the production
 * WAV pack plus its manifest/licenses. Proves every file the engine can
 * request exists, is a valid nonempty WAV PCM16 mono 44100 file with sane
 * duration, matches the manifest hash, and carries verified CC0/CC-BY
 * provenance (Kenney CC0 archives + OpenGameArt CC-BY recordings/effects with
 * attribution). Pins distinct CC0 petrol idle/load sources and honest HQ-preview acquisition.
 * Run: node test/kart-audio-samples.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { CUE_NAMES, ASSET_MAP, LOOP_MAP, COLLISION_VARIANTS } from '../public/js/engines/kart-audio.mjs';

let passed = 0;
function ok(cond, msg) {
  assert(cond, msg);
  passed += 1;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_DIR = path.join(HERE, '..', 'public', 'assets', 'karts', 'audio');
const MAX_TOTAL_BYTES = 2 * 1024 * 1024; // 2MB hard ceiling; ~1MB target

/* Minimal RIFF/WAVE walker: returns fmt + data facts, throws on malformed. */
function parseWav(p) {
  const b = fs.readFileSync(p);
  assert(b.length > 44, `${p}: too short for a WAV header`);
  assert(b.toString('ascii', 0, 4) === 'RIFF', `${p}: missing RIFF`);
  assert(b.toString('ascii', 8, 12) === 'WAVE', `${p}: missing WAVE`);
  let fmt = null;
  let dataBytes = 0;
  let dataOffset = 0;
  let off = 12;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const size = b.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        audioFormat: b.readUInt16LE(off + 8),
        channels: b.readUInt16LE(off + 10),
        sampleRate: b.readUInt32LE(off + 12),
        bits: b.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      dataBytes = size;
      dataOffset = off + 8;
    }
    off += 8 + size + (size % 2); // chunks are word-aligned
  }
  assert(fmt, `${p}: missing fmt chunk`);
  assert(dataBytes > 0, `${p}: missing/empty data chunk`);
  const bytesPerSec = fmt.sampleRate * fmt.channels * (fmt.bits / 8);
  assert(dataOffset + dataBytes <= b.length, `${p}: truncated PCM data`);
  let peak=0, power=0, maxDelta=0, previous=0, high=0, highPower=0;
  const alpha=1/(1+2*Math.PI*400/fmt.sampleRate);
  const samples=[];
  for(let i=dataOffset;i<dataOffset+dataBytes;i+=2) {
    const sample=b.readInt16LE(i)/32768;
    peak=Math.max(peak,Math.abs(sample));power+=sample*sample;
    if(i>dataOffset)maxDelta=Math.max(maxDelta,Math.abs(sample-previous));
    high=alpha*(high+sample-previous);highPower+=high*high;previous=sample;
    samples.push(sample);
  }
  const onset=samples.findIndex((x)=>Math.abs(x)>peak*0.035)/fmt.sampleRate;
  const seamStep=Math.abs(samples[0]-samples.at(-1));
  const windowRms=[];
  const windowSize=Math.round(fmt.sampleRate*.1);
  for(let start=0;start+windowSize<=samples.length;start+=windowSize){
    let sum=0;for(let i=start;i<start+windowSize;i++)sum+=samples[i]*samples[i];
    windowRms.push(Math.sqrt(sum/windowSize));
  }
  return { ...fmt, dataBytes, durationSec: dataBytes / bytesPerSec, fileBytes: b.length,
    peak, rms:Math.sqrt(power/samples.length), onset, seamStep, maxDelta, highRatio:highPower/power,
    rmsSpreadDb:20*Math.log10(Math.max(...windowRms)/Math.min(...windowRms)),samples };

}

const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

/* ---------- manifest + provenance ---------- */

const manifestPath = path.join(AUDIO_DIR, 'manifest.json');
ok(fs.existsSync(manifestPath), 'pack: manifest.json shipped');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
ok(manifest.version === 5, 'pack: manifest version 5 (cache-busting phase-coherent recorded cycles)');
ok(manifest.license && manifest.license.includes('CC0') && manifest.license.includes('CC-BY'),
  'pack: manifest declares the mixed CC0 + CC-BY pack');
ok(manifest.files && typeof manifest.files === 'object', 'pack: manifest lists files');
ok(!JSON.stringify(manifest).includes('spaceEngineLow'),
  'pack: spaceship engine bed gone (real recorded engine only)');

for (const lic of ['LICENSE-scifi-kenney.txt', 'LICENSE-impact-kenney.txt']) {
  const p = path.join(AUDIO_DIR, lic);
  ok(fs.existsSync(p), `pack: ${lic} preserved`);
  const text = fs.readFileSync(p, 'utf8');
  ok(/Creative Commons Zero/i.test(text) && /kenney/i.test(text), `pack: ${lic} is the Kenney CC0 text`);
}

const attrPath = path.join(AUDIO_DIR, 'CREDITS.txt');
ok(fs.existsSync(attrPath), 'pack: CREDITS.txt shipped');
{
  const text = fs.readFileSync(attrPath, 'utf8');
  for (const who of ['qubodup','dklon','Malthaner','varkalandar','audible-edge','Ben Jaszczak','Brian Nelson','Kevin Heras','Matthew Nanney','Kenney']) {
    ok(text.includes(who), `pack: attribution names ${who}`);
  }
  ok(text.includes('opengameart.org') && /CC-BY 3\.0/.test(text),
    'pack: attribution cites OGA source pages + CC-BY 3.0');
}

/* ---------- every mapped file shipped, valid, hashed ---------- */

const V1_CUES = ['boost', 'ko', 'mine', 'pickup', 'pulse', 'rail', 'respawn', 'rocket', 'scatter', 'shield'];
ok(V1_CUES.every((n) => CUE_NAMES.includes(n)), 'pack: original 10 cues preserved');
ok(['grenade','emp','grenadeBlast','collision'].every((n)=>CUE_NAMES.includes(n)), 'pack: new grenade/EMP/blast/collision cues present');
const seenFiles=new Set();
const entries=Object.fromEntries(Object.entries({...LOOP_MAP,...ASSET_MAP,collisionSoft:COLLISION_VARIANTS.soft}).filter(([,file])=>{
  if(seenFiles.has(file))return false;
  seenFiles.add(file);return true;
}));
const mapped=Object.values(entries);
ok(mapped.length === 22 && new Set(mapped).size === mapped.length,
  'pack: 22 distinct files, with seeker/bomb aliases requiring no extra transfer');
ok(ASSET_MAP.seeker===ASSET_MAP.rocket && ASSET_MAP.bomb===ASSET_MAP.grenade,
  'pack: both arsenal aliases retain existing licensed samples');
ok(manifest.cueCount===CUE_NAMES.length && manifest.cueAliases.seeker==='rocket' && manifest.cueAliases.bomb==='grenade',
  'pack: manifest documents19 names and two aliases');

let totalBytes = 0;
const hashes = new Set();
const durations = {};
for (const [name,file] of Object.entries(entries)) {
  const p = path.join(AUDIO_DIR, file);
  ok(fs.existsSync(p), `pack: ${file} shipped for ${name}`);
  const wav = parseWav(p);
  ok(wav.audioFormat === 1, `pack: ${file} PCM`);
  ok(wav.channels === 1, `pack: ${file} mono`);
  ok(wav.sampleRate === 44100, `pack: ${file} 44100Hz`);
  ok(wav.bits === 16, `pack: ${file} 16-bit`);
  ok(wav.durationSec >= 0.1 && wav.durationSec <= (name.startsWith('engine') ? 4.1 : 2.1),
    `pack: ${file} sane duration (${wav.durationSec.toFixed(2)}s)`);
  durations[name] = wav.durationSec;
  ok(wav.peak > 0.01 && wav.peak <= 0.82, `pack: ${file} non-silent with PCM headroom (${wav.peak.toFixed(3)})`);
  ok(wav.rms > 0.001, `pack: ${file} sustained measurable signal`);
  if(['pulse','scatter','rail','grenade','collision','grenadeBlast'].includes(name))
    ok(wav.onset>=0 && wav.onset<0.04, `pack: ${file} attack within40ms (${wav.onset.toFixed(3)}s)`);
  if(name.startsWith('engine')) ok(wav.highRatio>0.01, 'pack: recorded petrol motor retains measurable harmonics');
  if(name.startsWith('engine') || name==='drift')
    ok(wav.seamStep < wav.maxDelta * 0.75, `pack: ${file} loop join stays below normal signal transitions`);

  totalBytes += wav.fileBytes;
  const hash = sha256(p);
  ok(/^[0-9a-f]{64}$/.test(hash), `pack: ${file} hashes`);
  hashes.add(hash);

  const entry = manifest.files[file];
  ok(entry, `pack: manifest covers ${file}`);
  ok(entry.outputSha256 === hash, `pack: manifest hash matches ${file}`);
  ok(entry.license === 'CC0-1.0' || entry.license === 'CC-BY-3.0',
    `pack: ${file} licensed CC0-1.0 or CC-BY-3.0`);
  ok(typeof entry.sourceFile === 'string' && entry.sourceFile.length > 3,
    `pack: ${file} names its source file`);
  ok(/^[0-9a-f]{64}$/.test(entry.sourceSha256 || ''), `pack: ${file} records source SHA256`);
  ok(typeof entry.sourcePage === 'string' && entry.sourcePage.startsWith('https://'),
    `pack: ${file} records its official source page`);
  ok(Math.abs(entry.durationSec - wav.durationSec) < 0.01, `pack: manifest duration matches ${file}`);
  ok(entry.bytes === wav.fileBytes, `pack: manifest size matches ${file}`);
  if (entry.pack.includes('Kenney')) {
    ok(entry.sourceFile.endsWith('.ogg'), `pack: ${file} names its Kenney source`);
    ok(entry.pack && entry.pack.includes('Kenney'), `pack: ${file} names its Kenney pack`);
    ok(entry.sourcePage.startsWith('https://kenney.nl/assets/'),
      `pack: ${file} records the official Kenney page`);
  } else {
    ok(entry.pack && /OpenGameArt|Freesound/.test(entry.pack), `pack: ${file} names its OGA work`);
    ok(typeof entry.author === 'string' && entry.author.length > 1,
      `pack: ${file} names its original author`);
    ok(/opengameart.org|freesound.org/.test(entry.sourcePage),
      `pack: ${file} records the original-author OGA page`);
    ok(typeof entry.processing === 'string' && entry.processing.length > 10,
      `pack: ${file} documents the edit made`);
  }
}

/* ---------- pack shape ---------- */

ok(hashes.size === mapped.length, 'pack: every shipped file byte-distinct (no cue reused everywhere)');
ok(durations.engine >= .1 && durations.engine <= 4.1, `pack: compact recorded engine cycle loop (${durations.engine.toFixed(2)}s)`);
ok(durations.ko >= 1.0, `pack: ko is the big explosion (${durations.ko.toFixed(2)}s)`);
ok(durations.pulse < 0.5 && durations.scatter <= 0.6 && durations.rail <= 0.5 &&
  durations.grenade < 0.6 && durations.emp < 0.5,
  'pack: weapon attacks are short transients');
ok(durations.rocket <= 1.0, `pack: rocket is a compact whoosh (${durations.rocket.toFixed(2)}s)`);
for(const file of ['engine.wav','engine-load.wav']) {
  ok(manifest.files[file].license==='CC0-1.0' && manifest.files[file].author==='Hanbaal', 'pack: real petrol-kart recordings have primary CC0 attribution');
  ok(manifest.files[file].sourceFile.endsWith('-hq.mp3')&&manifest.files[file].acquisition.includes('preview'),'pack: official HQ preview acquisition is explicit, no original WAV claim');
  const wav=parseWav(path.join(AUDIO_DIR,file)),cycle=manifest.files[file].combustionCycleFrames;
  ok(Number.isInteger(cycle)&&cycle>wav.sampleRate*.04&&cycle<wav.sampleRate*.1,
    'pack: loop documents its measured combustion period, rather than a strong upper harmonic');
  let cross=0,left=0,right=0;
  for(let i=0;i+cycle<wav.samples.length;i++){
    const a=wav.samples[i],b=wav.samples[i+cycle];cross+=a*b;left+=a*a;right+=b*b;
  }
  ok(cross/Math.sqrt(left*right)>.999,'pack: successive actual PCM combustion cycles preserve pitch/phase without a slow repeated rev cycle');
}
ok(manifest.files['engine.wav'].sourceSha256!==manifest.files['engine-load.wav'].sourceSha256,'pack: idle and load use distinct source recordings');
const loadWav=parseWav(path.join(AUDIO_DIR,'engine-load.wav'));
ok(loadWav.rmsSpreadDb<2,'pack: steady load has no prerecorded rev/lift volume cycle (100ms RMS spread <2dB)');
ok(loadWav.seamStep<.015,'pack: steady load seam has no additional impulse');
ok(manifest.files['engine-load.wav'].derivedFromOutputSha256==='ab8bceadc3fbf209712c64cf6b3068ab46bf1fcd1778d71a4b3b9f9d9e1f9b91',
  'pack: phase-coherent load provenance identifies the edited pack-v4 recording');
for(const cue of ['pulse','scatter','rail','grenade'])
  ok(manifest.files[cue+'.wav'].license==='CC0-1.0' && manifest.files[cue+'.wav'].sourceArchive==='Prepared SFX Library.7z',
    `pack: ${cue} uses the clean original CC0 firearm library`);
ok(totalBytes === manifest.totalAudioBytes, 'pack: manifest total matches all mapped WAV bytes');
ok(totalBytes <= MAX_TOTAL_BYTES,
  `pack: lean shipping total (${(totalBytes / 1024).toFixed(0)}KB <= 2048KB)`);

console.log(`KART_AUDIO_SAMPLES_PASS: ${passed} assertions (${mapped.length} files, ${(totalBytes / 1024).toFixed(0)}KB audio)`);

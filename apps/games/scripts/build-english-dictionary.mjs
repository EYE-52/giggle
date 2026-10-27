#!/usr/bin/env node
// Offline build of a modified SCOWL 2020.12.07 size-60 word list.
// Copyright 2000-2018 Kevin Atkinson and source contributors.
// Full redistribution notices: games/engines/SCOWL_COPYRIGHT.txt.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.argv[2];
if (!source) throw new Error('Usage: node scripts/build-english-dictionary.mjs /path/to/extracted/scowl-2020.12.07');
const hash = data => createHash('sha256').update(data).digest('hex');
const copyright = fs.readFileSync(path.join(source, 'Copyright'), 'utf8');
const expectedCopyright = '283326a422e29c510e2ba6805518c418ce3c35ed1fadc3eec83d2da4f6c5a055';
if (hash(copyright) !== expectedCopyright) throw new Error('SCOWL copyright does not match the pinned release.');
// The complete release's copyright is copied verbatim beside the result.
const categories = ['english', 'american', 'british', 'british_z', 'variant_1', 'british_variant_1'];
const files = fs.readdirSync(path.join(source, 'final')).filter(file => {
  const match = file.match(/^(.+)-words\.(\d+)$/);
  return match && categories.includes(match[1]) && Number(match[2]) <= 60;
}).sort();
if (!files.length || !files.includes('english-words.60')) throw new Error('This is not an extracted SCOWL size-60 release.');
const words = new Set();
const sources = [];
for (const file of files) {
  const buffer = fs.readFileSync(path.join(source, 'final', file));
  sources.push({ file, sha256: hash(buffer) });
  for (const word of buffer.toString('utf8').split(/\r?\n/)) {
    // Deliberate modification: unaccented lower-case alphabetic words only;
    // omit names/abbreviations/contractions/roman-numeral and jargon categories.
    if (/^[a-z]{1,24}$/.test(word)) words.add(word);
  }
}
const text = [...words].sort().join('\n') + '\n';
if (words.size < 50000 || words.has('zzz') || !words.has('chocolate') || !words.has('colour') || !words.has('color')) throw new Error('Dictionary sanity check failed.');
const directory = path.join(root, 'games', 'engines');
fs.writeFileSync(path.join(directory, 'english-words.txt'), text);
fs.writeFileSync(path.join(directory, 'SCOWL_COPYRIGHT.txt'), copyright);
const info = {
  name: 'SCOWL', release: '2020.12.07', size: 60,
  homepage: 'https://wordlist.aspell.net/',
  sourceUrl: 'https://downloads.sourceforge.net/project/wordlist/SCOWL/2020.12.07/scowl-2020.12.07.tar.gz',
  sourceArchiveSha256: '5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc',
  sourceCommit: '5ef55f9c42730ebe4394a78b77855468a6f15dd2',
  license: 'SCOWL MIT-like collective license; full original source notices retained in SCOWL_COPYRIGHT.txt.',
  categories, modification: 'Sorted unique lower-case ASCII alphabetic words, lengths1–24, only normal-word files throughsize60.',
  wordCount: words.size, sha256: hash(text), copyrightSha256: hash(copyright), sources,
};
fs.writeFileSync(path.join(directory, 'english-words-info.json'), JSON.stringify(info, null, 2) + '\n');
console.log(`DICTIONARY_BUILD_PASS ${words.size} words; SHA-256 ${info.sha256}`);

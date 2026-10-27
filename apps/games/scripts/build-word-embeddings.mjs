#!/usr/bin/env node
// Build-only inference. Credit: Xenova/all-MiniLM-L6-v2 (Apache-2.0),
// https://huggingface.co/Xenova/all-MiniLM-L6-v2
// https://huggingface.co/docs/transformers.js/en/pipelines
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'games', 'warm-words');
const MODEL = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const TOOL_VERSION = '3.8.1';
const hash = (x) => createHash('sha256').update(x).digest('hex');
const toolRoot = process.env.EMBEDDING_TOOL_ROOT;
if (!toolRoot) throw new Error('Set EMBEDDING_TOOL_ROOT to a separate build folder containing @huggingface/transformers@3.8.1. See SEMANTIC_WORD_GUIDE.md.');
const packageDir = path.join(toolRoot, 'node_modules', '@huggingface', 'transformers');
const version = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8')).version;
if (version !== TOOL_VERSION) throw new Error(`Expected Transformers.js ${TOOL_VERSION}, got ${version}`);
const { pipeline, env } = await import(pathToFileURL(path.join(packageDir, 'dist', 'transformers.node.mjs')).href);
env.cacheDir = process.env.EMBEDDING_CACHE_DIR || path.join(os.tmpdir(), 'warm-words-model-cache');
if (process.env.EMBEDDING_OFFLINE === '1') env.allowRemoteModels = false;
const vocabularyText = fs.readFileSync(path.join(DIR, 'vocabulary.json'), 'utf8');
const { words, targets } = JSON.parse(vocabularyText);
if (words.length < 1500 || words.length > 2500 || new Set(words).size !== words.length || words.some(w => !/^[a-z]{2,24}$/.test(w))) throw new Error('Vocabulary must contain 1500–2500 unique ordinary English words.');
if (!targets.length || targets.some(w => !words.includes(w))) throw new Error('Every target must be in the vocabulary.');
const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8', revision: REVISION });
const vectors = [];
for (let offset = 0; offset < words.length; offset += 32) {
  const batch = await extractor(words.slice(offset, offset + 32), { pooling: 'mean', normalize: true });
  for (const vector of batch.tolist()) {
    if (vector.length !== 384 || vector.some(x => !Number.isFinite(x))) throw new Error('Invalid model output.');
    // Decimal storage is compact; the runtime re-normalizes these real vectors.
    vectors.push(vector.map(x => Number(x.toFixed(6))));
  }
  if (offset % 320 === 0) console.log(`${Math.min(offset + 32, words.length)}/${words.length} words embedded`);
}
const text = JSON.stringify({ dimensions: 384, words, vectors }) + '\n';
// Write only after successful inference. A failed download never manufactures data.
fs.writeFileSync(path.join(DIR, 'embeddings.json'), text);
const modelPath = path.join(env.cacheDir, MODEL, REVISION, 'onnx', 'model_quantized.onnx');
const tokenizerPath = path.join(env.cacheDir, MODEL, REVISION, 'tokenizer.json');
const info = {
  model: MODEL, revision: REVISION, license: 'Apache-2.0',
  modelUrl: `https://huggingface.co/${MODEL}/tree/${REVISION}`,
  sourceModel: 'sentence-transformers/all-MiniLM-L6-v2',
  library: '@huggingface/transformers', libraryVersion: version,
  dtype: 'q8', pooling: 'mean', normalized: true, dimensions: 384,
  input: 'Each vocabulary word alone, in the listed order.',
  vocabularyOrigin: 'Original curated everyday English vocabulary for Giggle; no third-party dictionary copied.',
  wordCount: words.length, targetCount: targets.length,
  vocabularySha256: hash(vocabularyText), embeddingsSha256: hash(text),
  weightsSha256: fs.existsSync(modelPath) ? hash(fs.readFileSync(modelPath)) : null,
  tokenizerSha256: fs.existsSync(tokenizerPath) ? hash(fs.readFileSync(tokenizerPath)) : null,
  generatedAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(DIR, 'model-info.json'), JSON.stringify(info, null, 2) + '\n');
await extractor.dispose();
console.log(`Wrote ${words.length} real ${info.dimensions}-dimensional word embeddings; SHA-256 ${info.embeddingsSha256}`);

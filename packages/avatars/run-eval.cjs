// Capped synthetic vision eval runner. Synthetic catalog recovery, NOT selfie
// likeness: it measures whether a vision model can recover known renderer
// configurations, nothing more.
//
// Usage (repo root):
//   node packages/avatars/run-eval.cjs --dir DIR --models m1,m2 --budget 0.10 [--dry-run] [--limit N] [--prices JSON_OR_FILE]
//
// Safety contract:
// - The OpenRouter key comes from OPENROUTER_API_KEY in the env only. It is
//   never printed, logged, or written to any file.
// - --dry-run performs ZERO network calls (not even the free price/key GETs),
//   builds every request, scores canned valid responses, and prints the
//   estimated maximum cost.
// - Paid runs fetch current prices first, reserve a conservative upper bound
//   before every request, never retry, stop at the budget cap or on the first
//   timeout/network/HTTP failure (charged the full reservation), and run all
//   requests sequentially, interleaving models per fixture.
// - Image bytes, base64, and full prompts never reach reports or logs.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const {
  MATCH_PROMPT_VERSION, SKIN_PALETTE, HAIR_PALETTE, buildMatchRequest, parseSuggestion,
} = require('../../server/src/utils/avatarMatch');

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const REQUEST_TIMEOUT_MS = 30000;
const RESERVE_INPUT_TOKENS = 2500;
const RESERVE_COMPLETION_TOKENS = 300;
const RESERVE_MULTIPLIER = 1.5;

// Hand-copied from docs/SELFIE_MATCHING_PLAN.md (checked 2026-09-24) and used
// ONLY for --dry-run estimates when no --prices are passed. UNVERIFIED.
const UNVERIFIED_FALLBACK_PRICES = {
  'qwen/qwen3-vl-8b-instruct': { prompt: 0.117, completion: 0.455, structuredOutputs: true },
  'qwen/qwen3.7-flash': { prompt: 0.03, completion: 0.13, structuredOutputs: false },
};

const SCORED_PALETTE_TRAITS = ['skinTone', 'hairColor'];
const CONFUSION_TRAITS = ['hair', 'glasses', 'facialHair'];
const NUMERIC_KEYS = ['faceWidth', 'eyeSpacing', 'noseSize', 'mouthWidth'];
const TRAIT_KEYS = ['hair', 'face', 'glasses', 'facialHair', 'headwear', 'earrings', 'clothing', 'freckles', ...SCORED_PALETTE_TRAITS];

const round6 = (value) => Math.round(value * 1e6) / 1e6;
const round4 = (value) => Math.round(value * 1e4) / 1e4;
const ratio = (part, whole) => (whole > 0 ? round4(part / whole) : null);
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
};

function readArg(name) {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) return args[i + 1];
    if (args[i].startsWith(`--${name}=`)) return args[i].slice(name.length + 3);
  }
  return undefined;
}

function fail(message) {
  console.error(String(message));
  process.exit(1);
}

function loadCachedPrices(spec) {
  if (!spec) return null;
  let raw = spec;
  if (!spec.trim().startsWith('{')) raw = fs.readFileSync(path.resolve(spec), 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail('--prices must be a JSON object string or a path to a JSON file');
  }
  const normalized = {};
  for (const [id, entry] of Object.entries(parsed)) {
    normalized[id] = {
      prompt: Number(entry.prompt),
      completion: Number(entry.completion),
      structuredOutputs: entry.structuredOutputs !== undefined ? Boolean(entry.structuredOutputs) : undefined,
    };
    if (!Number.isFinite(normalized[id].prompt) || !Number.isFinite(normalized[id].completion)) {
      fail(`cached price for ${id} needs numeric prompt and completion fields`);
    }
  }
  return normalized;
}

async function fetchJson(url, { key, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: controller.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) throw new Error(`GET ${url} failed with HTTP ${res.status}`);
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function postCompletion(key, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

function createAggregate(model) {
  return {
    model,
    attempts: 0,
    valid: 0,
    statusCorrect: 0,
    traits: Object.fromEntries(TRAIT_KEYS.map((trait) => [trait, { scored: 0, correct: 0, wrong: 0, abstained: 0 }])),
    confusion: Object.fromEntries(CONFUSION_TRAITS.map((trait) => [trait, {}])),
    palette: Object.fromEntries(SCORED_PALETTE_TRAITS.map((trait) => [trait, { scored: 0, exact: 0, within1: 0 }])),
    latencies: [],
    costs: [],
    promptTokens: 0,
    completionTokens: 0,
    responsesWithUsage: 0,
    providers: {},
    generationIds: [],
    numericAbsErrors: {},
    details: [],
  };
}

function recordOutcome(aggregate, fixture, parsed, meta) {
  aggregate.attempts++;
  const valid = Boolean(parsed && parsed.ok);
  if (valid) aggregate.valid++;
  const status = valid ? parsed.suggestion.status : null;
  const statusOk = valid && Array.isArray(fixture.acceptableStatuses) && fixture.acceptableStatuses.includes(status);
  if (statusOk) aggregate.statusCorrect++;
  const detail = { fixture: fixture.id, valid, status, statusOk, latencyMs: meta.latencyMs, costUsd: round6(meta.cost) };
  if (!valid) detail.parseReason = parsed && parsed.reason ? String(parsed.reason).slice(0, 160) : 'no response';
  aggregate.details.push(detail);
  aggregate.latencies.push(meta.latencyMs);
  aggregate.costs.push(meta.cost);
  if (meta.provider) aggregate.providers[meta.provider] = (aggregate.providers[meta.provider] || 0) + 1;
  if (meta.generationId) aggregate.generationIds.push(meta.generationId);
  if (meta.usage) {
    aggregate.promptTokens += Number(meta.usage.prompt_tokens) || 0;
    aggregate.completionTokens += Number(meta.usage.completion_tokens) || 0;
    aggregate.responsesWithUsage++;
  }
  if (valid && fixture.kind === 'known' && fixture.expected) {
    for (const trait of fixture.scoredTraits || []) {
      const expected = fixture.expected[trait];
      const predicted = parsed.suggestion[trait];
      const slot = aggregate.traits[trait] || (aggregate.traits[trait] = { scored: 0, correct: 0, wrong: 0, abstained: 0 });
      slot.scored++;
      if (predicted === expected) slot.correct++;
      else if (predicted === null || predicted === undefined) slot.abstained++;
      else slot.wrong++;
      if (SCORED_PALETTE_TRAITS.includes(trait)) {
        const palette = trait === 'skinTone' ? SKIN_PALETTE : HAIR_PALETTE;
        const expectedIndex = palette.findIndex((entry) => entry.id === expected);
        const predictedIndex = predicted == null ? -1 : palette.findIndex((entry) => entry.id === predicted);
        aggregate.palette[trait].scored++;
        if (expectedIndex >= 0 && predictedIndex === expectedIndex) aggregate.palette[trait].exact++;
        if (expectedIndex >= 0 && predictedIndex >= 0 && Math.abs(expectedIndex - predictedIndex) <= 1) aggregate.palette[trait].within1++;
      }
      if (CONFUSION_TRAITS.includes(trait)) {
        const expectedKey = String(expected);
        const predictedKey = predicted == null ? 'null' : String(predicted);
        aggregate.confusion[trait][expectedKey] = aggregate.confusion[trait][expectedKey] || {};
        aggregate.confusion[trait][expectedKey][predictedKey] = (aggregate.confusion[trait][expectedKey][predictedKey] || 0) + 1;
      }
    }
    for (const key of NUMERIC_KEYS) {
      const expected = fixture.expected[key];
      const predicted = parsed.suggestion[key];
      if (Number.isFinite(expected) && Number.isInteger(predicted)) {
        (aggregate.numericAbsErrors[key] = aggregate.numericAbsErrors[key] || []).push(Math.abs(expected - predicted));
      }
    }
  }
}

function summarize(aggregate) {
  const traits = {};
  for (const [trait, counts] of Object.entries(aggregate.traits)) {
    if (counts.scored > 0) traits[trait] = { ...counts, accuracy: ratio(counts.correct, counts.scored) };
  }
  const palette = {};
  for (const [trait, counts] of Object.entries(aggregate.palette)) {
    if (counts.scored > 0) palette[trait] = { ...counts, exactRate: ratio(counts.exact, counts.scored), withinOneStepRate: ratio(counts.within1, counts.scored) };
  }
  const numericSliders = {};
  for (const [key, errors] of Object.entries(aggregate.numericAbsErrors)) {
    numericSliders[key] = { n: errors.length, meanAbsError: round4(errors.reduce((sum, value) => sum + value, 0) / errors.length) };
  }
  const totalCost = aggregate.costs.reduce((sum, value) => sum + value, 0);
  return {
    model: aggregate.model,
    attempts: aggregate.attempts,
    validRate: ratio(aggregate.valid, aggregate.attempts),
    statusAccuracy: ratio(aggregate.statusCorrect, aggregate.attempts),
    traitAccuracy: traits,
    confusion: aggregate.confusion,
    paletteAccuracy: palette,
    numericSlidersToleranceOnly: numericSliders,
    latencyMs: { p50: percentile(aggregate.latencies, 0.5), p95: percentile(aggregate.latencies, 0.95) },
    tokens: { prompt: aggregate.promptTokens, completion: aggregate.completionTokens, responsesWithUsage: aggregate.responsesWithUsage },
    costUsd: { total: round6(totalCost), mean: round6(totalCost / (aggregate.attempts || 1)) },
    providers: aggregate.providers,
    generationIds: aggregate.generationIds,
    responses: aggregate.details,
  };
}

function cannedSuggestion(fixture) {
  const suggestion = {
    status: fixture.expectedStatus || (fixture.acceptableStatuses || ['match'])[0],
    hair: null, face: null, glasses: null, facialHair: null, headwear: null, earrings: null,
    clothing: null, freckles: null, skinTone: null, hairColor: null,
    faceWidth: null, eyeSpacing: null, noseSize: null, mouthWidth: null,
  };
  if (fixture.kind === 'known' && fixture.expected) {
    for (const key of Object.keys(suggestion)) {
      if (key === 'status') continue;
      if (fixture.scoredTraits && fixture.scoredTraits.includes(key)) suggestion[key] = fixture.expected[key];
      else if (NUMERIC_KEYS.includes(key) && Number.isInteger(fixture.expected[key])) suggestion[key] = fixture.expected[key];
    }
  }
  return suggestion;
}

function renderMarkdown(report) {
  const lines = [];
  const pct = (value) => (value === null || value === undefined ? 'n/a' : `${round4(value * 100)}%`);
  const usd = (value) => (value === null || value === undefined ? 'n/a' : `$${round6(value)}`);
  lines.push('# Synthetic avatar catalog recovery report', '');
  lines.push('**Label: synthetic catalog recovery, not selfie likeness.** These fixtures are rendered from known renderer configurations; scores measure catalog/format understanding only, never selfie accuracy.', '');
  lines.push(`- Generated: ${report.timestamp}`);
  lines.push(`- Prompt version: ${report.promptVersion}`);
  lines.push(`- Mode: ${report.dryRun ? 'dry-run (zero network calls, canned responses)' : 'paid pilot'}`);
  lines.push(`- Models: ${report.models.map((entry) => entry.model).join(', ')}`);
  lines.push(`- Price source: ${report.priceSource.label}`);
  lines.push(`- Fixtures: ${report.fixtures.total} (${report.fixtures.known} known + ${report.fixtures.negative} negative)${report.fixtures.limitApplied ? `, limited to first ${report.fixtures.limitApplied}` : ''}`);
  lines.push(`- Planned requests: ${report.plannedRequests} (models interleaved per fixture, sequential)`);
  lines.push(`- Estimated maximum cost: ${usd(report.estimatedMaxCostUsd)} ((2500 input + 300 output tokens) x price x 1.5 per request)`);
  lines.push(`- Budget: ${usd(report.budgetUsd)}; spent: ${usd(report.spentUsd)}`);
  if (report.stoppedEarly) {
    lines.push(`- **Stopped early:** reason=${report.stoppedEarly.reason}, at fixture=${report.stoppedEarly.atFixture || '-'}, model=${report.stoppedEarly.atModel || '-'}, skipped=${report.stoppedEarly.skipped || 0}${report.stoppedEarly.detail ? `, detail=${report.stoppedEarly.detail}` : ''}`);
  } else {
    lines.push('- Stopped early: no');
  }
  if (report.keyUsage.before || report.keyUsage.after) {
    const fmt = (entry) => (entry ? `limit=${entry.limit}, limit_remaining=${entry.limit_remaining}, usage=${entry.usage}` : 'n/a');
    lines.push(`- Key usage before: ${fmt(report.keyUsage.before)}`);
    lines.push(`- Key usage after: ${fmt(report.keyUsage.after)}`);
  } else {
    lines.push(`- Key usage: ${report.keyUsage.note}`);
  }
  for (const entry of report.models) {
    lines.push('', `## ${entry.model}`, '');
    lines.push(`- Valid rate: ${pct(entry.validRate)} (${entry.attempts} attempts)`);
    lines.push(`- Status accuracy: ${pct(entry.statusAccuracy)}`);
    lines.push(`- Latency p50/p95: ${entry.latencyMs.p50 ?? 'n/a'} ms / ${entry.latencyMs.p95 ?? 'n/a'} ms`);
    lines.push(`- Tokens: prompt=${entry.tokens.prompt}, completion=${entry.tokens.completion} (${entry.tokens.responsesWithUsage} responses with usage)`);
    lines.push(`- Cost: total ${usd(entry.costUsd.total)}, mean ${usd(entry.costUsd.mean)}`);
    lines.push(`- Providers returned by OpenRouter: ${Object.keys(entry.providers).join(', ') || 'n/a'}`);
    lines.push(`- Generation ids: ${entry.generationIds.length ? entry.generationIds.join(', ') : 'n/a'}`);
    lines.push('- Per-trait accuracy (exact match on scored traits; abstain = predicted null):');
    lines.push('');
    lines.push('| trait | scored | correct | wrong | abstained | accuracy |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const [trait, counts] of Object.entries(entry.traitAccuracy)) {
      lines.push(`| ${trait} | ${counts.scored} | ${counts.correct} | ${counts.wrong} | ${counts.abstained} | ${pct(counts.accuracy)} |`);
    }
    lines.push('');
    lines.push('- Palette accuracy (exact id and within one palette step):');
    for (const [trait, counts] of Object.entries(entry.paletteAccuracy)) {
      lines.push(`  - ${trait}: exact ${counts.exact}/${counts.scored} (${pct(counts.exactRate)}), within one step ${counts.within1}/${counts.scored} (${pct(counts.withinOneStepRate)})`);
    }
    lines.push('- Confusion counts (expected -> predicted; "null" = abstained or invalid):');
    for (const [trait, matrix] of Object.entries(entry.confusion)) {
      if (Object.keys(matrix).length) lines.push(`  - ${trait}: ${JSON.stringify(matrix)}`);
    }
    if (Object.keys(entry.numericSlidersToleranceOnly).length) {
      lines.push('- Numeric sliders (tolerance-only, not pass/fail):');
      for (const [key, stats] of Object.entries(entry.numericSlidersToleranceOnly)) {
        lines.push(`  - ${key}: mean |error| ${stats.meanAbsError} over ${stats.n} predictions`);
      }
    }
  }
  lines.push('', '_Synthetic catalog recovery, not selfie likeness. No image bytes, base64, or full prompts appear in this report._', '');
  return lines.join('\n');
}

async function writeReports(dir, report, key) {
  const serialized = JSON.stringify(report);
  if (serialized.includes('data:image')) throw new Error('refusing to write report: image payload detected');
  if (serialized.includes('"image_url"')) throw new Error('refusing to write report: request body detected');
  if (key && serialized.includes(key)) throw new Error('refusing to write report: credential detected');
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(report));
}

async function main() {
  const dir = readArg('dir');
  const dryRun = process.argv.includes('--dry-run');
  const models = String(readArg('models') || '').split(',').map((value) => value.trim()).filter(Boolean);
  const limitArg = readArg('limit');
  const limit = limitArg !== undefined ? Number(limitArg) : null;
  const budgetArg = readArg('budget');
  const budget = budgetArg !== undefined ? Number(budgetArg) : null;
  if (!dir) fail('--dir is required (the directory produced by prepare-eval.cjs)');
  if (!models.length) fail('--models is required (comma-separated OpenRouter model ids)');
  if (limit !== null && (!Number.isInteger(limit) || limit < 1)) fail('--limit must be a positive integer');
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0)) fail('--budget must be a positive dollar amount');
  if (!dryRun && budget === null) fail('--budget is required for paid runs (use --dry-run to estimate without spending)');

  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`${manifestPath} not found; run prepare-eval.cjs first`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  let fixtures = Array.isArray(manifest.fixtures) ? manifest.fixtures : [];
  if (limit !== null) fixtures = fixtures.slice(0, limit);
  if (!fixtures.length) fail('no fixtures to evaluate');
  for (const fixture of fixtures) {
    if (!fs.existsSync(path.join(dir, `${fixture.id}.png`))) fail(`missing ${fixture.id}.png in ${dir}`);
  }

  const aggregates = new Map(models.map((model) => [model, createAggregate(model)]));
  let prices = {};
  let priceSource;
  let keyUsageBefore = null;
  let keyUsageAfter = null;
  let spent = 0;
  let stoppedEarly = null;

  const reservationFor = (model) => {
    const entry = prices[model];
    return ((RESERVE_INPUT_TOKENS * entry.prompt + RESERVE_COMPLETION_TOKENS * entry.completion) / 1e6) * RESERVE_MULTIPLIER;
  };

  // Downscale every image once to a 384px JPEG data URL; never logged or reported.
  const dataUrls = {};
  for (const fixture of fixtures) {
    const jpeg = await sharp(path.join(dir, `${fixture.id}.png`)).resize({ width: 384, height: 384, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
    dataUrls[fixture.id] = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  }

  const plannedRequests = fixtures.length * models.length;

  if (dryRun) {
    const cached = loadCachedPrices(readArg('prices'));
    for (const model of models) {
      if (cached && cached[model]) prices[model] = cached[model];
      else if (UNVERIFIED_FALLBACK_PRICES[model]) prices[model] = UNVERIFIED_FALLBACK_PRICES[model];
      else fail(`no cached or fallback price for ${model}; pass --prices '{"${model}":{"prompt":X,"completion":Y}}'`);
    }
    priceSource = readArg('prices')
      ? { label: 'cached prices passed via --prices (not re-fetched; dry-run makes zero network calls)', unverified: true }
      : { label: 'hardcoded fallback prices copied from docs/SELFIE_MATCHING_PLAN.md — UNVERIFIED, dry-run made no network calls to confirm them', unverified: true };
    let built = 0;
    for (const fixture of fixtures) {
      for (const model of models) {
        const structured = prices[model].structuredOutputs !== false;
        buildMatchRequest({ model, imageDataUrl: dataUrls[fixture.id], structured });
        built++;
        const parsed = parseSuggestion(JSON.stringify(cannedSuggestion(fixture)));
        recordOutcome(aggregates.get(model), fixture, parsed, {
          latencyMs: 0, cost: reservationFor(model), provider: 'canned (dry-run)', generationId: `dry-run:${fixture.id}`, usage: null,
        });
      }
    }
    const estimate = round6(models.reduce((sum, model) => sum + reservationFor(model), 0) * fixtures.length);
    console.log(`Dry-run: built ${built}/${plannedRequests} requests, scored canned valid responses, ZERO network calls (no price or key lookups).`);
    console.log(`Estimated maximum cost: $${estimate} (${fixtures.length} fixtures x ${models.length} models x (2500 in + 300 out tokens) x price x ${RESERVE_MULTIPLIER}).`);
    const report = {
      kind: 'synthetic-catalog-recovery',
      label: 'Synthetic catalog recovery, not selfie likeness',
      timestamp: new Date().toISOString(),
      promptVersion: MATCH_PROMPT_VERSION,
      dryRun: true,
      plannedRequests,
      estimatedMaxCostUsd: estimate,
      budgetUsd: budget,
      spentUsd: 0,
      stoppedEarly: null,
      priceSource,
      prices,
      keyUsage: { before: null, after: null, note: 'dry-run: zero network calls; key never read' },
      fixtures: {
        total: fixtures.length,
        known: fixtures.filter((fixture) => fixture.kind === 'known').length,
        negative: fixtures.filter((fixture) => fixture.kind === 'negative').length,
        limitApplied: limit,
      },
      models: models.map((model) => summarize(aggregates.get(model))),
      cannedResponseNote: 'Dry-run validates the pipeline only: every "response" is a canned valid suggestion derived from the manifest, so all rates are 1.0 by construction.',
    };
    await writeReports(dir, report, null);
    console.log(`Wrote ${path.join(dir, 'report.json')} and report.md (labeled: synthetic catalog recovery, not selfie likeness).`);
    return;
  }

  // Paid path: the key exists in env only and never appears in output.
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) fail('OPENROUTER_API_KEY is not set. Refusing paid evaluation without it (use --dry-run to plan without spending).');

  // Free preflight: current prices/model capabilities, then key limits.
  const modelsBody = await fetchJson(`${OPENROUTER_BASE}/models`);
  const listed = new Map((modelsBody.data || []).map((entry) => [entry.id, entry]));
  for (const model of models) {
    const entry = listed.get(model);
    if (!entry) fail(`model ${model} is not listed by OpenRouter; aborting before any paid call`);
    const modalities = (entry.architecture && entry.architecture.input_modalities) || [];
    if (!modalities.includes('image')) fail(`model ${model} does not accept image input; aborting before any paid call`);
    // Reserve against the most expensive live endpoint: OpenRouter may route to
    // any of them. API prices are USD per token; `prices` holds USD per million
    // tokens (the unit reservationFor and --prices use).
    const endpointsBody = await fetchJson(`${OPENROUTER_BASE}/models/${model}/endpoints`);
    const endpoints = (endpointsBody.data && endpointsBody.data.endpoints) || [];
    if (!endpoints.length) fail(`model ${model} has no live endpoints; aborting before any paid call`);
    const perToken = (field) => Math.max(...endpoints.map((endpoint) => Number(endpoint.pricing && endpoint.pricing[field])));
    const promptPrice = perToken('prompt') * 1e6;
    const completionPrice = perToken('completion') * 1e6;
    if (!Number.isFinite(promptPrice) || !Number.isFinite(completionPrice) || promptPrice <= 0 || completionPrice <= 0) {
      fail(`model ${model} has no readable pricing; aborting before any paid call`);
    }
    prices[model] = {
      prompt: promptPrice,
      completion: completionPrice,
      structuredOutputs: (entry.supported_parameters || []).includes('structured_outputs') && endpoints.every((endpoint) => (endpoint.supported_parameters || []).includes('structured_outputs')),
      reasoningControl: endpoints.every((endpoint) => (endpoint.supported_parameters || []).includes('reasoning')),
    };
  }
  priceSource = { label: 'max endpoint price from GET /api/v1/models/{id}/endpoints immediately before the run (USD per million tokens)', unverified: false };
  for (const model of models) {
    if (!(reservationFor(model) > 0)) fail(`reservation for ${model} is not positive; refusing to run without a working budget guard`);
  }
  try {
    keyUsageBefore = (await fetchJson(`${OPENROUTER_BASE}/key`, { key })).data || null;
  } catch (error) {
    fail(`could not read key usage before the run: ${error.message}; aborting before any paid call`);
  }
  const estimate = round6(models.reduce((sum, model) => sum + reservationFor(model), 0) * fixtures.length);
  console.log(`Preflight ok (prices fetched, key limits read). Estimated maximum cost: $${estimate}. Budget: $${budget}. No image data will be logged.`);

  let attempted = 0;
  outer: for (const fixture of fixtures) {
    for (const model of models) {
      const reservation = reservationFor(model);
      if (spent + reservation > budget) {
        stoppedEarly = {
          reason: 'budget', atFixture: fixture.id, atModel: model,
          spentUsd: round6(spent), reservationUsd: round6(reservation), skipped: plannedRequests - attempted,
        };
        break outer;
      }
      attempted++;
      const body = buildMatchRequest({ model, imageDataUrl: dataUrls[fixture.id], structured: prices[model].structuredOutputs === true, reasoningControl: prices[model].reasoningControl === true });
      const started = Date.now();
      try {
        const { res, data } = await postCompletion(key, body);
        const latencyMs = Date.now() - started;
        if (!res.ok) {
          spent += reservation; // uncertain billing: assume the full reservation
          const detail = `HTTP ${res.status}: ${String((data && data.error && data.error.message) || 'no error message').slice(0, 160)}`;
          recordOutcome(aggregates.get(model), fixture, { ok: false, reason: `request failed: ${detail}` }, { latencyMs, cost: reservation, provider: null, generationId: null });
          stoppedEarly = { reason: 'request-failure', atFixture: fixture.id, atModel: model, detail, skipped: plannedRequests - attempted };
          break outer;
        }
        const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
        const usage = (data && data.usage) || null;
        const reportedCost = usage ? Number(usage.cost) : NaN;
        const cost = Number.isFinite(reportedCost) ? reportedCost : reservation; // uncertain billing -> assume full reservation
        spent += cost;
        const parsed = typeof content === 'string' ? parseSuggestion(content) : { ok: false, reason: 'response had no text content' };
        recordOutcome(aggregates.get(model), fixture, parsed, {
          latencyMs, cost,
          // OpenRouter reports the routed provider and generation id at the top level.
          provider: (typeof data.provider === 'string' && data.provider) || null,
          generationId: (typeof data.id === 'string' && data.id) || null,
          usage,
        });
        console.log(`[${attempted}/${plannedRequests}] ${model} ${fixture.id} valid=${parsed.ok} status=${parsed.ok ? parsed.suggestion.status : '-'} latency=${latencyMs}ms cost=$${round6(cost)}`);
      } catch (error) {
        const latencyMs = Date.now() - started;
        spent += reservation; // timeout or network error: charged the full reservation
        const reason = error && error.name === 'AbortError' ? 'timeout after 30s' : 'network error';
        recordOutcome(aggregates.get(model), fixture, { ok: false, reason: `request failed: ${reason}` }, { latencyMs, cost: reservation, provider: null, generationId: null });
        stoppedEarly = {
          reason, atFixture: fixture.id, atModel: model,
          detail: String((error && error.message) || error).slice(0, 160), skipped: plannedRequests - attempted,
        };
        break outer;
      }
    }
  }

  try {
    keyUsageAfter = (await fetchJson(`${OPENROUTER_BASE}/key`, { key })).data || null;
  } catch {
    console.error('warning: could not re-read key usage after the run');
  }

  if (stoppedEarly) {
    console.error(`Stopped early: ${stoppedEarly.reason} at ${stoppedEarly.atFixture || ''} (${stoppedEarly.atModel || ''}); ${stoppedEarly.skipped || 0} of ${plannedRequests} requests skipped. No retries.`);
  }
  const report = {
    kind: 'synthetic-catalog-recovery',
    label: 'Synthetic catalog recovery, not selfie likeness',
    timestamp: new Date().toISOString(),
    promptVersion: MATCH_PROMPT_VERSION,
    dryRun: false,
    plannedRequests,
    estimatedMaxCostUsd: estimate,
    budgetUsd: budget,
    spentUsd: round6(spent),
    stoppedEarly,
    priceSource,
    prices,
    keyUsage: {
      before: keyUsageBefore ? { limit: keyUsageBefore.limit, limit_remaining: keyUsageBefore.limit_remaining, usage: keyUsageBefore.usage } : null,
      after: keyUsageAfter ? { limit: keyUsageAfter.limit, limit_remaining: keyUsageAfter.limit_remaining, usage: keyUsageAfter.usage } : null,
      note: 'from GET /api/v1/key (free) before and after the run',
    },
    fixtures: {
      total: fixtures.length,
      known: fixtures.filter((fixture) => fixture.kind === 'known').length,
      negative: fixtures.filter((fixture) => fixture.kind === 'negative').length,
      limitApplied: limit,
    },
    models: models.map((model) => summarize(aggregates.get(model))),
  };
  await writeReports(dir, report, key);
  console.log(`Run complete: ${attempted}/${plannedRequests} requests, spent $${round6(spent)} of $${budget} budget. Reports written to ${dir} (labeled: synthetic catalog recovery, not selfie likeness).`);
  if (stoppedEarly && stoppedEarly.reason !== 'budget') process.exitCode = 1;
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

# Selfie → editable Giggle character

Proposal, 24 September 2026. No provider is connected and no user photos or paid requests were sent. This replaces the raster-generation direction in `PHOTO_AVATAR_PLAN.md` for the component-based avatar work.

## Recommended approach

Keep all artwork and animation in `packages/avatars`. Use one small vision-model request to suggest component IDs, colors, and conservative proportions; render three nearby variations locally. The user chooses a result, adjusts it, and explicitly saves it. Variations, edits, rendering, blinking, and future call animation have no inference charge.

Start with the existing manual editor plus one vision request. Benchmark browser-local landmarks as a second step if measured geometry accuracy needs improvement. Do not build a GPU service or train a custom model for this pilot. Better-looking results primarily depend on our component artwork and compatible proportions, not a larger model.

## Model shortlist and costs

Prices below were checked on official OpenRouter pages on the planning date. These are comparison candidates, not measured quality winners. Pin an approved endpoint/provider after checking its current image billing, parameters, retention, and availability.

| Candidate | Listed input / output per million tokens | Role |
| --- | --- | --- |
| [`qwen/qwen3-vl-8b-instruct`](https://openrouter.ai/qwen/qwen3-vl-8b-instruct) | $0.117 / $0.455 | First benchmark candidate: image input and JSON-schema output are listed. Provider pricing differs. |
| [`qwen/qwen3.7-flash`](https://openrouter.ai/qwen/qwen3.7-flash) | $0.03 / $0.13 | Cheaper challenger: image input and JSON output, but the listing explicitly says no JSON-schema enforcement. Validate every result ourselves. |

Do not start a new integration on [Gemini 2.5 Flash Lite](https://openrouter.ai/google/gemini-2.5-flash-lite/pricing): its listing currently says it is going away October 20, 2026. Recheck models before integration; avoid free endpoints as the production reliability assumption.

### Where Jev fits

The user suggested Jev as another candidate. [TypeSafe's own documentation](https://docs.typesafe.ai/concepts/system-one) identifies Jev as a structured decision model and explicitly states that it currently accepts **text only**, including strings, JSON, and arrays. Images, video, and audio are unsupported. Its Choice/Score/Noul primitives return constrained decisions/probabilities; these are not visual measurements or proof that a choice is correct.

The official [OpenRouter Jev 1.13 listing](https://openrouter.ai/typesafe/jev-1.13/) lists `typesafe/jev-1.13` at **$0.042 per million input tokens and free output**. OpenRouter's [Jev integration article](https://openrouter.ai/blog/insights/what-is-jev/) documents its separate `POST /api/alpha/decisions` endpoint, rather than treating it as a vision chat completion. Model prices and endpoint status should be rechecked before implementation.

For Giggle, Jev could map a user's written description, such as “short wavy hair and round glasses,” into component choices. It cannot look at a selfie, assess whether the rendered avatar resembles it, or measure facial proportions. Feeding it text from a vision model would add an extra network request without recovering visual details the first model missed. Use ordinary schema validation and deterministic mappings for valid IDs, ranges, compatible parts, and budget decisions; these do not need a model.

At 1,000 billed input tokens, a Jev description-to-options request would cost approximately **$0.000042**, or **$0.042 per 1,000 requests**, before fees. This is a calculated text-only scenario, not an observed charge and not a substitute for the selfie cost estimate below. Do not add Jev to the selfie pipeline by default. If users later want a natural-language editor, evaluate it separately against direct structured vision/chat output and a small phrase-mapping baseline.

Illustrative cost with **2,000 total billed input tokens including the image and schema, and 250 billed output tokens**:

| Candidate | One match | 1,000 matches | 10,000 matches |
| --- | --- | --- | --- |
| Qwen3 VL 8B | $0.000348 | $0.35 | $3.48 |
| Qwen3.7 Flash | $0.0000925 | $0.093 | $0.925 |

Formula: `(inputTokens × inputRate + outputTokens × outputRate) / 1,000,000`. These estimates are not a per-image quote. Actual image tokenization, schema size, hidden reasoning, provider routing, failures, and output length can change cost. Measure billed usage/cost per accepted avatar. Disable reasoning where supported and verify it is actually disabled; otherwise include its billed tokens. Excludes credit-purchase fees, taxes, and existing hosting. Do not automatically fall back to a costlier model.

## Request and editor flow

1. User chooses **Use a photo**, with **Start manually** always available. Explain that a reduced photo will be sent through OpenRouter to the selected provider; require an explicit upload/match action. Do not silently use a Google profile photo.
2. Let the user crop one face with the whole hairstyle visible. Start with JPEG/PNG/WebP only, a 5 MB upload cap, and a 20-megapixel decoded-size cap. Resize to a maximum 768 px long edge and re-encode to remove metadata. Validate and re-encode server-side too; browser checks are only a convenience. No arbitrary remote-image URLs or SVG input.
3. An authenticated Railway endpoint checks account access, idempotency, quotas, and reserved budget before making one bounded OpenRouter request. Request one structured suggestion; do not ask for SVG, prose, identity, age, ethnicity, gender, personality, or attractiveness. Any text in the image is untrusted content, not instructions.
4. Model may return `no_face`, `multiple_faces`, or `unclear_photo`. In those cases offer recrop/manual editing without inventing a likeness. In a match, allow uncertain traits to be null. Hair absent from our catalog is a catalog limitation; do not invent IDs or force a confident match.
5. Validate the output and map it to our renderer. Show a main result plus two local variations with modest changes in face shape/proportion. Never change the user's selected skin tone between variants. **Apply** updates the local editor; **Save avatar** persists only the accepted config. Do not override manual changes when a delayed match completes.
6. Drop photo bytes after the request. Keep no selfie gallery, embeddings, or facial landmark data. Save only the approved versioned configuration; normal avatar views never call a provider.

## Configuration contract

The current renderer supports eight hair variants, three face shapes, three glasses choices, four facial-hair choices, freckles, five color props, six 0–100 sliders, and four expressions, five clothing choices, three headwear choices and three earring choices. Treat this as a versioned catalog, not the entire `GiggleAvatarProps` type: `className`, `label`, `size`, and other presentation props must never be model-controlled.

Example **validated renderer configuration** (not raw model text):

```json
{
  "version": 1,
  "face": "soft",
  "hair": "curls",
  "glasses": "round",
  "facialHair": "none",
  "freckles": false,
  "skin": "#c98763",
  "hairColor": "#39302e",
  "faceWidth": 54,
  "eyeSize": 50,
  "eyeSpacing": 48,
  "browTilt": 50,
  "noseSize": 52,
  "mouthWidth": 55,
  "shirtColor": "#f9f0dc",
  "accent": "#d4ddbd",
  "expression": "smile"
}
```

Define one shared schema/catalog for frontend and backend. For model output, require exact enums, finite integer sliders, booleans, and color palette IDs; reject extra properties, URLs, markup, paths, and unknown versions. Map palette IDs to our hex colors. Manual colors can accept only six-digit hex. Reject out-of-range values at the API; renderer clamping is defense in depth. Initially constrain inferred proportions to 30–70, while the editor retains 0–100, to avoid overfitting noise in the photo. Default ambiguous values to a curated baseline. Keep clothing, background, and expression user-selected/default rather than guessing the whole scene.

Use `response_format: json_schema` only with an endpoint that supports it; require matching supported parameters when routing. JSON mode still needs schema validation. Invalid output returns the manual editor, without a paid repair loop. [OpenRouter structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs) documents endpoint compatibility and schema errors.

The local implementation now saves a validated `giggle:v1:` configuration in the existing string `avatar` field (`server/src/models/User.js` and `server/src/utils/avatars.js`). Legacy avatar IDs remain supported, and public serializers accept the validated configuration. Future model suggestions should use `server/src/utils/characterConfig.js` and the same save path; a second `avatarConfig` field is unnecessary. These changes have not been deployed to production. Never publish the photo or model analysis through those serializers. The standalone renderer stays independent of authentication, storage, and OpenRouter.

## Optional local geometry stage

[MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) provides landmarks, optional expression blendshapes, and transformation matrices. It is local model inference, not zero AI; it has download, browser compute, and maintenance costs but no per-request cloud inference charge. Its synchronous detection can block the UI, so lazy-load it on photo selection and run it in a worker. Pin and review the model/SDK licenses before shipping their assets.

For a clear frontal face, normalize eye spacing, nose width, mouth width, and face width against face dimensions, then map calibrated ratios into the bounded sliders. These ratios cannot simply be multiplied by 100: our controls are stylized transforms, and smiling, perspective, eyelid closure, and occlusion distort measurements. Keep eye size/brow tilt at defaults when uncertain. Detect multiple faces by allowing more than one detection, rather than setting a one-face maximum and assuming the image contains one person.

Landmarks cannot choose a hairstyle or reliably infer colors by themselves. A local-only mode can suggest proportions and ask users to choose hair/colors; cloud matching can add those visible traits. Measure whether the extra local download improves time-to-accepted-avatar before making it mandatory. Never use these measurements for identification or age verification.

## Spending, privacy, and failure controls

Proposed pilot settings, not configured limits:

- Signed-in account, one in-flight request per user, one match per minute, three matches per rolling day and ten per rolling 30 days. Manual edits and variations are unlimited.
- Reserve conservatively $0.005 per attempt, with app-wide $1/day and $10/month caps including in-flight reservations. This is a starting ceiling that must be checked against endpoint token limits; reconcile actual billed cost. Keep a separate capped provider key only in Railway secrets. Never expose it in the frontend.
- Reuse existing Redis for atomic reservations/rate limits and MongoDB for durable request/spend metadata. If quota storage is unavailable, disable cloud matching; keep the editor usable. One request endpoint is sufficient for the pilot; no separate queue service is needed.
- Use an account-scoped idempotency key and a hash of the normalized photo plus catalog/prompt/model version. Retain deduplication metadata and suggested config for at most 24 hours; no cross-account caching. Never store the source image in the cache.
- Bound request duration, input size, output tokens, and concurrent calls. A timeout with uncertain billing remains charged/reserved pending reconciliation; do not automatically retry. A repeated idempotency key returns existing status. Retry explicit throttling only within a fresh checked reservation; respect `Retry-After`.
- Keep images, base64, full prompts, and model responses out of request logs/error trackers. Record request ID, model/provider, version, status, latency, and usage/cost. Delete temporary decoded files in `finally` if used; prefer bounded memory handling.
- Disable prompt/response logging and data-use opt-ins. Review and pin an acceptable provider retention policy before sending real photos; OpenRouter settings alone do not guarantee upstream deletion. Use compatible zero-retention routing if available and do not silently relax it. [OpenRouter privacy documentation](https://openrouter.ai/docs/guides/privacy/data-collection) distinguishes its own logging from provider handling.

## Evaluation and rollout

First use 30 consented photos spanning hairstyles, skin tones, facial hair, glasses, lighting, and phone quality; include a small reject set with multiple/obscured/no faces. Compare both candidates once per image under a separate $1 maximum evaluation budget. No real-user photo upload without the explicit flow above. Score schema validity, visible-trait accuracy, skin-color correction rate, number of manual edits, user acceptance, p50/p95 latency, and actual total cost per accepted result. This is a pilot sample, not proof of fairness or general accuracy.

Before real-photo evaluation, prepare a reproducible synthetic smoke set: render 24–36 known configurations from our SVG library, rasterize to PNG, and include several glasses/hair/skin/face combinations plus 4 blank or deliberately ambiguous cases. The held-out expected settings come from the renderer configuration, not another model. A proposed remote test would ask each vision candidate to recover supported discrete traits, producing a per-trait confusion matrix, exact-valid-config rate, latency, token usage, and actual billed cost. Compare continuous knobs only within a tolerance: some combinations render nearly identically, and crop/expression affects apparent proportions. Synthetic success checks catalog understanding, not selfie likeness; real-photo review remains necessary. Rendering the dataset locally does not incur inference costs, but sending it to either model does.

Do not use Jev as an automatic visual benchmark judge: it cannot see either the photo or avatar. For a possible later text editor, a separate held-out set of 30 written appearance requests can test supported option selection, abstention on unavailable options, preservation of unspecified fields, and ambiguous instructions. Compare against deterministic parsing before introducing this extra API. Human reviewers should judge likeness and visual appeal; model-reported confidence is not an acceptance metric on its own.

**Evidence status:** the research sections above were written before any test. A measured synthetic pilot has since run (see *Measured synthetic pilot* below). No real photo has been sent and no real-photo quality has been measured.

Suggested gates: all accepted configurations pass validation, at least 80% of valid portrait suggestions are accepted with at most three edits, no malformed request causes a public image/secret leak, and mean measured model cost is below $0.001 per successful suggestion. If the cheaper model meets the same quality bar, choose it. If neither does, improve component coverage/calibration before buying a larger model.

Test ownership, mixed legacy/new avatars, config versions, malformed/massive uploads, prompt text inside images, invalid model output, duplicate submissions, concurrent quota reservations, unavailable Redis, provider errors/timeouts, deleting temporary data, and user edits made during inference. Use mocked provider responses in CI. Deploy backend support first behind a disabled `SELFIE_MATCHING_ENABLED` flag, deploy the editor/persistence, then enable internal accounts and a small cohort. Rollback disables matching while preserving manual editing and saved avatars. Follow `DEPLOYMENT.md` for Vercel/Railway deployment checks.

Implementation update (24 September 2026): photo matching is implemented locally behind `SELFIE_MATCHING_ENABLED` (off by default everywhere) and has not been deployed.
- `server/src/utils/avatarMatch.js` holds the prompt (`match-v2`), the strict suggestion schema and validation, palette mapping, and the three variations.
- `server/src/services/avatarMatchService.js` exposes `GET /api/me/avatar/suggest/status` and `POST /api/me/avatar/suggest`. It accepts client-cropped JPEG only (≤1 MB, 64–1024 px), strips APP1–15 and COM metadata without re-encoding, and adds no new dependency.
- Spending controls: an owner-token in-flight lock, 1 request per minute, 3 per UTC day and 10 per calendar month per user (fixed buckets approximate the rolling windows), and an atomic Lua reservation of $0.005 against app-wide $1/day and $10/month caps. Reservations are reconciled to `usage.cost`, and unknown billing keeps the reservation.
- Requests use a per-user idempotency key for 24 h, storing only final outcomes. There are no retries except one fallback (`qwen/qwen3-vl-8b-instruct`) when the primary is refused with 429 or 503, under a shared timeout.
- The service never stores or logs photos, prompts or model content.
- The editor's "Use a photo" panel (`apps/desktop/app/avatar-playground/PhotoMatch.tsx`) appears only when signed in and enabled. The flow is consent, then crop/zoom in the browser, then a 512 px JPEG upload, then three options with Apply; saving remains a separate step.
- Verified locally end to end on a production web build with one real synthetic-photo match (Flash via Alibaba, 4.3 s, $0.000047, applied and saved).
- Still pending: consented real-photo evaluation and a provider retention review before any real user photo is sent. Redis commands have no per-command timeout (a slow Redis can hold requests, though it can't cause spending).

## Prepared evaluation fixtures

Run `node packages/avatars/prepare-eval.cjs <dir>` from the repository root. It renders 28 synthetic 512 px PNGs from the real renderer: 24 known configurations covering every hairstyle, face, glasses, facial-hair, headwear and earring option and all 8 skin and hair palette colors, plus 4 negatives (blank, two faces, blurred, tiny). It also writes a `manifest.json` with the expected status and scored traits. It makes no network calls. Hair hidden under a hat is not scored.

`node packages/avatars/run-eval.cjs --dir <dir> --models a,b --budget 0.10` runs the capped comparison. It uses `OPENROUTER_API_KEY` from the environment only, reads live prices from each model's endpoints (reserving against the most expensive endpoint), and reserves budget before every request. It never retries, stops on the first failure, timeout or budget hit, and writes `report.json` and `report.md` without image data or prompts. `--dry-run` makes zero network calls.

## Measured synthetic pilot (24 September 2026)

Synthetic catalog recovery only, not selfie likeness. 28 fixtures per model, 384 px JPEG, sequential, using the Giggle OpenRouter key. Both models were routed to the Alibaba provider. Runner-accounted spend was $0.0064 across both runs. The key's usage counter reported less.

| Metric | Qwen3-VL 8B (match-v1) | Qwen3.7 Flash (match-v1) | Qwen3.7 Flash (match-v2) |
| --- | --- | --- | --- |
| Valid JSON | 100% | 96% | 96%* |
| Status incl. negatives | 93% (said "match" for blank and two-face images) | 96% | 96% |
| Hair | 57% | 80% | **90%** |
| Glasses / headwear / earrings | 100% | 100% | 100% |
| Facial hair / clothing | 88% / 83% | 91% / 96% | 91% / 96% |
| Skin tone exact / within 1 step | 8% / 38% | 35% / 87% | **43% / 91%** |
| Hair color exact / within 1 step | 50% / 79% | 57% / 78% | 52% / 78% |
| Face shape | 25% | 30% | 30% |
| Latency p50 / p95 | 1.2 s / 1.4 s | 2.8 s / 4.5 s | 2.8 s / 3.3 s |
| Mean cost per request | $0.000144 | $0.000040 | $0.000044 |

\*The single invalid response had one slider outside 30–70. `parseSuggestion` now drops such a slider (keeping the user's value) instead of rejecting the whole paid suggestion.

Decision: default to `qwen/qwen3.7-flash` in JSON mode (its endpoint lacks json_schema), with our own validation and reasoning disabled. Prompt `match-v2` adds one-line visual cues per hairstyle and face shape. Neither model recovers face shape, so the three offered options cycle through all three shapes. Mean cost is well below the $0.001 gate. Real consented photos are still needed to judge likeness.

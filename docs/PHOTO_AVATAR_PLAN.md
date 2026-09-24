# Photo avatars: proposed rollout

## Direction update

The user subsequently selected a component-based approach. The image-generation proposal below is historical, not the implementation plan. Build our own SVG parts and bounded proportion controls; an optional vision model can later suggest a validated configuration from a selfie. No image-generation model or paid API is connected. The local editor supports face/hair variants, glasses, facial hair, freckles, colors, six proportion sliders, expression previews, and versioned JSON export. Profile persistence, selfie matching, wider feature catalogs, and provider/model evaluation remain future work.

Planning date: 24 September 2026. This is a proposal, not a deployed integration. No paid generations or user-photo transfers have been performed for this plan.

## Model selection

Start by testing `black-forest-labs/flux.2-klein-4b` through OpenRouter. It accepts up to four image references, so each request can include one selfie and one reference sheet rendered from Giggle's own SVG characters. OpenRouter currently lists $0.014 for the first generated megapixel, priced by output. Verify the actual endpoint's editing price before enabling requests.

Compare with `black-forest-labs/flux.2-pro`: $0.03 for the first output megapixel plus $0.015 per input megapixel. Two 1 MP references and one 1 MP result imply approximately $0.06 per attempt. Neither model's likeness or adherence to Giggle's style has been tested yet. Do not silently fall back to a more expensive model.

Use the dedicated OpenRouter Image API. Check model endpoint capabilities and prices at integration time, pin an approved model/provider, and record response usage cost. Do not choose a text-only model merely because it can read photos.

## User flow

1. Signed-in user chooses "Create from photo" in profile settings, uploads their own selfie, crops it, and agrees to sending it through OpenRouter to the named generation provider.
2. Decode and validate JPEG/PNG/WebP server-side, impose upload/pixel limits, remove metadata, re-encode, and resize to a bounded square input. Reject invalid or unsuitable input and ask for one clear face. Never fetch arbitrary user-provided URLs.
3. Create an authenticated, owner-scoped generation job and reserve its budget before calling the provider. Return a job ID so refreshes do not submit again.
4. Generate one square portrait using the selfie for appearance and our character sheet for style: flat shapes, simple eyes, soft outlines, Giggle palette, plain background, no text or logos. Do not request imitation of a named commercial character style.
5. Validate returned image bytes/dimensions and apply content checks. Show a private preview. A result cannot replace a profile avatar until its owner selects "Use this".
6. Save a compact WebP and thumbnail; store a URL/reference on the profile. Reuse the stored asset everywhere. Delete temporary inputs after the job terminates, with a maximum 24-hour cleanup deadline; expire unaccepted previews too.
7. Preserve the existing SVG avatar for declines, failures, disabled generation, or exhausted budgets. Manual customization stays available.

## Cost controls: proposed launch defaults

- Verified account required; one active job per account; two paid attempts per rolling 30 days; 60-second submit cooldown. Retrying a request with the same idempotency key returns the same job.
- Two concurrent provider calls globally, plus bounded queue length and expiry. Coordinate limits through existing Redis; keep durable job state and spend records in MongoDB.
- Separate OpenRouter key stored only in Railway secrets, with a $25 monthly provider-side credit limit. App-side limit: $2/day and $25/month, including reserved in-flight spend. Stop if budget accounting is unavailable. These are proposed caps, not configured settings.
- Reserve a conservative maximum per attempt atomically; reconcile actual cost on completion. Count retries against the budget. Do not automatically resubmit a timed-out generation whose billing/completion status is unknown. Respect Retry-After for explicit throttling.
- Cache within the same account by processed input hash, model, style version, and settings. Do not share a selfie-derived cache across users. Profile views, sign-ins, and call animations never trigger generation.
- No unbounded regenerate button, multi-image batches, automatic quality loops, or paid model escalation.

At the listed Klein first-megapixel rate, 1,000 attempts are approximately $14; two attempts for each of 1,000 users are approximately $28. These figures exclude retries, storage/hosting, credit purchase fees/taxes, and endpoint pricing changes. A $25 monthly launch cap will stop generation before all 1,000 users can receive two attempts. Measure cost per accepted avatar, not just cost per API call.

## Animation and reusable library

Generated output is a raster image, not the layered SVG we built. First release adds gentle whole-image movement and speaking indicators locally; no paid video generation. Keep reduced-motion support. Correct blinking, mouth movement, and expression changes require a later layered/rigged asset workflow and should not be advertised as implemented.

Keep rendering in `packages/avatars`, independent of accounts and OpenRouter. Generation, secrets, quotas, and storage belong on the backend. A future photo-to-traits mode could use a vision model to choose validated parameters for our SVG renderer, retaining editable expressions at lower cost, but it provides less detailed likeness and needs a wider trait library.

## Deployment and verification

Use the existing Vercel frontend, Railway backend, Redis, and MongoDB. Do not introduce a new microservice for the pilot. Run durable jobs with a bounded worker in the Railway service, with leases and restart recovery. Reuse the approach of the current Mongo-backed cover storage in a separate avatar namespace; review its capacity and delivery policy before scaling or moving to object storage. Never rely on the Railway instance's temporary filesystem for saved avatars.

First compare both models on 20 consented selfies spanning skin tones, hairstyles, glasses, and lighting. Assess recognizable appearance, style consistency, rendering defects, latency, and cost per accepted result. Up to two attempts/model/photo would be about $2.96 at the reference assumptions above, excluding overhead; stop within a separately configured $5 evaluation budget. No model-quality winner is assumed in advance.

Then implement behind a default-off flag. Test duplicate requests, concurrent budget reservations, ownership checks, malformed uploads, provider failures, timeouts, restart recovery, deletion, and accept/save behavior. Use mocks for CI; paid calls are explicit evaluation jobs only. Deploy the backend first with generation disabled, deploy the frontend, enable for internal accounts, then a small cohort. Check Railway deployment-bundle health and production health per DEPLOYMENT.md. Rollback disables generation while retaining saved avatars and normal login/calls.

Before sending real user photos, confirm the selected provider's commercial-use terms and retention/training policy. OpenRouter privacy settings do not alone establish the upstream provider's retention policy. Keep photos and image-bearing prompts out of logs. Record model, provider, style version, and generation time for provenance; do not promise exclusive ownership or worldwide uniqueness of generated output.

## Sources checked

- https://openrouter.ai/black-forest-labs/flux.2-klein-4b
- https://openrouter.ai/black-forest-labs/flux.2-pro/pricing
- https://openrouter.ai/blog/announcements/image-api/
- https://openrouter.ai/docs/api/api-reference/api-keys/update-keys
- https://openrouter.ai/docs/guides/privacy/data-collection

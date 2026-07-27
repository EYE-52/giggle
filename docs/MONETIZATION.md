# Giggle — Monetization Plan

_Model chosen: **Hybrid** (Giggle+ subscription + one-off tokens). Guiding rule: **never hassle users** — the core loop is always free; paid = additive boosts and visible status only._

## The principle (why this converts without annoying people)

The entire fun of Giggle — creating/joining squads, 4-person squads, live video
encounters, matchmaking, friends, chat, reactions, and a full set of
good-looking covers — is **free, forever, with no nags**. We never paywall core
value or punish free users. Giggle+ only *adds* power and *visible status*.

People don't pay for cosmetics they can't see. They pay for:
1. **Reach** — match faster, meet more, bigger squads.
2. **Status others see** — a theme/flair the opponent sees live in the "vs".
3. **Control** — choose who you meet.
4. **Expression** — reactions/emotes used live.

## Tiers

### Free (never hassled)
- Create/join squads, **4-person** squads
- Live video encounters + full matchmaking
- Friends, chat, reactions
- Full set of **standard covers** (the 12 gradients) — and they now actually
  show (lobby + encounter), so free identity already feels good
- Generous skips (no punitive throttling)

### Giggle+ (subscription, ~$5–9/mo — additive only)
- **Priority matchmaking** — jump the queue, faster matches. _(Lever already
  built: `isPremiumSquad` on the Squad model; just needs the queue to consume
  it. `server/src/services/queueService.js` / `matchmakingService.js`.)_
- **8-person squads** _(already live: `PREMIUM_MAX_MEMBERS`, the only current
  entitlement)_
- **Animated covers + entrance flair** shown **live to the opponent** in the
  encounter — the flex. _(Covers now render boldly; premium tier = motion/glow
  variants.)_
- **Premium emotes/reactions** used live in encounters
- _(Later)_ **Match filters** — region / vibe targeting

### Tokens (consumable — the "hybrid" half)
- Buy a single **premium/animated cover** à-la-carte (no sub needed)
- **Queue boost** — front of queue for the next N matches
- **Gift tokens** to a friend
- Still **earned via referrals** (100 each side) to keep the viral loop

### Adult track (separate, later)
Age-gated 18+ rooms already exist (orthogonal to payment). If monetized, it
needs **ID verification + a high-risk payment processor** (Stripe/mainstream
ban adult) — keep it a distinct tier, do not couple to Giggle+.

## What exists vs. what's needed

| Piece | State |
|---|---|
| Token wallet, packs, subscription catalog | Built in `packages/core/src/billing.ts` (preview/local only) |
| `isPremium` → 8-person squads | ✅ live entitlement |
| `isPremiumSquad` → priority match | Built but **inert** — no queue consumer yet |
| Cover themes visible + opponent-seen | ✅ done (this change) |
| Premium cover **enforcement** | Client-only today; `updateSquadCoverHandler` has **no server check** |
| Animated/premium cover **visuals** | Not built — needed to make the tier worth buying |
| **Real charging (Stripe)** | **Not integrated.** Processor seam exists (`billing.ts` `setProcessor`); default refuses in prod |
| Server-authoritative entitlements | Needed — today premium/perks aren't persisted per-user for real |

## Phased roadmap

1. **✅ Make covers matter** (done) — bold covers in lobby + encounter so
   identity/flex is real and free tier already feels good.
2. **Premium cover visuals** — a handful of genuinely special animated/glow
   covers, shown live in the encounter, so there's something worth paying for.
3. **Priority matchmaking** — wire `isPremiumSquad` into the queue (biggest
   "skip the wait" lever; additive, non-intrusive).
4. **Server entitlements** — persist per-user premium/unlocks (`User.entitlements`)
   so gates have teeth; enforce premium covers in `updateSquadCoverHandler`.
5. **Stripe** — Checkout for Giggle+ subscription + token packs; webhook flips
   `isPremium` / credits tokens. Slots into the existing processor seam.
   _(Deferred per product call; everything above can ship before charging.)_
6. **Match filters** (region/vibe) once there's enough matchmaking liquidity.
7. **Adult tier** (verified) — separate, high-risk processor, later.

## Non-negotiables (the "don't hassle" contract)
- Core loop never paywalled.
- No interstitials/nags mid-flow; upsell only at natural moments (e.g. a subtle
  "Giggle+ matches faster" line on the matchmaking screen after a long wait).
- Priority match must feel like payers get a *boost*, not free users get
  *throttled*.
- Free covers always look good (never the "ugly free tier").

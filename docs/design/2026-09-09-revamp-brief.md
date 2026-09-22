# Giggle revamp: first product and design review

Date: 9 September 2026

Status: source review and proposed direction. This is not an approved design or a completed visual audit. No running screens were inspected: Node and pnpm are unavailable in the current shell, dependencies are absent, and no app was listening on port 4000.

## Product understanding

Giggle helps a group of friends meet another group on live video. Its main promise is: **Meet new people. Bring your friends.**

The main journey is sign in → verify adult access → create or join a squad → gather in the lobby → search → match → live group call. Supporting features include public squad discovery, friends on web, chat, reactions, profiles, notifications, and a token wallet.

Two different actions need clear explanations:

- Join a squad: become part of one group.
- Meet another squad: keep your group together and connect both groups on video.

The root README defines a verified-adult 18+ service. Production stranger discovery has release gates and a server switch. The redesign must account for both discovery-enabled and private-room-only states. Old MVP and monetization documents contain conflicting plans; they are not proof of shipped behavior.

## Findings from the current source

| Finding | Evidence | Design implication |
| --- | --- | --- |
| Home mixes several jobs | Web Home combines squad management, create/join controls, activity stats, a match action, and a “Live signals” rail | Choose the main action for each user state and give it clear priority |
| Language changes across the journey | Copy uses “squad,” “crew,” “room,” “Open signals,” and “Live signals” | Define one name for each thing; use plain action labels |
| Visual rules have drifted | Shared mobile tokens use `#080A0B` and `#7657FF`; desktop Midnight uses `#0E0D12` and `#6D52FF`; landing has its own palette | Establish shared rules for color, type, spacing, and controls |
| Web and native have different structures | Web has Home, Discover, Friends, and Profile navigation; native uses a screen stack and has no Friends route | Design one shared journey with layouts suited to each device |
| Several appearance directions already exist | Desktop offers Midnight, Cloud, and Tangerine Pop; mobile uses a fixed dark palette | First prove one coherent brand direction across the main journey |
| Supporting features claim visible space | Web navigation includes token balance and theme controls; Wallet includes future perks | Keep the first social experience ahead of cosmetics and wallet features |
| Real user states already exist | Source handles first use, empty squads, failed loads, long searches, access checks, and call controls | Carry these states into the new design; do not design only populated screens |

These are source findings. Claims about actual spacing, clipping, contrast, animation quality, and ease of use still need rendered screens and hands-on review.

## Proposed direction

**A warm, playful place to hang out with friends and meet people together.**

Make people, group identity, and the next social action the focus. Explore a warm neutral background outside calls, dark backgrounds during calls, one strong brand accent, generous space, clear type, and restrained illustration. Compare this with a calmer dark treatment on the same screens before choosing the final palette.

Use color mainly to identify actions and states. Avoid giving every card, label, and decorative detail equal visual weight. Personality should come from the group, friendly copy, and a few distinctive brand details.

This is a design hypothesis, not a claim about user preference. Target audience, launch market, and positioning as friendship, casual hangouts, or dating still need confirmation.

## Screen priorities

| Screen or state | What it should help someone do |
| --- | --- |
| Entry and verification | Understand group video, know the adult requirement, and see the next step |
| Home: first visit | Start a squad or join friends with a code; understand what happens next |
| Home: returning user | Return to an active squad immediately, or start a new hangout |
| Lobby | See friends, invite missing people, check camera and microphone, and know who can start the search |
| Search and match | Stay oriented with the group, understand the wait, and cancel easily |
| Live call | See people clearly, tell the groups apart, and find microphone, camera, leave, report, and block controls |
| Discover | Understand which group is open, who can join, and whether approval is required |
| Friends and profile | Find people again and manage identity without competing with the active call |

During calls, distinguish leaving yourself from ending or skipping a call for the whole squad. Preserve leader and member permissions. Clarify these effects in the interface.

## First design deliverable

Design Home, Lobby, and Live Call as one connected journey. Show both the first visit and a returning squad. Include a small-phone layout and a desktop layout so the design is not dependent on one screen size.

Use clearly labeled sample people and squads in mockups. Include empty, loading, permission-denied, long-wait, and disconnected states in the working prototype. Do not imply that sample activity is live production data.

After this journey is settled, extend the system to onboarding, discovery, friends, profile, wallet, and the public landing page. Implement it through shared design rules and reusable components, while preserving current service access checks and call behavior.

## How to judge the redesign

- A new visitor can explain the product and find the start or join action without help.
- Inviting a friend is easy, including when the squad is empty.
- People understand joining a squad versus meeting another squad.
- Every participant knows what happens next and who controls the search.
- Calls keep faces prominent and important controls easy to reach.
- Empty and failed states still give a useful next step.
- Web and native feel like the same product.

Later measurement should track verified users reaching their first group call, successful friend joins, abandonment before the call, and squads returning for another session. No current analytics were reviewed, so these are proposed measures rather than observed problems.

## Source map

- Product boundary: `README.md`, `DEPLOYMENT.md`
- Main web journey: `apps/desktop/app/(app)/`
- Native journey: `apps/mobile/app/(app)/`
- Web navigation: `apps/desktop/components/TopNav.tsx`
- Web design rules: `apps/desktop/app/globals.css`, `apps/desktop/components/ThemeToggle.tsx`
- Shared and mobile design rules: `packages/ui-tokens/src/index.ts`, `apps/mobile/constants/theme.ts`
- Access checks: web and native `(app)/layout` files
- Wallet and catalog: `apps/desktop/app/(app)/premium/page.tsx`, `packages/core/src/billing.ts`

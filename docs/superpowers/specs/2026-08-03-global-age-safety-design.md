# Global Age Safety and Child-Protection Design

**Date:** 2026-08-03

**Status:** Approved by the user for implementation after comparative research
**Launch scope:** One verified-18+ Giggle service across web and native. No minor stranger-matching mode.

## Goal

Replace Giggle's cosmetic date-of-birth overlay with enforceable, privacy-minimizing age assurance and child-safety boundaries. A stale JWT, direct API call, Socket.IO connection, queued squad, or Agora-token request must never bypass the same live server decision.

This design covers age eligibility, minor exclusion, and the product controls directly required by Giggle's social/video interaction model. It is not a claim that code alone certifies every law worldwide; store-console declarations, vendor contracts, moderation operations, and jurisdiction-specific legal review remain release evidence.

## Research conclusion

Two product patterns dominate:

1. General social networks such as Instagram, TikTok, Snapchat, X, YouTube, and Discord allow teens only behind safer defaults: private accounts, connection-limited messages, sensitive-content filtering, restricted live features, guardian visibility without message contents, age-recheck and appeal paths.
2. Stranger-discovery and dating products increasingly use a verified-adult boundary. Yubo, Tinder, Bumble BFF, Azar, and OmeTV are 18+. Wizz combines mandatory age estimation with narrow minor cohorts and hard adult/minor separation.

Giggle's core flow connects squads that do not already know one another by live video. A shared 13+ and adult discovery graph would therefore require a second safety product: guardian consent, age cohorts, separate discovery and messaging graphs, minor-specific moderation, regional availability, and different store treatment. A theme or client-only mode is not isolation.

The launch decision is consequently:

- Giggle's account may exist before verification so the user can verify, get support, appeal, export, or delete data.
- Every squad, friend, discovery, invitation, matchmaking, chat, reaction, lobby-video, encounter, Socket.IO, and Agora capability requires a current server-confirmed 18+ decision.
- Users under 18 cannot use Giggle's social product, even with parental consent.
- A future 13-17 product, if pursued, must be connection/invite-only, teen-only, region-enabled after legal review, and must not share discovery, DMs, invitations, or encounters with adults.

## Evidence from standard apps

- Instagram uses Teen Accounts, private-by-default profiles, connection-limited messaging, adult-to-unconnected-teen DM restrictions, under-16 parental approval for weaker settings or Live, and layered age assurance. It also shows why DOB alone is insufficient: EU regulators have challenged the effectiveness of false-birthday prevention.
- TikTok makes ages 13-15 private by default, disables their DMs, requires 18 for Live, applies Family Pairing, and uses age estimation plus appeal methods.
- X protects known minor posts by default, restricts DMs to followed accounts, blocks sensitive media, and locks accounts where regional parental consent is missing.
- Snapchat limits teen contact to mutual or otherwise established connections, keeps location off by default, offers Family Center, and supports age-lock appeals.
- Discord keeps teen safety defaults unless adulthood is assured and gives adults privacy-forward age-estimation or ID options; its guardian tools show activity rather than message contents.
- Yubo moved its real-time stranger social product to 18+ and runs age estimation for every user with ID fallback and ongoing mismatch checks.
- Tinder and Bumble BFF are 18+, require reciprocal interest before messaging, and combine age/identity checks with report, block, moderation, and appeals.
- Wizz demonstrates that allowing minors in discovery is not a simple 13+ switch: it uses mandatory assurance, hard adult/minor separation, and narrow age cohorts.

## Platform constraints

- Apple App Review Guideline 1.2 requires filtering, reporting, blocking, and contact information and says apps used primarily for Chatroulette-style, random, or anonymous chat do not belong on the App Store. Giggle must remain authenticated, squad-based, non-anonymous, and consent-led; an iOS friend/invite-only kill switch remains the fallback if review still classifies discovery as random chat.
- Google Play applies Child Safety Standards to social, dating, and random-chat products even when they are adult-only. Random or anonymous chat apps must restrict minors, and Play's expanded minor-blocking rule takes effect on 2026-08-26.
- Australia bars under-16 accounts on covered social platforms. UK/EU guidance requires risk-based, effective, privacy-preserving age assurance rather than a birthday checkbox. Other jurisdictions vary, but a verified 18+ product meets the highest relevant age floor without maintaining a fragile worldwide teen-consent matrix.

## Authoritative eligibility rule

Reuse the current user fields and add only provider receipt metadata. The server decision is:

```text
adult social access = ageConfirmed AND isAdult AND ageVerified
```

- `ageConfirmed` means a set-once DOB was declared.
- `isAdult` means the declared DOB is currently at least 18.
- `ageVerified` means an approved assurance provider returned a completed 18+ result that was fetched server-to-server.
- JWT claims are display hints only. Authorization always reloads the current user from MongoDB.
- Unknown, pending, conflicting, missing, rejected, provider-error, or stale states fail closed for social/video access.
- Development may use an explicit non-production bypass so local/E2E workflows remain usable. Production ignores it.

The stored provider metadata is limited to provider name, opaque session/evidence identifiers, status, method class, threshold, policy version, and timestamps. Giggle never receives or stores the raw selfie, biometric template, or identity document.

## Yoti verification flow

Yoti is the initial provider because its Age Verification Service supports hosted web/mobile flows, facial age estimation, Digital ID, document fallback, biometric-consent handling, and a data-minimized result API. It is also publicly used by several researched comparators.

1. The user submits a set-once DOB. Under-18 declarations are denied social access and are not offered verification.
2. An adult-declared user requests a verification session from Giggle's authenticated API.
3. Giggle creates a Yoti `OVER 18` session server-to-server. Facial age estimation may use a conservative threshold; Digital ID and document scan provide 18+ fallback.
4. Giggle stores the opaque session id against the user and returns only the hosted Yoti URL.
5. Web opens the hosted flow in the current browser. Native opens the same provider URL externally. The app polls Giggle, not Yoti.
6. Giggle fetches the result server-to-server, verifies the stored session and opaque user reference match, and accepts only a completed passing 18+ method.
7. On success, Giggle stores the minimized receipt and grants access. Failed or inconclusive results remain blocked and retryable; support provides the appeal path.

Required production configuration is `YOTI_AGE_API_KEY`, `YOTI_AGE_SDK_ID`, and an HTTPS callback URL. Production must fail startup if they are absent; an unavailable verifier must not silently fall back to self-attestation.

## Enforcement points

### HTTP

Split authentication into:

- identity-only authentication for age declaration, verification status/session, profile read, support, export/delete, and admin review;
- verified-adult authentication for every social/product route.

The verified-adult middleware validates the JWT identity, loads the live user, applies the shared eligibility rule, and returns a stable `AGE_VERIFICATION_REQUIRED` or `AGE_RESTRICTED` response without exposing DOB.

### Squads and matchmaking

- Callers cannot create, discover, join, invite, approve, search, chat, or use video without verified-adult access.
- Invitees and join-request targets are checked too; an eligible caller cannot pull an ineligible account into a squad.
- Starting search requires every current member to be eligible.
- Matchmaking rechecks both full rosters from Mongo while holding its existing lock. A legacy or stale queued squad is reset and dequeued before any encounter is created.

### Socket.IO and Agora

- Socket authentication loads live age state before joining presence or user rooms. Ineligible production sockets are rejected.
- Room membership checks remain in place; age verification does not replace authorization.
- Lobby and encounter Agora tokens stay behind verified-adult middleware and existing membership checks.
- The client connects realtime only after verified access, so the verification screen does not create a social presence.

## Client behavior

The existing blocking age screen becomes a two-step state machine rather than a new onboarding system:

1. Declare DOB.
2. If 18+, launch age verification and show pending/retry/help states until the server confirms the result.

Under-18 users see a clear adult-only explanation and can sign out or request account/data help. Copy must not imply that Giggle supports adult sexual content: `18+` describes user eligibility, while sexual/explicit themes remain prohibited.

Both web and native consume the same core API/session state. Neither client treats a URL callback, local flag, JWT boolean, or provider payload as proof.

## Content boundary

Giggle is an adult-user social app, not an adult-content app. Existing mature/sexual squad tags must no longer create a special adult room; they are rejected. This removes a store-policy conflict and eliminates a false impression that verified age permits sexual content.

## Migration and rollout

1. Existing `ageConfirmed` and `isAdult` values remain self-attested and do not become verified.
2. Existing users must complete assurance before their next social action. Identity/profile/verification access remains available.
3. The stronger middleware immediately closes direct-API, stale-JWT, socket, queued-match, and token bypasses.
4. Deploy backend and provider configuration before clients rely on the new states. Keep restrictive server kill switches available for stranger discovery by platform/region.
5. Publish and staff Community/Child Safety standards, report/block handling, an appeal route, and a named safety contact before store submission.

## Verification

- Unit tests prove stale JWT claims cannot override Mongo state; missing users, provider errors, under-18, self-attested adults, and pending users fail closed; only a verified adult passes.
- Provider tests mock `fetch` and verify session binding, result parsing, no raw evidence persistence, error handling, and production configuration.
- Squad/matchmaking tests prove every member and stale queue candidate is rechecked.
- Socket tests prove unverified identities cannot connect or join rooms.
- Route/source checks ensure both Agora token endpoints remain adult-gated.
- Web, core, mobile, server, and production-build checks run before integration.

## Explicit non-goals

- No under-18 discovery, encounters, DMs, invites, or parental-consent system in this release.
- No home-grown face inference, raw-ID upload, biometric storage, default call recording, or broad video surveillance.
- No claim of worldwide legal certification without counsel, vendor agreements, store-console settings, and operational evidence.

## Primary sources

- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Google Play Child Safety Standards: https://support.google.com/googleplay/android-developer/answer/14747720
- Google Play age-restricted random-chat policy: https://support.google.com/googleplay/android-developer/answer/16302250
- Instagram Teen Accounts: https://about.fb.com/news/2024/09/instagram-teen-accounts/
- TikTok teen privacy settings: https://support.tiktok.com/en/account-and-privacy/account-privacy-settings/privacy-and-safety-settings-for-users-under-age-18/
- X information for parents and minors: https://help.x.com/en/rules-and-policies/information-for-parents-and-minor-users
- Snapchat teen privacy: https://values.snap.com/privacy/teens
- Discord safer teen defaults: https://discord.com/safety/how-discord-is-building-safer-experiences-for-teens
- Yubo's verified 18+ model: https://www.yubo.live/blog/yubo-in-2025
- Wizz age assurance: https://wizzapp.com/age-assurance
- Tinder age verification: https://www.help.tinder.com/hc/en-us/articles/360040592771-How-does-age-verification-work
- Yoti AVS session flow: https://developers.yoti.com/age-verification/create-a-session
- EU minor-protection guidance: https://digital-strategy.ec.europa.eu/en/library/commission-publishes-guidelines-protection-minors
- Australian social-media age restrictions: https://www.esafety.gov.au/parents/social-media-age-restrictions

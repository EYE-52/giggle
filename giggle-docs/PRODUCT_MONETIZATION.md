# Giggle Monetization Strategy: "Giggle Premium"

To build a sustainable and profitable business, Giggle will operate on a **Freemium** model. The core "Squad-to-Squad" discovery loop remains free to ensure a massive user base and high queue liquidity. However, power users and highly engaged squads can upgrade to **Giggle Premium** for enhanced control, status, and connection tools.

## The Premium Feature Set

### 1. Premium Identity & Cosmetics
*   **Free:** Standard squad identity, lobby covers, and profile vibes.
*   **Premium:** Member badge, premium squad covers, animated vibe cosmetics, and launch-ready token perks. Premium status must not move squads ahead in matchmaking.

### 2. Squad History & "Reconnect" (The Social Network feature)
*   **Free:** Encounters are ephemeral. Once you skip or disconnect, that squad is gone forever.
*   **Premium:** Access the "Encounter History" tab. Premium squads can send a "Vibe Check / Reconnect" request to squads they met in the last 24 hours to hang out again.

### 3. Advanced Vibe Control & Cosmetics
*   **Free:** Access to standard Vibe Tags (Gaming, Music, Chill) and standard lobby backgrounds.
*   **Premium:** 
    *   Unlock exclusive Premium Tags (e.g., #Dating, #VIP, #Local).
    *   Unlock animated, reactive Lobby Backgrounds (e.g., Neon Cyberpunk, Lo-Fi Room).
    *   **Premium Badge:** A sleek glowing crown/badge next to the Squad Name during the collision reveal.

### 4. Video Polish
*   **Free:** Standard live video.
*   **Premium:** Reserved for launch-ready video cosmetics and presentation polish. Do not promise HD streaming until Agora configuration, billing, and entitlement enforcement are implemented.

---

## Technical Implementation Plan

To roll this out, we need a system that securely checks and propagates the user's premium status from the database to the UI.

### Phase A: The Data Layer
1.  **User Model:** Add `isPremium: { type: Boolean, default: false }` and `premiumExpiresAt: { type: Date }` to `giggle-server/src/models/User.js`.
2.  **Squad Inheritance:** If the **Squad Leader** is Premium, the squad may inherit cosmetic status for that session. This must not affect matchmaking queue order.

### Phase B: The Auth & API Layer
1.  **NextAuth Sync:** Update `giggle-web/src/auth.ts` to fetch the user's `isPremium` status from the backend during the `session` callback. This makes `session.user.isPremium` available globally on the frontend.
2.  **Backend Middleware:** Create a `requirePremiumAccess` middleware in the backend to protect premium-only routes (like fetching encounter history).

### Phase C: The UI Layer
1.  **The Paywall:** Build a sleek `PremiumModal.tsx` detailing the benefits.
2.  **Gated UI:** 
    *   Show padlock icons (🔒) next to Premium Vibe Tags in the Lobby.
    *   Add a "👑 Upgrade to Premium" CTA in the header for free users.
    *   Display the Premium Badge on Video Tiles for premium users.

---
*Future Integration: Stripe or Apple/Google Pay for subscription processing.*

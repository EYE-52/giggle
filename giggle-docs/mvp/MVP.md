This is the definitive **Giggle MVP Product Blueprint**. This document is designed to be the "source of truth" in your `giggle-docs` repository, focusing on a raw, functional demo that proves the core "Squad-to-Squad" concept without any unnecessary overhead.

---

# 🚀 Giggle MVP: Core Product Blueprint

**Project Name:** Giggle  
**Concept:** Social discovery for squads. Don't meet strangers alone; bring your friends.  
**MVP Goal:** A "zero-friction" web demo where a group of friends can form a squad via a 6-digit code and be matched into a 2v2 or 3v3 video instance with another squad.

---

## 1. User Journey (The "Raw" Flow)

1.  **Entry:** User arrives and authenticates via Google OAuth. They see two buttons: `[Create a Squad]` and `[Join with Code]`.
2.  **Squad Creation:**
    * **Leader:** Clicks "Create," gets a short alphanumeric **Invite Code** (e.g., `WGK-025`), and enters the **Lobby**.
    * **Friends:** Enter the invite code on the home screen and instantly appear in the Leader's Lobby.
3.  **The Lobby:** All squad members see their own cameras in the video lobby. The Leader sees a `[Find a Match]` button once all members are `ready`. A single member can search solo.
4.  **The Match:** Leader hits "Find a Match." The squad enters the global queue. The system pairs them with another searching squad. Both squads acknowledge the match before the encounter starts.
5.  **The Encounter (Auto-Join):**
    * Once both squads acknowledge, the encounter becomes `active`.
    * **All squad members who are in the video lobby are automatically moved into the encounter Agora channel** — no manual action needed.
    * Late joiners who open the squad lobby video after the encounter is already active are also dropped directly into the encounter channel.
    * **Layout:** Your squad on the left, their squad on the right. Grid columns scale with member count.
    * **Actions:** A `[Skip]` button (leader-only) finds a new match. `[Disconnect]` (leader-only) ends the encounter for both squads. Non-leaders can leave the encounter video without affecting the encounter state.

---

## 2. Functional Components (Prioritized)

### A. Home & Lobby System
* **Code Generator:** A backend utility to create unique, non-colliding 6-digit alphanumeric strings.
* **Stateful Lobby:** A real-time synchronized view where the list of "Connected Friends" updates instantly as people enter/leave the code-room.
* **Media Permissions:** A "Pre-flight" check to ensure Camera and Microphone are active before allowing a user to join a squad.

### B. The Matchmaking Brain
* **The Queue:** MongoDB-backed. All squads with `status: "searching"` are candidates. Matching runs synchronously on search-start using a score-based picker (size difference penalty + wait-time bonus).
* **Pairing Logic:** Lowest-score candidate wins. Encounter created immediately.
* **Encounter Handoff:** Both squads must acknowledge (`/ack`) before the encounter activates. 30-second expiry on the ack window.
* **Auto-Join:** Once the encounter is `active`, the frontend auto-joins all `inLobbyVideo` members into the Agora encounter channel without any user interaction.

### C. Video Instance Engine (Agora)
* **Dynamic Channel Joining:** Automatically connecting to an Agora channel based on the `encounterId` (`encounter_<encounterId>`).
* **Dynamic Grid:** CSS grid that scales based on member count per side. 1 member → full width, 2–4 → 2 columns, 5+ → 3 columns.
* **Split-Screen Encounter UI:** Left half = own squad tiles (indigo label), right half = opponent tiles (rose label). Squad Members sidebar hides during encounter to maximise video area. Header turns dark red with an ⚔️ icon.
* **Manual Disconnect:** Leader-only. Gracefully ends the encounter for both squads and returns to idle state without a page reload. Non-leaders can leave the Agora channel locally and rejoin later.

---

## 3. Technical Constraints & Current State

* **Google OAuth Required:** Users must be signed in with Google; API identity is based on `providerAccountId` from the Auth.js MongoDB `accounts` collection.
* **Secured APIs:** All product APIs are authenticated/authorized server-side (leader-only and squad-member checks where needed).
* **State persistence:** All squad, matchmaking, and encounter state persists in MongoDB via Mongoose. No Redis in current implementation.
* **Realtime updates:** Short-polling (2 s squad sync, 3 s matchmaking sync). No WebSocket/Signaling yet.
* **Presence flags:** `inLobbyVideo` and `inEncounterVideo` fields on each `SquadMember` document allow non-Agora clients to see who is in video.
* **Solo matchmaking allowed:** `MIN_MEMBERS_TO_SEARCH = 1`. A single leader can search and be matched.
* **Desktop-First:** Optimized for Chrome/Safari on desktop.
* **No Moderation (For Demo):** Assumed trusted testers. AI moderation planned for Phase 2.

---

## 4. Success Metric for MVP
**"The 2-Browser Test":**
> Successfully opening two tabs on a MacBook, creating two separate squads (4 'users' total), hitting "Find Match," and seeing all four video streams interacting in a single shared instance without a page reload.

---

## 5. Backend API Contract
Detailed request/response contracts and intended backend handler functions are documented in:

`BACKEND_API_SPEC.md`

---

### Next Step for Giggle
With this document finalized, your next move is to build the **Signaling Server** in the `giggle-server` repo. 


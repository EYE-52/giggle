This document serves as the **Product Blueprint** for **Giggle**. It outlines the functional components and the user journey required to bring the "Squad-to-Squad" discovery concept to life.

---

# Project Giggle: Product Component Roadmap

**Concept:** A social discovery platform where friends join as a "Squad" to meet other "Squads" via high-quality, moderated video instances.

---

## Phase 1: The Squad Foundation (The Lobby)
The first set of components focuses on the "Pre-Match" experience. This is where users gather before hitting the "Shuffle" button.

### 1.1 The Squad Creation Engine
* **Unique Room Generator:** A system that creates a persistent session ID for a group.
* **Dynamic Invite System:** A one-click "Join Link" (e.g., `giggle.social/join/squad-xyz`) that bypasses login for guests to ensure zero friction.
* **The "Ready" State:** A UI mechanism where the Squad Leader can see which friends are active, have their cameras on, and are ready to search.

### 1.2 The Squad Lobby (UI/UX)
* **Self-View Grid:** A private video area where the squad can talk and see each other before being matched with strangers.
* **Member Management:** Ability for the leader to kick or promote other members.
* **Live Status Indicators:** Visual cues showing "Searching," "Matching," or "Connected."
* **Unified Visual System:** Lobby and encounter screens should follow the same landing page palette to make the experience feel cohesive and premium.

---

## Phase 2: The Matchmaking Engine (The Brain)
This is the core logic that differentiates **Giggle** from traditional 1-on-1 chat sites.

### 2.1 The Queue Manager
* **Priority Sorting:** A logic layer that groups squads based on size (e.g., pairing a squad of 2 with another squad of 2 or 3).
* **Regional Routing:** Ensuring squads in the same geographic region (e.g., India/Asia) are paired first to minimize video latency.

### 2.2 The "Handshake" Protocol
* **Synchronized Transition:** When a match is found, all 4–8 users must be moved to the new video instance simultaneously so no one is left behind in the lobby.
* **The "Reveal" Moment:** A brief visual transition (3-2-1 countdown or animation) before the cameras of the other squad appear.

---

## Phase 3: The Encounter (The Instance)
Components required for the actual live interaction between two groups.

### 3.1 The Multi-User Video Grid
* **Smart Layouts:** A responsive grid that automatically adjusts based on the total number of participants (e.g., 2v2, 3v3, or 1v3).
* **Audio Focus:** Logic that prioritizes the audio of the person currently speaking to prevent "noise chaos."

### 3.2 Interaction Tools
* **The "Next/Skip" Trigger:** A voting system or Leader-only button to disconnect and find a new match.
* **Text Overlay:** A shared chat box for sending links, social media handles, or text when audio is too loud.

---

## Phase 4: The Safety & Moderation Layer
Essential for platform longevity and protecting the "Giggle" brand.

### 4.1 Real-Time Shield
* **Automated Content Scanning:** An "invisible" observer that scans video frames for prohibited content.
* **Instant Disconnect:** A kill-switch that triggers if a violation is detected, protecting the innocent squad from seeing inappropriate imagery.

### 4.2 Reporting & Reputation
* **Squad-Reporting:** If a whole group is toxic, they can be reported and blacklisted by their Device ID/IP.
* **Community Standards:** A clear, non-intrusive overlay of the rules upon entering the first match.

---

## Phase 5: The Discovery & Growth Loop
Components to keep users coming back.

### 5.1 Post-Match Interaction
* **"Add Friend" / "Save Squad":** A way to bookmark a group you liked so you can find them again later.
* **Social Sharing:** Tools to capture a "Squad Selfie" (screenshot of both groups) to share on Instagram/TikTok, driving organic growth.

---

## Step-by-Step Build Process

1.  **Step 1:** Establish the `giggle-docs` repo with these requirements.
2.  **Step 2:** Build the **Squad Lobby** (Web) — Friends seeing friends.
3.  **Step 3:** Implement the **Signaling Server** (Backend) — Managing who is in which room.
4.  **Step 4:** Deploy the **Matchmaking Logic** — The ability to "collide" two rooms.
5.  **Step 5:** Integrate **Video SDK** (Agora) — High-quality streaming.
6.  **Step 6:** Layer in **AI Moderation** — Ensuring the environment stays fun and safe.

**This document can now be saved into your `giggle-docs` repository as `PRODUCT_ROADMAP.md`.**
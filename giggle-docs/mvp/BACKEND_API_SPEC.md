# Giggle MVP Backend API Spec

This document defines the first backend APIs for Giggle MVP, including:
- endpoint purpose
- request/response contracts
- intended backend function/handler name

Scope matches the MVP docs: lobby-first, then matchmaking, then encounter bootstrap.
All product APIs are secured with Google OAuth identity from your existing Auth.js login.

---

## 0) Conventions

### Base URL
- Local: `http://localhost:<server-port>/api`

### Content Type
- Request/response JSON unless otherwise stated.

### Authentication & Identity
- **Auth source:** Backend JWT issued by `POST /auth/exchange` after Google login via Auth.js / NextAuth.
- **Security model:** All product APIs require bearer JWT auth.
- **Public exceptions:** `GET /health` and `GET /ready` can stay unauthenticated.
- **Identity key used across APIs:** `userId` (primary) with `providerAccountId` retained for backward compatibility.
- **Identity injection:** middleware verifies JWT and attaches decoded identity to request context.

### Auth Header
- `Authorization: Bearer <session-token-or-jwt>`

### Auth Middleware (implemented)
- `requireApiAuth()` -> validates bearer token and required identity claims.
- `requireSquadMemberAccess()` -> loads squad context and ensures requester belongs to the squad.
- `requireSquadLeaderAccess()` -> loads squad context and ensures requester is the squad leader.

### Identity Mapping
```ts
type GiggleIdentity = {
  userId: string; // users._id from MongoDB adapter
  provider: "google";
  providerAccountId: string; // accounts.providerAccountId (primary external user key)
  name?: string;
  email?: string;
  image?: string;
};
```

### Standard Error Response
```json
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human-readable error",
    "details": {}
  }
}
```

### Standard Success Envelope
```json
{
  "ok": true,
  "data": {}
}
```

### Suggested Core Types
```ts
type SquadRole = "leader" | "member";
type LobbyStatus = "idle" | "searching" | "matched" | "in_encounter";

type SquadMember = {
  memberId: string;
  userId: string;
  providerAccountId: string;
  displayName: string;
  role: SquadRole;
  ready: boolean;
  inLobbyVideo: boolean;      // true while member is in the Agora squad lobby channel
  inEncounterVideo: boolean;  // true while member is in the Agora encounter channel
  joinedAt: string; // ISO
};

type Squad = {
  squadId: string;
  squadCode: string; // ex: WGK-025
  squadName: string; // editable by leader, max 32 chars
  status: LobbyStatus;
  members: SquadMember[];
  leaderMemberId: string | null;
  currentEncounterId: string | null;
  opponentSquadId: string | null;
  createdAt: string; // ISO
};
```

---

## 1) Lobby APIs (Phase 1)

## 1.1 Create Squad

- **Endpoint:** `POST /squads/create`
- **Purpose:** Create new squad and assign requester as leader.
- **Intended Backend Function:** `createSquadHandler` -> `createSquad()`
- **Auth:** required (`requireApiAuth`)

### Request Body
```json
{
  "displayName": "Himanshu"
}
```

`displayName` is optional override; if omitted, use authenticated profile name.

### Success Response (201)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "squadCode": "GIG-882",
    "member": {
      "memberId": "mem_01JY...",
      "userId": "usr_01JY...",
      "providerAccountId": "108923456789012345678",
      "displayName": "Himanshu",
      "role": "leader",
      "ready": false,
      "joinedAt": "2026-03-25T10:00:00.000Z"
    },
    "status": "idle"
  }
}
```

### Errors
- `400 INVALID_REQUEST` (missing/invalid `displayName`)
- `401 UNAUTHORIZED`
- `500 INTERNAL_ERROR`

---

## 1.2 Join Squad by Code

- **Endpoint:** `POST /squads/join`
- **Purpose:** Join existing squad via 6-digit code.
- **Intended Backend Function:** `joinSquadHandler` -> `joinSquadByCode()`
- **Auth:** required (`requireApiAuth`)

### Request Body
```json
{
  "squadCode": "GIG-882",
  "displayName": "Aman"
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "squadCode": "GIG-882",
    "member": {
      "memberId": "mem_01JY...",
      "userId": "usr_01JY...",
      "providerAccountId": "109999999999999999999",
      "displayName": "Aman",
      "role": "member",
      "ready": false,
      "joinedAt": "2026-03-25T10:01:00.000Z"
    },
    "members": [
      {
        "memberId": "mem_01JY_leader",
        "userId": "usr_01JY_leader",
        "providerAccountId": "108923456789012345678",
        "displayName": "Himanshu",
        "role": "leader",
        "ready": true,
        "joinedAt": "2026-03-25T10:00:00.000Z"
      },
      {
        "memberId": "mem_01JY_member",
        "userId": "usr_01JY_member",
        "providerAccountId": "109999999999999999999",
        "displayName": "Aman",
        "role": "member",
        "ready": false,
        "joinedAt": "2026-03-25T10:01:00.000Z"
      }
    ],
    "status": "idle"
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `404 SQUAD_NOT_FOUND`
- `409 SQUAD_FULL` (if limit reached)
- `409 SQUAD_CLOSED` (already matched/in encounter and joins are blocked)

---

## 1.3 Get Squad Lobby State

- **Endpoint:** `GET /squads/:squadId`
- **Purpose:** Fetch current lobby state (poll fallback for realtime updates).
- **Intended Backend Function:** `getSquadHandler` -> `getSquadState()`
- **Auth:** required (`requireApiAuth`, `requireSquadMember`)

### Request Params
- Path: `squadId`

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "squadCode": "GIG-882",
    "status": "searching",
    "members": [
      {
        "memberId": "mem_01JY_leader",
        "userId": "usr_01JY_leader",
        "providerAccountId": "108923456789012345678",
        "displayName": "Himanshu",
        "role": "leader",
        "ready": true,
        "joinedAt": "2026-03-25T10:00:00.000Z"
      }
    ],
    "leaderMemberId": "mem_01JY_leader"
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 SQUAD_NOT_FOUND`

---

## 1.4 Update Ready State

- **Endpoint:** `POST /squads/:squadId/ready`
- **Purpose:** Mark current member ready/unready in lobby.
- **Intended Backend Function:** `setReadyHandler` -> `setMemberReadyState()`
- **Auth:** required (`requireApiAuth`, `requireSquadMember`)

### Request Body
```json
{
  "ready": true
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "memberId": "mem_01JY_member",
    "providerAccountId": "109999999999999999999",
    "ready": true,
    "readyCount": 2,
    "totalMembers": 3
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 SQUAD_NOT_FOUND`
- `404 MEMBER_NOT_FOUND`
- `409 INVALID_SQUAD_STATE` (if not allowed during encounter)

---

## 1.5 Leave Squad

- **Endpoint:** `POST /squads/:squadId/leave`
- **Purpose:** Member leaves squad; if leader leaves, promote next member.
- **Auto-delete behavior:** If the leaving member is the last member, squad is deleted automatically.
- **Intended Backend Function:** `leaveSquadHandler` -> `removeMemberAndReassignLeader()`
- **Auth:** required (`requireApiAuth`, `requireSquadMember`)

### Request Body
```json
{}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "leftMemberId": "mem_01JY_member",
    "newLeaderMemberId": "mem_01JY_leader",
    "remainingCount": 2,
    "squadDeleted": false
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 SQUAD_NOT_FOUND`
- `404 MEMBER_NOT_FOUND`

---

## 1.6 Get My Squad Context

- **Endpoint:** `GET /squads/me`
- **Purpose:** Return current authenticated user's squad state (or no active squad).
- **Auth:** required (`requireApiAuth`)

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "inSquad": true,
    "squadId": "sq_01JY...",
    "squadCode": "GIG-882",
    "status": "idle",
    "member": {
      "memberId": "mem_01JY...",
      "userId": "usr_01JY...",
      "providerAccountId": "108923456789012345678",
      "displayName": "Himanshu",
      "role": "leader",
      "ready": true,
      "joinedAt": "2026-03-25T10:00:00.000Z"
    },
    "leaderMemberId": "mem_01JY...",
    "members": []
  }
}
```

When user has no squad:
```json
{
  "ok": true,
  "data": {
    "inSquad": false
  }
}
```

### Errors
- `401 UNAUTHORIZED`

---

## 1.7 Update Squad Name (Leader Only)

- **Endpoint:** `POST /squads/:squadId/name`
- **Purpose:** Change the squad display name.
- **Auth:** required (`requireApiAuth` + leader-only access)

### Request Body
```json
{ "squadName": "dream team" }
```

### Success Response (200)
```json
{ "ok": true, "data": { "squadId": "sq_01JY...", "squadName": "dream team" } }
```

### Errors
- `400 INVALID_REQUEST` (empty or > 32 chars)
- `401 UNAUTHORIZED`
- `403 LEADER_ONLY`
- `404 SQUAD_NOT_FOUND`

---

## 1.8 Set Lobby Video Presence

- **Endpoint:** `POST /squads/:squadId/lobby-video`
- **Purpose:** Track whether a member is currently in the Agora squad lobby channel. Called by the frontend on join and leave. Setting `inLobbyVideo: false` also clears `inEncounterVideo`.
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Request Body
```json
{ "inLobbyVideo": true }
```

### Success Response (200)
```json
{ "ok": true, "data": { "memberId": "mem_01JY...", "inLobbyVideo": true } }
```

### Errors
- `400 INVALID_REQUEST` (`inLobbyVideo` not a boolean)
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`

---

## 1.9 Set Encounter Video Presence

- **Endpoint:** `POST /squads/:squadId/encounter-video`
- **Purpose:** Track whether a member has joined the Agora encounter channel. Used by other squad members (who may not be in Agora) to see who is in the encounter. Called on auto-join and manual join/leave of the encounter channel.
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Request Body
```json
{ "inEncounterVideo": true }
```

### Success Response (200)
```json
{ "ok": true, "data": { "memberId": "mem_01JY...", "inEncounterVideo": true } }
```

### Errors
- `400 INVALID_REQUEST` (`inEncounterVideo` not a boolean)
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`

---

## 1.10 Get Agora Lobby Token

- **Endpoint:** `POST /agora/lobby-token/:squadId`
- **Purpose:** Issue Agora RTC token for squad lobby channel.
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "memberId": "mem_01JY...",
    "appId": "your-agora-app-id",
    "channelName": "lobby_sq_01JY...",
    "rtcToken": "007eJx...",
    "uid": 123456789,
    "expiresIn": 3600,
    "expiresAt": "2026-04-03T14:00:00.000Z"
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 SQUAD_NOT_FOUND`
- `500 AGORA_NOT_CONFIGURED`
- `500 INTERNAL_ERROR`

### Required Environment Variables
- `AGORA_APP_ID`
- `AGORA_APP_CERTIFICATE`
- `AGORA_TOKEN_EXPIRY_SECONDS` (optional, default 3600)

---

## 1.11 Start Squad Search (Leader Only)

- **Endpoint:** `POST /squads/:squadId/search`
- **Purpose:** Move squad from `idle` to `searching`.
- **Auth:** required (`requireApiAuth` + leader-only access)

### Preconditions
- Requester is a squad member and leader.
- Squad status is `idle`.
- Squad has at least `MIN_MEMBERS_TO_SEARCH` members (`appConfig.js`, default **1** — solo search allowed).
- All members are `ready: true`.

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `403 LEADER_ONLY`
- `404 SQUAD_NOT_FOUND`
- `409 INVALID_SQUAD_STATE`
- `409 NOT_ENOUGH_MEMBERS`
- `409 NOT_READY_TO_SEARCH`

---

## 1.12 Cancel Squad Search (Leader Only)

- **Endpoint:** `POST /squads/:squadId/search/cancel`
- **Purpose:** Move squad from `searching` to `idle`.
- **Auth:** required (`requireApiAuth` + leader-only access)

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `403 LEADER_ONLY`
- `404 SQUAD_NOT_FOUND`
- `409 NOT_IN_SEARCH`

---

## 1.13 Kick Member (Leader Only)

- **Endpoint:** `POST /squads/:squadId/members/:memberId/kick`
- **Purpose:** Remove target member from squad.
- **Auth:** required (`requireApiAuth` + leader-only access)

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `403 LEADER_ONLY`
- `404 SQUAD_NOT_FOUND`
- `404 MEMBER_NOT_FOUND`
- `409 LEADER_CANNOT_BE_KICKED`

---

## 1.14 Promote Member to Leader (Leader Only)

- **Endpoint:** `POST /squads/:squadId/members/:memberId/promote`
- **Purpose:** Transfer leadership to another member.
- **Auth:** required (`requireApiAuth` + leader-only access)

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `403 LEADER_ONLY`
- `404 SQUAD_NOT_FOUND`
- `404 MEMBER_NOT_FOUND`
- `409 ALREADY_LEADER`

---

## 2) Matchmaking APIs

> All matchmaking APIs are **implemented**. Queue is backed by MongoDB (not Redis); matching runs synchronously on search start using a score-based candidate picker.

Start/cancel search use the squad-state APIs in section 1:
- `POST /squads/:squadId/search` (§1.11)
- `POST /squads/:squadId/search/cancel` (§1.12)

### 2.0 Matching Algorithm (Implemented)

- Candidates are all squads with `status: "searching"` in MongoDB.
- Score = `|sizeDiff| × 40 − min(waitSeconds, 60)`.
- Lowest score wins. Match created immediately once a candidate exists.

## 2.1 Get Matchmaking Status

- **Endpoint:** `GET /matchmaking/status/:squadId`
- **Purpose:** Fetch current search or match state for a squad.
- **Intended Backend Function:** `getMatchmakingStatusHandler` -> `getSquadMatchStatus()`
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "state": "searching",
    "queue": {
      "region": "ap-south-1",
      "size": 2,
      "queuedAt": "2026-03-25T10:05:00.000Z",
      "waitSeconds": 7
    },
    "match": null
  }
}
```

Matched example:
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "state": "matched",
    "queue": null,
    "match": {
      "encounterId": "enc_01JY...",
      "opponentSquadId": "sq_01JY_op",
      "matchedAt": "2026-03-25T10:06:10.000Z"
    }
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 SQUAD_NOT_FOUND`

---

## 2.2 Encounter Handoff Status

- **Endpoint:** `GET /matchmaking/encounters/:encounterId`
- **Purpose:** Return encounter handoff state while clients transition from lobby to encounter room.
- **Intended Backend Function:** `getEncounterHandoffHandler` -> `getEncounterHandoffStatus()`
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "encounterId": "enc_01JY...",
    "status": "awaiting_ack",
    "squadAId": "sq_01JY_A",
    "squadAName": "awesome sauce",
    "squadBId": "sq_01JY_B",
    "squadBName": "dream team",
    "ack": {
      "sq_01JY_A": true,
      "sq_01JY_B": false
    },
    "expiresAt": "2026-03-25T10:06:50.000Z"
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 ENCOUNTER_NOT_FOUND`

---

## 2.3 Acknowledge Encounter Join

- **Endpoint:** `POST /matchmaking/encounters/:encounterId/ack`
- **Purpose:** Mark current squad as acknowledged in encounter handoff flow; once both squads ack, state moves to `active`. This endpoint is called automatically by the frontend when a match is detected.
- **Intended Backend Function:** `ackEncounterJoinHandler` -> `ackEncounterJoin()`
- **Auth:** required (`requireApiAuth`, `requireSquadMemberAccess`)

### Request Body
```json
{
  "squadId": "sq_01JY..."
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "encounterId": "enc_01JY...",
    "squadId": "sq_01JY...",
    "acknowledged": true,
    "allAcked": false
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 ENCOUNTER_NOT_FOUND`
- `409 ENCOUNTER_EXPIRED`

---

## 2.4 Skip Encounter (Leader Only)

- **Endpoint:** `POST /matchmaking/skip`
- **Purpose:** Leader requests disconnect and rematch.
- **Intended Backend Function:** `skipEncounterHandler` -> `skipAndRequeueSquad()`
- **Auth:** required (`requireApiAuth`, `requireSquadLeaderAccess`)

### Request Body
```json
{
  "squadId": "sq_01JY...",
  "encounterId": "enc_01JY..."
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "squadId": "sq_01JY...",
    "previousEncounterId": "enc_01JY...",
    "queueStatus": "searching"
  }
}
```

### Errors
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `403 LEADER_ONLY`
- `409 NOT_IN_ENCOUNTER`

---

## 3) Encounter / Video APIs

> All encounter APIs are **implemented**.

## 3.1 Issue Encounter Agora Token

- **Endpoint:** `POST /encounters/token`
- **Purpose:** Issue Agora RTC token for the shared encounter channel. Validates the requester belongs to the squad and the squad is currently in the given encounter.
- **Auth:** required (`requireApiAuth`)

### Request Body
```json
{
  "encounterId": "enc_01JY...",
  "squadId": "sq_01JY..."
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "encounterId": "enc_01JY...",
    "squadId": "sq_01JY...",
    "memberId": "mem_01JY...",
    "appId": "your-agora-app-id",
    "channelName": "encounter_enc_01JY...",
    "rtcToken": "007eJx...",
    "uid": 987654321,
    "expiresIn": 3600,
    "expiresAt": "2026-04-03T15:00:00.000Z"
  }
}
```

> **Channel naming:** encounter channels use the prefix `encounter_` (e.g. `encounter_enc_01JY...`). This differs from lobby channels which use `lobby_`.

### Errors
- `400 INVALID_REQUEST` (missing `squadId` or `encounterId`)
- `401 UNAUTHORIZED`
- `403 MEMBER_NOT_IN_ENCOUNTER`
- `404 ENCOUNTER_NOT_FOUND`
- `500 AGORA_NOT_CONFIGURED`

---

## 3.2 Disconnect from Encounter

- **Endpoint:** `POST /encounters/disconnect`
- **Purpose:** Leave the active encounter. Behavior differs by role:
  - **Leader:** ends the encounter for both squads (both squads return to `idle`). The frontend then clears match state.
  - **Non-leader:** server returns success with `isLeaderDisconnect: false`. The encounter stays alive. The client simply leaves the Agora channel locally.
- **Auth:** required (`requireApiAuth`)

### Request Body
```json
{
  "encounterId": "enc_01JY...",
  "squadId": "sq_01JY..."
}
```

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "encounterId": "enc_01JY...",
    "memberId": "mem_01JY...",
    "disconnected": true,
    "isLeaderDisconnect": true,
    "squadStatus": "idle"
  }
}
```

For non-leader:
```json
{ "ok": true, "data": { "disconnected": true, "isLeaderDisconnect": false, "squadStatus": "in_encounter" } }
```

### Errors
- `400 INVALID_REQUEST`
- `401 UNAUTHORIZED`
- `403 FORBIDDEN`
- `404 ENCOUNTER_NOT_FOUND`
- `409 NOT_IN_ENCOUNTER`

---

## 4) Platform / Ops APIs

## 4.1 Health Check

- **Endpoint:** `GET /health`
- **Purpose:** Process-level liveness probe.
- **Intended Backend Function:** `healthHandler`

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "status": "up",
    "service": "giggle-server",
    "time": "2026-03-25T10:00:00.000Z"
  }
}
```

---

## 4.2 Readiness Check

- **Endpoint:** `GET /ready`
- **Purpose:** Readiness probe (Redis, signaling, config).
- **Intended Backend Function:** `readyHandler` -> `checkDependenciesReady()`

### Success Response (200)
```json
{
  "ok": true,
  "data": {
    "status": "ready",
    "checks": {
      "redis": "ok",
      "agoraConfig": "ok"
    }
  }
}
```

### Error Response (503)
```json
{
  "ok": false,
  "error": {
    "code": "NOT_READY",
    "message": "One or more dependencies are unavailable",
    "details": {
      "redis": "down"
    }
  }
}
```

---

## 4.3 Event Ingestion (Optional but recommended)

- **Endpoint:** `POST /events`
- **Purpose:** Track product events for MVP debugging/analytics.
- **Intended Backend Function:** `ingestEventHandler` -> `recordProductEvent()`
- **Auth:** required (`requireApiAuth`)

### Request Body
```json
{
  "eventName": "squad_enqueued",
  "squadId": "sq_01JY...",
  "metadata": {
    "region": "ap-south-1"
  },
  "occurredAt": "2026-03-25T10:05:00.000Z"
}
```

### Success Response (202)
```json
{
  "ok": true,
  "data": {
    "accepted": true
  }
}
```

---

## 5) Build Order (Implementation Sequence)

1. `POST /squads/create`
2. `POST /squads/join`
3. `GET /squads/:squadId`
4. `POST /squads/:squadId/ready`
5. `POST /squads/:squadId/leave`
6. `POST /squads/:squadId/search`
7. `POST /squads/:squadId/search/cancel`
8. `GET /matchmaking/status/:squadId`
9. `GET /matchmaking/encounters/:encounterId`
10. `POST /matchmaking/encounters/:encounterId/ack`
11. `POST /encounters/token`
12. `POST /encounters/disconnect`
13. `GET /health` + `GET /ready`
14. `POST /events` (optional)

This sequence gives a runnable MVP path: lobby -> queue -> match handoff -> video bootstrap.

---

## 6) Manual Smoke Test (Matchmaking + Encounter)

Use this checklist to validate the newly added server APIs before frontend integration.

### 6.1 Setup Variables

```bash
export API_BASE="http://localhost:3001/api"
export TOKEN_A="<backend_jwt_for_user_a>"
export TOKEN_B="<backend_jwt_for_user_b>"
```

### 6.2 Create Two Squads and Capture IDs

```bash
# User A creates squad
curl -s -X POST "$API_BASE/squads/create" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Leader A"}'

# User B creates squad
curl -s -X POST "$API_BASE/squads/create" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"Leader B"}'
```

Copy `squadId` values from both responses:

```bash
export SQUAD_A_ID="<sq_from_user_a_response>"
export SQUAD_B_ID="<sq_from_user_b_response>"
```

### 6.3 Mark Both Squads Ready and Start Search

```bash
curl -s -X POST "$API_BASE/squads/$SQUAD_A_ID/ready" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d '{"ready":true}'

curl -s -X POST "$API_BASE/squads/$SQUAD_B_ID/ready" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d '{"ready":true}'

curl -s -X POST "$API_BASE/squads/$SQUAD_A_ID/search" \
  -H "Authorization: Bearer $TOKEN_A"

curl -s -X POST "$API_BASE/squads/$SQUAD_B_ID/search" \
  -H "Authorization: Bearer $TOKEN_B"
```

### 6.4 Verify Matchmaking Status

```bash
curl -s "$API_BASE/matchmaking/status/$SQUAD_A_ID" \
  -H "Authorization: Bearer $TOKEN_A"
```

Expected:
- `state` should become `matched`.
- `match.encounterId` should be present.

```bash
export ENCOUNTER_ID="<encounter_id_from_status_response>"
```

### 6.5 Verify Encounter Handoff and ACK from Both Squads

```bash
curl -s "$API_BASE/matchmaking/encounters/$ENCOUNTER_ID" \
  -H "Authorization: Bearer $TOKEN_A"

curl -s -X POST "$API_BASE/matchmaking/encounters/$ENCOUNTER_ID/ack" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_A_ID\"}"

curl -s -X POST "$API_BASE/matchmaking/encounters/$ENCOUNTER_ID/ack" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_B_ID\"}"
```

Expected:
- after second ACK, `allAcked: true`
- squads transition to `in_encounter`

### 6.6 Issue Encounter Tokens

```bash
curl -s -X POST "$API_BASE/encounters/token" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_A_ID\",\"encounterId\":\"$ENCOUNTER_ID\"}"

curl -s -X POST "$API_BASE/encounters/token" \
  -H "Authorization: Bearer $TOKEN_B" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_B_ID\",\"encounterId\":\"$ENCOUNTER_ID\"}"
```

Expected:
- token payload with `channelName: encounter_<encounterId>`

### 6.7 Disconnect Encounter

```bash
curl -s -X POST "$API_BASE/encounters/disconnect" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_A_ID\",\"encounterId\":\"$ENCOUNTER_ID\"}"
```

Expected:
- encounter ends
- squads return to `idle`

### 6.8 Optional: Skip Encounter and Requeue

```bash
curl -s -X POST "$API_BASE/matchmaking/skip" \
  -H "Authorization: Bearer $TOKEN_A" \
  -H "Content-Type: application/json" \
  -d "{\"squadId\":\"$SQUAD_A_ID\",\"encounterId\":\"$ENCOUNTER_ID\"}"
```

Expected:
- `queueStatus: searching` for triggering squad

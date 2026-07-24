# Giggle Random Meets Design (Efficient Matchmaking)

This document defines how Giggle should implement random squad-to-squad meets efficiently for MVP and near-term scale.

---

## 1. Problem Statement

Giggle needs to pair squads quickly and fairly while preserving quality:
- low wait time
- good conversation quality (size compatibility, latency)
- anti-repeat behavior (avoid matching the same squads repeatedly)
- predictable behavior under low and high traffic

The output of this system is an `encounter` assignment that moves two squads from lobby state to a shared Agora room.

---

## 2. Goals and Non-Goals

### Goals
- Match in under 5s for healthy traffic, under 20s for sparse traffic.
- Prefer equal squad sizes (`2v2`, `3v3`) and allow close fallback (`2v3`) when needed.
- Reduce repeated pairings across short windows.
- Keep the algorithm simple enough for MVP operations and debugging.

### Non-Goals (MVP)
- No ML ranking/personalization.
- No deep profile compatibility scoring.
- No cross-region smart migration beyond basic region preference.

---

## 3. Functional Model

### Input
A searching squad contributes:
- `squadId`
- `size` (member count)
- `region` (derived from client/network)
- `searchStartedAt`
- optional constraints (future): language, age-band, interests

### Output
A match result:
- `encounterId`
- paired squads (`squadAId`, `squadBId`)
- selected region/media profile
- expiry/timeout metadata

---

## 4. Core Strategy: Bucketed Queue + Expanding Search Window

### 4.1 Bucketed Queue
Use Redis sorted sets/lists partitioned by size and region:
- `queue:region:<region>:size:2`
- `queue:region:<region>:size:3`
- fallback global buckets by size

Each entry stores:
- `squadId`
- enqueue timestamp
- lightweight metadata hash key (`squad:search:<squadId>`)

### 4.2 Search Windows (Time-Based Relaxation)
When a squad starts searching:

Window A (0-8s):
- same region
- same size only

Window B (8-16s):
- same region
- +/-1 size (e.g., `2` can match `3`)

Window C (16s+):
- neighboring/global region allowed
- +/-1 size

This guarantees quality first, speed second.

### 4.3 Candidate Scoring
For each candidate squad, compute a simple score:

Score =
- size penalty (`|sizeA - sizeB| * 40`)
- region penalty (`0` same region, `30` nearby, `60` global)
- repeat penalty (`100` if matched in cooldown window)
- wait bonus (`-min(waitSeconds, 60)`) to avoid starving old entries

Choose the lowest score. If no candidate exists, keep squad queued.

---

## 5. Anti-Repeat and Fairness

### 5.1 Recent Pair Cooldown
Store pair history key:
- `recent_pair:<minSquadId>:<maxSquadId> = lastMatchedAt`

For MVP, enforce a 10-15 minute cooldown where possible.

### 5.2 Starvation Protection
If a squad waits too long:
- progressively relax constraints
- elevate priority using wait bonus in scoring

---

## 6. Matchmaking State Machine

### Squad States
- `idle`
- `searching`
- `matched`
- `in_encounter`

### Transitions
1. Leader starts search -> `idle` to `searching`
2. Match found -> `searching` to `matched`
3. Encounter room joined by both squads -> `matched` to `in_encounter`
4. Encounter ends/skip -> `in_encounter` to `idle` (or back to `searching` if auto-rematch enabled later)

State changes must be atomic with queue operations.

---

## 7. Data Structures (Redis + DB)

### Redis (hot path)
- Queues by region/size
- Squad search metadata hash
- Distributed lock keys for pairing
- Recent pair cooldown keys
- Encounter handshake keys with TTL

### MongoDB (source of truth / audit)
- Encounter records:
  - `encounterId`
  - squads
  - startedAt/endedAt
  - skip reason / timeout reason

---

## 8. Concurrency and Correctness

### 8.1 Atomic Pairing
Use Redis Lua script (or transaction with lock) to:
- verify both squads are still searchable
- remove both from queue
- mark both as `matched`
- write encounter handshake payload

All in one atomic step to prevent double-matching.

### 8.2 Idempotency
Use idempotency key for start-search actions:
- repeated clicks should not enqueue duplicates

---

## 9. API Additions (Proposed)

Build on existing squad APIs; add:

1. `POST /matchmaking/search/start`
- body: `{ squadId }`
- effect: enqueue + status `searching`

2. `POST /matchmaking/search/cancel`
- body: `{ squadId }`
- effect: dequeue + status `idle`

3. `GET /matchmaking/status/:squadId`
- returns current search state and wait duration

4. `POST /matchmaking/encounter/:encounterId/ack`
- each squad acks transition; server moves to `in_encounter` once both ack

For MVP polling is acceptable; websocket push is preferred for transition events.

---

## 10. Encounter Handoff Flow

1. Both squads are matched, `encounterId` created.
2. Server emits/polls transition payload to both squads:
   - `encounterId`
   - Agora channel name: `encounter_<encounterId>`
   - token payload per member
3. Clients leave lobby channel and join encounter channel.
4. Each client sends ack; server confirms encounter activation.

Timeout policy:
- if one squad fails to join in N seconds, cancel encounter and requeue the other squad safely.

---

## 11. Performance Targets and SLOs

### Target Metrics
- P50 match time < 5s
- P95 match time < 20s
- duplicate pair rate < 10% over 30 min at moderate traffic
- failed handoff rate < 2%

### Operational Metrics
- queue depth by region/size
- average wait by region/size
- active encounters
- cancellation rate
- requeue rate after failed handoff

---

## 12. Rollout Plan

### Phase A (MVP)
- FIFO within same region and same size
- fallback to +/-1 size after threshold
- simple anti-repeat cooldown
- polling-based status updates

### Phase B
- websocket transition events
- better regional grouping
- encounter ack + robust timeout recovery

### Phase C
- richer compatibility signals
- adaptive weights tuned from metrics

---

## 13. Failure Handling

- Queue corruption/duplication: periodic queue reconciliation worker.
- Crash during match creation: encounter keys use TTL and idempotent recovery.
- Client disconnect while searching: heartbeat timeout removes stale squads.

---

## 14. Security and Abuse Controls

- Leader-only start/cancel search.
- Squad membership verified for all matchmaking calls.
- Rate limit start/cancel to prevent queue spam.
- Optional short cooldown after repeated skip-abuse.

---

## 15. Implementation Checklist

1. Redis queue keys + metadata schema.
2. Atomic pairing script/service.
3. Matchmaking API handlers.
4. Encounter creation + token issuance for encounter channels.
5. Client transition flow (lobby -> encounter).
6. Metrics instrumentation and dashboards.
7. Recovery jobs (stale queue cleanup, failed handoff requeue).

---

## 16. Recommended MVP Defaults

- Cooldown between same pair: 12 minutes
- Window thresholds: 8s / 16s
- Max search timeout before user hint: 45s
- Region fallback order: local -> nearby -> global

These defaults should be tuned from real traffic telemetry after the first test cohort.

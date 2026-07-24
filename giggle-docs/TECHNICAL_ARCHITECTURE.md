# Giggle Backend Architecture & Event Flow

This document provides a high-level overview of the Giggle backend architecture, detailing how real-time events, matchmaking, and session states are managed across our high-scale infrastructure.

---

## 1. System Architecture Diagram

```mermaid
graph TD
    subgraph Client_Layer ["Client Layer (Next.js)"]
        A[Squad A Client]
        B[Squad B Client]
    end

    subgraph Communication_Layer ["Real-time & API"]
        C[Socket.io Server]
        D[Express API Server]
    end

    subgraph High_Speed_State ["Redis - Memory Layer"]
        E[Matchmaking Queue ZSET]
        F[Session State HASH]
        G[Pub/Sub Adapter]
    end

    subgraph Persistent_Layer ["MongoDB - Disk Layer"]
        H[(User Profiles)]
        I[(Squad Metadata)]
        J[(Encounter Logs)]
    end

    subgraph Media_Layer ["Agora Cloud"]
        K[Low-Latency Video/Audio]
    end

    %% Relationships
    A <-->|WebSockets| C
    B <-->|WebSockets| C
    A <-->|REST API| D
    B <-->|REST API| D

    C <-->|Sync State| G
    D <-->|Matchmaking| E
    D <-->|Quick Toggles| F
    
    D <-->|Long-term Storage| H
    D <-->|Long-term Storage| I
    D <-->|Long-term Storage| J

    A <-->|RTC| K
    B <-->|RTC| K

    %% Styling
    style E fill:#f96,stroke:#333,stroke-width:2px
    style F fill:#f96,stroke:#333,stroke-width:2px
    style G fill:#f96,stroke:#333,stroke-width:2px
    style K fill:#0af,stroke:#333,stroke-width:2px
```

## 2. Real-time Event Flow (Sequence)

```mermaid
sequenceDiagram
    participant UserA as Squad Leader (A)
    participant UserB as Squad Leader (B)
    participant Server as Giggle Backend
    participant Redis as Redis (State/Queue)
    participant Mongo as MongoDB (Persistent)

    Note over UserA, Redis: SQUAD LOBBY PHASE
    UserA->>Server: Toggle Ready
    Server->>Redis: Set member_ready = true (HSET)
    Server-->>UserA: Emit SQUAD_UPDATED (WebSocket)
    
    Note over UserA, Redis: MATCHMAKING PHASE
    UserA->>Server: Start Search
    Server->>Redis: Add to queue (ZADD) & Set meta (HSET)
    Server->>Redis: Acquire Redlock ("lock:matchmaking")
    Redis-->>Server: Lock Granted
    Server->>Redis: Find best candidate (ZRANGE/HGETALL)
    Server->>Server: Score Algorithm (Size, Wait, Vibe, Rep)
    
    Note over UserA, UserB: COLLISION PHASE
    Server->>Mongo: Create Encounter (awaiting_ack)
    Server->>Redis: Remove both from Queue
    Server-->>UserA: Emit MATCH_FOUND (WS)
    Server-->>UserB: Emit MATCH_FOUND (WS)
    
    Note over UserA, UserB: ENCOUNTER PHASE
    UserA->>Server: send_message ("Hello!")
    Server-->>UserB: Emit new_message (WS - Sub-ms latency)
    
    Note over UserA, UserB: DISCONNECT (Asymmetric)
    UserA->>Server: Disconnect
    Server->>Redis: Set Squad A -> IDLE
    Server->>Redis: Set Squad B -> SEARCHING (Auto-requeue)
    Server-->>UserA: Emit ENCOUNTER_ENDED (WS)
    Server-->>UserB: Emit ENCOUNTER_ENDED (WS)
```

---

## 3. Comprehensive User Actions & Backend Impact

| Action | Primary Trigger | Backend Logic | Data Layer Impact |
| :--- | :--- | :--- | :--- |
| **Create Squad** | REST POST | Generates 6-digit code, creates Leader identity. | **Mongo:** New Squad/Member docs. |
| **Ready Up** | REST POST | Updates live session state for friends to see. | **Redis:** Fast HSET update. |
| **Join Video** | Agora Sync | Updates video presence flag. | **Redis:** Fast HSET update. |
| **Start Search** | REST POST | Validates live Ready/Video states from Redis, enters queue. | **Redis:** Added to regional ZSET with timestamp score. |
| **Report Squad** | WebSocket | Triggers "Reputation Cascade" lowering all member scores. | **Mongo:** User & Squad Score -15. |
| **Chat** | WebSocket | Ephemeral broadcast to the shared encounter room. | **None (In-memory only)** |
| **Skip** | REST POST | Ends encounter, sets both squads to "Searching." | **Redis:** Both squads re-added to ZSET. |
| **Disconnect** | REST POST | Initiator goes to Lobby, other squad is auto-requeued. | **Redis:** Initiator IDLE, Other ZSET re-add. |

---

## 4. Scaling Logic (Phase 5+)

1.  **Fair queue scoring:** Matchmaking scores squad size, wait time, shared tags, and reputation compatibility. Premium status does not move squads ahead in the queue.
2.  **Geo-Sharding:** The Redis key is prefixed by region (`matchmaking_queue:us-east`). The `matchmakingService` checks the local shard first, then expands to `*:*` after 10 seconds of waiting.
3.  **Cross-Server Messaging:** When a message is sent to an `encounterId`, the Socket.io Redis adapter publishes it to a Redis Channel. All Giggle server instances subscribe to this channel and emit the message to users connected to their specific node.

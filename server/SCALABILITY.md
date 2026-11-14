# Meet backend scale checks

These checks cover the Meet control server: group admission, matching, call
identity, chat and reconnect state. Local measurements do not establish
production user capacity or Agora video capacity. Production replica count and
provider capacity are unchanged.

## Bounded matching work

Each match attempt reads at most 100 oldest candidates in its region. After ten
seconds, or when that page has no other squad, it can read one more 100-candidate
page from a rotating region. Scoring, account access, moderation, blocks,
cooldowns, online membership, and the final locked state checks still apply.
Ranking now chooses the best eligible candidate in the visited windows rather
than loading and ranking every waiting squad at once.

A Redis cursor per seeker and region records `(queuedAt, squadId)`. Seeking uses
both values, including when scores tie or earlier candidates were removed.
Retries continue through later candidates and wrap to the oldest remaining
candidate. Cursor keys expire after 30 minutes without use, and new queue
admission resets the seeker's cursor. Missing/corrupt metadata is removed from
the queue with a conditional check so a concurrent repair is preserved.

The region index is populated by queue admissions and nonempty regional reads.
Queues already present during an upgrade enter the index as their seekers are
retried. An incremental bootstrap also discovers pre-upgrade queues using at
most one `SCAN COUNT 250` step per expansion until the pass completes. Empty
regional reads clear their index entry and page cursor. After bootstrap,
ordinary expansion uses the region index. Full queue enumeration is retained
for administrative recovery when discovery is disabled.

Maintenance retries at most 25 seekers per tick, in oldest-first order with a
shared continuation cursor. This moves past an incompatible first batch and
eventually wraps. The supporting Mongo index is
`{status:1, searchQueuedAt:1, squadId:1}`. The directory also has
`{visibility:1, status:1, createdAt:-1}` for its equality filters and sort.
Both indexes were observed automatically installed on a private Mongo instance
during the local API check below. Startup does not await index completion before
listening. Deployed index installation and production query plans remain unverified.

Socket room joins, media changes and group presence share a per-socket budget of
60 actions per ten seconds and at most eight pending actions. Media/presence
chains reject excess work before queuing it. Disconnect stops new controls and
clears the presence heartbeat immediately. Fresh connections receive a fresh
budget. Normal chat, reaction, report, transport and replica behavior is retained.

The general HTTP budget remains 3,000 requests per 15 minutes, now keyed by a
signature/expiry-verified account ID when the bearer token is valid. It uses the
same verification helper as API authentication, with no extra account query.
Missing, invalid and expired credentials share the normal IPv6-safe IP budget.
The stricter authentication-route IP limiter is unchanged, and live account/age
checks still run on protected routes.

## Reproduce the queue measurement

From the repository root:

```sh
node server/scripts/benchmark-matchmaking-queue.js
```

The script starts its own Redis on a temporary Unix socket, seeds synthetic
queues, compares the former full-region reader with bounded candidate windows,
then stops only that Redis process. It does not load `.env` or use configured
services. `redis-server` must be installed.

One Node 24 local run on 14 November 2026:

| Queued squads | Full reader median | Window median | Full 25-read burst | Window 25-read burst |
| --- | ---: | ---: | ---: | ---: |
| 100 | 0.59 ms | 0.42 ms | 9.50 ms | 9.40 ms |
| 1,000 | 2.68 ms | 0.42 ms | 85.00 ms | 8.36 ms |
| 10,000 | 26.27 ms | 0.31 ms | 775.95 ms | 8.87 ms |

Each row uses 12 sequential samples and a burst of 25 reader calls. At 10,000,
metadata reads fall from 10,000 to 100 per page and serialized results from
1,260,001 to 12,601 bytes. Results vary by machine and do not include network
latency, Mongo, authentication, HTTP, sockets, or video.

## Isolated API check

A separate private API, Mongo replica set and Redis run used 26 synthetic adult
development accounts in 13 two-person squads. Thirteen concurrent search
requests produced six matches (12 squads) and one correctly waiting squad. All
12 leader acknowledgements succeeded, leaving six active encounters. Search
HTTP latency was 24.97 ms median / 25.52 ms maximum; concurrent acknowledgement
latency was 315.50 ms median / 487.84 ms maximum. The whole fixture flow took
1.97 seconds after service startup, including account creation and setup.

All 78 normal group-presence/media control acknowledgements succeeded, with
zero `BUSY` replies or HTTP errors. Both new Squad indexes appeared in
`listIndexes()` without an explicit index command. Only owned test processes
were stopped afterward. Ready/video flags were simulated through local APIs;
no camera, browser rendering, Agora connection, outside account, or provider
call was part of this check. This modest test does not establish a production
capacity target or outage/reconnect behavior.

## Concurrent matching and reconnect protection

Normal match attempts scan candidates outside the lease. Final checks and state
changes take only the two squads' deterministic Redis lock stripes (256 stripes).
A busy candidate is skipped rather than holding every other pair in line.
The match insert and both squad transitions commit in one Mongo transaction,
with roster/version predicates to reject concurrent membership changes. Call
acknowledgements also commit both squad states and the encounter together.
Rare account/safety operations without an explicit squad scope take all stripes.

Search admission releases its own lease before attempting a pair. Expired
handoffs and live pointers to ended encounters use separate bounded pages, each
with a continuation cursor, so historical calls cannot delay new expiry work.
Reconnection cleanup checks current socket/media ownership. Queue admissions
have unique IDs so an old cleanup cannot remove a replacement search.

Redis adapter subscriptions skip the INFO ready check that could run after
SUBSCRIBE and break cross-replica delivery at startup. The publisher connects
at startup, and `/health` requires primary Redis, publisher and subscriber
clients to be ready. This checks connection state; the multi-replica harness
separately checks actual room delivery and isolation.

The reproducible load harness, its scope and limitations are documented in
[MEET_LOAD_TEST.md](MEET_LOAD_TEST.md). It uses private stores and synthetic
accounts, not production traffic.

## Safe lock rollout

`MEET_SCOPED_MATCHMAKING_LOCKS` defaults to false. Compatibility mode takes the
legacy `lock:matchmaking` key **and all stripe keys** in one lease. It is safe
alongside the previous global-lock release. Scoped mode takes only the involved
stripes, and is safe alongside this release's compatibility mode.

1. Deploy this code with the flag absent or false. Verify `/health` reports
   `matchmaking.lockMode: "compatibility"` and the intended release SHA.
2. Wait until every legacy API process/deployment has stopped.
3. Set the flag to true and redeploy the same tested build. Verify health reports
   `scoped`, the same SHA, and connected database, Redis and realtime clients.

Never run scoped mode alongside a legacy global-only replica. To roll back to
legacy code, first redeploy this code in compatibility mode and wait for all
scoped processes to stop. Compatibility mode requires standalone Redis because
its legacy key and stripe keys use different Redis Cluster hash slots.

## Remaining capacity limits

- Stripe collisions can briefly serialize unrelated pairs. Rare global safety
  operations still take all stripes, and discovery-disable cleanup may inspect
  the full queue. This prioritizes stopping unsafe matching over throughput.
- Maintenance retries at most 25 seekers every 30 seconds. Sparse compatible
  groups or a large backlog can wait several ticks. Its leader lease is 25
  seconds and is not renewed; overlapping maintenance is still protected by
  per-pair leases and conditional database writes.
- Socket control budgets are per connection. A connection storm still needs a
  shared authenticated-user admission policy before materially larger targets.
- Health readiness is not an end-to-end broadcast probe. Redis outages, replica
  crashes, provider outages and queued adapter memory under a long outage need
  separate fault tests.
- The local workload does not include browser capture, Agora media transport,
  internet latency, production query plans, database pool limits or billing.
  Increase capacity against measured production CPU, memory, latency and
  provider limits rather than treating the test's user count as a guarantee.

# Meet backend scale checks

These are local code changes and isolated measurements. They do not establish
production user capacity or Agora video capacity. No replica, hosting, provider,
or production data changes were made.

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

## Remaining capacity limits

- Matching, acknowledgements, skip/end, and encounter cleanup still share one
  global Redis lock. More API replicas do not remove this bottleneck. In an
  isolated synthetic test using the existing lock retry policy, 100 simultaneous
  calls each holding the lock for 50 ms produced 48 successes and 52 lock
  failures in 2.74 seconds. This is lock behavior, not an app capacity estimate.
- Up to 200 examined candidates can still mean many serial Mongo checks while
  holding that lock. The expired/ended-encounter sweeper and discovery-disable
  cleanup can still enumerate large sets. Their work needs bounded continuation
  before substantially larger queues can be claimed safe.
- Maintenance runs every 30 seconds. A large backlog or sparse compatible
  groups can still wait several ticks. Its 25-second leader lease is not renewed
  during long work; the next replica can start another maintenance run after it
  expires. The global matchmaking lock still serializes state transitions.
- HTTP budgets remain shared across replicas. Socket control budgets are per
  connection; a connection storm needs a shared
  authenticated-user/connection admission policy.
- The public health check checks Mongo connection state and primary Redis state,
  not adapter pub/sub readiness. Adapter clients retain offline commands during
  Redis outages. Neither outage memory bounds nor multi-replica recovery were
  load-tested here.
- Mongo plans/index installation, real concurrent authenticated HTTP flows,
  event-loop delay, database pool pressure, process memory, reconnect storms,
  cross-replica delivery and Agora cost/capacity still need an isolated staging
  test with an agreed user count and latency target. Current clients use direct
  WebSocket transport; no transport or deployment assumptions were changed.

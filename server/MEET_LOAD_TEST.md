# Isolated Meet load and reconnect check

Run with Node 24, local `redis-server`, a local MongoDB `mongod` binary, and the
repository's existing server/core dependencies:

```sh
node server/scripts/load-test-meet.js \
  --mongod /path/to/mongod \
  --users 200 --replicas 3 \
  --report /absolute/path/to/meet-load-report.json
```

`--users` defaults to 200 and must be a multiple of four. `--replicas` accepts
two or three. The default queue-drain timeout is 150 seconds; change it with
`--timeout-ms`. The reconnect grace observation is at least 32 seconds and can
be increased with `--grace-ms`. An eight-user smoke run exercises the same flow.
Scoped matchmaking leases are enabled explicitly in every replica. Pass
`--scoped-locks false` to exercise compatibility mode instead; the report records
the chosen setting.

The harness runs API replicas in production mode with synthetic credentials.
It starts a private Mongo replica set, Redis and API processes on
ephemeral loopback ports. It copies `server/src` into an immutable temporary
snapshot so every API process runs the same code. It records the source hash,
commit, dirty production filenames, dependency/runtime environment and log
directory. It does not load `.env`, use existing services, change infrastructure,
send outside messages, or connect to a media provider. Cleanup stops only its
own child processes. Temporary data and logs remain available for review.

Synthetic adult accounts and JWTs are seeded in the private database. This
skips OAuth and the authentication endpoint's shared IP budget. Squad creation,
joins, readiness, video-presence flags, lobby tokens, searches, encounter
acknowledgements and encounter tokens all use the real local HTTP routes.
Readiness/video flags and Agora credentials are simulated; token signing runs
locally. This does not test cameras, media delivery, Agora capacity or cost.

For 200 users, the scenario creates 100 two-person squads, bursts 100 joins and
100 search starts across replicas, and waits for all 50 pairs without manually
requeueing anyone. It then verifies:

- No self-match or squad in two live encounters; durable squad pointers agree.
- Duplicate acknowledgements keep the same active calls.
- Token identity and its remote UID allow-list contain only the call's roster;
  outsiders receive an authorization failure.
- Call-wide chat reaches exactly four members across replicas. Private squad
  chat reaches its two members and no opponent or unrelated call.
- All sockets disconnect and reconnect onto different API processes, then
  rejoin rooms, acknowledge again, obtain tokens and exchange chat again.
- A replacement tab takes media ownership. The old tab cannot end that source,
  and its later disconnect does not remove the replacement presence or source.
- Calls keep the same IDs and active state beyond the disconnect grace period.

Reports include per-operation median/p95/max latency, counts, expected denials,
first-attempt failures, recovery failures and phase durations. Setup/search/ack
bursts allow at most three recovery rounds with six workers, and every failed
attempt remains visible. `success: true` means final integrity checks passed;
`cleanFirstAttemptRun: true` additionally requires zero unexpected errors.
Expected outsider/stale-owner rejections count separately. A recovered run must
not be described as error-free.

The report is evidence for this local machine and scenario. It does not prove
production capacity, internet latency, provider behavior, billing, browser
rendering, a Redis outage, or failover after an API process crash. The harness
does not restart or kill other agents' processes.

## Results on 14 November 2026

Two independent scoped-mode runs each used 200 synthetic users, 100 two-person
squads and three private API replicas. Both formed exactly 50 calls, drained
the queue, and passed every reconnect, room, token, ownership and grace-period
check. Each run completed 420 socket connections: 200 initial connections,
200 replacements in the reconnect storm, and 20 additional owner takeovers.
There were zero unexpected errors, zero recovery attempts, and no error,
critical or failed lines in the API logs. Expected outsider-token and stale-owner
rejections were counted separately.

| Operation | Run 1 median / p95 / max | Run 2 median / p95 / max |
| --- | ---: | ---: |
| 100 concurrent squad joins | 96.02 / 105.07 / 106.18 ms | 321.38 / 336.02 / 337.23 ms |
| 100 concurrent search requests | 91.79 / 365.51 / 463.91 ms | 82.81 / 334.32 / 446.59 ms |
| 100 initial acknowledgements | 176.37 / 422.16 / 698.52 ms | 124.28 / 395.10 / 500.95 ms |
| All 420 socket connections | 41.06 / 78.19 / 82.33 ms | 48.58 / 81.39 / 85.81 ms |
| 200 call-token requests after reconnect | 14.52 / 26.81 / 30.19 ms | 12.80 / 23.97 / 29.80 ms |

Search HTTP responses all completed in 468.50 / 447.99 ms. The full queues were
matched and drained in 695.35 / 684.96 ms, including the integrity read after
settlement. The reconnect phases took 1,955.65 / 1,947.95 ms, including room
rejoins, media controls, repeat acknowledgements, token checks and chat checks.
Calls retained the same IDs and active state beyond the 32-second disconnect
grace observation.

An independent eight-user compatibility-mode run on three replicas also passed
with zero unexpected errors or retries. Health on every replica reported the
requested lock mode and `services.realtime: connected`; Redis showed all three
adapter request subscriptions.

All three runs used exactly the current production source snapshot:
`ca03e38bb3a98903c541824a3e807d208cfe72dacb4eee690894a0bb8e615198`.
The runtime was Node 24.21.0, MongoDB 8.0.12 and Redis 8.10.3. Full measurements
and assertions are saved in:

- [Scoped run 1](load-tests/2026-11-14-scoped-200-run-1.json)
- [Scoped run 2](load-tests/2026-11-14-scoped-200-run-2.json)
- [Compatibility run](load-tests/2026-11-14-compatibility-8.json)

These are local API/socket results with dummy signed call tokens and simulated
video-presence flags. No live Agora stream or browser media was tested. The
hosted service's replica count was not changed, and these local numbers do not
establish its production capacity.

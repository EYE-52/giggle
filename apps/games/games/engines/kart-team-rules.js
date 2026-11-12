"use strict";
// Authority-only objectives shared by classic and raised kart battles.
// Callers keep movement, weapons, damage and respawns; this module owns teams,
// objective transitions and team results. All times are server milliseconds.
const { PLACE_POINTS, DRAW_POINTS } = require("./kart-standings");
const {
  createRoadTerrain,
} = require("../../public/js/engines/kart-road-terrain.mjs");
const {
  raisedSurfaceHeight,
} = require("../../public/js/engines/kart-raised-support.mjs");
const TEAM_MODES = Object.freeze({
  teambattle: "Team Battle",
  ctf: "Capture the Flag",
});
const TEAM_RULES = Object.freeze({
  pickupRadius: 2.4,
  captureRadius: 2.8,
  heightTolerance: 1.4,
  returnMs: 12000,
  maxEvents: 32,
  maxKOEvents: 16384,
});
const COLOURS = { blue: 0x489fff, coral: 0xff7e8d };
const copy = (value) => structuredClone(value),
  idOf = (k) => (typeof k === "string" ? k : (k?.pid ?? k?.id));
const finite = Number.isFinite,
  dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const validPoint = (p) => p && ["x", "y", "z"].every((k) => finite(p[k]));
// Reorder only the already approved starting grid. Distinct positions and
// authored headings remain unchanged; membership never depends on join order.
function arrangeTeamSpawns(seats, spawns, teamByPlayer, bases) {
  const seatIds = seats.map(idOf);
  const blueBase = bases.find((base) => base.teamId === "blue")?.position;
  const coralBase = bases.find((base) => base.teamId === "coral")?.position;
  if (
    !validPoint(blueBase) ||
    !validPoint(coralBase) ||
    new Set(seatIds).size !== seatIds.length
  ) {
    throw new TypeError("Unique seats and two team bases required");
  }
  const seenPositions = new Set();
  const approvedGrid = spawns.filter((spawn) => {
    if (
      !finite(spawn.x) ||
      !finite(spawn.z) ||
      (spawn.y !== undefined && !finite(spawn.y))
    )
      return false;
    const key = [spawn.x, spawn.y || 0, spawn.z]
      .map((n) => Math.round(n * 10000))
      .join(",");
    if (seenPositions.has(key)) return false;
    seenPositions.add(key);
    return true;
  });
  if (
    approvedGrid.length < seatIds.length ||
    seatIds.some((id) => !["blue", "coral"].includes(teamByPlayer[id]))
  ) {
    throw new RangeError("One approved unique spawn per team seat required");
  }
  const distanceTo = (spawn, base) =>
    Math.hypot(spawn.x - base.x, spawn.z - base.z) +
    Math.abs((spawn.y || 0) - base.y) * 2;
  const rows = approvedGrid.map((spawn, index) => ({
    spawn,
    index,
    affinity: distanceTo(spawn, blueBase) - distanceTo(spawn, coralBase),
  }));
  const blueSeats = seatIds.filter((id) => teamByPlayer[id] === "blue").sort();
  const coralSeats = seatIds
    .filter((id) => teamByPlayer[id] === "coral")
    .sort();
  const awayFromBases = (row) =>
    bases.every(
      (base) =>
        Math.abs((row.spawn.y || 0) - base.position.y) >= 2.5 ||
        dist(row.spawn, base.position) >= 5.2,
    );
  const separated = (left, right) =>
    Math.abs((left.spawn.y || 0) - (right.spawn.y || 0)) >= 2.5 ||
    dist(left.spawn, right.spawn) >= 4.6 - 1e-5;
  const byAffinity = (list) =>
    [...list].sort(
      (left, right) =>
        left.affinity - right.affinity || left.index - right.index,
    );
  const original = byAffinity(rows.slice(0, seatIds.length));
  const originalBalanced = original.every((row, index) =>
    index < blueSeats.length ? row.affinity <= 1e-5 : row.affinity >= -1e-5,
  );
  let chosen;
  if (
    originalBalanced &&
    original.every(awayFromBases) &&
    original.every((row, index) =>
      original.slice(0, index).every((other) => separated(row, other)),
    )
  ) {
    chosen = original;
  } else {
    const selected = [];
    const quotas = { blue: blueSeats.length, coral: coralSeats.length };
    const selectedByTeam = { blue: [], coral: [] };
    // Alternate quotas so one side cannot consume every useful bay first.
    let capacityFallback = false;
    selection: while (selected.length < seatIds.length) {
      for (const teamId of ["blue", "coral"]) {
        if (selectedByTeam[teamId].length >= quotas[teamId]) continue;
        const direction = teamId === "blue" ? 1 : -1;
        const candidates = rows
          .filter(
            (row) =>
              !selected.includes(row) &&
              awayFromBases(row) &&
              selected.every((other) => separated(row, other)),
          )
          .sort(
            (left, right) =>
              direction * (left.affinity - right.affinity) ||
              left.index - right.index,
          );
        const pick = candidates[0];
        if (!pick) {
          // The caller already proved this original grid physically legal.
          // A stricter presentation preference must not reduce map capacity.
          capacityFallback = true;
          break selection;
        }
        selected.push(pick);
        selectedByTeam[teamId].push(pick);
      }
    }
    chosen = capacityFallback
      ? original
      : [...selectedByTeam.blue, ...selectedByTeam.coral];
  }
  const assignments = new Map();
  blueSeats.forEach((id, index) => assignments.set(id, chosen[index].spawn));
  coralSeats.forEach((id, index) =>
    assignments.set(id, chosen[blueSeats.length + index].spawn),
  );
  return seatIds.map((id) => copy(assignments.get(id)));
}

function createTeamRules(options = {}) {
  const mode = Object.keys(TEAM_MODES).find(
    (k) => options.mode === k || options.mode === TEAM_MODES[k],
  );
  if (!mode) throw new TypeError("Team Battle or Capture the Flag required");
  const ids = (options.seats || []).map(idOf).sort();
  if (
    ids.length < 2 ||
    ids.length > 32 ||
    ids.some((id) => typeof id !== "string" || !id || id.length > 64) ||
    new Set(ids).size !== ids.length
  )
    throw new TypeError("2..32 unique seats required");
  const startAt = options.startAt ?? 0,
    roundMs = options.roundMs ?? 90000,
    target = options.targetScore ?? (mode === "ctf" ? 3 : 15);
  if (
    !finite(startAt) ||
    startAt < 0 ||
    !finite(roundMs) ||
    roundMs < 1000 ||
    roundMs > 900000 ||
    !Number.isInteger(target) ||
    target < 1 ||
    target > (mode === "ctf" ? 10 : 100)
  )
    throw new RangeError("Invalid team round timing or target");
  const deadline = startAt + roundMs,
    map = options.map || {},
    teamByPlayer = Object.fromEntries(
      ids.map((id, i) => [id, i % 2 ? "coral" : "blue"]),
    );
  const teams = ["blue", "coral"].map((id) => ({
    id,
    label: id === "blue" ? "Blue" : "Coral",
    color: COLOURS[id],
    score: 0,
    members: ids.filter((pid) => teamByPlayer[pid] === id),
  }));
  const team = (id) => teams.find((t) => t.id === id),
    terrain = !map.colliders
      ? createRoadTerrain({ ...map, id: map.id || map.theme })
      : null;
  const groundAt = options.groundAt || ((x, z) => terrain?.heightAt(x, z) ?? 0);
  const surfaces = (map.colliders || []).filter(
    (d) =>
      d.shape === "deck" ||
      d.shape === "wedge" ||
      d.id?.startsWith("floor") ||
      d.material === "ice",
  );
  const solids = (map.colliders || []).flatMap((d) => d.parts || [d]);
  function support(p) {
    if (options.supportAt)
      return options.supportAt({ x: p.x, y: p.y + 0.5, z: p.z }, 1.1);
    if (!map.colliders)
      return {
        point: { x: p.x, y: groundAt(p.x, p.z), z: p.z },
        normal: { y: 1 },
        surfaceId: "ground",
      };
    let best = null;
    for (const d of surfaces) {
      const y = raisedSurfaceHeight(d, p.x, p.z);
      if (y > p.y + 0.55 || y < p.y - 0.7 || !finite(y)) continue;
      if (!best || y > best.point.y)
        best = {
          point: { x: p.x, y, z: p.z },
          normal: {
            y: d.shape === "wedge" ? 1 / Math.hypot(1, d.half.y / d.half.z) : 1,
          },
          surfaceId: d.id,
        };
    }
    return best;
  }
  function safe(p) {
    if (
      !validPoint(p) ||
      Math.abs(p.x) > (map.half || 500) - 2 ||
      Math.abs(p.z) > (map.half || 500) - 2
    )
      return false;
    const featureBodies = [
      ...(map.features?.cannons || []),
      ...(map.features?.portals || []).flat(),
    ];
    if (
      featureBodies.some(
        (feature) =>
          finite(feature.x) &&
          finite(feature.z) &&
          Math.abs((feature.y || 0) - p.y) < 3 &&
          dist(feature, p) < 6,
      )
    )
      return false;
    const falls = map.fallZones || map.features?.falls || [];
    if (
      falls.some(
        (f) =>
          Math.abs(p.x - f.x) < (f.halfX ?? f.hw ?? 0) + 1.4 &&
          Math.abs(p.z - f.z) < (f.halfZ ?? f.hd ?? 0) + 1.4,
      )
    )
      return false;
    for (const [x, z] of [
      [0, 0],
      [-1.4, -1.4],
      [-1.4, 1.4],
      [1.4, -1.4],
      [1.4, 1.4],
    ]) {
      const h = support({ ...p, x: p.x + x, z: p.z + z });
      if (!h || h.normal?.y < 0.65 || Math.abs(h.point.y - p.y) > 0.18)
        return false;
    }
    if (options.clearAt && !options.clearAt(p)) return false;
    if (!map.colliders)
      return ![...(map.blocks || []), ...(map.barriers || [])].some(
        (d) =>
          Math.abs(p.x - d.x) < d.hw + 1.8 && Math.abs(p.z - d.z) < d.hd + 1.8,
      );
    return !solids.some((d) => {
      if (
        !d.half ||
        d.position.y + d.half.y <= p.y + 0.18 ||
        d.position.y - d.half.y >= p.y + 2.2
      )
        return false;
      const a = 2 * Math.atan2(d.rotation?.y || 0, d.rotation?.w ?? 1),
        dx = p.x - d.position.x,
        dz = p.z - d.position.z;
      return (
        Math.abs(Math.cos(a) * dx - Math.sin(a) * dz) < d.half.x + 1.6 &&
        Math.abs(Math.sin(a) * dx + Math.cos(a) * dz) < d.half.z + 1.6
      );
    });
  }
  function connected(a, b) {
    if (options.reachable) return options.reachable(a, b) === true;
    const atlas = map.travelAtlas,
      n = atlas?.ids?.length,
      ai = atlas?.ids?.indexOf(a.sourceId),
      bi = atlas?.ids?.indexOf(b.sourceId);
    if (n && ai >= 0 && bi >= 0)
      return (
        atlas.distances[ai * n + bi] !== 65535 &&
        atlas.distances[bi * n + ai] !== 65535
      );
    // Legacy maps expose ordinary routes by support surface; launch maps use
    // level IDs. Merge coplanar floor pieces into their common storey.
    const level = (p) =>
      map.levels?.find((l) => Math.abs(l.y - p.y) < 0.25)?.id ||
      String(Math.round(p.y * 100));
    const surfaceLevel = (id) => {
      const d = surfaces.find((s) => s.id === id);
      return d
        ? level({ y: d.position.y + d.half.y })
        : map.levels?.some((l) => l.id === id)
          ? id
          : null;
    };
    const from = level(a),
      to = level(b);
    if (from === to) return true;
    const graph = new Map(),
      edge = (x, y) => {
        if (x && y) {
          if (!graph.has(x)) graph.set(x, new Set());
          graph.get(x).add(y);
        }
      };
    for (const r of map.routes || [])
      if (!r.kind || r.kind === "drive") {
        const x = surfaceLevel(r.from),
          y = surfaceLevel(r.to);
        edge(x, y);
        if (r.bidirectional !== false) edge(y, x);
      }
    const reach = (x, y) => {
      const seen = new Set(),
        queue = [x];
      for (const v of queue) {
        if (v === y) return true;
        if (seen.has(v)) continue;
        seen.add(v);
        queue.push(...(graph.get(v) || []));
      }
      return false;
    };
    return reach(from, to) && reach(to, from);
  }
  function deriveBases() {
    const authoredStarts = map.spawnCandidates?.length
      ? map.spawnCandidates
      : map.spawns || [];
    const occupiedStarts = [
      ...(options.occupiedSpawns || map.spawns || []),
      ...(options.seats || []),
    ]
      .map((seat) => ({
        x: seat.x,
        y: finite(seat.y) ? seat.y : groundAt(seat.x, seat.z),
        z: seat.z,
      }))
      .filter(validPoint);
    const anchors = authoredStarts
      .map((start, index) => ({
        x: start.x,
        y: finite(start.y) ? start.y : groundAt(start.x, start.z),
        z: start.z,
        angle: start.angle || 0,
        sourceId: start.id || "spawn-" + index,
        surfaceId: start.surface || null,
      }))
      .map((point) => {
        const hit = support(point);
        return hit && Math.abs(hit.point.y - point.y) <= 0.18
          ? {
              ...point,
              y: hit.point.y,
              surfaceId: point.surfaceId || hit.surfaceId,
            }
          : point;
      })
      .filter(safe)
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId));

    function approachClear(anchor, destination) {
      const steps = Math.ceil(dist(anchor, destination));
      for (let index = 1; index <= steps; index++) {
        const fraction = index / steps;
        const point = {
          x: anchor.x + (destination.x - anchor.x) * fraction,
          y: anchor.y + (destination.y - anchor.y) * fraction,
          z: anchor.z + (destination.z - anchor.z) * fraction,
        };
        if (!safe(point)) return false;
      }
      return true;
    }
    function besideStart(anchor) {
      // Leave a complete parked kart and a turning lane beside the objective.
      // Search only a short, supported walk from an existing reachable bay.
      for (const radius of [6, 9, 12]) {
        for (const turn of [
          0,
          Math.PI / 2,
          -Math.PI / 2,
          Math.PI,
          Math.PI / 4,
          -Math.PI / 4,
          (3 * Math.PI) / 4,
          (-3 * Math.PI) / 4,
        ]) {
          const angle = anchor.angle + turn;
          const point = {
            ...anchor,
            x: anchor.x + Math.sin(angle) * radius,
            z: anchor.z + Math.cos(angle) * radius,
          };
          const hit = support(point);
          if (!hit || Math.abs(hit.point.y - anchor.y) > 0.18) continue;
          point.y = hit.point.y;
          point.surfaceId = hit.surfaceId || point.surfaceId;
          if (
            occupiedStarts.some(
              (start) =>
                Math.abs(start.y - point.y) < 2.5 && dist(start, point) < 5.2,
            )
          )
            continue;
          if (safe(point) && approachClear(anchor, point))
            return {
              ...point,
              anchorPosition: { x: anchor.x, y: anchor.y, z: anchor.z },
            };
        }
      }
      return null;
    }
    const candidates = anchors.map(besideStart).filter(Boolean);
    let selectedPair = null;
    let bestSeparation = -Infinity;
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex++) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < candidates.length;
        secondIndex++
      ) {
        const first = candidates[firstIndex];
        const second = candidates[secondIndex];
        if (dist(first, second) < 8 || !connected(first, second)) continue;
        const separation =
          dist(first, second) -
          Math.abs(first.y - second.y) * 3 -
          (Math.abs(first.y) + Math.abs(second.y)) * 0.5;
        if (separation > bestSeparation) {
          bestSeparation = separation;
          selectedPair = [first, second];
        }
      }
    }
    if (!selectedPair)
      throw new Error(
        "Capture the Flag requires two supported reachable clear base bays",
      );
    return selectedPair.map((point, index) => ({
      id: "base-" + teams[index].id,
      teamId: teams[index].id,
      position: { x: point.x, y: point.y, z: point.z },
      surfaceId: point.surfaceId,
      anchorId: point.sourceId,
      anchorPosition: point.anchorPosition,
    }));
  }

  const bases = mode === "ctf" ? deriveBases() : [],
    flags = bases.map((b) => ({
      id: "flag-" + b.teamId,
      teamId: b.teamId,
      state: "home",
      position: copy(b.position),
      home: copy(b.position),
      carrierId: null,
      returnAt: null,
    }));
  const roster = new Map(
      ids.map((pid) => [pid, { pid, out: false, connected: true }]),
    ),
    lastSafe = new Map(),
    lastProbe = new Map(),
    pickupArmed = new Map(),
    capturesByPlayer = Object.fromEntries(ids.map((id) => [id, 0])),
    koEvents = new Set(),
    events = [];
  let clock = startAt,
    observedAt = -Infinity,
    eventSeq = 0,
    final = null;
  function emit(type, pid, flag, extra = {}) {
    events.push({
      id: "objective-" + ++eventSeq,
      type,
      pid,
      flagId: flag?.id ?? null,
      teamId: flag?.teamId ?? teamByPlayer[pid] ?? null,
      at: clock,
      ...extra,
    });
    if (events.length > TEAM_RULES.maxEvents) events.shift();
  }
  function canDamage(attackerId, victimId) {
    return (
      attackerId !== victimId &&
      Object.hasOwn(teamByPlayer, attackerId) &&
      Object.hasOwn(teamByPlayer, victimId) &&
      teamByPlayer[attackerId] !== teamByPlayer[victimId]
    );
  }
  function home(flag, type, pid) {
    flag.state = "home";
    flag.position = copy(flag.home);
    flag.carrierId = null;
    flag.returnAt = null;
    emit(type, pid, flag);
  }
  function drop(pid, reason) {
    for (const flag of flags)
      if (flag.carrierId === pid) {
        flag.state = "dropped";
        flag.carrierId = null;
        flag.position = copy(lastSafe.get(pid) || flag.home);
        flag.returnAt = clock + TEAM_RULES.returnMs;
        emit("flag_drop", pid, flag, { reason });
      }
  }
  function position(k) {
    const p = k?.pose?.position || k?.physicalPose?.position;
    if (p) return validPoint(p) ? { x: p.x, y: p.y - 0.65, z: p.z } : null;
    return finite(k?.x) && finite(k?.z)
      ? { x: k.x, y: finite(k.y) ? k.y : groundAt(k.x, k.z), z: k.z }
      : null;
  }
  const live = (k) =>
    k &&
    k.connected !== false &&
    k.out !== true &&
    k.alive !== false &&
    !(k.respawn > 0) &&
    !(k.health <= 0);
  const near = (p, q, r) =>
    validPoint(p) &&
    dist(p, q) <= r &&
    Math.abs(p.y - q.y) <= TEAM_RULES.heightTolerance;
  function result() {
    return final ? copy(final) : null;
  }
  function finish(now = clock, reason = "deadline") {
    if (final) return result();
    if (!finite(now)) throw new TypeError("Authority time required");
    clock = Math.max(clock, now);
    const internalReason =
      { timeout: "deadline", goal: "target", "players-left": "abandonment" }[
        reason
      ] || reason;
    const activeTeams = teams.filter((team) =>
      team.members.some((playerId) => !roster.get(playerId).out),
    );
    const winningScore = Math.max(...activeTeams.map((team) => team.score));
    const winningTeams = activeTeams
      .filter((team) => team.score === winningScore)
      .map((team) => team.id);
    const draw =
      activeTeams.length > 1 && winningTeams.length === activeTeams.length;
    const sortedTeams = [...teams].sort(
      (left, right) =>
        Number(activeTeams.includes(right)) -
          Number(activeTeams.includes(left)) || right.score - left.score,
    );
    const teamStandings = [];
    for (const [index, team] of sortedTeams.entries()) {
      const previous = teamStandings[index - 1];
      const out = !activeTeams.includes(team);
      const samePlace =
        previous && previous.score === team.score && previous.out === out;
      teamStandings.push({
        ...copy(team),
        out,
        rank: samePlace ? previous.rank : index + 1,
      });
    }
    const standings = ids
      .map((playerId) => {
        const teamResult = teamStandings.find(
          (team) => team.id === teamByPlayer[playerId],
        );
        const out = roster.get(playerId).out;
        return {
          pid: playerId,
          score: teamResult.score,
          out,
          rank: out ? teams.length + 1 : teamResult.rank,
          points: out
            ? 0
            : draw
              ? DRAW_POINTS
              : PLACE_POINTS[teamResult.rank - 1] || 0,
          captures: capturesByPlayer[playerId],
        };
      })
      .sort(
        (left, right) =>
          Number(left.out) - Number(right.out) ||
          left.rank - right.rank ||
          left.pid.localeCompare(right.pid),
      );
    const winners = standings
      .filter((row) => !row.out && winningTeams.includes(teamByPlayer[row.pid]))
      .map((row) => row.pid);
    final = {
      standings,
      winners,
      winner: winners.length === 1 ? winners[0] : null,
      draw,
      winningTeams,
      teamStandings,
      tie: draw,
      awards: Object.fromEntries(standings.map((row) => [row.pid, row.points])),
      scores: Object.fromEntries(
        ids.map((playerId) => [playerId, team(teamByPlayer[playerId]).score]),
      ),
      teamScores: Object.fromEntries(
        teams.map((team) => [team.id, team.score]),
      ),
      endReason:
        { deadline: "timeout", target: "goal", abandonment: "players-left" }[
          internalReason
        ] || internalReason,
      reason: internalReason,
      endedAt: internalReason === "deadline" ? deadline : clock,
    };
    for (const flag of flags) {
      if (flag.carrierId) home(flag, "flag_return", flag.carrierId);
    }
    return result();
  }
  function targetReached() {
    if (
      options.winRule !== "Time limit" &&
      teams.some((t) => t.score >= target)
    )
      finish(clock, "target");
  }
  function scoreKO(killerId, victimId, eventId, now = clock) {
    if (
      final ||
      !finite(now) ||
      now < startAt ||
      now >= deadline ||
      now < clock ||
      !Object.hasOwn(teamByPlayer, victimId) ||
      typeof eventId !== "string" ||
      !eventId ||
      eventId.length > 180 ||
      koEvents.has(eventId) ||
      koEvents.size >= TEAM_RULES.maxKOEvents
    )
      return false;
    if (killerId != null && !canDamage(killerId, victimId)) return false;
    clock = now;
    koEvents.add(eventId);
    drop(victimId, "ko");
    if (mode === "teambattle" && killerId != null) {
      team(teamByPlayer[killerId]).score++;
      emit("team_ko", killerId, null, {
        victimId,
        teamId: teamByPlayer[killerId],
      });
      targetReached();
    }
    return true;
  }
  function observePlayer(playerId, kart) {
    const groundPosition = position(kart);
    const life = kart.spawnSeq ?? kart.life ?? 0;
    const previousArming = pickupArmed.get(playerId);
    if (!previousArming || previousArming.life !== life) {
      pickupArmed.set(playerId, { life, armed: false });
    }
    const enemyFlag = flags.find(
      (flag) => flag.teamId !== teamByPlayer[playerId],
    );
    const enemyPickupPoint =
      enemyFlag.state === "carried" ? enemyFlag.home : enemyFlag.position;
    if (
      live(kart) &&
      groundPosition &&
      !near(groundPosition, enemyPickupPoint, TEAM_RULES.pickupRadius + 0.2)
    ) {
      pickupArmed.get(playerId).armed = true;
    }
    if (!flags.some((flag) => flag.carrierId === playerId)) return;
    const belowArena =
      groundPosition &&
      groundPosition.y < Math.min(...bases.map((base) => base.position.y)) - 4;
    const outsideArena =
      groundPosition &&
      (Math.abs(groundPosition.x) > (map.half || 500) + 5 ||
        Math.abs(groundPosition.z) > (map.half || 500) + 5);
    if (!live(kart) || !groundPosition || belowArena || outsideArena) {
      drop(
        playerId,
        kart.out ? "left" : kart.connected === false ? "disconnect" : "ko",
      );
      return;
    }
    // Only a moved carrier needs drop-support work. Idle karts, spectators
    // and ordinary team battles perform no per-frame support raycasts.
    const previousProbe = lastProbe.get(playerId);
    if (
      previousProbe &&
      dist(previousProbe, groundPosition) <= 0.6 &&
      Math.abs(previousProbe.y - groundPosition.y) <= 0.25
    )
      return;
    lastProbe.set(playerId, { ...groundPosition });
    const hit = support(groundPosition);
    const grounded = kart.pose?.grounded !== false;
    if (
      hit &&
      hit.normal?.y >= 0.65 &&
      Math.abs(hit.point.y - groundPosition.y) < 1 &&
      grounded &&
      safeDrop(hit.point)
    ) {
      lastSafe.set(playerId, { ...hit.point });
    }
  }

  function updateFlag(flag) {
    if (flag.state === "carried") {
      const carrierPosition = position(roster.get(flag.carrierId));
      if (carrierPosition)
        flag.position = { ...carrierPosition, y: carrierPosition.y + 2 };
      return;
    }
    if (flag.state === "dropped" && clock >= flag.returnAt) {
      home(flag, "flag_return", null);
      return;
    }
    const touchingPlayers = ids.filter(
      (playerId) =>
        live(roster.get(playerId)) &&
        near(
          position(roster.get(playerId)),
          flag.position,
          TEAM_RULES.pickupRadius,
        ),
    );
    // A defender returning a loose flag wins a simultaneous touch; nobody
    // can steal it again until a later authority update.
    const defenderId =
      flag.state === "dropped" &&
      touchingPlayers.find(
        (playerId) => teamByPlayer[playerId] === flag.teamId,
      );
    if (defenderId) {
      home(flag, "flag_return", defenderId);
      return;
    }
    const thiefId = touchingPlayers.find(
      (playerId) =>
        teamByPlayer[playerId] !== flag.teamId &&
        pickupArmed.get(playerId)?.armed &&
        !flags.some((other) => other.carrierId === playerId),
    );
    if (!thiefId) return;
    lastSafe.set(thiefId, { ...flag.position });
    lastProbe.delete(thiefId);
    flag.state = "carried";
    flag.carrierId = thiefId;
    flag.returnAt = null;
    const carrierPosition = position(roster.get(thiefId));
    flag.position = { ...carrierPosition, y: carrierPosition.y + 2 };
    emit("flag_pickup", thiefId, flag);
  }

  function captureAtHome(flag) {
    if (!flag.carrierId) return;
    const playerId = flag.carrierId;
    const ownTeamId = teamByPlayer[playerId];
    const ownFlag = flags.find((other) => other.teamId === ownTeamId);
    const ownBase = bases.find((base) => base.teamId === ownTeamId);
    if (
      ownFlag.state !== "home" ||
      !near(
        position(roster.get(playerId)),
        ownBase.position,
        TEAM_RULES.captureRadius,
      )
    )
      return;
    team(ownTeamId).score++;
    capturesByPlayer[playerId]++;
    home(flag, "flag_score", playerId);
    events.at(-1).teamId = ownTeamId;
    targetReached();
  }

  function update(now, karts) {
    if (final) return result();
    if (!finite(now) || now < 0) throw new TypeError("Authority time required");
    if (now < observedAt) return null;
    observedAt = now;
    const incoming = new Map(
      (Array.isArray(karts) ? karts : [...(karts?.values?.() || [])]).map(
        (kart) => [idOf(kart), kart],
      ),
    );
    for (const playerId of ids) {
      const state = roster.get(playerId);
      const kart = incoming.get(playerId);
      if (!kart) {
        state.connected = false;
        continue;
      }
      // Keep only objective inputs, not input queues, weapon payloads or
      // a deep copy of a physics kart. Public snapshots clone on demand.
      state.connected = kart.connected !== false;
      state.out ||= kart.out === true;
      state.alive = kart.alive;
      state.respawn = kart.respawn;
      state.health = kart.health;
      state.spawnSeq = kart.spawnSeq ?? kart.life ?? 0;
      state.pose = kart.pose || kart.physicalPose;
      state.x = kart.x;
      state.y = kart.y;
      state.z = kart.z;
    }
    const abandonedTeam = teams.some((team) =>
      team.members.every((playerId) => roster.get(playerId).out),
    );
    if (abandonedTeam) {
      if (now < startAt) clock = now;
      return finish(now, "abandonment");
    }
    if (now < startAt || now < clock) return null;
    clock = now;
    if (now >= deadline) return finish(now, "deadline");
    if (mode !== "ctf") {
      targetReached();
      return result();
    }
    for (const playerId of ids) observePlayer(playerId, roster.get(playerId));
    for (const flag of flags) updateFlag(flag);
    for (const flag of flags) {
      captureAtHome(flag);
      if (final) break;
    }
    return result();
  }
  function safeDrop(p) {
    return (
      validPoint(p) &&
      Math.abs(p.x) < (map.half || 500) - 1 &&
      Math.abs(p.z) < (map.half || 500) - 1 &&
      !(map.fallZones || map.features?.falls || []).some(
        (f) =>
          Math.abs(p.x - f.x) < (f.halfX ?? f.hw ?? 0) + 0.5 &&
          Math.abs(p.z - f.z) < (f.halfZ ?? f.hd ?? 0) + 0.5,
      )
    );
  }
  function snapshot() {
    return {
      teamMode: mode,
      teamByPlayer: copy(teamByPlayer),
      capturesByPlayer: copy(capturesByPlayer),
      teams: copy(teams),
      bases: copy(bases),
      flags: copy(flags),
      teamResult: result(),
      objectiveEvents: copy(events),
    };
  }
  return Object.freeze({
    canDamage,
    scoreKO,
    update,
    finish,
    snapshot,
    result,
    done: () => final !== null,
  });
}
module.exports = { TEAM_MODES, TEAM_RULES, createTeamRules, arrangeTeamSpawns };

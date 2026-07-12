const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("api exposes squad-id join for public previews without squad codes", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.equal(api.includes("joinSquadById"), true);
  assert.equal(api.includes("`/api/squads/${squadId}/join`"), true);
});

test("squad creation can request initial visibility atomically", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.equal(api.includes('createSquad: (body: { squadName?: string; displayName?: string; tags?: string[]; visibility?: "private" | "open" })'), true);
});

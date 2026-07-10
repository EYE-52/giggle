const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("api exposes squad-id join for public previews without squad codes", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.equal(api.includes("joinSquadById"), true);
  assert.equal(api.includes("`/api/squads/${squadId}/join`"), true);
});

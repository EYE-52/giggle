const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("api exposes squad-id join for public previews without squad codes", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.equal(api.includes("joinSquadById"), true);
  assert.equal(api.includes("`/api/squads/${squadId}/join`"), true);
});

test("api exposes typed age verification session and status wrappers", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.match(api, /export type AgeVerificationStatus/);
  assert.match(api, /startAgeVerification:\s*\(\)\s*=>\s*\n?\s*backendRequest<AgeVerificationResult>\("\/api\/me\/age\/verification-session", \{ method: "POST" \}\)/);
  assert.match(api, /getAgeVerificationStatus:\s*\(\)\s*=>\s*\n?\s*backendRequest<AgeVerificationResult>\("\/api\/me\/age\/verification-status"\)/);
});

test("api exposes typed block, unblock, and blocked-account wrappers", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.match(api, /export interface BlockedAccount/);
  assert.match(api, /blockUsers:\s*\(userIds: string\[\]\).*"\/api\/users\/block"/s);
  assert.match(api, /unblockUser:\s*\(userId: string\).*`\/api\/users\/\$\{userId\}\/block`/s);
  assert.match(api, /listBlockedUsers:\s*\(\).*"\/api\/me\/blocks"/s);
});

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

test("api exposes typed account export and deletion wrappers", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.match(api, /export interface AccountExport/);
  assert.match(api, /exportAccount:\s*\(\).*backendRequest<AccountExport>\("\/api\/me\/export"\)/s);
  assert.match(api, /deleteAccount:\s*\(\).*backendRequest<\{ status: "deleted" \| "pending" \}>\("\/api\/me\/account", \{ method: "DELETE" \}\)/s);
});

test("api exposes typed squad game ticket wrapper and games flag", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.match(api, /export interface GameTicket/);
  assert.match(api, /gameUrl: string;/);
  assert.match(api, /ticket: string;/);
  assert.match(api, /gameToken:\s*\(squadId: string\).*backendRequest<GameTicket>\(`\/api\/squads\/\$\{squadId\}\/games\/token`, \{ method: "POST" \}\)/s);
  assert.match(api, /getFeatures:\s*\(\)\s*=>\s*\n?\s*backendRequest<\{ strangerDiscovery: boolean; games\?: boolean \}>\("\/api\/features"\)/);
});

test("api exposes typed encounter game ticket wrapper for the shared room", () => {
  const api = readFileSync(path.join(__dirname, "../src/api.ts"), "utf8");

  assert.match(api, /export interface EncounterGameTicket/);
  assert.match(api, /encounterId: string;/);
  assert.match(api, /encounterGameToken:\s*\(encounterId: string\).*backendRequest<EncounterGameTicket>\(`\/api\/encounters\/\$\{encounterId\}\/games\/token`, \{ method: "POST" \}\)/s);
});

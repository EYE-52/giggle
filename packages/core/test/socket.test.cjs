const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("createReportOpponentPayload reports squad B when requester is squad A", async () => {
  const { createReportOpponentPayload } = await import("../src/report.ts");

  assert.deepEqual(
    createReportOpponentPayload({
      encounterId: "enc_1",
      squadId: "sq_a",
      encounter: { squadAId: "sq_a", squadBId: "sq_b" },
    }),
    { encounterId: "enc_1", squadId: "sq_a", reportedSquadId: "sq_b" }
  );
});

test("createReportOpponentPayload reports squad A when requester is squad B", async () => {
  const { createReportOpponentPayload } = await import("../src/report.ts");

  assert.deepEqual(
    createReportOpponentPayload({
      encounterId: "enc_1",
      squadId: "sq_b",
      encounter: { squadAId: "sq_a", squadBId: "sq_b" },
    }),
    { encounterId: "enc_1", squadId: "sq_b", reportedSquadId: "sq_a" }
  );
});

test("createReportOpponentPayload returns null for missing or unrelated squads", async () => {
  const { createReportOpponentPayload } = await import("../src/report.ts");

  assert.equal(createReportOpponentPayload({ encounterId: "enc_1", squadId: "sq_x", encounter: { squadAId: "sq_a", squadBId: "sq_b" } }), null);
  assert.equal(createReportOpponentPayload({ encounterId: "", squadId: "sq_a", encounter: { squadAId: "sq_a", squadBId: "sq_b" } }), null);
});

test("signOut disconnects the authenticated realtime socket", () => {
  const sessionSource = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");

  assert.equal(sessionSource.includes('import { disconnectSocket } from "./socket";'), true);
  assert.match(sessionSource, /signOut\(\)\s*{[\s\S]*disconnectSocket\(\);/);
});

test("OAuth callback tokens must be decoded and validated before persistence", () => {
  const sessionSource = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");
  const oauthSetter = sessionSource.slice(
    sessionSource.indexOf("setTokenFromOAuth(jwtToken: string)"),
    sessionSource.indexOf("  signOut()")
  );

  assert.equal(sessionSource.includes("function decodeJwtPayload"), true);
  assert.match(sessionSource, /if \(!jwtToken \|\| typeof jwtToken !== "string"\) throw new Error\("INVALID_AUTH_TOKEN"\);/);
  assert.match(sessionSource, /if \(!payload\.email \|\| \!\(payload\.userId \|\| payload\.sub\)\) throw new Error\("INVALID_AUTH_TOKEN"\);/);
  assert.match(oauthSetter, /const payload = decodeJwtPayload\(jwtToken\);/);
  assert.equal(oauthSetter.includes("catch {}"), false);
});

test("persisted sessions are validated before auth is restored", () => {
  const sessionSource = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");
  const restoreBlock = sessionSource.slice(
    sessionSource.indexOf("function restore()"),
    sessionSource.indexOf("restore();")
  );

  assert.match(restoreBlock, /const restoredPayload = decodeJwtPayload\(parsed\.token\);/);
  assert.match(restoreBlock, /user = normalizeSessionUser\(parsed\.user, restoredPayload\);/);
  assert.match(restoreBlock, /if \(!user\) throw new Error\("INVALID_AUTH_TOKEN"\);/);
  assert.match(restoreBlock, /localStorage\.removeItem\(STORAGE_KEY\);/);
});

test("magic-link sign-in forwards pending referral codes", () => {
  const sessionSource = readFileSync(path.join(__dirname, "../src/session.ts"), "utf8");
  const magicLinkBlock = sessionSource.slice(
    sessionSource.indexOf("startEmailSignIn(email: string)"),
    sessionSource.indexOf("  /** Exchange identity")
  );

  assert.match(magicLinkBlock, /const ref = getPendingReferral\(\);/);
  assert.match(magicLinkBlock, /return api\.startEmailMagicLink\(email, ref\);/);
});

test("chat send reports disconnected socket failures to callers", () => {
  const socketSource = readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8");
  const sendBlock = socketSource.slice(
    socketSource.indexOf("export function sendChatMessage"),
    socketSource.indexOf("/** Subscribe to incoming chat messages.")
  );

  assert.match(sendBlock, /\): boolean \{/);
  assert.match(sendBlock, /if \(!s\.connected\) return false;/);
  assert.match(sendBlock, /return true;/);
  assert.match(sendBlock, /catch \{\s*return false;\s*\}/);
});

test("chat subscriptions preserve encounter ids for scoped filtering", () => {
  const socketSource = readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8");
  const messageTypeBlock = socketSource.slice(
    socketSource.indexOf("export interface ChatMessage"),
    socketSource.indexOf("export type ChatScope")
  );
  const subscribeBlock = socketSource.slice(
    socketSource.indexOf("export function subscribeChat"),
    socketSource.indexOf("// --- Reactions")
  );

  assert.match(messageTypeBlock, /encounterId\?: string;/);
  assert.match(subscribeBlock, /encounterId\?: string;/);
  assert.match(subscribeBlock, /encounterId: raw\.encounterId,/);
});

test("reaction subscriptions preserve encounter ids for scoped filtering", () => {
  const socketSource = readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8");
  const reactionTypeBlock = socketSource.slice(
    socketSource.indexOf("export interface ReactionEvent"),
    socketSource.indexOf("/** Broadcast an emoji reaction")
  );
  const subscribeBlock = socketSource.slice(
    socketSource.indexOf("export function subscribeReaction"),
    socketSource.indexOf("export function reportOpponentSquad")
  );

  assert.match(reactionTypeBlock, /encounterId\?: string;/);
  assert.match(subscribeBlock, /encounterId: raw\.encounterId,/);
});

test("reaction send reports disconnected socket failures to callers", () => {
  const socketSource = readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8");
  const sendBlock = socketSource.slice(
    socketSource.indexOf("export function sendReaction"),
    socketSource.indexOf("/** Subscribe to incoming reactions.")
  );

  assert.match(sendBlock, /\): boolean \{/);
  assert.match(sendBlock, /if \(!s\.connected\) return false;/);
  assert.match(sendBlock, /return true;/);
  assert.match(sendBlock, /catch \{\s*return false;\s*\}/);
});

test("report opponent only reports success when realtime emit can be sent", () => {
  const socketSource = readFileSync(path.join(__dirname, "../src/socket.ts"), "utf8");
  const reportBlock = socketSource.slice(
    socketSource.indexOf("export function reportOpponentSquad"),
    socketSource.indexOf("// --- Notifications")
  );

  assert.match(reportBlock, /const s = connectSocket\(payload\.squadId\);/);
  assert.match(reportBlock, /if \(!s\.connected\) return false;/);
  assert.match(reportBlock, /s\.emit\(SOCKET_EMIT\.REPORT_SQUAD, payload\);/);
});

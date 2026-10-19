const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");

const { rejectQueryOperators, hasOperatorKey } = require("../src/middlewares/rejectQueryOperators");

async function withApp(run) {
  const app = express();
  app.use(express.json());
  app.use(rejectQueryOperators);
  app.all("/echo", (req, res) => res.json({ ok: true, body: req.body, query: req.query }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(base);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const post = (base, body) => fetch(`${base}/echo`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

test("hasOperatorKey finds $ keys at any depth", () => {
  assert.equal(hasOperatorKey({ squadId: { $ne: null } }), true);
  assert.equal(hasOperatorKey({ a: [{ b: { $gt: "" } }] }), true);
  assert.equal(hasOperatorKey({ $where: "1" }), true);
  assert.equal(hasOperatorKey({ squadId: "SQ1", tags: ["$5 deal"], note: "costs $3" }), false);
  assert.equal(hasOperatorKey(null), false);
  assert.equal(hasOperatorKey("text"), false);
});

test("hasOperatorKey treats very deep nesting as unsafe", () => {
  let deep = { leaf: "x" };
  for (let i = 0; i < 30; i += 1) deep = { next: deep };
  assert.equal(hasOperatorKey(deep), true);
});

test("operator keys in the JSON body are rejected with 400", async () => {
  await withApp(async (base) => {
    const res = await post(base, { squadId: { $ne: null }, encounterId: "E1" });
    assert.equal(res.status, 400);
    const json = await res.json();
    assert.equal(json.error.code, "INVALID_REQUEST");
  });
});

test("operator keys in the query string are rejected with 400", async () => {
  await withApp(async (base) => {
    const res = await fetch(`${base}/echo?squadId[$ne]=x`);
    assert.equal(res.status, 400);
  });
});

test("normal requests pass through unchanged", async () => {
  await withApp(async (base) => {
    const res = await post(base, { squadId: "SQ1", text: "Price is $5", list: ["a", "b"] });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.deepEqual(json.body, { squadId: "SQ1", text: "Price is $5", list: ["a", "b"] });

    const getRes = await fetch(`${base}/echo?page=2&q=hello`);
    assert.equal(getRes.status, 200);
  });
});

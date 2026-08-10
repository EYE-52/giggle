const assert = require("node:assert/strict");
const test = require("node:test");

const {
  POLICY_VERSION,
  createAgeVerificationSession,
  getAgeVerificationResult,
} = require("../src/services/yotiAgeService");

const ENV = {
  YOTI_AGE_API_KEY: "server-api-secret",
  YOTI_AGE_SDK_ID: "sdk-id-for-tests-123",
  AGE_VERIFICATION_CALLBACK_URL: "https://giggle.example.com/age-verification",
};
const SESSION_ID = "14010f56-3f04-4f1f-84e7-a43ff723ef86";
const REFERENCE_ID = "7f9779fd-75e3-47c4-8bd4-c3185b59d42c";
const EVIDENCE_ID = "4786ecb7-c10c-4037-9947-aaa6507e7414";

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => body };
}

test("session creation uses the hosted OVER policy and keeps credentials server-side", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return jsonResponse({
      id: SESSION_ID,
      expires_at: "2026-08-04T12:15:00Z",
      status: "PENDING",
    });
  };

  const session = await createAgeVerificationSession({
    referenceId: REFERENCE_ID,
    env: ENV,
    fetchImpl,
  });
  const body = JSON.parse(request.options.body);

  assert.equal(request.url, "https://age.yoti.com/api/v1/sessions");
  assert.equal(request.options.method, "POST");
  assert.deepEqual(request.options.headers, {
    Authorization: "Bearer server-api-secret",
    "Content-Type": "application/json",
    "Yoti-SDK-Id": "sdk-id-for-tests-123",
  });
  assert.deepEqual(body, {
    type: "OVER",
    ttl: 900,
    age_estimation: {
      allowed: true,
      threshold: 21,
      level: "PASSIVE",
      retry_limit: 2,
    },
    digital_id: {
      allowed: true,
      threshold: 18,
      age_estimation_allowed: true,
      age_estimation_threshold: 21,
      retry_limit: 1,
    },
    doc_scan: {
      allowed: true,
      threshold: 18,
      authenticity: "AUTO",
      level: "PASSIVE",
      retry_limit: 1,
    },
    credit_card: { allowed: false, retry_limit: 1 },
    mobile: { allowed: false, retry_limit: 1 },
    reference_id: REFERENCE_ID,
    callback: { auto: true, url: ENV.AGE_VERIFICATION_CALLBACK_URL },
    cancel_url: ENV.AGE_VERIFICATION_CALLBACK_URL,
    retry_enabled: true,
    resume_enabled: true,
    synchronous_checks: true,
  });
  assert.equal(Object.hasOwn(body, "block_biometric_consent"), false);
  assert.equal(session.sessionId, SESSION_ID);
  assert.equal(
    session.url,
    "https://age.yoti.com?sessionId=14010f56-3f04-4f1f-84e7-a43ff723ef86&sdkId=sdk-id-for-tests-123"
  );
  assert.equal(JSON.stringify(session).includes(ENV.YOTI_AGE_API_KEY), false);
});

test("missing or unsafe provider configuration fails closed", async () => {
  for (const missing of Object.keys(ENV)) {
    const env = { ...ENV };
    delete env[missing];
    await assert.rejects(
      createAgeVerificationSession({
        referenceId: REFERENCE_ID,
        env,
        fetchImpl: async () => assert.fail("provider should not be called"),
      }),
      (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
    );
  }

  await assert.rejects(
    createAgeVerificationSession({
      referenceId: REFERENCE_ID,
      env: { ...ENV, AGE_VERIFICATION_CALLBACK_URL: "http://giggle.example.com/age" },
      fetchImpl: async () => assert.fail("provider should not be called"),
    }),
    (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
  );

  await assert.rejects(
    createAgeVerificationSession({
      referenceId: REFERENCE_ID,
      env: { ...ENV, YOTI_AGE_API_KEY: 123 },
      fetchImpl: async () => assert.fail("provider should not be called"),
    }),
    (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
  );
});

test("provider failures, timeouts, and malformed creation responses fail closed", async () => {
  const failures = [
    async () => jsonResponse({ message: "no" }, { ok: false, status: 503 }),
    async () => {
      const error = new Error("timed out");
      error.name = "AbortError";
      throw error;
    },
    async () => jsonResponse({ id: SESSION_ID, status: "COMPLETE" }),
  ];

  for (const fetchImpl of failures) {
    await assert.rejects(
      createAgeVerificationSession({ referenceId: REFERENCE_ID, env: ENV, fetchImpl }),
      (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
    );
  }
});

function completeResult(method, threshold) {
  const methodField = method.toLowerCase();
  return {
    id: SESSION_ID,
    sdk_id: ENV.YOTI_AGE_SDK_ID,
    type: "OVER",
    status: "COMPLETE",
    method,
    reference_id: REFERENCE_ID,
    evidence_id: EVIDENCE_ID,
    age: threshold,
    [methodField]: { allowed: true, threshold },
    selfie: "must-not-escape",
    document: { number: "must-not-escape" },
  };
}

test("result retrieval verifies each configured method and returns only a normalized receipt", async () => {
  for (const [method, threshold] of [
    ["AGE_ESTIMATION", 21],
    ["DIGITAL_ID", 18],
    ["DOC_SCAN", 18],
  ]) {
    let request;
    const result = await getAgeVerificationResult({
      sessionId: SESSION_ID,
      referenceId: REFERENCE_ID,
      env: ENV,
      fetchImpl: async (url, options) => {
        request = { url, options };
        return jsonResponse(completeResult(method, threshold));
      },
    });

    assert.equal(
      request.url,
      `https://age.yoti.com/api/v1/sessions/${SESSION_ID}/result`
    );
    assert.equal(request.options.method, "GET");
    assert.equal(request.options.headers.Authorization, "Bearer server-api-secret");
    assert.equal(request.options.headers["Yoti-SDK-Id"], ENV.YOTI_AGE_SDK_ID);
    assert.deepEqual(result, {
      status: "verified",
      receipt: {
        provider: "yoti",
        sessionId: SESSION_ID,
        evidenceId: EVIDENCE_ID,
        method,
        threshold,
        policyVersion: POLICY_VERSION,
      },
    });
    assert.equal(JSON.stringify(result).includes("must-not-escape"), false);
  }
});

test("pending and terminal failed provider states never verify", async () => {
  for (const providerStatus of ["PENDING", "IN_PROGRESS", "PROCESSING"]) {
    const result = await getAgeVerificationResult({
      sessionId: SESSION_ID,
      referenceId: REFERENCE_ID,
      env: ENV,
      fetchImpl: async () =>
        jsonResponse({
          id: SESSION_ID,
          sdk_id: ENV.YOTI_AGE_SDK_ID,
          type: "OVER",
          status: providerStatus,
          reference_id: REFERENCE_ID,
        }),
    });
    assert.deepEqual(result, { status: "pending" });
  }

  for (const providerStatus of ["FAIL", "ERROR", "CANCELLED", "EXPIRED"]) {
    const result = await getAgeVerificationResult({
      sessionId: SESSION_ID,
      referenceId: REFERENCE_ID,
      env: ENV,
      fetchImpl: async () =>
        jsonResponse({
          id: SESSION_ID,
          sdk_id: ENV.YOTI_AGE_SDK_ID,
          type: "OVER",
          status: providerStatus,
          reference_id: REFERENCE_ID,
        }),
    });
    assert.deepEqual(result, { status: "rejected", reason: providerStatus.toLowerCase() });
  }
});

test("mismatched or incomplete COMPLETE results fail closed", async () => {
  const base = completeResult("DIGITAL_ID", 18);
  const invalidResults = [
    { ...base, id: "another-session" },
    { ...base, reference_id: "another-reference" },
    { ...base, sdk_id: "another-sdk" },
    { ...base, type: "AGE" },
    { ...base, method: "CREDIT_CARD" },
    { ...base, digital_id: { allowed: true, threshold: 21 } },
    { ...base, age: 17 },
    { ...base, evidence_id: "" },
    { ...base, status: "SOMETHING_NEW" },
  ];

  for (const payload of invalidResults) {
    await assert.rejects(
      getAgeVerificationResult({
        sessionId: SESSION_ID,
        referenceId: REFERENCE_ID,
        env: ENV,
        fetchImpl: async () => jsonResponse(payload),
      }),
      (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
    );
  }
});

test("result provider errors and non-JSON responses fail closed", async () => {
  const failures = [
    async () => jsonResponse({}, { ok: false, status: 404 }),
    async () => ({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } }),
    async () => { throw new Error("network down"); },
  ];

  for (const fetchImpl of failures) {
    await assert.rejects(
      getAgeVerificationResult({
        sessionId: SESSION_ID,
        referenceId: REFERENCE_ID,
        env: ENV,
        fetchImpl,
      }),
      (error) => error.code === "AGE_VERIFICATION_UNAVAILABLE"
    );
  }
});

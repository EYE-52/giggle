const YOTI_API = "https://age.yoti.com/api/v1/sessions";
const POLICY_VERSION = "verified-adult-v1";
const SESSION_TTL_SECONDS = 900;
const REQUEST_TIMEOUT_MS = 8000;
const METHOD_THRESHOLDS = {
  AGE_ESTIMATION: 21,
  DIGITAL_ID: 18,
  DOC_SCAN: 18,
};

function unavailable() {
  const error = new Error("Age verification is temporarily unavailable");
  error.code = "AGE_VERIFICATION_UNAVAILABLE";
  return error;
}

function getConfig(env = process.env) {
  const stringValue = (value) => (typeof value === "string" ? value.trim() : "");
  const apiKey = stringValue(env?.YOTI_AGE_API_KEY);
  const sdkId = stringValue(env?.YOTI_AGE_SDK_ID);
  const callbackUrl = stringValue(env?.AGE_VERIFICATION_CALLBACK_URL);

  try {
    if (!apiKey || !sdkId || new URL(callbackUrl).protocol !== "https:") throw unavailable();
  } catch {
    throw unavailable();
  }

  return { apiKey, sdkId, callbackUrl };
}

function buildAgeVerificationUrl(sessionId, env = process.env) {
  const { sdkId } = getConfig(env);
  const query = new URLSearchParams({ sessionId, sdkId });
  return `https://age.yoti.com?${query}`;
}

async function requestJson(url, options, fetchImpl) {
  try {
    if (typeof fetchImpl !== "function") throw unavailable();
    const response = await fetchImpl(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response?.ok) throw unavailable();
    return await response.json();
  } catch {
    throw unavailable();
  }
}

async function createAgeVerificationSession({
  referenceId,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  if (typeof referenceId !== "string" || !referenceId || referenceId.length > 100) {
    throw unavailable();
  }
  const { apiKey, sdkId, callbackUrl } = getConfig(env);
  const payload = {
    type: "OVER",
    ttl: SESSION_TTL_SECONDS,
    age_estimation: {
      allowed: true,
      threshold: METHOD_THRESHOLDS.AGE_ESTIMATION,
      level: "PASSIVE",
      retry_limit: 2,
    },
    digital_id: {
      allowed: true,
      threshold: METHOD_THRESHOLDS.DIGITAL_ID,
      age_estimation_allowed: true,
      age_estimation_threshold: METHOD_THRESHOLDS.AGE_ESTIMATION,
      retry_limit: 1,
    },
    doc_scan: {
      allowed: true,
      threshold: METHOD_THRESHOLDS.DOC_SCAN,
      authenticity: "AUTO",
      level: "PASSIVE",
      retry_limit: 1,
    },
    credit_card: { allowed: false, retry_limit: 1 },
    mobile: { allowed: false, retry_limit: 1 },
    reference_id: referenceId,
    callback: { auto: true, url: callbackUrl },
    cancel_url: callbackUrl,
    retry_enabled: true,
    resume_enabled: true,
    synchronous_checks: true,
  };
  const result = await requestJson(
    YOTI_API,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Yoti-SDK-Id": sdkId,
      },
      body: JSON.stringify(payload),
    },
    fetchImpl
  );

  if (typeof result?.id !== "string" || !result.id || result.status !== "PENDING") {
    throw unavailable();
  }

  return {
    provider: "yoti",
    sessionId: result.id,
    url: buildAgeVerificationUrl(result.id, env),
  };
}

async function getAgeVerificationResult({
  sessionId,
  referenceId,
  env = process.env,
  fetchImpl = globalThis.fetch,
}) {
  if (!sessionId || !referenceId) throw unavailable();
  const { apiKey, sdkId } = getConfig(env);
  const result = await requestJson(
    `${YOTI_API}/${encodeURIComponent(sessionId)}/result`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Yoti-SDK-Id": sdkId,
      },
    },
    fetchImpl
  );

  if (
    result?.id !== sessionId ||
    result?.reference_id !== referenceId ||
    result?.sdk_id !== sdkId ||
    result?.type !== "OVER"
  ) {
    throw unavailable();
  }

  if (["PENDING", "IN_PROGRESS", "PROCESSING"].includes(result.status)) {
    return { status: "pending" };
  }
  if (["FAIL", "ERROR", "CANCELLED", "EXPIRED"].includes(result.status)) {
    return { status: "rejected", reason: result.status.toLowerCase() };
  }
  if (result.status !== "COMPLETE") throw unavailable();

  const threshold = METHOD_THRESHOLDS[result.method];
  const methodConfig = result[result.method?.toLowerCase()];
  if (
    threshold === undefined ||
    methodConfig?.allowed !== true ||
    methodConfig?.threshold !== threshold ||
    result.age !== threshold ||
    typeof result.evidence_id !== "string" ||
    !result.evidence_id
  ) {
    throw unavailable();
  }

  return {
    status: "verified",
    receipt: {
      provider: "yoti",
      sessionId,
      evidenceId: result.evidence_id,
      method: result.method,
      threshold,
      policyVersion: POLICY_VERSION,
    },
  };
}

module.exports = {
  POLICY_VERSION,
  buildAgeVerificationUrl,
  createAgeVerificationSession,
  getAgeVerificationResult,
};

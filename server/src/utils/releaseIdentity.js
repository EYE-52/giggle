// Provider-generated identifiers only; no credentials or database details.
function releaseIdentity(env = process.env) {
  return {
    sourceCommit: /^[0-9a-f]{40}$/.test(env.RAILWAY_GIT_COMMIT_SHA || '') ? env.RAILWAY_GIT_COMMIT_SHA : null,
    deploymentId: /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(env.RAILWAY_DEPLOYMENT_ID || '') ? env.RAILWAY_DEPLOYMENT_ID : null,
  };
}
module.exports = { releaseIdentity };

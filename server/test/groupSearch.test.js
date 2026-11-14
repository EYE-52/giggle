const test = require("node:test"),
  assert = require("node:assert/strict");
const { directoryQuery } = require("../src/utils/groupSettingsValidation");
test("group search is bounded, literal and restricted to public group metadata", () => {
  const result = directoryQuery({
    search: "a.*(b)",
    communicationMode: "voice",
    publicTopic: "games",
    language: "en",
  });
  assert(!result.error);
  assert.deepEqual(
    result.query.$or.map((row) => Object.keys(row)[0]),
    ["squadName", "description", "tags"],
  );
  assert.equal(result.query.$or[0].squadName.$regex, "a\\.\\*\\(b\\)");
  assert.equal(result.query.communicationMode, "voice");
  assert(!JSON.stringify(result).includes("members"));
  for (const input of [
    { search: "x".repeat(81) },
    { search: { $ne: "" } },
    { communicationMode: "invalid" },
    { publicTopic: "invalid" },
    { language: "invalid" },
  ])
    assert(directoryQuery(input).error);
});
test("legacy groups without stored mode still match video and default topic filters", () => {
  const query = directoryQuery({
    communicationMode: "video",
    publicTopic: "banter",
  }).query;
  assert.equal(query.$and.length, 2);
  assert(
    query.$and[0].$or.some((row) => row.communicationMode?.$exists === false),
  );
});

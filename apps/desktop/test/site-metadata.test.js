const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadMetadata(siteUrl) {
  const source = fs.readFileSync(path.join(__dirname, "../lib/siteMetadata.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  new Function("exports", "process", compiled)(exports, { env: { NEXT_PUBLIC_SITE_URL: siteUrl } });
  return exports;
}

test("search URLs default to the canonical www host and accept only explicit HTTPS origins", () => {
  const { canonicalSiteOrigin, SITE_ORIGIN } = loadMetadata();
  assert.equal(SITE_ORIGIN, "https://www.gigglemeet.com");
  assert.equal(canonicalSiteOrigin("https://gigglemeet.com/"), SITE_ORIGIN);
  assert.equal(canonicalSiteOrigin("https://www.gigglemeet.com/"), SITE_ORIGIN);
  assert.equal(loadMetadata("https://future.example/").SITE_ORIGIN, "https://future.example");
  for (const value of ["http://localhost:4000", "javascript:alert(1)", "https://user:password@example.com", "https://example.com/path", "https://example.com/?ref=code", "https://example.com/#invite=secret", "not a URL"]) {
    assert.throws(() => canonicalSiteOrigin(value), undefined, value);
  }
});

test("each public page has matching canonical and social URLs, with a valid existing image", () => {
  const { PUBLIC_PAGES, SITE_ORIGIN, publicPageMetadata } = loadMetadata();
  const titles = new Set();
  for (const page of PUBLIC_PAGES) {
    const metadata = publicPageMetadata(page.path);
    assert.equal(metadata.alternates.canonical, SITE_ORIGIN + page.path);
    assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
    assert.equal(metadata.openGraph.siteName, "Giggle Meet");
    assert.equal(metadata.description, page.description);
    assert.equal(metadata.twitter.card, "summary");
    assert.deepEqual(metadata.robots, { index: true, follow: true });
    assert.equal(metadata.openGraph.images[0].url, SITE_ORIGIN + "/icon.png");
    titles.add(metadata.title);
  }
  assert.equal(titles.size, PUBLIC_PAGES.length);
  const image = fs.readFileSync(path.join(__dirname, "../app/icon.png"));
  assert.equal(image.readUInt32BE(16), 512);
  assert.equal(image.readUInt32BE(20), 512);
});

test("private metadata clears home previews and the home schema describes only real brand facts", () => {
  const { PRIVATE_METADATA, HOME_JSON_LD, SITE_ORIGIN } = loadMetadata();
  assert.deepEqual(PRIVATE_METADATA.robots, { index: false, follow: false });
  assert.equal(PRIVATE_METADATA.alternates.canonical, null);
  assert.equal(PRIVATE_METADATA.openGraph, null);
  assert.equal(PRIVATE_METADATA.twitter, null);
  const graph = JSON.parse(HOME_JSON_LD)["@graph"];
  assert.deepEqual(graph.map(item => item["@type"]), ["WebSite", "Organization"]);
  assert.equal(graph[0].name, "Giggle Meet");
  assert.equal(graph[0].url, SITE_ORIGIN + "/");
  assert.equal(graph[0].publisher["@id"], graph[1]["@id"]);
  assert.equal(graph[1].logo.url, SITE_ORIGIN + "/icon.png");
  assert(!HOME_JSON_LD.includes("<"));
});

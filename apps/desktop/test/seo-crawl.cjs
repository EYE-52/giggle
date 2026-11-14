// Read complete HTTP responses as a crawler, without running the app or auth.
// Run against the local Meet preview: node apps/desktop/test/seo-crawl.cjs
const assert = require("node:assert/strict");
const { chromium } = require("@playwright/test");
const base = process.env.MEET_SEO_TEST_URL || "http://localhost:4104";

(async () => {
  assert(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "Use a local test instance");
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext({ javaScriptEnabled: false, userAgent: "Googlebot" });
  const page = await context.newPage();
  try {
    let origin;
    const publicPaths = ["/", "/safety", "/support", "/privacy", "/terms"];
    for (const route of [...publicPaths, "/?ref=ABC123XY"]) {
      const response = await context.request.get(base + route);
      assert.equal(response.status(), 200, route);
      const html = await response.text();
      const tags = await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const content = selector => doc.querySelector(selector)?.getAttribute("content");
        return { title: doc.title, canonical: doc.querySelector('link[rel="canonical"]')?.getAttribute("href"), robots: content('meta[name="robots"]'), description: content('meta[name="description"]'), og: content('meta[property="og:url"]'), siteName: content('meta[property="og:site_name"]'), image: content('meta[property="og:image"]'), schemas: [...doc.querySelectorAll('script[type="application/ld+json"]')].map(node => JSON.parse(node.textContent)) };
      }, html);
      origin ||= new URL(tags.canonical).origin;
      const expected = origin + new URL(route, base).pathname;
      assert.equal(new URL(tags.canonical).href, expected, route);
      assert.equal(new URL(tags.og).href, expected, route);
      assert.equal(tags.siteName, "Giggle Meet", route);
      assert(tags.title.includes("Giggle Meet") && tags.description.length > 30, route);
      assert(!tags.robots.includes("noindex"), route);
      assert.equal(tags.image, origin + "/icon.png");
      if (new URL(route, base).pathname === "/") {
        const graph = tags.schemas.flatMap(schema => schema["@graph"] || [schema]);
        assert.equal(graph.filter(item => item["@type"] === "WebSite").length, 1, "One homepage WebSite declaration");
        assert.equal(graph.find(item => item["@type"] === "WebSite").name, "Giggle Meet");
        assert.equal(graph.find(item => item["@type"] === "Organization").url, origin + "/");
      }
    }
    for (const route of ["/signin?ref=ABC123XY", "/auth/callback", "/join/ABC123XY", "/home", "/discover", "/groups/new", "/groups/fixture", "/match", "/lobby", "/matchmaking", "/encounter", "/profile", "/friends", "/premium", "/avatar-playground"]) {
      const response = await context.request.get(base + route);
      assert.equal(response.status(), 200, route);
      const html = await response.text();
      const tags = await page.evaluate(html => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        return { robots: doc.querySelector('meta[name="robots"]')?.content, canonical: doc.querySelector('link[rel="canonical"]'), og: doc.querySelector('meta[property="og:url"]') };
      }, html);
      assert(tags.robots?.includes("noindex"), route);
      assert.equal(tags.canonical, null, route);
      assert.equal(tags.og, null, route);
    }
    const robots = await context.request.get(base + "/robots.txt");
    assert.equal(robots.status(), 200);
    assert((await robots.text()).includes("Sitemap: " + origin + "/sitemap.xml"));
    const sitemap = await context.request.get(base + "/sitemap.xml");
    assert.equal(sitemap.status(), 200);
    const urls = [...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
    assert.deepEqual(urls.sort(), publicPaths.map(route => origin + route).sort());
    const image = await context.request.get(base + "/icon.png");
    assert.equal(image.status(), 200);
    assert(image.headers()["content-type"].includes("image/png"));
    console.log("PASS crawled HTML: six public requests, fifteen private routes, referral canonical, home schema, robots, sitemap and existing social image.");
  } finally {
    await context.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

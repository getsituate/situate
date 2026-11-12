import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  mkdir,
  writeFile,
  symlink,
  copyFile,
  realpath,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { createHash } from "node:crypto";
import {
  analyticsConfiguration,
  websiteAnalyticsToken,
  createPreviewServer,
  createBuildServer,
  landingContentSecurityPolicy,
  render,
  build,
} from "./site.mjs";
import { spawn, spawnSync } from "node:child_process";
import {
  renderHeader,
  renderFooter,
  legalLinks,
  menuLinks,
} from "./components.mjs";
import { renderLegalPage } from "./legal/render.mjs";

test("analytics configuration exports only a public project token and defaults to disabled", async (t) => {
  assert.match(analyticsConfiguration(""), /"token":""/);
  const token = "phc_websiteSyntheticProjectToken12345";
  assert.equal(
    analyticsConfiguration(token),
    `window.situateAnalyticsConfig = Object.freeze(${JSON.stringify({ token })});\n`,
  );
  for (const value of [
    "phx_personalKey",
    "<script>",
    "phc_bad",
    "secret value",
  ])
    assert.throws(
      () => analyticsConfiguration(value),
      /public PostHog project token/,
    );
  const destination = await mkdtemp(join(tmpdir(), "situate-analytics-build-"));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await build(destination, { analyticsToken: token });
  assert.equal(
    await readFile(join(destination, "analytics-config.js"), "utf8"),
    analyticsConfiguration(token),
  );
  for (const [file, hash] of [
    [
      "posthog-1.447.4.min.js",
      "a35c138863f5b54ce2e5fdfcf03800c564014a42d2d4abdee33930d30b1b1fbd",
    ],
    [
      "posthog-LICENSE.txt",
      "d3fb92ac01f0bef4078f89aac9f20f76da3383ad45becf6204abdf5495f43f8f",
    ],
  ])
    assert.equal(
      createHash("sha256")
        .update(await readFile(join(destination, "vendor", file)))
        .digest("hex"),
      hash,
    );
  await assert.rejects(readFile(join(destination, "vendor/README.md")), {
    code: "ENOENT",
  });
});

test("website token configuration reads only private dotenv data with environment precedence", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-website-env-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, environment: {} };
  assert.equal(await websiteAnalyticsToken(options), "");
  const token = "phc_websiteSyntheticProjectToken12345";
  await writeFile(
    join(directory, ".env"),
    `WEBSITE_POSTHOG_TOKEN="${token}"\nPOSTHOG_CLI_API_KEY=private-api-value\nUNRELATED="$(touch should-not-exist)"\n`,
    { mode: 0o600 },
  );
  assert.equal(await websiteAnalyticsToken(options), token);
  assert.equal(
    await websiteAnalyticsToken({
      directory,
      environment: { WEBSITE_POSTHOG_TOKEN: "" },
    }),
    "",
  );
  assert.equal(
    await websiteAnalyticsToken({
      directory,
      environment: { WEBSITE_POSTHOG_TOKEN: "explicit" },
    }),
    "explicit",
  );
  assert.equal(
    await websiteAnalyticsToken({ directory, environment: { CI: "true" } }),
    "",
  );
  assert.equal(
    await websiteAnalyticsToken({
      directory,
      environment: { CI: "true", WEBSITE_POSTHOG_TOKEN: token },
    }),
    token,
  );
  assert.deepEqual(await readdir(directory), [".env"]);
  assert.doesNotMatch(
    analyticsConfiguration(await websiteAnalyticsToken(options)),
    /private-api-value|POSTHOG_CLI|UNRELATED/,
  );
  await chmod(join(directory, ".env"), 0o644);
  await assert.rejects(websiteAnalyticsToken(options), /owner-only/);
  await chmod(join(directory, ".env"), 0o600);
  await writeFile(
    join(directory, "private.env"),
    "WEBSITE_POSTHOG_TOKEN=" + token,
    { mode: 0o600 },
  );
  await rm(join(directory, ".env"));
  await symlink(join(directory, "private.env"), join(directory, ".env"));
  await assert.rejects(websiteAnalyticsToken(options), /regular/);
});

test("templates escape catalog values and reject missing translations", () => {
  assert.equal(
    render("<h1>{{title}}</h1>", { title: "<script>\"&'" }),
    "<h1>&lt;script&gt;&quot;&amp;&#39;</h1>",
  );
  assert.throws(() => render("{{missing}}", {}), /Missing translation/);
});

test("preview serves the landing page at the root and only public assets", async (t) => {
  const server = createPreviewServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  {
    const route = "/";
    const response = await fetch(origin + route);
    assert.equal(response.status, 200, route);
    const body = await response.text();
    assert.ok(body.includes('<html lang="en">'));
    assert.ok(body.includes("Put AI"));
    assert.ok(body.includes('class="hero"'));
    assert.ok(!body.includes("{{"), route);
    assert.equal(
      response.headers.get("content-security-policy"),
      landingContentSecurityPolicy,
    );
  }
  for (const route of ["/system", "/system/", "/system/index.html"]) {
    const response = await fetch(origin + route, { redirect: "manual" });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get("location"), "/");
  }
  assert.equal((await fetch(`${origin}/`, { method: "POST" })).status, 405);
  assert.equal((await fetch(`${origin}/`, { method: "HEAD" })).status, 200);
  for (const route of [
    "/.env",
    "/AGENTS.md",
    "/retrieve/",
    "/momentum/",
    "/retrieve/script.js",
    "/momentum/styles.css",
    "/hub.css",
    "/website/site.mjs",
    "/messages.en.json",
    "/components.mjs",
    "/legal/messages.en.json",
    "/legal/pages.json",
    "/legal/review.md",
    "/legal/render.mjs",
    "/legal/browser.test.mjs",
    "/media/birthday-fixture.json",
    "/media/manifest.json",
    "/media/platforms/provenance.json",
    "/capture-workshop.mjs",
    "/design/brand/README.md",
    "/%2e%2e%2f.env",
    "/%2e%2e%5c.env",
  ]) {
    assert.equal((await fetch(origin + route)).status, 404, route);
  }
  const analytics = await fetch(`${origin}/analytics-config.js`);
  assert.equal(await analytics.text(), analyticsConfiguration(""));
  for (const asset of [
    "analytics.js",
    "vendor/posthog-1.447.4.min.js",
    "vendor/posthog-LICENSE.txt",
  ])
    assert.equal((await fetch(`${origin}/${asset}`)).status, 200);
  assert.equal((await fetch(`${origin}/vendor/README.md`)).status, 404);
  const screenshot = await fetch(`${origin}/media/workspace.webp`);
  assert.equal(screenshot.status, 200);
  assert.equal(screenshot.headers.get("content-type"), "image/webp");
  assert.ok((await screenshot.arrayBuffer()).byteLength > 1000);
  const license = await fetch(`${origin}/media/provider-icons-license.txt`);
  assert.equal(license.status, 200);
  assert.match(await license.text(), /Copyright \(c\) 2023 LobeHub/);
  assert.equal((await fetch(`${origin}/%ZZ`)).status, 400);
  assert.equal(
    (await fetch(`${origin}/design/brand/bend/svg/carry-welcome.svg`)).status,
    200,
  );
});

test("all pages share navigation and footer in preview and static output", async (t) => {
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const pages = JSON.parse(
    await readFile(new URL("./legal/pages.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(
    pages.map((page) => page.path),
    legalLinks.map((link) => link.href),
  );
  const server = createPreviewServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
      }),
  );
  const destination = await mkdtemp(join(tmpdir(), "situate-shared-shell-"));
  t.after(() => rm(destination, { recursive: true, force: true }));
  await build(destination);
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    "/",
    "/product.html",
    ...pages.map((page) => page.path),
  ]) {
    const response = await fetch(origin + route);
    assert.equal(response.status, 200);
    const content = await response.text();
    assert.equal(
      content,
      await readFile(
        join(destination, route === "/" ? "index.html" : route.slice(1)),
        "utf8",
      ),
    );
    assert.ok(
      content.includes(
        renderHeader(messages, {
          home: route === "/",
          progress: route === "/" || route === "/product.html",
          pathname: route,
        }),
      ),
    );
    assert.ok(content.includes(renderFooter(messages, { pathname: route })));
    assert.equal([...content.matchAll(/<footer\b/g)].length, 1);
    assert.equal([...content.matchAll(/<header class="header"/g)].length, 1);
    assert.doesNotMatch(content, /class="motion(?:-dock)?"/);
    assert.match(content, /href="\/components.css"/);
    assert.match(content, /<script src="\/navigation.js" defer><\/script>/);
    assert.match(content, /<details class="mobile-menu">/);
    assert.doesNotMatch(content, /\{\{/);
    const head = await fetch(origin + route, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    assert.equal((await fetch(origin + route, { method: "POST" })).status, 405);
    if (route !== "/" && route !== "/product.html") {
      assert.doesNotMatch(
        content,
        /src="(?:\.\/)?script.js"|class="motion"|class="page-progress"/,
      );
      assert.match(content, /name="robots" content="noindex, nofollow"/);
      assert.match(content, /aria-current="page"/);
    }
  }
  for (const path of ["/components.css", "/product.css", "/legal/styles.css"]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^text\/css/);
    assert.equal(
      await response.text(),
      await readFile(join(destination, path.slice(1)), "utf8"),
    );
  }
  const navigation = await fetch(origin + "/navigation.js");
  assert.equal(navigation.status, 200);
  assert.match(navigation.headers.get("content-type"), /^text\/javascript/);
  assert.equal(
    await navigation.text(),
    await readFile(join(destination, "navigation.js"), "utf8"),
  );
  assert.deepEqual(await readdir(join(destination, "legal")), ["styles.css"]);
});

test("privacy notice covers production delivery and app processing without a legacy self-link", async () => {
  const pages = JSON.parse(
    await readFile(new URL("./legal/pages.json", import.meta.url), "utf8"),
  );
  const messages = {
    ...JSON.parse(
      await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
    ),
    ...JSON.parse(
      await readFile(
        new URL("./legal/messages.en.json", import.meta.url),
        "utf8",
      ),
    ),
  };
  const privacy = pages.find((page) => page.id === "privacy");
  const html = renderLegalPage(privacy, messages);
  const sections = new Map(
    privacy.sections.map((section) => [section.id, section]),
  );
  for (const id of [
    "scope",
    "website-hosting",
    "downloads-and-updates",
    "app-workspaces",
    "app-ai-connections",
    "app-tools-and-remote-content",
    "app-diagnostics",
    "platform-updates",
    "your-rights",
    "right-to-object",
  ]) {
    assert.ok(sections.has(id), id);
    assert.ok(html.includes(`href="#${id}"`), id);
    assert.ok(html.includes(`id="${id}"`), id);
  }
  const blocks = privacy.sections.flatMap((section) => section.blocks);
  for (const block of blocks.filter((entry) => entry.type === "link")) {
    const destination = new URL(block.href);
    assert.ok(
      !["getsituate.com", "reboot.getsituate.com"].includes(
        destination.hostname,
      ) || destination.pathname !== privacy.path,
      `Privacy link must not point back to the replacement notice: ${block.href}`,
    );
  }
  const scope = sections.get("scope").blocks;
  assert.deepEqual(scope, [{ type: "paragraph", key: "privacy.scope.body" }]);
  assert.match(messages[scope[0].key], /getsituate\.com/);
  assert.match(
    messages[scope[0].key],
    /macOS and iOS builds of Situate distributed or linked through this website or Apple/,
  );
  assert.doesNotMatch(html, /prototype|new Situate client|new Situate app/i);
  assert.match(
    messages["privacy.controller.body"],
    /website, waitlist, release delivery and contact processing we operate/,
  );
  assert.doesNotMatch(
    messages["privacy.controller.body"],
    /processing described in this notice/,
  );
  assert.ok(!("privacy.scope.link" in messages));
  for (const section of privacy.sections) {
    assert.ok(html.includes(messages[section.headingKey]));
    for (const block of section.blocks) {
      for (const key of block.keys || [block.key]) {
        assert.equal(typeof messages[key], "string", key);
        assert.ok(messages[key].length > 0, key);
      }
    }
  }
  assert.match(html, /three files of 10 MiB per container/);
  assert.match(html, /not a fixed retention period/);
  assert.match(html, /weekly rotation with up to four rotated files/);
  assert.match(
    html,
    /does not guarantee deletion after a fixed number of days/,
  );
  assert.match(html, /256 MiB logical budget and 4 MiB segments/);
  assert.match(html, /not anonymous/);
  assert.match(html, /retains events for one year/);
  assert.match(html, /next monthly cleanup/);
  assert.match(
    html,
    /processing outside the European Economic Area, including in the United States/,
  );
  assert.match(html, /EU Standard Contractual Clauses \(Module 2\)/);
  assert.ok(html.includes('href="https://posthog.com/subprocessors"'));
  assert.doesNotMatch(html, /Contact us for the retention period/);
  assert.match(html, /Apple.*App Store privacy information/);
  assert.doesNotMatch(html, /href="https:\/\/getsituate\.com\/privacy\.html"/);
  assert.doesNotMatch(html, /privacy\.scope\.link|\{\{/);
});

test("legal renderer escapes copy and rejects unsafe links, IDs and missing strings", async () => {
  const shared = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const page = {
    path: "/privacy.html",
    titleKey: "title",
    sections: [
      {
        id: "details",
        headingKey: "title",
        blocks: [{ type: "paragraph", key: "body" }],
      },
    ],
  };
  const messages = { ...shared, title: "<Title>", body: '<script>"&' };
  assert.match(renderLegalPage(page, messages), /&lt;script&gt;&quot;&amp;/);
  assert.throws(() => renderLegalPage(page, shared), /Missing translation/);
  for (const href of [
    "javascript:alert(1)",
    "//example.com",
    "data:text/html,test",
  ]) {
    const unsafe = structuredClone(page);
    unsafe.sections[0].blocks = [{ type: "link", key: "title", href }];
    assert.throws(() => renderLegalPage(unsafe, messages), /Unsupported link/);
  }
  const duplicate = structuredClone(page);
  duplicate.sections.push(duplicate.sections[0]);
  assert.throws(
    () => renderLegalPage(duplicate, messages),
    /Invalid or duplicate section ID/,
  );
  for (const id of ["main", "top", 'bad"id']) {
    const invalid = structuredClone(page);
    invalid.sections[0].id = id;
    assert.throws(
      () => renderLegalPage(invalid, messages),
      /Invalid or duplicate section ID/,
    );
  }
});

test("download controls identify five platforms without linking to unavailable files", async () => {
  const template = await readFile(
    new URL("./index.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages);
  const controls = [
    ...html.matchAll(/<a\b[^>]*data-platform="([^"]+)"[^>]*>/g),
  ];
  assert.deepEqual(
    controls.map((match) => match[1]),
    ["macos"],
  );
  assert.match(controls[0][0], /aria-disabled="true"/);
  assert.doesNotMatch(controls[0][0], /href=/);
  assert.match(controls[0][0], /aria-describedby="macos-availability"/);
  const links = [
    ...html.matchAll(/<a\b[^>]*data-waitlist-platform="([^"]+)"[^>]*>/g),
  ];
  assert.deepEqual(
    links.map((match) => match[1]),
    ["windows", "linux", "ios", "android"],
  );
  for (const [markup] of links) {
    assert.match(markup, /href="#platform-waitlist"/);
    assert.match(markup, /aria-label="Join the [^"]+ waitlist"/);
  }
  assert.match(html, /Coming soon/);
  assert.match(html, /Download currently unavailable/);
  assert.match(html, /src="\.\/download.js" defer/);
  assert.match(html, /id="load-platform-waitlist"[^>]*hidden/);
  assert.match(html, /id="platform-waitlist-status"\s+role="status"/);
  assert.match(html, /href="\/privacy.html#platform-updates"/);
  assert.doesNotMatch(html, /<script[^>]*src="https:/);
  assert.equal([...html.matchAll(/href="#download"/g)].length, 2);
  assert.match(html, /id="download"\s+aria-labelledby="download-title"/);
});

test("waitlist CSP matches deployment and keeps script and form restrictions", async () => {
  const nginx = await readFile(
    new URL("../infrastructure/website/docker/nginx.conf", import.meta.url),
    "utf8",
  );
  assert.ok(
    nginx.includes(`Content-Security-Policy "${landingContentSecurityPolicy}"`),
  );
  assert.match(landingContentSecurityPolicy, /form-action 'none'/);
  assert.match(
    landingContentSecurityPolicy,
    /connect-src 'self' https:\/\/eocampaign1.com/,
  );
  assert.doesNotMatch(
    landingContentSecurityPolicy,
    /unsafe-eval|script-src[^;]*unsafe-inline|\*/,
  );
});

test("platform artwork preserves its sources and exposes attribution", async () => {
  const base = new URL("./media/platforms/", import.meta.url);
  const { assets } = JSON.parse(
    await readFile(new URL("provenance.json", base), "utf8"),
  );
  assert.deepEqual(
    assets.map((asset) => asset.file),
    ["windows.svg", "linux.png", "android.svg"],
  );
  const template = await readFile(
    new URL("./index.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages);
  for (const asset of assets) {
    const bytes = await readFile(new URL(asset.file, base));
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      asset.sha256,
    );
    assert.ok(bytes.length < 24 * 1024);
    assert.ok(!html.includes(`src="./media/platforms/${asset.file}"`));
    if (asset.file.endsWith(".svg")) {
      assert.doesNotMatch(
        bytes.toString(),
        /<script\b|<foreignObject\b|onload=|(?:href|url\()\s*["']?https?:/i,
      );
    }
  }
  assert.equal([...html.matchAll(/data-download-platform="/g)].length, 5);
  assert.match(html, /class="download-featured" hidden/);
  assert.match(html, /class="download-art" aria-hidden="true"/);
  for (const file of [
    "background-offset-discs.svg",
    "reading-lamp.svg",
    "open-book.svg",
    "ribbon-cup.svg",
  ]) {
    assert.ok(html.includes(`src="/design/brand/assets/${file}"`));
  }
  assert.doesNotMatch(html, /platform-icon|platform-device|download-card/);
  assert.doesNotMatch(html, /platform-credits|platform-waitlist-privacy/);
  assert.ok(!html.includes("Opens a form using"));
  const pages = JSON.parse(
    await readFile(new URL("./legal/pages.json", import.meta.url), "utf8"),
  );
  const legalMessages = JSON.parse(
    await readFile(
      new URL("./legal/messages.en.json", import.meta.url),
      "utf8",
    ),
  );
  const legalHtml = renderLegalPage(
    pages.find((page) => page.id === "legal-notice"),
    { ...messages, ...legalMessages },
  );
  assert.match(legalHtml, /id="icon-credits"/);
  assert.match(legalHtml, /Larry Ewing using The GIMP/);
  assert.ok(
    legalHtml.includes(
      assets.find((asset) => asset.file === "android.svg").attribution,
    ),
  );
  assert.match(
    legalHtml,
    /href="https:\/\/creativecommons.org\/licenses\/by\/3.0\/"/,
  );
});

test("landing introduces AI help, an example, setup and costs", async () => {
  const template = await readFile(
    new URL("./index.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages);
  const hero = html.match(
    /<div class="hero-copy">([\s\S]*?)<div class="hero-stage"/,
  )?.[1];
  assert.ok(hero);
  for (const key of [
    "hero.product",
    "hero.fact.free",
    "hero.fact.ai",
    "hero.fact.files",
    "hero.action",
    "hero.secondary",
  ])
    assert.ok(hero.includes(render("{{copy}}", { copy: messages[key] })), key);
  assert.match(hero, /notes, tasks and documents in one free app/);
  assert.match(hero, /Free app\. No limits\./);
  assert.match(hero, /<a class="hero-facts" href="\/product.html">/);
  assert.equal([...hero.matchAll(/<p\b/g)].length, 1);
  assert.doesNotMatch(hero, /class="eyebrow"|class="hero-lead"|unlimited AI/);
  assert.match(hero, /<a class="button" href="#story"/);
  assert.match(hero, /<a class="subtle-link" href="#download"/);
  assert.match(html, /What do I need to set up/);
  assert.match(html, /What does it cost/);
  assert.match(html, /provider may charge/);
  for (const id of ["story", "questions", "download"])
    assert.ok(html.includes(`id="${id}"`));
  const overview = html.match(
    /<section class="overview"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(overview);
  for (const benefit of ["local", "personal", "portable"])
    for (const part of ["title", "body"])
      assert.ok(
        overview.includes(
          render("{{copy}}", { copy: messages[`overview.${benefit}.${part}`] }),
        ),
      );
  assert.equal([...overview.matchAll(/<h2>/g)].length, 3);
  assert.match(overview, /href="\/product\.html"/);
  assert.match(overview, /without internet or AI/);
  assert.match(overview, /Ask Situate to adapt/);
  assert.match(overview, /Markdown/);
  assert.match(overview, /not tied to Situate/);
  assert.match(overview, /take your files to another app whenever you want/);
  assert.ok(html.indexOf('class="overview"') < html.indexOf('id="story"'));
  assert.ok(html.indexOf('id="story"') < html.indexOf('id="questions"'));
  assert.ok(html.indexOf('id="questions"') < html.indexOf('id="download"'));
  assert.match(
    html,
    /<section class="faq[\s\S]*?<\/section>\s*<section\s+class="downloads/,
  );
  assert.doesNotMatch(html, /class="ending"|data-bend-rig="ending"/);
});

test("landing and product separate the free app from AI provider charges", async () => {
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  for (const [file, pathname] of [
    ["index.html", "/"],
    ["product.html", "/product.html"],
  ]) {
    const template = await readFile(new URL(file, import.meta.url), "utf8");
    const html = render(template, messages, { pathname });
    const content = html.replace(/<[^>]*>/g, " ");
    assert.match(content, /The entire app is free\./, file);
    assert.match(content, /Your chosen AI provider may charge/, file);
    assert.doesNotMatch(
      content,
      /\b(?:paid|subscription|synchroni[sz]ation)\b|managed AI|free (?:local use|on (?:one|a single) device)/i,
      file,
    );
  }
});

test("header separates page navigation from the download action", async () => {
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(menuLinks, [
    { href: "/", key: "nav.index" },
    { href: "/product.html", key: "nav.product" },
  ]);
  for (const pathname of ["/", "/product.html", "/privacy.html"]) {
    const header = renderHeader(messages, { home: pathname === "/", pathname });
    const navs = [...header.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map(
      (match) => match[0],
    );
    assert.equal(navs.length, 2);
    for (const nav of navs) {
      assert.match(nav, /<ul class="site-links"><li><a href="\/"/);
      assert.match(nav, />Home<\/a><\/li><li><a href="\/product.html"/);
      assert.match(nav, />Product<\/a><\/li><\/ul>/);
      for (const { href } of menuLinks) {
        assert.equal(
          nav.includes(`href="${href}" aria-current="page"`),
          pathname === href,
        );
      }
      assert.doesNotMatch(nav, /href="(?:\/)?#/);
    }
    assert.ok(
      header.includes(
        `class="nav-action" href="${pathname === "/" ? "" : "/"}#download"`,
      ),
    );
    assert.match(header, /<a class="wordmark" href="\/"/);
    assert.match(header, /<summary><span class="menu-open-label">Menu<\/span>/);
    assert.match(header, /class="menu-close-label">Close<\/span>/);
  }
});

test("product introduction leads with personal workflows and an illustrated request", async () => {
  const template = await readFile(
    new URL("./product.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages, { pathname: "/product.html" });
  const intro = html.match(
    /<section class="product-intro wrap"[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(intro);
  for (const key of [
    "product.line1",
    "product.line2",
    "product.body",
    ...["work", "help", "independence"].flatMap((benefit) =>
      ["title", "body"].map((part) => `product.benefit.${benefit}.${part}`),
    ),
    ...Object.keys(messages).filter((key) =>
      key.startsWith("product.example."),
    ),
  ])
    assert.ok(intro.includes(render("{{copy}}", { copy: messages[key] })), key);
  assert.match(intro, /An organization app that adapts to you\./);
  assert.match(intro, /Tell it how you work/);
  assert.match(intro, /<ul class="product-benefits" role="list">/);
  assert.equal([...intro.matchAll(/<h2>/g)].length, 3);
  assert.deepEqual(
    [...intro.matchAll(/href="(#[^"]+)"/g)].map((match) => match[1]),
    ["#plugins", "#space", "#choices"],
  );
  assert.match(intro, /aria-labelledby="workstyle-caption"/);
  assert.ok(
    intro.indexOf('class="product-contents"') <
      intro.indexOf('class="workstyle-example"'),
  );
  assert.doesNotMatch(intro, /data-motion-scene|\shidden\b/);
});

test("product chapters explain adaptation, help, independence and getting started in order", async () => {
  const template = await readFile(
    new URL("./product.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages, { pathname: "/product.html" });
  const classes = [...html.matchAll(/<section\s+class="([^"]+)"/g)].map(
    (match) => match[1].split(" ")[0],
  );
  assert.deepEqual(classes, [
    "product-intro",
    "plugins",
    "space",
    "models",
    "free",
    "ending",
  ]);
  const independence = html.match(
    /<section\s+class="models[\s\S]*?<\/section>/,
  )?.[0];
  assert.ok(independence);
  for (const copy of [
    "models.providerBody",
    "models.localBody",
    "models.processing",
    "open.body",
    "open.code",
  ])
    assert.ok(
      independence.includes(render("{{copy}}", { copy: messages[copy] })),
      copy,
    );
  assert.match(independence, /Markdown files/);
  assert.match(independence, /no export required/);
  assert.match(independence, /<h3>Open your files/);
  assert.match(html, /Start with the built-in tools/);
  assert.match(html, /The entire app is free/);
  assert.match(html, /Your chosen AI provider may charge for usage/);
  assert.match(html, /Work without AI, too/);
});

test("product page links its chapters and returns to the shared downloads", async () => {
  const template = await readFile(
    new URL("./product.html", import.meta.url),
    "utf8",
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const html = render(template, messages, { pathname: "/product.html" });
  assert.match(html, /href="\/product.html" aria-current="page"/);
  assert.match(html, /href="\/#download"/);
  assert.doesNotMatch(html, /href="\/#(?:story|questions)"/);
  assert.match(html, /href="\/product.css"/);
  assert.doesNotMatch(html, /platform-waitlist.js|id="download"/);
  assert.equal([...html.matchAll(/<dialog\b/g)].length, 1);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.equal([...html.matchAll(/data-tab="/g)].length, 3);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ["space", "plugins", "choices"]) {
    assert.ok(ids.includes(id));
    assert.ok(html.includes(`href="#${id}"`));
  }
  for (const { href } of menuLinks) assert.ok(html.includes(`href="${href}"`));
});

test("birthday story and captured results use the same source material", async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./media/birthday-fixture.json", import.meta.url),
      "utf8",
    ),
  );
  const messages = JSON.parse(
    await readFile(new URL("./messages.en.json", import.meta.url), "utf8"),
  );
  const normalize = (text) => text.replace(/\s+/g, " ").trim();
  assert.equal(messages["step2.quote"], fixture.request);
  assert.ok(
    fixture.sources.some((source) =>
      source.content.includes(messages["step1.quote"]),
    ),
  );
  assert.equal(fixture.reply.subject, `Re: ${fixture.sources[0].subject}`);
  assert.ok(
    fixture.documents.some(
      (document) => document.filename === fixture.reply.attachment,
    ),
  );
  assert.ok(messages["step3.two"].includes(fixture.reply.attachment));
  assert.equal(fixture.reply.status, "draft saved");
  assert.equal(fixture.reply.sent, false);
  assert.ok(
    normalize(fixture.response).includes(normalize(fixture.reply.body)),
  );
  assert.equal(fixture.calendar.status, "created");
  assert.deepEqual(fixture.calendar.guests, []);
  assert.equal(fixture.calendar.invitationsSent, false);
  const confirmation = fixture.sources.find(
    (source) => source.id === "handover-confirmation",
  );
  for (const value of [
    fixture.calendar.start,
    fixture.calendar.end,
    fixture.calendar.location,
  ])
    assert.ok(confirmation.content.includes(value));
  assert.ok(messages["step3.three"].includes(fixture.calendar.start));
  assert.match(fixture.response, /Gmail/);
  assert.match(fixture.response, /Google Calendar/);
  for (const value of ["24 guests", "4 vegetarian", "2 vegan"]) {
    assert.ok(fixture.reply.body.includes(value), value);
    assert.ok(
      fixture.files.some((file) => file.content.includes(value)),
      value,
    );
  }
  const runningOrder = fixture.documents.find(
    (document) => document.filename === fixture.reply.attachment,
  );
  for (const value of ["19:00", "20:30"]) {
    assert.ok(fixture.reply.body.includes(value), value);
    assert.ok(runningOrder.page.includes(value), value);
  }
  assert.doesNotMatch(
    JSON.stringify({ fixture, messages }),
    /garden talk|neighborhood.garden|growing.guide|I keep reorganizing|The folders can wait/i,
  );
});

test("workshop captures retain their provenance and bounded image weight", async () => {
  const base = new URL("./media/", import.meta.url);
  const manifest = JSON.parse(
    await readFile(new URL("manifest.json", base), "utf8"),
  );
  assert.equal(manifest.syntheticData, true);
  assert.equal(manifest.language, "en");
  assert.equal(manifest.fixture.file, "birthday-fixture.json");
  assert.equal(manifest.images.length, 7);
  assert.ok(
    manifest.images.reduce((sum, image) => sum + image.bytes, 0) < 768 * 1024,
  );
  const fixture = await readFile(new URL(manifest.fixture.file, base));
  assert.equal(
    createHash("sha256").update(fixture).digest("hex"),
    manifest.fixture.sha256,
  );
  for (const image of manifest.images) {
    assert.equal(
      image.width,
      image.viewport.width * manifest.renderer.deviceScaleFactor,
    );
    assert.equal(
      image.height,
      image.viewport.height * manifest.renderer.deviceScaleFactor,
    );
  }
  assert.equal(
    await readFile(new URL("provider-icons-license.txt", base), "utf8"),
    await readFile(
      new URL(
        "../client/workshop/src/ai/assets/providers/LICENSE.txt",
        import.meta.url,
      ),
      "utf8",
    ),
  );
});

test("static build removes retired pages and emits the landing page at the root", async () => {
  const destination = await mkdtemp(join(tmpdir(), "situate-website-build-"));
  try {
    for (const name of ["system", "retrieve", "momentum"]) {
      await mkdir(join(destination, name));
      await writeFile(join(destination, name, "index.html"), "old page");
    }
    await writeFile(join(destination, "hub.css"), "old styles");
    await build(destination);
    const content = await readFile(join(destination, "index.html"), "utf8");
    assert.ok(!content.includes("{{"));
    assert.ok(content.includes("Put AI"));
    assert.ok(content.includes('class="hero"'));
    const files = await readdir(destination);
    for (const absent of [
      "messages.en.json",
      "hub.css",
      "system",
      "retrieve",
      "momentum",
    ])
      assert.ok(!files.includes(absent), absent);
    for (const match of content.matchAll(
      /(?:src|href)="(\/design\/brand\/[^"#]+)"/g,
    ))
      assert.ok(
        (await readFile(join(destination, match[1]))).length > 0,
        match[1],
      );
    const source = new URL("./media/manifest.json", import.meta.url);
    const manifest = JSON.parse(await readFile(source, "utf8"));
    for (const image of manifest.images) {
      const bytes = await readFile(join(destination, "media", image.file));
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        image.sha256,
      );
      assert.equal(bytes.length, image.bytes);
    }
    const { assets } = JSON.parse(
      await readFile(
        new URL("./media/platforms/provenance.json", import.meta.url),
        "utf8",
      ),
    );
    for (const asset of assets) {
      const bytes = await readFile(
        join(destination, "media/platforms", asset.file),
      );
      assert.equal(
        createHash("sha256").update(bytes).digest("hex"),
        asset.sha256,
      );
    }
    assert.deepEqual(
      (await readdir(join(destination, "media/platforms"))).sort(),
      assets.map((asset) => asset.file).sort(),
    );
    const mediaFiles = await readdir(join(destination, "media"));
    assert.ok(!mediaFiles.some((file) => file.endsWith(".json")));
    assert.match(
      await readFile(
        join(destination, "media/provider-icons-license.txt"),
        "utf8",
      ),
      /MIT License/,
    );
    await build(destination);
    assert.equal(
      await readFile(join(destination, "index.html"), "utf8"),
      content,
    );
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});

test("built preview serves the generated files and excludes sources and escaping symlinks", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-built-preview-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const output = join(directory, "dist");
  await build(output);
  await writeFile(join(directory, "outside.html"), "private");
  await symlink(join(directory, "outside.html"), join(output, "escape.html"));
  await writeFile(join(output, ".env"), "not public");
  await writeFile(join(output, "messages.en.json"), "{}");
  const server = createBuildServer(output);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(
    () =>
      new Promise((done) => {
        server.close(done);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const file of [
    "index.html",
    "product.html",
    "product.css",
    "legal-notice.html",
    "privacy.html",
    "components.css",
    "navigation.js",
    "platform-waitlist.js",
    "download.js",
    "legal/styles.css",
    "design/brand/assets/wordmark.svg",
    "media/provider-icons-license.txt",
  ]) {
    const response = await fetch(`${origin}/${file}`);
    assert.equal(response.status, 200, file);
    assert.equal(
      await response.text(),
      await readFile(join(output, file), "utf8"),
    );
  }
  assert.equal(
    await (await fetch(origin)).text(),
    await readFile(join(output, "index.html"), "utf8"),
  );
  for (const path of [
    "/.env",
    "/messages.en.json",
    "/site.mjs",
    "/legal/review.md",
    "/escape.html",
    "/%2e%2e%2foutside.html",
    "/%2e%2e%5coutside.html",
    "/media/",
  ]) {
    assert.equal((await fetch(origin + path)).status, 404, path);
  }
  assert.equal((await fetch(`${origin}/%ZZ`)).status, 400);
  assert.equal((await fetch(origin, { method: "POST" })).status, 405);
  const head = await fetch(origin, { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
});

test(
  "build-and-serve CLI announces a ready ephemeral server and stops on SIGTERM",
  { timeout: 15000 },
  async (t) => {
    const child = spawn(
      process.execPath,
      [
        fileURLToPath(new URL("./site.mjs", import.meta.url)),
        "--build",
        "--serve",
      ],
      {
        env: { ...process.env, PORT: "invalid" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const closed = once(child, "close");
    t.after(async () => {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGTERM");
      await closed;
    });
    let output = "";
    const url = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        reject(new Error(`Server exited before readiness: ${code}: ${output}`)),
      );
      child.stderr.on("data", (data) => {
        output += data;
      });
      child.stdout.on("data", (data) => {
        output += data;
        const match = output.match(
          /Website preview: (http:\/\/127\.0\.0\.1:\d+\/)\n/,
        );
        if (match) resolve(match[1]);
      });
    });
    assert.equal((await fetch(url)).status, 200);
    assert.match(
      await (await fetch(new URL("privacy.html", url))).text(),
      /Privacy notice/,
    );
    child.kill("SIGTERM");
    const [code, signal] = await closed;
    assert.equal(code, 0);
    assert.equal(signal, null);
    await assert.rejects(fetch(url));
  },
);

test("failed builds never announce a website server", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "situate-failed-build-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "legal"));
  for (const file of ["site.mjs", "components.mjs", "legal/render.mjs"]) {
    await copyFile(
      new URL(`./${file}`, import.meta.url),
      join(directory, file),
    );
  }
  const result = spawnSync(
    process.execPath,
    [await realpath(join(directory, "site.mjs")), "--build", "--serve"],
    { encoding: "utf8", timeout: 5000 },
  );
  assert.equal(result.error, undefined);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ENOENT/);
  assert.doesNotMatch(result.stdout, /Website preview:/);
});

test("build refuses destinations containing website sources", async () => {
  const root = fileURLToPath(new URL("./", import.meta.url));
  for (const destination of [root, resolve(root, ".."), resolve(root, "media")])
    await assert.rejects(
      build(destination),
      /must not contain or overwrite website source files/,
    );
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "client/package.json"));
const { createServer } = await import(require.resolve("vite"));
const { chromium } = require("playwright");
const media = join(root, "website/media");
const fixtureBytes = await readFile(join(media, "birthday-fixture.json"));
const fixture = JSON.parse(fixtureBytes);
assert.equal(
  fixture.request,
  "Draft a reply to Maya’s latest email about my birthday. Attach the running order and add the key handover to my calendar.",
);
assert.equal(fixture.sources[0].subject, "A few final details");
assert(
  fixture.sources[0].content.includes(
    "Could you send the final guest count, dietary requirements and running order? Let me know what sound equipment you need, too.",
  ),
);
assert(fixture.sources[1].content.includes("Friday 18 June 2027, 17:30–17:45"));
const projectNote = fixture.files.find(
  (file) => file.name === "my-birthday.md",
).content;
for (const fact of [
  "24 guests",
  "18 standard",
  "4 vegetarian",
  "2 vegan",
  "venue speakers",
  "no microphone",
])
  assert(projectNote.includes(fact));
const runningOrder = fixture.documents.find(
  (item) => item.filename === "birthday-running-order.pdf",
).page;
for (const time of ["18:00", "19:00", "20:30", "23:00"])
  assert(runningOrder.includes(time));
for (const file of fixture.files)
  assert(
    !/\d{2}:\d{2}/.test(file.content),
    "Notes must not duplicate schedule or handover times",
  );
assert.equal(fixture.reply.sent, false);
assert(
  fixture.response
    .replace(/\s+/g, " ")
    .includes(fixture.reply.body.replace(/\s+/g, " ")),
);
assert(fixture.response.includes("Reply saved in Gmail · To Maya · Not sent"));
assert.equal(fixture.calendar.invitationsSent, false);
assert.deepEqual(fixture.calendar.guests, []);
assert(
  fixture.documents.some((item) => item.filename === fixture.reply.attachment),
);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const temporary = await mkdtemp(join(tmpdir(), "situate-workshop-capture-"));
const captures = [
  {
    file: "workspace.webp",
    scenario: "files-chat",
    selector: ".editor-workspace",
    kind: "workspace",
  },
  {
    file: "notes.webp",
    scenario: "files-read",
    selector: ".editor-workspace",
    kind: "notes",
  },
  {
    file: "conversation.webp",
    scenario: "chat-complete",
    selector: ".chat-screen",
    kind: "conversation",
  },
  {
    file: "documents.webp",
    scenario: "documents-find",
    selector: ".documents-view",
    kind: "documents",
  },
  {
    file: "models.webp",
    scenario: "settings-ai",
    selector: ".settings-view",
    kind: "models",
  },
  {
    file: "plugins.webp",
    scenario: "plugins-list-illustrated",
    selector: ".plugin-view",
    kind: "plugins",
  },
  {
    file: "mobile.webp",
    scenario: "files-read",
    selector: ".editor-workspace",
    kind: "mobile",
    mobile: true,
  },
];
const server = await createServer({
  configFile: join(root, "client/workshop/vite.config.ts"),
  root: join(root, "client/workshop"),
  server: { host: "127.0.0.1", port: 0, strictPort: true, open: false },
});
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    channel: process.env.CAPTURE_BROWSER_CHANNEL || "chrome",
    headless: true,
  });
  const manifest = {
    schemaVersion: 1,
    source: "client/workshop",
    status:
      "Workshop design previews; not evidence of production availability or provider qualification.",
    language: "en",
    syntheticData: true,
    attribution: {
      artwork:
        "Original artwork by Situate contributors, CC BY 4.0; see LICENSING.md and design/brand/docs/provenance.md. Captures retain the licenses of their underlying material; trademark rights are separate.",
      providerIcons:
        "Lobe Icons, copyright (c) 2023 LobeHub, MIT. See provider-icons-license.txt and client/workshop/src/ai/assets/providers/SOURCES.md. Provider marks belong to their respective owners; no endorsement is implied.",
    },
    fixture: { file: "birthday-fixture.json", sha256: sha256(fixtureBytes) },
    renderer: {
      browser: browser.version(),
      deviceScaleFactor: 2,
      colorScheme: "light",
      reducedMotion: "reduce",
    },
    method:
      "Actual Vue workshop rendered in an isolated browser session. Workspace, navigation, editor and document fixtures are composed in memory and delivered through the workshop transport. Conversation title and events are supplied separately through the existing ChatView conversation prop by setting ChatView.props.conversation.default before mounting. No DOM text replacement, UI overlays or image compositing.",
    reproduction:
      "Run npm ci in client, install cwebp and Chrome, then run node website/capture-workshop.mjs from the repository root. The script starts and closes its own ephemeral-port Vite server; it never attaches to an existing server.",
    limitations: [
      "Browser geometry is not native-device qualification. Mobile uses the workshop iOS profile with synthetic safe areas and no keyboard.",
      "Responses and document pages are authored synthetic examples; no AI requests, accounts, personal workspaces or external services are used.",
      "Provider and plugin screens retain the workshop’s existing options and fixtures; they do not establish shipped integrations or real account access.",
      "Rasterization can vary between runs and across hosts and browsers; hashes describe these captured files, not guaranteed pixel equality.",
    ],
    images: [],
  };
  for (const capture of captures) {
    const viewport = capture.mobile
      ? { width: 390, height: 844 }
      : { width: 1440, height: 940 };
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      locale: "en-US",
      timezoneId: "UTC",
      colorScheme: "light",
      reducedMotion: "reduce",
      isMobile: !!capture.mobile,
      hasTouch: !!capture.mobile,
    });
    const external = [];
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(origin + "/") || url.startsWith("data:"))
        return route.continue();
      external.push(url);
      return route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(
      `${origin}/?workshop=preview&session=marketing-${capture.kind}`,
      { waitUntil: "networkidle" },
    );
    await page.evaluate(
      async ({ capture, fixture }) => {
        const { createSimulation, reduceSimulation } =
          await import("/src/workshop/simulation.ts");
        const { connect } = await import("/src/workshop/transport.ts");
        const { default: ChatView } = await import("/src/chat/ChatView.vue");
        let state = createSimulation(capture.scenario, !!capture.mobile);
        state.environment = {
          profile: capture.mobile ? "ios" : "mac",
          keyboardOpen: false,
        };
        state.snapshot.current.name = fixture.workspace;
        state.navigation.conversations = [
          {
            id: "birthday-reply",
            title: fixture.title,
            status: "Today",
            archived: false,
          },
          {
            id: "birthday-handover",
            title: "Willow Room · Key handover",
            status: "10 June",
            archived: false,
          },
        ];
        state.navigation.tabs = [
          { id: "chat", title: fixture.project, kind: "chat", draft: "" },
        ];
        state.navigation.activeTab = "chat";
        if (["workspace", "notes", "mobile"].includes(capture.kind)) {
          const editor = state.editor;
          editor.files = fixture.files.map((file) => ({
            ...file,
            key: file.name,
            draft: file.content,
            versions: [],
            deleted: false,
            saveError: false,
          }));
          editor.folders = [fixture.project];
          editor.expanded = [fixture.project];
          editor.currentKey = "my-birthday.md";
          editor.selected = { kind: "file", key: editor.currentKey };
          editor.treeOpen = capture.kind === "notes";
          if (capture.kind === "workspace") {
            editor.chats[0].title = fixture.title;
            editor.chats[0].draft = fixture.request;
            editor.chats[0].references = [];
          }
        }
        if (capture.kind === "conversation") {
          const call = (id, tool, label, input, result) => ({
            kind: "call",
            id,
            tool,
            label,
            input,
            result,
            visible: false,
          });
          const conversation = {
            title: fixture.title,
            working: "",
            stopped: "",
            error: "",
            events: [
              {
                kind: "message",
                id: "request",
                speaker: "user",
                text: fixture.request,
              },
              call(
                "mail",
                "gmail.search",
                "Found Maya’s email and handover confirmation",
                "Maya · birthday · Willow Room",
                JSON.stringify(fixture.sources),
              ),
              call(
                "context",
                "workspace.search",
                "Found birthday notes and running-order PDF",
                fixture.project,
                JSON.stringify({
                  files: fixture.files,
                  documents: fixture.documents,
                }),
              ),
              call(
                "draft",
                "gmail.saveDraft",
                "Reply saved in Gmail · To Maya · Not sent",
                JSON.stringify(fixture.reply),
                "Draft saved. Existing PDF attached. Email not sent.",
              ),
              call(
                "calendar",
                "googleCalendar.createEvent",
                "Key handover added to Personal · No invitations",
                JSON.stringify(fixture.calendar),
                "Calendar entry created. No guests; no invitations.",
              ),
              {
                kind: "message",
                id: "reply",
                speaker: "assistant",
                text: fixture.response,
              },
            ],
          };
          // ChatView already accepts conversation fixtures; set its prop default before mounting.
          ChatView.props.conversation.default = () => conversation;
        }
        if (capture.kind === "documents") {
          const d = state.documents;
          d.documents = fixture.documents.map((item) => ({
            ...item,
            type: "PDF",
            source: "computer",
            folder: fixture.project,
            content: item.excerpt,
            concepts: ["birthday Willow Room celebration running order"],
            pages: [item.page],
            availability: "available",
            preparation: "ready",
            thumbnail: "available",
            metadata: "Collection: My birthday",
          }));
          d.sources = [
            {
              id: "computer",
              name: "Local documents",
              detail: fixture.project,
              included: fixture.project,
              excluded: "",
              rules: "",
              checked: "Today",
              status: "ready",
              pending: 0,
            },
          ];
          d.tags = [
            { id: "birthday", name: "My birthday", parent: null },
            { id: "plans", name: "Plans", parent: null },
            { id: "venue", name: "Venue", parent: null },
          ];
          d.saved = [
            {
              id: "birthday",
              name: fixture.project,
              pinned: true,
              query: "",
              filter: { operator: "any", tags: ["birthday"] },
              untagged: false,
            },
          ];
          d.activeSaved = "birthday";
          d.query = d.draftQuery = "";
          d.filter = { operator: "any", tags: ["birthday"] };
          d.layout = "library";
          d.selected = null;
        }
        let revision = 0;
        let acknowledged = 0;
        const host = "marketing-capture";
        const send = () =>
          transport.send({
            type: "state",
            state,
            revision: ++revision,
            host,
            acknowledged,
          });
        const transport = await connect("controls", (message) => {
          if (message.type === "hello") void send();
          if (
            message.type === "command" &&
            message.host === host &&
            message.epoch === state.epoch
          ) {
            state = reduceSimulation(state, message.command);
            acknowledged = message.sequence;
            void send();
          }
        });
        await send();
      },
      { capture, fixture },
    );
    await page.locator(capture.selector).first().waitFor({ state: "visible" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) => image.decode().catch(() => {})),
      );
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await page.waitForTimeout(350);
    if (capture.kind === "conversation") {
      const activity = page.locator(".activity > summary");
      await activity.click();
      const steps = page.locator(".call-detail > summary");
      assert.equal(await steps.count(), 4);
      for (let index = 0; index < 4; index++) {
        await steps.nth(index).click();
        const result = page.locator(".call-data").nth(index);
        assert(await result.isVisible());
        const text = await result.innerText();
        assert(
          text.includes(
            [
              fixture.sources[0].subject,
              fixture.reply.attachment,
              "Email not sent",
              "No guests; no invitations",
            ][index],
          ),
        );
        await steps.nth(index).click();
      }
      assert(
        await page.locator(".activity").evaluate((element) => element.open),
      );
      assert.equal(await page.locator(".call-detail[open]").count(), 0);
      for (let index = 0; index < 4; index++)
        assert(await steps.nth(index).isVisible());
      await activity.click();
      await page.evaluate(() => document.activeElement?.blur());
      await page.locator(".chat-scroll").evaluate((element) => {
        element.scrollTop = 0;
      });
      const bounds = await page.locator(".chat-scroll").evaluate((element) => ({
        content: element.scrollHeight,
        available: element.clientHeight,
      }));
      assert(
        bounds.content <= bounds.available,
        `The complete reply must fit in the conversation capture (${bounds.content}/${bounds.available})`,
      );
      assert(
        await page.getByText(fixture.response, { exact: true }).isVisible(),
      );
    }
    if (capture.kind === "workspace") {
      assert.equal(
        await page.locator("textarea").first().inputValue(),
        fixture.request,
      );
      assert.equal(await page.locator(".attachment-chip").count(), 0);
    }
    if (capture.kind === "conversation") {
      assert(
        await page
          .getByText(fixture.title, { exact: true })
          .first()
          .isVisible(),
      );
      assert(
        await page.getByText(fixture.request, { exact: true }).isVisible(),
      );
      assert(fixture.response.includes(fixture.reply.subject));
      for (const fact of [
        "24 guests",
        "18 standard",
        "4 vegetarian",
        "2 vegan",
        "19:00",
        "20:30",
        "no microphone",
        "birthday-running-order.pdf",
        "17:30–17:45",
        "No guests or invitations",
      ])
        assert(fixture.response.includes(fact), `Missing result fact: ${fact}`);
    }
    const audit = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      missingImages: [...document.images]
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.getAttribute("src")),
      controls: !!document.querySelector(
        ".workshop-controls, vite-error-overlay, [role=dialog]",
      ),
      text: document.body.innerText,
    }));
    assert.equal(audit.overflow, false, `${capture.file}: horizontal overflow`);
    assert.deepEqual(
      audit.missingImages,
      [],
      `${capture.file}: missing images`,
    );
    assert.equal(audit.controls, false);
    assert.deepEqual(errors, [], `${capture.file}: browser errors`);
    assert.deepEqual(external, [], `${capture.file}: external requests`);
    assert(
      !/\/Users\/|\/home\/|sk-[a-zA-Z0-9]|@/.test(
        audit.text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.example\b/g, ""),
      ),
      `${capture.file}: unexpected identifying text`,
    );
    assert(
      !/garden|growing|herbs|outline|Thursday|reading evening/i.test(
        audit.text,
      ),
      `${capture.file}: unrelated story residue`,
    );
    const png = join(temporary, capture.file + ".png");
    await page.screenshot({
      path: png,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    execFileSync("cwebp", [
      "-quiet",
      "-lossless",
      "-z",
      "9",
      png,
      "-o",
      join(media, capture.file),
    ]);
    const bytes = await readFile(join(media, capture.file));
    const pngBytes = await readFile(png);
    manifest.images.push({
      file: capture.file,
      startingState: capture.scenario,
      steps:
        capture.kind === "models" || capture.kind === "plugins"
          ? [
              "Load existing workshop starting state",
              "Set shared synthetic navigation context",
              "Capture clean preview",
            ]
          : [
              "Load existing workshop starting state",
              "Compose birthday-fixture.json through workshop simulation model and transport",
              ...(capture.kind === "conversation"
                ? [
                    "Set ChatView.props.conversation.default to supply the title and events as a component-prop fixture before mounting, separately from transport state",
                    "Open Activity and verify all four call details, then collapse Activity to keep the full reply visible",
                  ]
                : []),
              "Capture clean preview",
            ],
      viewport,
      platformProfile: capture.mobile ? "ios" : "mac",
      width: pngBytes.readUInt32BE(16),
      height: pngBytes.readUInt32BE(20),
      bytes: bytes.length,
      sha256: sha256(bytes),
      encoding: "lossless WebP",
      checks: {
        horizontalOverflow: false,
        missingImages: 0,
        browserErrors: 0,
        externalRequests: 0,
        controlsVisible: false,
      },
    });
    console.log(
      `${capture.file}: ${pngBytes.readUInt32BE(16)}×${pngBytes.readUInt32BE(20)}, ${bytes.length} bytes`,
    );
    await context.close();
  }
  assert(
    manifest.images.reduce((total, image) => total + image.bytes, 0) <
      768 * 1024,
    "Screenshot set exceeds 768 KiB",
  );
  await writeFile(
    join(media, "provider-icons-license.txt"),
    await readFile(
      join(root, "client/workshop/src/ai/assets/providers/LICENSE.txt"),
    ),
  );
  await writeFile(
    join(media, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
} finally {
  await browser?.close();
  await server.close();
  await rm(temporary, { recursive: true, force: true });
}

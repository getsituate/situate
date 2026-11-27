import { randomUUID } from "node:crypto";
import { expect, test } from "./test";
import { emptyLayout, reduceLayout } from "../../src/layout/model";
import { shellState, workspaceFixture } from "./workspace-fixture";

const libraryExports = [
  "documentLibraryDescribe",
  "documentLibraryList",
  "documentLibrarySearch",
  "documentLibraryReadOriginal",
];
const pdf = twoPagePdf();
const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAJ/l4eoWQAAAABJRU5ErkJggg==";

function twoPagePdf(): string {
  const stream = (text: string) => {
    const body = `BT /F1 18 Tf 30 250 Td (${text}) Tj ET\n`;
    return `<< /Length ${body.length} >>\nstream\n${body}endstream`;
  };
  const page = (object: number) =>
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 320 320] /Resources << /Font << /F1 5 0 R >> >> /Contents ${object} 0 R >>`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    page(6),
    page(7),
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    stream("Workshop receipt"),
    stream("Amount: 24.50"),
  ];
  let data = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = data.length;
    data += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  data += "% Synthetic padding\n".repeat(60_000);
  const xref = data.length;
  data += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(data).toString("base64");
}

function source(
  pluginId: string,
  name: string,
  title: string,
  mimeType: string,
  base64: string,
  fields?: { id: string; label: string; value: string }[],
  revision: string | null = "r1",
) {
  const source = { pluginId, instanceId: "default" };
  const scope = {
    id: "included",
    included: ["Synthetic records"],
    excluded: [],
    constraints: [],
  };
  const document = {
    title,
    mimeType,
    ref: {
      source,
      id: "42",
      identity: "stable",
      ...(revision && { revision }),
    },
  };
  const original = {
    id: randomUUID(),
    size: Buffer.from(base64, "base64").byteLength,
  };
  const result = (operation: string) => ({
    version: 2,
    source,
    operation,
    scopeId: scope.id,
    status: "ok",
  });
  return {
    installed: {
      id: pluginId,
      enabled: true,
      error: null,
      manifest: {
        id: pluginId,
        schemaVersion: 3,
        name,
        description: "Synthetic source",
        skills: [],
        kind: "source" as const,
        exports: fields
          ? [...libraryExports, "documentLibraryDetails"]
          : libraryExports,
      },
    },
    original: { [original.id]: base64 },
    values: {
      documentLibraryDescribe: {
        version: 2,
        source,
        scope,
        label: name,
        searchCoverage: ["filename"],
        limits: { maxItems: 10 },
      },
      documentLibraryList: {
        ...result("list"),
        items: [document],
        truncated: false,
      },
      documentLibrarySearch: {
        ...result("search"),
        items: [document],
        truncated: false,
      },
      documentLibraryReadOriginal: {
        ...result("readOriginal"),
        document,
        original,
      },
      ...(fields && {
        documentLibraryDetails: {
          ...result("details"),
          ref: document.ref,
          fields,
        },
      }),
    },
  };
}

test.use({ localizationMode: "real" });

function documentsLayout() {
  return {
    records: {
      garden: {
        revision: "saved",
        data: {
          version: 1,
          pinnedViews: [],
          layout: reduceLayout(
            emptyLayout(),
            { type: "open", target: { kind: "view", viewId: "documents" } },
            randomUUID,
          ),
        },
      },
    },
  };
}

for (const mobile of [false, true]) {
  test.describe(() => {
    test.use({ locale: mobile ? "de-DE" : "en-US" });
    test(
      `no document sources offers source creation on ${mobile ? "mobile" : "desktop"}`,
      { tag: mobile ? "@visual-mobile" : "@visual-desktop" },
      async ({ page, visual }) => {
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        );
        await workspaceFixture(
          page,
          { ...shellState, mobile },
          {
            layout: documentsLayout(),
            ...(mobile && {
              localization: {
                language: "de",
                formats: { time: "24", date: "dmy-dot", number: "comma-dot" },
                writable: true,
              },
            }),
          },
        );
        await page.goto("/");
        const library = page.getByRole("main", {
          name: mobile ? "Dokumente" : "Documents",
        });
        await expect(
          library.getByRole("heading", {
            name: mobile
              ? "Deine Dokumente an einem Ort"
              : "Your documents, together",
          }),
        ).toBeVisible();
        await expect(library.getByRole("searchbox")).toHaveCount(0);
        await expect(
          library.getByRole("heading", {
            name: mobile ? "Dokumente" : "Documents",
            exact: true,
          }),
        ).toHaveCount(0);
        const create = library.getByRole("button", {
          name: mobile ? "Quelle erstellen" : "Create a source",
          exact: true,
        });
        await expect(create).toBeVisible();
        await visual.capture("documents.library.no-sources");
        await create.press("Enter");
        await expect(
          page.getByRole("region", {
            name: mobile ? "Unterhaltung" : "Conversation",
            exact: true,
          }),
        ).toBeVisible();
      },
    );
  });
}

test("a disabled document source leaves the Library in the no-sources layout @visual-desktop", async ({
  page,
  visual,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { installed } = source(
    "test-folder",
    "Fixture folder",
    "Scan",
    "image/png",
    png,
  );
  await workspaceFixture(page, shellState, {
    layout: documentsLayout(),
    installedPlugins: [{ ...installed, enabled: false }],
  });
  await page.goto("/");
  const library = page.getByRole("main", { name: "Documents" });
  await expect(
    library.getByRole("heading", { name: "Your documents, together" }),
  ).toBeVisible();
  await expect(library.getByRole("searchbox")).toHaveCount(0);
  await visual.capture("documents.library.no-active-sources");
  await library.getByRole("button", { name: "Sources", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Sources 1", exact: true }),
  ).toBeVisible();
});

test("opens a multipage PDF and an image from two sources in the same Library @visual-desktop", async ({
  page,
  visual,
  visualEnabled,
}) => {
  await page.setViewportSize({ width: 1560, height: 900 });
  const folder = source(
    "test-folder",
    "Fixture folder",
    "Receipt",
    "application/pdf",
    pdf,
    [
      {
        id: "filename",
        label: "Original filename",
        value: "Workshop receipt.pdf",
      },
    ],
  );
  const archive = source(
    "test-archive",
    "Fixture archive",
    "Receipt scan",
    "image/png",
    png,
  );
  await workspaceFixture(page, shellState, {
    layout: documentsLayout(),
    installedPlugins: [folder.installed, archive.installed],
    pluginExportResults: {
      [folder.installed.id]: folder.values,
      [archive.installed.id]: archive.values,
    },
    documentOriginals: { ...folder.original, ...archive.original },
  });
  await page.goto("/");
  const library = page.getByRole("main", { name: "Documents" });
  const search = library.getByRole("searchbox", { name: "Search documents" });
  await expect(search).toBeVisible();
  await expect(library.getByRole("complementary")).toHaveCount(0);
  const clear = library.getByRole("button", { name: "Clear search" });
  await expect(clear).toHaveCount(0);
  await search.fill("Receipt");
  await search.press("Tab");
  await expect(clear).toBeFocused();
  await clear.press("Tab");
  const submit = library.getByRole("button", { name: "Search documents" });
  await expect(submit).toBeFocused();
  await submit.press("Enter");
  const receipt = library.getByRole("button", {
    name: "Receipt Fixture folder",
  });
  await expect(receipt).toBeVisible();
  const searchRequests = await page.evaluate(() =>
    (
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { request?: { exportName?: string; args?: { query?: string } } };
      }[]
    )
      .filter(
        (call) =>
          call.command === "plugin_executor" &&
          call.args.request?.exportName === "documentLibrarySearch",
      )
      .map((call) => call.args.request?.args?.query),
  );
  expect(searchRequests).toEqual(["Receipt", "Receipt"]);
  const scan = library.getByRole("button", {
    name: "Receipt scan Fixture archive",
  });
  const pdfThumbnail = receipt.locator(".doc-thumbnail img");
  await expect(pdfThumbnail).toHaveJSProperty("naturalWidth", 320);
  await expect(scan.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  const imageUrl = await pdfThumbnail.getAttribute("src");
  const chunkOffsets = () =>
    page.evaluate(() =>
      (
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: { offset: number };
        }[]
      )
        .filter((call) => call.command === "plugin_document_chunk")
        .map((call) => call.args.offset),
    );
  const chunksBeforeOpen = (await chunkOffsets()).length;
  await page.mouse.move(0, 0);
  await visual.capture("documents.library.results");
  const holdDocument = (key: string, hold: boolean) =>
    page.evaluate(
      ({ key, hold }) => Reflect.get(window, "__holdDocumentReply")(key, hold),
      { key, hold },
    );
  await holdDocument("chunk", true);
  await holdDocument(folder.installed.id, true);
  await receipt.click();
  const preview = library.getByRole("region", { name: "Document preview" });
  const stage = preview.getByRole("group", { name: "Document preview" });
  const opening = preview.getByText("Opening document…", { exact: true });
  await expect(opening).toBeVisible();
  await expect(stage).toHaveAttribute("aria-busy", "true");
  await expect(pdfThumbnail).toBeVisible();
  await expect(pdfThumbnail).toHaveAttribute("src", imageUrl!);
  await expect(preview.getByRole("button", { name: "Next page" })).toHaveCount(
    0,
  );
  const reservedPdfStage = await stage.boundingBox();
  expect(reservedPdfStage?.height).toBeGreaterThan(300);
  const details = preview.locator("details");
  await expect(details.locator("dt")).toHaveText(["File type"]);
  await holdDocument(folder.installed.id, false);
  await expect(details.locator("dt")).toHaveText([
    "File type",
    "Original filename",
  ]);
  await expect(details.locator("dd")).toHaveText([
    "PDF",
    "Workshop receipt.pdf",
  ]);
  expect(await stage.boundingBox()).toEqual(reservedPdfStage);
  await page.mouse.move(0, 0);
  await visual.capture("documents.library.opening");
  await holdDocument("chunk", false);
  await expect(preview.locator("canvas")).toBeVisible();
  await expect(opening).toHaveCount(0);
  await expect(stage).toHaveAttribute("aria-busy", "false");
  await stage.focus();
  await preview
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) => canvas.focus());
  await expect(stage).toBeFocused();
  await expect(preview.getByText("Document preview ready.")).toBeAttached();
  expect(await stage.boundingBox()).toEqual(reservedPdfStage);
  const detailsRequests = () =>
    page.evaluate(() =>
      (
        Reflect.get(window, "__ipcCalls") as {
          args: { request?: { exportName?: string; args?: unknown } };
        }[]
      ).flatMap(({ args }) =>
        args.request?.exportName === "documentLibraryDetails"
          ? [args.request.args]
          : [],
      ),
    );
  expect(await detailsRequests()).toEqual([
    {
      locale: "en",
      ref: {
        id: "42",
        identity: "stable",
        revision: "r1",
        source: { pluginId: "test-folder", instanceId: "default" },
      },
    },
  ]);
  await expect(
    preview.getByText("Workshop receipt", { exact: true }),
  ).toBeAttached();
  await preview.getByRole("button", { name: "Next page" }).click();
  await expect(
    preview.getByText("Amount: 24.50", { exact: true }),
  ).toBeAttached();
  await expect(
    preview.getByRole("button", { name: "Next page" }),
  ).toBeDisabled();
  expect((await chunkOffsets()).slice(chunksBeforeOpen)).toEqual([
    0,
    1024 * 1024,
  ]);
  await page.mouse.move(0, 0);
  await visual.capture("documents.library.pdf-page");
  await preview.getByRole("button", { name: "Zoom in" }).click();
  await expect(preview.getByText("120%")).toBeVisible();
  const openExternal = preview.getByRole("button", {
    name: "Open in default app",
  });
  const pendingHandoff = preview.getByRole("button", {
    name: "Opening…",
    exact: true,
  });
  const sent = preview.getByText("Sent a copy to the default app.");
  if (!visualEnabled) await page.clock.install();
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000);

  await holdDocument("open", true);
  await openExternal.focus();
  await openExternal.press("Enter");
  await expect(openExternal).toBeDisabled();
  await expect(openExternal).toHaveText("Open");
  await page.clock.runFor(100);
  await expect(pendingHandoff).toHaveCount(0);
  await holdDocument("open", false);
  await expect(sent).toBeAttached();
  await page.clock.runFor(200);
  await expect(pendingHandoff).toHaveCount(0);

  await holdDocument("open", true);
  await openExternal.press("Enter");
  await expect(openExternal).toBeDisabled();
  await page.clock.runFor(199);
  await expect(openExternal).toHaveText("Open");
  await page.clock.runFor(1);
  await expect(pendingHandoff).toBeDisabled();
  await expect(preview.getByText("120%")).toBeVisible();
  await expect(
    preview.getByText("Amount: 24.50", { exact: true }),
  ).toBeAttached();
  await holdDocument("open", false);
  await expect(sent).toBeAttached();
  await page.clock.resume();
  const handoff = await page.evaluate(() => {
    const calls = Reflect.get(window, "__ipcCalls") as {
      command: string;
      args: {
        scope?: string;
        id?: string;
        request?: { readId?: string; args?: unknown };
      };
    }[];
    return calls
      .filter(({ command }) => command === "plugin_document_open")
      .map(
        ({ args }) =>
          calls.find(
            ({ command, args: read }) =>
              command === "plugin_executor" &&
              read.scope === args.scope &&
              read.request?.readId === args.id &&
              read.request?.args,
          )?.args.request?.args,
      );
  });
  const expectedHandoff = {
    ref: {
      id: "42",
      identity: "stable",
      revision: "r1",
      source: { pluginId: "test-folder", instanceId: "default" },
    },
  };
  expect(handoff).toEqual([expectedHandoff, expectedHandoff]);
  await expect(openExternal).toBeFocused();
  await preview.getByRole("button", { name: "Close preview" }).click();
  await expect(receipt).toBeFocused();
  await expect(search).toHaveValue("Receipt");

  await holdDocument(folder.installed.id, true);
  await receipt.click();
  await expect.poll(async () => (await detailsRequests()).length).toBe(2);
  await library
    .getByRole("button", { name: "Receipt scan Fixture archive" })
    .click();
  await holdDocument(folder.installed.id, false);
  await expect(
    preview.getByRole("img", { name: "Receipt scan" }),
  ).toBeVisible();
  await expect(details.locator("dd")).toHaveText(["PNG"]);
  await preview.getByRole("button", { name: "Close preview" }).click();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(search).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await holdDocument("chunk", true);
  await library
    .getByRole("button", { name: "Receipt scan Fixture archive" })
    .click();
  await expect(opening).toBeVisible();
  const reservedImageStage = await stage.boundingBox();
  expect(reservedImageStage?.height).toBeGreaterThan(250);
  await expect(preview.locator("[data-bend-mini]")).toHaveAttribute(
    "data-mini-frame",
    "rest",
  );
  await holdDocument("chunk", false);
  const image = preview.getByRole("img", { name: "Receipt scan" });
  await expect(details.locator("dt")).toHaveText(["File type"]);
  await expect(details.locator("dd")).toHaveText(["PNG"]);
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("animation-name", "none");
  expect(await stage.boundingBox()).toEqual(reservedImageStage);
  await details.getByText("Details", { exact: true }).click();
  await expect(details.getByText("PNG", { exact: true })).toBeHidden();
  await expect
    .poll(() =>
      image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
    )
    .toBe(1);
  await expect(search).toBeHidden();
  await preview.getByRole("button", { name: "Back to results" }).click();
  await expect(
    library.getByRole("button", { name: "Receipt scan Fixture archive" }),
  ).toBeFocused();
  await expect(search).toHaveValue("Receipt");

  await clear.click();
  await expect(search).toBeFocused();
  await expect(search).toHaveValue("");
  await expect(clear).toHaveCount(0);
  await expect(receipt).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            Reflect.get(window, "__ipcCalls") as {
              args: { request?: { exportName?: string } };
            }[]
          ).filter(
            ({ args }) => args.request?.exportName === "documentLibraryList",
          ).length,
      ),
    )
    .toBe(4);
});

test("opens files without a preview and reports a missing default app", async ({
  page,
}) => {
  const table = source(
    "test-folder",
    "Folder",
    "Expense table",
    "text/csv",
    Buffer.from("Item,Amount\nPaper,12\n").toString("base64"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await workspaceFixture(page, shellState, {
    layout: documentsLayout(),
    installedPlugins: [table.installed],
    pluginExportResults: { [table.installed.id]: table.values },
    documentOriginals: table.original,
    documentOpenError: "native.files.external.openFailed",
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Expense table Folder" }).click();
  const preview = page.getByRole("region", { name: "Document preview" });
  await expect(
    preview.getByText("A preview is not available for this file type."),
  ).toBeVisible();
  const openExternal = preview.getByRole("button", {
    name: "Open in default app",
  });
  await expect(openExternal).toBeInViewport({ ratio: 1 });
  await openExternal.focus();
  await openExternal.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText(/Couldn’t open the document in the default app/),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(openExternal).toBeFocused();
  await expect(openExternal).toBeEnabled();
});

test("reuses revisioned thumbnails after reload and clears them when removal is confirmed", async ({
  page,
}) => {
  const archived = source(
    "test-archive",
    "Archive",
    "Archived scan",
    "image/png",
    png,
  );
  const jpeg = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    return canvas.toDataURL("image/jpeg").split(",")[1]!;
  });
  const live = source(
    "test-live",
    "Folder",
    "Live scan",
    "image/jpeg",
    jpeg,
    undefined,
    null,
  );
  await workspaceFixture(page, shellState, {
    layout: documentsLayout(),
    installedPlugins: [archived.installed, live.installed],
    pluginExportResults: {
      [archived.installed.id]: archived.values,
      [live.installed.id]: live.values,
    },
    documentOriginals: { ...archived.original, ...live.original },
    documentThumbnailCache: true,
  });
  const archive = page.getByRole("button", { name: "Archived scan Archive" });
  const current = page.getByRole("button", { name: "Live scan Folder" });
  const originalRequests = () =>
    page.evaluate(() =>
      (
        Reflect.get(window, "__ipcCalls") as {
          args: { request?: { exportName?: string; pluginId: string } };
        }[]
      ).flatMap(({ args }) =>
        args.request?.exportName === "documentLibraryReadOriginal"
          ? [args.request.pluginId]
          : [],
      ),
    );
  await page.goto("/");
  await expect(archive.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await expect(current.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  expect((await originalRequests()).sort()).toEqual([
    "test-archive",
    "test-live",
  ]);

  await page.reload();
  await expect(archive.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await expect(current.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  expect(await originalRequests()).toEqual(["test-live"]);

  await page.evaluate(() =>
    Reflect.get(window, "__removeSourceDocument")("test-archive"),
  );
  await archive.click();
  await expect(archive.locator(".doc-thumbnail img")).toHaveCount(0);
  await expect(current.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith("thumbnail:"),
        ),
      ),
    )
    .toEqual([]);
});

test("bounds background original reads and cancels them when results scroll out of view", async ({
  page,
}) => {
  await page.setViewportSize({ width: 780, height: 500 });
  const fixtures = Array.from({ length: 9 }, (_, index) =>
    source(
      `test-scan-${index}`,
      `Folder ${index}`,
      `Scan ${index}`,
      "image/png",
      png,
    ),
  );
  await workspaceFixture(page, shellState, {
    layout: documentsLayout(),
    installedPlugins: fixtures.map(({ installed }) => installed),
    pluginExportResults: Object.fromEntries(
      fixtures.map(({ installed, values }) => [installed.id, values]),
    ),
    documentOriginals: Object.assign(
      {},
      ...fixtures.map(({ original }) => original),
    ),
    holdDocumentChunks: true,
  });
  await page.goto("/");
  const last = page.getByRole("button", { name: "Scan 8 Folder 8" });
  await expect(last).toBeAttached();
  await expect(last).not.toBeInViewport();
  const documentRequests = () =>
    page.evaluate(() =>
      (
        Reflect.get(window, "__ipcCalls") as {
          command: string;
          args: {
            request?: {
              operation: string;
              exportName?: string;
              pluginId?: string;
              readId?: string;
            };
          };
        }[]
      ).flatMap(({ command, args }) =>
        command === "plugin_executor" && args.request ? [args.request] : [],
      ),
    );
  const originals = async () =>
    (await documentRequests()).filter(
      (request) => request.exportName === "documentLibraryReadOriginal",
    );
  await expect.poll(async () => (await originals()).length).toBe(2);
  const initial = await originals();
  expect(initial.map(({ pluginId }) => pluginId)).not.toContain("test-scan-8");
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await expect
    .poll(
      async () =>
        (await documentRequests()).filter(
          (request) =>
            request.operation === "cancelDocumentRead" &&
            initial.some(({ readId }) => readId === request.readId),
        ).length,
    )
    .toBe(2);
  await page.evaluate(() =>
    Reflect.get(window, "__holdDocumentReply")("chunk", false),
  );
  await expect(last.locator(".doc-thumbnail img")).toHaveJSProperty(
    "naturalWidth",
    1,
  );
});

test("a failed source does not hide results or details from other sources", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const folder = source(
    "test-folder",
    "Fixture folder",
    "Receipt",
    "text/plain",
    png,
    [{ id: "correspondent", label: "Correspondent", value: "Garden club" }],
  );
  const archive = source(
    "test-archive",
    "Fixture archive",
    "Scan",
    "image/png",
    png,
  );
  await workspaceFixture(page, shellState, {
    installedPlugins: [folder.installed, archive.installed],
    pluginExportResults: { [folder.installed.id]: folder.values },
  });
  await page.goto("/");
  const navigation = page.getByRole("navigation", {
    name: "Workspace navigation",
  });
  await navigation.getByRole("button", { name: "More", exact: true }).click();
  await navigation
    .getByRole("button", { name: "Documents", exact: true })
    .click();
  const library = page.getByRole("main", { name: "Documents" });
  await expect(
    library.getByRole("button", { name: "Receipt Fixture folder" }),
  ).toBeVisible();
  await expect(library.getByText("Some results may be missing")).toBeVisible();
  await expect(library.getByText("No documents in these sources")).toHaveCount(
    0,
  );
  await library.getByRole("button", { name: "Receipt Fixture folder" }).click();
  const preview = library.getByRole("region", { name: "Document preview" });
  await expect(
    preview
      .getByRole("status")
      .filter({ hasText: "A preview is not available" }),
  ).toBeVisible();
  await expect(preview.locator("dd")).toHaveText(["text/plain", "Garden club"]);
  await library
    .getByRole("button", { name: "Some results may be missing" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sources 2", exact: true }),
  ).toBeVisible();
});

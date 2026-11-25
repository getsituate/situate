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
    ref: { source, id: "42", identity: "stable", revision: "r1" },
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
  await expect(
    library.getByRole("button", { name: "Save search" }),
  ).toBeDisabled();
  await expect(library.getByText("Available later").first()).toBeVisible();
  await search.fill("Receipt");
  await search.press("Enter");
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
  const offsets = await page.evaluate(() =>
    (
      Reflect.get(window, "__ipcCalls") as {
        command: string;
        args: { offset: number };
      }[]
    )
      .filter((call) => call.command === "plugin_document_chunk")
      .map((call) => call.args.offset),
  );
  expect(offsets).toEqual([0, 1024 * 1024]);
  await page.mouse.move(0, 0);
  await visual.capture("documents.library.pdf-page");
  await preview.getByRole("button", { name: "Zoom in" }).click();
  await expect(preview.getByText("120%")).toBeVisible();
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
  await library.getByRole("button", { name: "Browse", exact: true }).click();
  const browse = page.getByRole("dialog", { name: "Browse" });
  await expect(
    browse.getByText("Saved searches", { exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(browse).toBeHidden();
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
  await expect(search).toHaveValue("Receipt");
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
  await expect(preview.getByRole("status")).toBeVisible();
  await expect(preview.locator("dd")).toHaveText(["text/plain", "Garden club"]);
  await library
    .getByRole("button", { name: "Some results may be missing" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sources 2", exact: true }),
  ).toBeVisible();
});

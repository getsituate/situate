import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { assertUiModule } from "./ui-boundary.mjs";

const client = fileURLToPath(new URL("..", import.meta.url));
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.(?:vue|[cm]?[jt]s)$/.test(path)
        ? [path]
        : [];
  });
}
function imports(text, file) {
  const scripts = file.endsWith(".vue")
    ? [...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(
        (match) => match[1],
      )
    : [text];
  return scripts.flatMap((script) =>
    ts.preProcessFile(script).importedFiles.map((item) => item.fileName),
  );
}

function resolveImport(specifier, file) {
  const request = specifier.split("?")[0];
  if (request.startsWith(".")) return resolve(dirname(file), request);
  return (
    ts.resolveModuleName(
      request,
      file,
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      ts.sys,
    ).resolvedModule?.resolvedFileName ?? createRequire(file).resolve(request)
  );
}

test("public Vue component exports resolve without bypassing UI boundaries", () => {
  const file = join(client, "app/src/plugins/ui.ts");
  const component = resolveImport("@situate/ui/components/SituateButton", file);
  assert.equal(component, join(client, "packages/ui/src/SituateButton.vue"));
  assert.doesNotThrow(() =>
    assertUiModule(component, [join(client, "packages/ui")]),
  );
  assert.throws(() =>
    assertUiModule(component, [
      join(client, "workshop"),
      join(client, "node_modules"),
    ]),
  );
  assert.throws(() =>
    resolveImport("@situate/ui/components/DoesNotExist", file),
  );
});

test("asset queries still resolve and enforce the boundary of the underlying module", () => {
  const file = join(client, "app/src/documents/DocumentReading.vue");
  const worker = resolveImport("pdfjs-dist/build/pdf.worker.min.mjs?url", file);
  assert.equal(
    worker,
    join(client, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"),
  );
  assert.throws(
    () => assertUiModule(worker, [join(client, "app")]),
    /crosses the application boundary/,
  );
  assert.throws(() => resolveImport("pdfjs-dist/build/missing.mjs?url", file), {
    code: "MODULE_NOT_FOUND",
  });
});

test("UI source boundaries include type-only and test imports", () => {
  assert.deepEqual(
    imports(
      "import type { State } from '../../workshop/src/model';",
      "example.ts",
    ),
    ["../../workshop/src/model"],
  );
  for (const [directories, allowed] of [
    [
      ["app/src", "app/tests", "packages/ui/src", "packages/localization/src"],
      [
        "app",
        "packages/ui",
        "packages/localization",
        "contracts/diagnostics.json",
        "contracts/keyboard-shortcuts.json",
        "../design/brand",
        "node_modules",
      ],
    ],
    [
      ["workshop/src", "workshop/tests"],
      ["workshop", "node_modules"],
    ],
  ]) {
    const roots = allowed.map((path) => resolve(client, path));
    for (const file of directories.flatMap((path) =>
      sources(join(client, path)),
    )) {
      for (const specifier of imports(readFileSync(file, "utf8"), file)) {
        if (isBuiltin(specifier)) continue;
        const dependency = resolveImport(specifier, file);
        assert.ok(dependency, `Cannot resolve ${specifier} from ${file}`);
        assert.doesNotThrow(
          () =>
            assertUiModule(
              dependency,
              file.startsWith(join(client, "app") + sep) &&
                /\.(test|spec)\.ts$/.test(file)
                ? [...roots, resolve(client, "contracts")]
                : roots,
            ),
          `${file}: ${specifier}`,
        );
      }
    }
  }
});

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
  if (specifier.startsWith(".")) return resolve(dirname(file), specifier);
  return (
    ts.resolveModuleName(
      specifier,
      file,
      {
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
      },
      ts.sys,
    ).resolvedModule?.resolvedFileName ?? createRequire(file).resolve(specifier)
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

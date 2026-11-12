import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const library = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ui/src",
);

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory()
      ? sources(path)
      : /\.(vue|ts|css)$/.test(path)
        ? [path]
        : [];
  });
}

describe("UI library dependencies", () => {
  it("keeps components independent of application and workshop sources", () => {
    const files = sources(library);
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) {
      const source = readFileSync(path, "utf8");
      const references = source.matchAll(
        /(?:\bfrom\s*|\bimport\s*\(\s*|@import\s+|\bsrc=)\s*["']([^"']+)["']/g,
      );
      for (const [, specifier] of references) {
        if (specifier.startsWith(".")) {
          const dependency = relative(
            library,
            resolve(dirname(path), specifier),
          );
          expect(
            dependency.startsWith(".."),
            `${relative(library, path)}: ${specifier}`,
          ).toBe(false);
        } else {
          expect(
            ["vue", "@situate/localization"],
            relative(library, path),
          ).toContain(specifier);
        }
      }
    }
  });
});

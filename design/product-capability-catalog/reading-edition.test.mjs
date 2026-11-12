import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const setup = `
import importlib.util
from pathlib import Path
import tempfile

path = Path("docs/product-capability-catalog/generate-reading-edition.py")
spec = importlib.util.spec_from_file_location("catalog", path)
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)
sources = {name: (catalog.ROOT / name).read_text(encoding="utf-8")
           for name in ["README.md", *(area + ".md" for area in catalog.AREAS)]}

def rejected(action, message):
    try:
        action()
    except ValueError as error:
        assert message in str(error), str(error)
    else:
        raise AssertionError("Expected rejection: " + message)
`;

function python(program) {
  const result = spawnSync("python3", ["-B", "-c", setup + program], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
}

test("saved reading edition preserves all source sections, IDs, statuses and links", () => {
  python(`
result, chunks, toc = catalog.assemble(sources)
actual = catalog.OUTPUT.read_text(encoding="utf-8")
assert catalog.normalized(actual) == catalog.normalized(result)
assert len(toc) == 15
assert len(chunks) == 12
assert catalog.verify(actual, sources, chunks, toc) > 0
`);
});

test("generation rejects an unexpected capability identifier", () => {
  python(`
sources["notes.md"] = sources["notes.md"].replace("### N01 —", "### N99 —")
rejected(lambda: catalog.assemble(sources), "Unexpected capability list")
`);
});

test("generation rejects overview sections that have not been assigned a location", () => {
  python(`
sources["README.md"] += "\\n## Unassigned section\\n\\nSynthetic fixture.\\n"
rejected(lambda: catalog.assemble(sources), "Unassigned overview section")
`);
});

test("verification rejects invalid support vocabulary and changes to document target status", () => {
  python(`
original = dict(sources)
sources["plugins.md"] = sources["plugins.md"].replace("Support: **Supported**.", "Support: **Guaranteed**.", 1)
result, chunks, toc = catalog.assemble(sources)
rejected(lambda: catalog.verify(result, sources, chunks, toc), "Invalid status")
sources = dict(original)
sources["documents.md"] = sources["documents.md"].replace("**Support:** Not supported at reviewed revision. Tentative future target.", "**Support:** Supported.", 1)
result, chunks, toc = catalog.assemble(sources)
rejected(lambda: catalog.verify(result, sources, chunks, toc), "Document target status changed")
`);
});

test("verification rejects omitted area content and duplicate anchors", () => {
  python(`
result, chunks, toc = catalog.assemble(sources)
omitted = result.replace("Benefit: Develop free-form thoughts", "Benefit: Different synthetic text", 1)
rejected(lambda: catalog.verify(omitted, sources, chunks, toc), "Area content omitted")
rejected(lambda: catalog.verify(result + "\\n## Notes\\n", sources, chunks, toc), "Duplicate generated anchors")
`);
});

test("verification rejects a contents list that does not match the chapters", () => {
  python(`
result, chunks, toc = catalog.assemble(sources)
broken = result.replace("- [Functional areas](#functional-areas)", "- [Wrong chapter](#notes)", 1)
rejected(lambda: catalog.verify(broken, sources, chunks, toc), "Contents differs")
`);
});

test("link validation rejects missing files, references, anchors and source line ranges", () => {
  python(`
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    markdown = root / "fixture.md"
    markdown.write_text("# Fixture\\n", encoding="utf-8")
    code = root / "source.py"
    code.write_text("pass\\n", encoding="utf-8")
    for text, message in [
        ("[missing](missing.md)", "Missing file"),
        ("[missing][undefined]", "Missing reference definition"),
        ("# Fixture\\n[missing](#absent)", "Missing anchor"),
        ("[source](source.py#L2)", "Invalid line range"),
    ]:
        rejected(lambda: catalog.validate_links(markdown, text, ""), message)
`);
});

test("normalization ignores table padding but preserves paragraph boundaries", () => {
  python(`
assert catalog.normalized("| A | B |\\n| --- | --- |") == catalog.normalized("|A|B|\\n|---|---|")
assert catalog.normalized("First paragraph.\\n\\nSecond paragraph.") != catalog.normalized("First paragraph. Second paragraph.")
`);
});

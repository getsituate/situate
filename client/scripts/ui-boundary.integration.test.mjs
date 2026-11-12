import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { uiBoundary } from "./ui-boundary.mjs";

async function compile(t, source, css = "") {
  const root = mkdtempSync(join(tmpdir(), "situate-ui-build-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const app = join(root, "app");
  mkdirSync(app);
  mkdirSync(join(root, "other"));
  writeFileSync(
    join(app, "index.html"),
    '<script type="module" src="/main.js"></script>',
  );
  writeFileSync(join(app, "main.js"), source);
  writeFileSync(join(app, "theme.css"), css);
  writeFileSync(join(root, "other/view.js"), 'export default "outside";');
  writeFileSync(join(root, "other/theme.css"), "body { color: red; }");
  writeFileSync(
    join(root, "other/mark.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"/>',
  );
  return build({
    root: app,
    configFile: false,
    logLevel: "silent",
    plugins: [uiBoundary([app])],
    build: { write: false, assetsInlineLimit: 0 },
  });
}

test("independent UI builds accept local styles", async (t) => {
  await assert.doesNotReject(
    compile(t, 'import "./theme.css";', "body { color: purple; }"),
  );
});
for (const [label, source, css] of [
  [
    "static import",
    'import value from "../other/view.js"; console.log(value);',
    "",
  ],
  ["dynamic import", 'import("../other/view.js").then(console.log);', ""],
  [
    "raw import",
    'import value from "../other/mark.svg?raw"; console.log(value);',
    "",
  ],
  ["CSS import", 'import "./theme.css";', '@import "../other/theme.css";'],
  [
    "CSS image",
    'import "./theme.css";',
    'body { background: url("../other/mark.svg"); }',
  ],
]) {
  test(`independent UI builds reject cross-boundary ${label}`, async (t) => {
    await assert.rejects(compile(t, source, css), /application boundary/);
  });
}

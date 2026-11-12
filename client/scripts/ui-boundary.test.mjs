import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { assertUiModule } from "./ui-boundary.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "situate-ui-boundary-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const name of ["app", "workshop", "node_modules", "packages/ui"])
    mkdirSync(join(root, name), { recursive: true });
  return root;
}

test("each app permits its own source and external dependencies, not sibling UI", (t) => {
  const root = fixture(t);
  for (const name of ["app", "workshop"]) {
    const roots = [join(root, name), join(root, "node_modules")];
    assert.doesNotThrow(() =>
      assertUiModule(
        join(root, name, "Surface.vue") + "?vue&type=style",
        roots,
      ),
    );
    assert.doesNotThrow(() =>
      assertUiModule(join(root, "node_modules/vue/index.js"), roots),
    );
    assert.doesNotThrow(() => assertUiModule("\0vite:helper", roots));
    for (const sibling of ["app", "workshop", "packages/ui"].filter(
      (other) => other !== name,
    )) {
      assert.throws(
        () => assertUiModule(join(root, sibling, "Surface.vue"), roots),
        /application boundary/,
      );
    }
    assert.throws(
      () => assertUiModule(join(root, `${name}-other`, "Surface.vue"), roots),
      /application boundary/,
    );
  }
});

test("an exact contract file root does not permit sibling contracts", (t) => {
  const root = fixture(t);
  mkdirSync(join(root, "contracts"));
  const contract = join(root, "contracts/diagnostics.json");
  writeFileSync(contract, "{}");
  const roots = [join(root, "app"), contract];
  for (const id of [
    contract,
    contract + "?import",
    pathToFileURL(contract).href,
  ])
    assert.doesNotThrow(() => assertUiModule(id, roots));
  for (const id of [
    join(root, "contracts/other.json"),
    join(root, "contracts/diagnostics.json-other"),
  ])
    assert.throws(() => assertUiModule(id, roots), /application boundary/);
});

test("query strings, file URLs and symlinks cannot hide a sibling dependency", (t) => {
  const root = fixture(t);
  const foreign = join(root, "packages/ui/Button.vue");
  writeFileSync(foreign, "<template>Button</template>");
  symlinkSync(
    join(root, "packages/ui"),
    join(root, "node_modules/ui"),
    "junction",
  );
  symlinkSync(
    join(root, "packages/ui"),
    join(root, "workshop/shared"),
    "junction",
  );
  const roots = [join(root, "workshop"), join(root, "node_modules")];
  for (const id of [
    foreign + "?raw",
    pathToFileURL(foreign).href,
    join(root, "node_modules/ui/Button.vue"),
    join(root, "workshop/shared/Button.vue"),
  ]) {
    assert.throws(() => assertUiModule(id, roots), /application boundary/);
  }
});

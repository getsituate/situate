import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  checkSource,
  checkBrowserImports,
  loadCatalogs,
  validateCatalogs,
} from "./localization-check.mjs";

const en = { "app.title": "Title", "app.hello": "Hello {name}" };
const checkVue = (source) => checkSource(source, "Example.vue", en);

test("English model prompts require a marked tool schema, without exempting nearby UI copy", () => {
  const tool = `
    import { modelToolPrompt as prompt } from "./tool-instructions";
    const tool = {
      name: "read", label: prompt("Read"), description: prompt("Read a workspace file"),
      parameters: Type.Object({path: Type.String({description: prompt("Relative path")})}),
      execute: async () => ({content:[]}),
    };
  `;
  assert.deepEqual(checkSource(tool, "tools.ts", en), []);
  assert.equal(
    checkSource(
      `${tool}\nconst ui = {\nlabel:"Visible label",\ndescription:"Visible description"\n};`,
      "tools.ts",
      en,
    ).length,
    2,
  );
  assert.ok(
    checkSource(
      `${tool}\nconst ui = {description:prompt("Visible description")};`,
      "tools.ts",
      en,
    ).length,
  );
  assert.ok(
    checkSource(
      `import {modelToolPrompt} from "./tool-instructions";
    const tool = {name:"read", parameters:Type.Object({}), execute() { return {description:modelToolPrompt("Visible description")}; }};`,
      "tools.ts",
      en,
    ).length,
  );
  assert.ok(
    checkSource(
      `const tool = {name:"read",parameters:Type.Object({}),description:"Unmarked description"};`,
      "tools.ts",
      en,
    ).length,
  );
});

test("catalog parity, nonempty entries and interpolation parity are required", () => {
  assert.deepEqual(
    validateCatalogs({
      en,
      de: { "app.title": "Titel", "app.hello": "Hallo {name}" },
    }),
    [],
  );
  const errors = validateCatalogs({
    en,
    de: { "app.hello": "Hallo {person}", extra: "" },
  });
  assert.equal(errors.length, 4);
  assert.ok(errors.some((error) => error.includes("missing key app.title")));
  assert.ok(errors.some((error) => error.includes("parameter mismatch")));
  assert.ok(errors.some((error) => error.includes("extra key")));
  assert.ok(errors.some((error) => error.includes("empty or non-string")));
});

test("catalog loading merges suffixes and rejects duplicate keys within and between files", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "localization-catalogs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, "en.json"), '{"one":"One","one":"Duplicate"}');
  writeFileSync(join(directory, "en.ui.json"), '{"one":"Again","two":"Two"}');
  writeFileSync(join(directory, "de.json"), '{"one":"Eins"}');
  writeFileSync(join(directory, "de.ui.json"), '{"two":"Zwei"}');
  const { catalogs, errors } = loadCatalogs(directory);
  assert.equal(catalogs.de.two, "Zwei");
  assert.equal(
    errors.filter((error) => error.includes("duplicate key")).length,
    2,
  );
});

test("Vue text and static or bound accessible attributes cannot contain product copy", () => {
  for (const source of [
    "<template><button>Save</button></template>",
    '<template><input placeholder="Speichern" /></template>',
    "<template><button :aria-label=\"'Save'\" /></template>",
    "<template><p>{{ ready ? 'Ready' : 'Waiting' }}</p></template>",
    "<template><p>{{ `Hello ${name}` }}</p></template>",
    '<template><Widget label="保存" /></template>',
    "<template><p v-text=\"'Welcome'\" /></template>",
  ])
    assert.ok(checkVue(source).length, source);
});

test("bound identifiers, computed values and function returns are inspected at template sinks", () => {
  for (const script of [
    "const label = 'Save';",
    "const label = computed(() => ready ? 'Ready' : 'Waiting');",
    "const label = ref(''); label.value = 'Save';",
    "function getLabel() { if (ready) return 'Ready'; return 'Waiting'; } const label = computed(() => getLabel());",
    "const item = { name: 'Save' }; const label = item.name;",
  ])
    assert.ok(
      checkVue(
        `<script setup lang="ts">${script}</script><template><button :aria-label="label" /></template>`,
      ).length,
      script,
    );
});

test("known literal translation calls are accepted and dynamic or unknown keys rejected", () => {
  assert.deepEqual(
    checkVue(
      '<template><p>{{ t("app.title") }} · {{ t("app.hello", { name }) }}</p></template>',
    ),
    [],
  );
  assert.ok(
    checkVue("<template><p>{{ t(key) }}</p></template>").some((error) =>
      error.includes("static string"),
    ),
  );
  assert.ok(
    checkVue('<template><p>{{ t("missing") }}</p></template>').some((error) =>
      error.includes("Unknown translation key"),
    ),
  );
  assert.ok(
    checkSource(
      'import { t as translate } from "@situate/localization"; translate("missing");',
      "example.ts",
      en,
    ).some((error) => error.includes("Unknown translation key")),
  );
  assert.ok(
    checkVue('<template><p>{{ t("app.hello") }}</p></template>').some((error) =>
      error.includes("Missing parameters"),
    ),
  );
  assert.ok(
    checkVue(
      '<template><p>{{ t("app.hello", { other: name }) }}</p></template>',
    ).some((error) => error.includes("Parameter names")),
  );
});

test("finite local key maps and explicitly typed catalog-key props are accepted", () => {
  assert.deepEqual(
    checkVue(`<script setup lang="ts">
    const props = defineProps<{ error: MessageKey | '' }>();
    const choices: { key: MessageKey }[] = [{ key: 'app.title' }];
  </script><template><p v-if="error">{{ t(error) }}</p><option v-for="item in choices">{{ t(item.key) }}</option></template>`),
    [],
  );
  assert.ok(
    checkVue(
      `<script setup lang="ts">const choices = [{ key: 'missing' }];</script><template><p v-for="item in choices">{{ t(item.key) }}</p></template>`,
    ).some((error) => error.includes("Unknown translation key")),
  );
  assert.ok(
    checkVue(
      `<script setup lang="ts">const props = defineProps<{ key: string }>();</script><template><p>{{ t(key) }}</p></template>`,
    ).some((error) => error.includes("finite catalog-key")),
  );
  assert.deepEqual(
    checkSource(
      "const key = ready ? 'app.title' : 'app.title'; t(key);",
      "keys.ts",
      en,
    ),
    [],
  );
});

test("content domains exempt only leaf content, not product attributes or unknown keys", () => {
  assert.deepEqual(
    checkVue(
      '<template><span data-localization-content="user">{{ file.name }}</span></template>',
    ),
    [],
  );
  assert.ok(
    checkVue(
      '<template><span data-localization-content="user" title="Rename">{{ file.name }}</span></template>',
    ).length,
  );
  assert.ok(
    checkVue(
      '<template><div data-localization-content="user"><button>Save</button></div></template>',
    ).length,
  );
  assert.ok(
    checkVue(
      '<template><span data-localization-content="user">{{ t("missing") }}</span></template>',
    ).length,
  );
  assert.deepEqual(
    checkVue(
      '<template><article class="markdown" data-localization-content="user" v-html="safeHtml" /></template>',
    ),
    [],
  );
});

test("identifiable TypeScript UI sinks catch literals and conditional templates without checking machine values", () => {
  assert.ok(
    checkSource(
      "const entries = [{ action: 'read', label: 'Read' }];",
      "menu.ts",
      en,
    ).length,
  );
  assert.ok(
    checkSource(
      "state.error = ready ? 'Failed' : `Failed ${name}`;",
      "state.ts",
      en,
    ).length,
  );
  assert.ok(
    checkSource("element.setAttribute('aria-label', 'Save');", "view.ts", en)
      .length,
  );
  assert.deepEqual(
    checkSource(
      "const request = { method: 'POST', path: '/api' }; const entries = [{ action: 'read', label: t('app.title') }];",
      "menu.ts",
      en,
    ),
    [],
  );
});

test("CSS generated prose and attribute content are rejected, decorative glyphs pass", () => {
  for (const content of ['"Save"', '"\\53 ave"', "attr(data-label)", '"保存"'])
    assert.ok(
      checkSource(`p::before { content: ${content}; }`, "style.css", en).length,
      content,
    );
  assert.deepEqual(
    checkSource(
      'p::before { content: "•"; } p::after { content: none; }',
      "style.css",
      en,
    ),
    [],
  );
  assert.ok(
    checkVue(
      '<template><p /></template><style>p::before { content: "Welcome"; }</style>',
    ).length,
  );
});

test("every product browser spec imports the automatic fixture", () => {
  assert.deepEqual(
    checkBrowserImports(
      "import { test, expect } from './test';",
      "screen.spec.ts",
    ),
    [],
  );
  assert.ok(
    checkBrowserImports(
      "import { test } from '@playwright/test';",
      "screen.spec.ts",
    ).length,
  );
  assert.ok(
    checkBrowserImports("import { expect } from './test';", "screen.spec.ts")
      .length,
  );
  assert.ok(
    checkBrowserImports(
      "import { test as raw } from '@playwright/test'; import { test } from './test';",
      "screen.spec.ts",
    ).length,
  );
});

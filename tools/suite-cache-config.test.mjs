import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { cacheConfigurations } from "./fixtures/suite-cache.mjs";
import {
  CacheConfigurationError,
  suiteConfigurationFiles,
  validateSuiteConfiguration,
} from "./suite-cache-config.mjs";

const coreFile = "client/crates/situate-core/Cargo.toml";
const workspaceFile = "client/Cargo.toml";
const typesFile = "client/app/tsconfig.json";
const vitestFile = "client/app/vitest.config.ts";
const boundaryFile = "client/scripts/ui-boundary.mjs";
const suite = (id = "client-types") => ({
  id,
  cwd:
    id === "client-core"
      ? "client"
      : id.startsWith("workshop-")
        ? "client/workshop"
        : "client/app",
});
const validate = (file, source, id) =>
  validateSuiteConfiguration(file, Buffer.from(source), suite(id));
const rejected = (file, source, id) =>
  assert.throws(
    () => validate(file, source, id),
    (error) => error instanceof CacheConfigurationError && error.file === file,
  );

test("supported suite configurations pass eligibility checks", () => {
  for (const id of [
    "client-core",
    "client-types",
    "client-vue",
    "workshop-types",
    "workshop-vue",
  ])
    for (const file of suiteConfigurationFiles(suite(id)))
      validate(file, cacheConfigurations[file], id);
});

test("Cargo accepts registry updates, feature changes and ordinary TOML formatting", () => {
  for (const source of [
    cacheConfigurations[coreFile].replace('version = "1.0"', 'version = "2.1"'),
    cacheConfigurations[coreFile].replace(
      '["std"]',
      '[\n  "std", # enabled\n  "extra",\n]',
    ),
    cacheConfigurations[coreFile].replace(
      "[dependencies]",
      '# registry inputs\n[dependencies]\nadditional = "^2.1"',
    ),
    cacheConfigurations[coreFile].replace(
      'fixture = { version = "1.0", features = ["std"], default-features = false }',
      '[dependencies.fixture]\nversion = "1.0"\nfeatures = ["std"]\ndefault-features = false',
    ),
    cacheConfigurations[coreFile] + '\n[features]\ndefault = ["fixture/std"]\n',
    cacheConfigurations[coreFile].replace(
      'name = "situate-core"',
      '"name" = "situate-core" # package',
    ),
    cacheConfigurations[coreFile] +
      '\n[dev-dependencies]\nother = { version = "1", optional = true, package = "renamed" }\n',
  ])
    validate(coreFile, source, "client-core");
  validate(
    workspaceFile,
    cacheConfigurations[workspaceFile].replace(
      'version = "0.0.1"',
      'version = "1.2.3"',
    ),
    "client-core",
  );
});

test("Cargo rejects external dependency mechanisms, build hooks and custom targets", () => {
  for (const source of [
    cacheConfigurations[coreFile] +
      '\n[build-dependencies]\nexternal = { path = "../../outside" }\n',
    cacheConfigurations[coreFile] +
      '\n[patch.crates-io]\nfixture = { path = "../../outside" }\n',
    cacheConfigurations[coreFile] +
      '\n[replace]\n"fixture:1.0" = { path = "../../outside" }\n',
    cacheConfigurations[coreFile] + '\n[lib]\npath = "../../outside.rs"\n',
    cacheConfigurations[coreFile] +
      '\n[[test]]\nname = "outside"\npath = "../../outside.rs"\n',
    cacheConfigurations[coreFile].replace(
      'name = "situate-core"',
      'name = "situate-core"\nbuild = "../../build.rs"',
    ),
    cacheConfigurations[coreFile].replace(
      'name = "situate-core"',
      'name = "situate-core"\nworkspace = "../../outside"',
    ),
    ...[
      'path = "../../outside"',
      'git = "https://example.invalid/repository"',
      'registry = "custom"',
      "workspace = true",
    ].map((extra) =>
      cacheConfigurations[coreFile].replace(
        'version = "1.0"',
        `version = "1.0", ${extra}`,
      ),
    ),
    cacheConfigurations[coreFile].replace(
      'native-fixture = "1"',
      'native-fixture = { version = "1", path = "../../outside" }',
    ),
  ])
    rejected(coreFile, source, "client-core");
  for (const member of [
    "crates/test-results/example",
    "../outside",
    "crates/../../outside",
    "crates//outside",
    "/outside",
    "crates/*",
  ])
    rejected(
      workspaceFile,
      cacheConfigurations[workspaceFile].replace(
        '"crates/situate-core"',
        `"crates/situate-core", ${JSON.stringify(member)}`,
      ),
      "client-core",
    );
});

test("Cargo fully consumes input and rejects duplicates, escaping and unsupported syntax", () => {
  for (const source of [
    cacheConfigurations[coreFile] + '\n[dependencies]\nother = "1"\n',
    cacheConfigurations[coreFile].replace(
      'name = "situate-core"',
      'name = "situate-core"\nname = "other"',
    ),
    cacheConfigurations[coreFile].replace(
      'version = "1.0"',
      'version = "1.0", version = "2.0"',
    ),
    cacheConfigurations[coreFile].replace(
      'version = "1.0"',
      'version = "1.0", "pa\\u0074h" = "../../outside"',
    ),
    cacheConfigurations[coreFile].replace(
      'version = "1.0"',
      'version = """1.0"""',
    ),
    cacheConfigurations[coreFile] + "\nthis is not TOML\n",
    cacheConfigurations[coreFile] + '\n[package.metadata]\nvalue = "unknown"\n',
  ])
    rejected(coreFile, source, "client-core");
});

test("TypeScript accepts bounded option changes but not expanded input resolution", () => {
  const config = JSON.parse(cacheConfigurations[typesFile]);
  for (const options of [
    { ...config.compilerOptions, strict: false },
    {
      ...config.compilerOptions,
      target: "ES2022",
      lib: ["ES2022", "DOM.Iterable"],
    },
    {
      ...config.compilerOptions,
      noUnusedLocals: true,
      types: ["vite/client", "node"],
    },
  ])
    validate(
      typesFile,
      JSON.stringify({ ...config, compilerOptions: options }),
    );
  for (const extra of [
    { extends: "../../outside.json" },
    { references: [{ path: "../../outside" }] },
    { files: ["../../outside.ts"] },
    { vueCompilerOptions: { plugins: ["outside"] } },
    { include: ["../../outside/**/*.ts"] },
    { include: ["../workshop/src/**/*.ts"] },
    {
      compilerOptions: {
        ...config.compilerOptions,
        plugins: [{ name: "outside" }],
      },
    },
    {
      compilerOptions: {
        ...config.compilerOptions,
        paths: { outside: ["../../outside"] },
      },
    },
    {
      compilerOptions: {
        ...config.compilerOptions,
        typeRoots: ["../../outside"],
      },
    },
    {
      compilerOptions: { ...config.compilerOptions, types: ["../../outside"] },
    },
    { compilerOptions: { ...config.compilerOptions, noEmit: false } },
  ])
    rejected(typesFile, JSON.stringify({ ...config, ...extra }));
  rejected(
    typesFile,
    '{"compilerOptions":{"noEmit":true},"include":["src/**/*.ts"],"include":["src/**/*.vue"]}',
  );
  rejected(typesFile, cacheConfigurations[typesFile] + "// not strict JSON");
});

test("Vitest accepts literal options, comments and known bounded source roots", () => {
  for (const source of [
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      "clearMocks: false, passWithNoTests: false",
    ),
    cacheConfigurations[vitestFile].replace('"jsdom"', "'node'"),
    cacheConfigurations[vitestFile].replace(
      "const sourceRoots",
      "/* module roots */\nconst sourceRoots",
    ),
    cacheConfigurations[vitestFile].replace(
      '[".", "../node_modules"]',
      '[".", "../node_modules", "../packages/ui"]',
    ),
    cacheConfigurations[vitestFile].replace(
      "test: {",
      'server: { fs: { allow: sourceRoots } }, test: { setupFiles: ["./src/test-setup.ts"],',
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      'clearMocks: true, coverage: { provider: "v8", include: ["src/**/*.{ts,vue}"], exclude: ["src/**/*.test.ts"], reporter: ["text", "lcov", "html"], reportsDirectory: "../target/coverage/vue" }',
    ),
  ])
    validate(vitestFile, source, "client-vue");
});

test("Vitest unit exclusions accept only the literal default and executor boundary patterns", () => {
  const original = cacheConfigurations[vitestFile];
  const source = original.replace(
    "test: {",
    'test: { exclude: ["**/node_modules/**", "**/.git/**", "src/plugins/executor-boundary.test.ts"],',
  );
  validate(vitestFile, source, "client-vue");
  validate(
    vitestFile,
    readFileSync(
      new URL("../client/app/vitest.config.ts", import.meta.url),
      "utf8",
    ),
    "client-vue",
  );
  for (const value of [
    '"src/plugins/executor-boundary.test.ts"',
    "null",
    "true",
    "{}",
    "[1]",
    "[null]",
    '["src/**/*.test.ts"]',
    '["../../outside/**/*.test.ts"]',
    '["src/{..,x}/outside.test.ts"]',
    "defaultExclude",
    "configDefaults.exclude",
    "process.env.EXCLUDES",
    '[...configDefaults.exclude, "src/plugins/executor-boundary.test.ts"]',
    '(() => ["src/plugins/executor-boundary.test.ts"])()',
    "[outside()]",
  ])
    rejected(
      vitestFile,
      original.replace("test: {", `test: { exclude: ${value},`),
      "client-vue",
    );
});

test("Vitest rejects arbitrary execution, added imports and paths outside captured roots", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "cache-policy-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const marker = join(directory, "executed");
  for (const source of [
    cacheConfigurations[vitestFile] +
      `\nimport("node:fs").then(fs => fs.writeFileSync(${JSON.stringify(marker)}, "executed"));`,
    cacheConfigurations[vitestFile] + '\nthrow new Error("appended");',
    ...["\\r", "\\n", "\\u2028", "\\u2029"].flatMap((terminator) => {
      const lineBreak = JSON.parse(`"${terminator}"`);
      return [
        cacheConfigurations[vitestFile] +
          `// comment${lineBreak}throw new Error("outside input");`,
        cacheConfigurations[vitestFile].replace(
          "const sourceRoots",
          `// comment${lineBreak}outside();\nconst sourceRoots`,
        ),
      ];
    }),
    ...[
      "src/{..,x}/dist/**/*.test.ts",
      "src/{..,x}/test-results/**/*.test.ts",
    ].map((pattern) =>
      cacheConfigurations[vitestFile].replace(
        '"src/**/*.test.ts"',
        JSON.stringify(pattern),
      ),
    ),
    cacheConfigurations[vitestFile].replace(
      "const sourceRoots",
      'import outside from "outside";\nconst sourceRoots',
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      '["clearMocks"]: true',
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      "get clearMocks() { return true; }",
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      "clearMocks: (() => true)()",
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      "clearMocks: true, ...outside",
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      "clearMocks: true, clearMocks: false",
    ),
    cacheConfigurations[vitestFile].replace(
      '[".", "../node_modules"]',
      '[".", "../node_modules", "../../outside"]',
    ),
    cacheConfigurations[vitestFile].replace(
      '"src/**/*.test.ts"',
      '"../../outside/**/*.test.ts"',
    ),
    cacheConfigurations[vitestFile].replace(
      "clearMocks: true",
      'clearMocks: true, setupFiles: ["src/../../outside.ts"]',
    ),
    cacheConfigurations[vitestFile].replace("vue()", "outside()"),
    cacheConfigurations[vitestFile].replace(
      'environment: "jsdom"',
      "environment: process.env.ENVIRONMENT",
    ),
  ])
    rejected(vitestFile, source, "client-vue");
  assert.equal(existsSync(marker), false);
});

test("the executable UI boundary retains an explicit known-source trust anchor", () => {
  const original = cacheConfigurations[boundaryFile];
  validate(
    boundaryFile,
    original.replace(/^/gm, "  ").replace(/$/gm, "\t"),
    "client-vue",
  );
  for (const source of [
    original.replace('"node:fs"', '"node:fs/promises"'),
    original.replace("assertUiModule(id, roots);", "outside(id, roots);"),
    original.replace("UI import crosses", "Outside import crosses"),
    original + "\nprocess.exit(0);\n",
    original.replace(
      "return realpathSync(absolute);",
      "return\nrealpathSync(absolute);",
    ),
  ])
    rejected(boundaryFile, source, "client-vue");
});

import { readFileSync } from "node:fs";

let boundarySource;
try {
  boundarySource = readFileSync(
    new URL("./suite-cache-policy/ui-boundary.mjs", import.meta.url),
    "utf8",
  );
} catch {
  // Missing policy data disables reuse, not the underlying test execution.
}
const normalizeBoundary = (source) => source.replace(/^[\t ]+|[\t ]+$/gm, "");
const rootsReference = Symbol("sourceRoots");
const boundaryPlugin = Symbol("uiBoundary(sourceRoots)");
const vuePlugin = Symbol("vue()");
const requireValue = (condition) => {
  if (!condition) throw new Error("Unsupported configuration");
};
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, allowed) =>
  object(value) && Object.keys(value).every((key) => allowed.includes(key));
const strings = (value, check = () => true) =>
  Array.isArray(value) &&
  value.every((entry) => typeof entry === "string" && check(entry));

// This recognizes literals, not executable JavaScript or the full TOML grammar.
// Unsupported syntax must run the suite normally rather than expand its inputs.
class Literals {
  constructor(source, toml = false) {
    requireValue(source.length <= 128 * 1024 && !source.includes("\ufffd"));
    this.toml = toml;
    this.tokens = [];
    const pattern = toml
      ? /[\t \r]+|\n|#[^\r\n]*|"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|[A-Za-z_$][\w$-]*|(?:0|[1-9]\d*)(?:\.\d+)?|[{}[\](),.:;=]/y
      : /\s+|\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/|"(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|[A-Za-z_$][\w$-]*|(?:0|[1-9]\d*)(?:\.\d+)?|=>|[{}[\](),.:;=]/y;
    let offset = 0;
    while (offset < source.length) {
      pattern.lastIndex = offset;
      const match = pattern.exec(source);
      requireValue(match);
      const token = match[0];
      offset = pattern.lastIndex;
      if (toml && token === "\n") this.tokens.push(token);
      else if (!/^\s|^#|^\/\//.test(token) && !token.startsWith("/*"))
        this.tokens.push(token);
    }
    this.index = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  take(expected) {
    const token = this.tokens[this.index++];
    requireValue(
      token !== undefined && (expected === undefined || token === expected),
    );
    return token;
  }

  newlines() {
    while (this.peek() === "\n") this.take();
  }

  string(token = this.take()) {
    requireValue(token.startsWith('"') || token.startsWith("'"));
    if (token.startsWith('"')) return JSON.parse(token);
    requireValue(this.toml || !token.includes("\\"));
    return token.slice(1, -1);
  }

  key() {
    const token = this.take();
    return /^[A-Za-z_][\w-]*$/.test(token) ? token : this.string(token);
  }

  value(depth = 0) {
    requireValue(depth < 32);
    const token = this.take();
    if (token.startsWith('"') || token.startsWith("'"))
      return this.string(token);
    if (token === "true" || token === "false") return token === "true";
    if (/^\d/.test(token)) return Number(token);
    if (token === "[" || token === "{") {
      const array = token === "[";
      const closing = array ? "]" : "}";
      const result = array ? [] : Object.create(null);
      this.newlines();
      while (this.peek() !== closing) {
        if (array) result.push(this.value(depth + 1));
        else {
          const key = this.key();
          requireValue(!Object.hasOwn(result, key));
          this.take(this.toml ? "=" : ":");
          result[key] = this.value(depth + 1);
        }
        this.newlines();
        if (this.peek() === closing) break;
        this.take(",");
        this.newlines();
      }
      this.take(closing);
      return result;
    }
    if (!this.toml) {
      if (token === "sourceRoots") return rootsReference;
      requireValue(token === "vue" || token === "uiBoundary");
      this.take("(");
      if (token === "uiBoundary") this.take("sourceRoots");
      this.take(")");
      return token === "vue" ? vuePlugin : boundaryPlugin;
    }
    throw new Error("Unsupported literal");
  }

  sequence(tokens) {
    for (const token of tokens.split(" ")) this.take(token);
  }

  end() {
    requireValue(this.peek() === undefined);
  }
}

function manifest(source) {
  const reader = new Literals(source, true);
  const root = Object.create(null);
  const tables = new Set();
  let current = root;
  const descend = (value, path) => {
    for (const key of path) {
      if (!Object.hasOwn(value, key)) value[key] = Object.create(null);
      requireValue(object(value[key]));
      value = value[key];
    }
    return value;
  };
  reader.newlines();
  while (reader.peek() !== undefined) {
    if (reader.peek() === "[") {
      reader.take();
      const path = [reader.key()];
      while (reader.peek() === ".") {
        reader.take();
        path.push(reader.key());
      }
      reader.take("]");
      const name = JSON.stringify(path);
      requireValue(!tables.has(name));
      tables.add(name);
      current = descend(root, path);
    } else {
      const path = [reader.key()];
      while (reader.peek() === ".") {
        reader.take();
        path.push(reader.key());
      }
      reader.take("=");
      const target = descend(current, path.slice(0, -1));
      const key = path.at(-1);
      requireValue(!Object.hasOwn(target, key));
      target[key] = reader.value();
    }
    requireValue(reader.peek() === undefined || reader.peek() === "\n");
    reader.newlines();
  }
  return root;
}

const workspaceMembers = [
  "crates/situate-core",
  "crates/tauri-plugin-workspace-access",
  "crates/tauri-plugin-provider-platform",
  "app/src-tauri",
];
const version = (value) =>
  typeof value === "string" && /^[\w.+*^~<>=,| -]+$/.test(value);
const inherited = (value, check) =>
  check(value) || (keys(value, ["workspace"]) && value.workspace === true);
const featureNames = (value) =>
  strings(value, (name) => /^[\w+?:/-]+$/.test(name));

function dependencies(value) {
  requireValue(object(value));
  for (const [name, dependency] of Object.entries(value)) {
    requireValue(/^[\w-]+$/.test(name));
    if (typeof dependency === "string") requireValue(version(dependency));
    else {
      requireValue(
        keys(dependency, [
          "version",
          "features",
          "default-features",
          "optional",
          "package",
        ]) && version(dependency.version),
      );
      for (const [key, entry] of Object.entries(dependency)) {
        if (key === "features") requireValue(featureNames(entry));
        else if (["default-features", "optional"].includes(key))
          requireValue(typeof entry === "boolean");
        else if (key === "package")
          requireValue(typeof entry === "string" && /^[\w-]+$/.test(entry));
      }
    }
  }
}

function cargo(source, workspace) {
  const config = manifest(source);
  const packageFields = ["version", "edition", "rust-version", "publish"];
  if (workspace) {
    requireValue(keys(config, ["workspace"]));
    const value = config.workspace;
    requireValue(keys(value, ["members", "resolver", "package"]));
    requireValue(
      strings(value.members, (member) => workspaceMembers.includes(member)) &&
        value.members.includes("crates/situate-core"),
    );
    requireValue(["2", "3"].includes(value.resolver));
    requireValue(keys(value.package, packageFields));
    for (const [key, entry] of Object.entries(value.package))
      requireValue(
        key === "publish" ? typeof entry === "boolean" : version(entry),
      );
    return value.members.map((member) => `client/${member}/Cargo.toml`);
  }
  requireValue(
    keys(config, [
      "package",
      "dependencies",
      "dev-dependencies",
      "target",
      "features",
    ]),
  );
  requireValue(keys(config.package, ["name", ...packageFields, "build"]));
  requireValue(config.package.name === "situate-core");
  for (const [key, entry] of Object.entries(config.package)) {
    if (packageFields.includes(key))
      requireValue(
        inherited(
          entry,
          key === "publish" ? (value) => typeof value === "boolean" : version,
        ),
      );
    if (key === "build") requireValue(entry === false);
  }
  for (const key of ["dependencies", "dev-dependencies"])
    if (config[key] !== undefined) dependencies(config[key]);
  if (config.target !== undefined) {
    requireValue(object(config.target));
    for (const [name, target] of Object.entries(config.target)) {
      requireValue(/^(?:cfg\([\w(), =".-]+\)|[\w-]+)$/.test(name));
      requireValue(keys(target, ["dependencies", "dev-dependencies"]));
      for (const value of Object.values(target)) dependencies(value);
    }
  }
  if (config.features !== undefined) {
    requireValue(object(config.features));
    for (const [name, value] of Object.entries(config.features))
      requireValue(/^[\w-]+$/.test(name) && featureNames(value));
  }
}

const typePatterns = [
  "src/**/*.ts",
  "src/**/*.vue",
  "tests/**/*.ts",
  "*.config.ts",
];
const appPatterns = [
  "../packages/ui/src/**/*.ts",
  "../packages/ui/src/**/*.vue",
  "../packages/localization/src/**/*.ts",
];
const booleanOptions = [
  "strict",
  "noEmit",
  "isolatedModules",
  "esModuleInterop",
  "skipLibCheck",
  "noUnusedLocals",
  "noUnusedParameters",
  "noUncheckedIndexedAccess",
  "exactOptionalPropertyTypes",
  "forceConsistentCasingInFileNames",
  "resolveJsonModule",
];
function typescript(source, suite) {
  const config = JSON.parse(source);
  const reader = new Literals(source);
  reader.value();
  reader.end();
  requireValue(keys(config, ["compilerOptions", "include", "exclude"]));
  const options = config.compilerOptions;
  requireValue(
    keys(options, [
      ...booleanOptions,
      "target",
      "lib",
      "module",
      "moduleResolution",
      "types",
    ]),
  );
  requireValue(options.noEmit === true);
  for (const [key, value] of Object.entries(options)) {
    if (booleanOptions.includes(key)) requireValue(typeof value === "boolean");
    else if (key === "lib")
      requireValue(strings(value, (entry) => /^[\w.]+$/.test(entry)));
    else if (key === "types")
      requireValue(
        strings(value, (entry) => ["vite/client", "node"].includes(entry)),
      );
    else requireValue(typeof value === "string" && /^[\w]+$/.test(value));
  }
  const allowed = [
    ...typePatterns,
    ...(suite.cwd === "client/app" ? appPatterns : []),
  ];
  requireValue(
    strings(config.include, (pattern) => allowed.includes(pattern)) &&
      config.include.length > 0,
  );
  if (config.exclude !== undefined)
    requireValue(
      strings(config.exclude, (pattern) => allowed.includes(pattern)),
    );
}

function vitest(source, suite) {
  const reader = new Literals(source);
  for (const [binding, module] of [
    ["{ defineConfig }", "vitest/config"],
    ["vue", "@vitejs/plugin-vue"],
    ["{ uiBoundary }", "../scripts/ui-boundary.mjs"],
    ["{ fileURLToPath }", "node:url"],
  ]) {
    reader.sequence(`import ${binding} from`);
    requireValue(reader.string() === module);
    reader.take(";");
  }
  reader.sequence("const sourceRoots =");
  const roots = reader.value();
  const allowed = [
    ".",
    "../node_modules",
    ...(suite.cwd === "client/app"
      ? [
          "../packages/ui",
          "../contracts",
          "../packages/localization",
          "../../design/brand",
        ]
      : []),
  ];
  requireValue(
    strings(roots, (root) => allowed.includes(root)) &&
      roots.includes(".") &&
      roots.includes("../node_modules"),
  );
  reader.sequence(
    ". map ( ( path ) => fileURLToPath ( new URL ( path , import . meta . url ) )",
  );
  if (reader.peek() === ",") reader.take();
  reader.sequence(") ; export default defineConfig (");
  const config = reader.value();
  if (reader.peek() === ",") reader.take();
  reader.sequence(") ;");
  reader.end();
  requireValue(keys(config, ["plugins", "server", "test"]));
  requireValue(
    Array.isArray(config.plugins) &&
      config.plugins.length === 2 &&
      config.plugins[0] === boundaryPlugin &&
      config.plugins[1] === vuePlugin,
  );
  if (config.server !== undefined)
    requireValue(
      keys(config.server, ["fs"]) &&
        keys(config.server.fs, ["allow"]) &&
        config.server.fs.allow === rootsReference,
    );
  const test = config.test;
  requireValue(
    keys(test, [
      "environment",
      "setupFiles",
      "include",
      "exclude",
      "clearMocks",
      "passWithNoTests",
      "coverage",
    ]),
  );
  requireValue(["jsdom", "node"].includes(test.environment));
  const testPatterns = [
    "src/**/*.test.ts",
    "src/**/*.spec.ts",
    "tests/**/*.test.ts",
    "tests/**/*.spec.ts",
  ];
  const coveragePatterns = [
    ...testPatterns,
    ...typePatterns,
    "src/**/*.{ts,vue}",
    "src/**/*.d.ts",
  ];
  requireValue(
    strings(test.include, (pattern) => testPatterns.includes(pattern)) &&
      test.include.length > 0,
  );
  if (test.exclude !== undefined)
    requireValue(
      strings(test.exclude, (pattern) =>
        [
          "**/node_modules/**",
          "**/.git/**",
          ...(suite.cwd === "client/app"
            ? ["src/plugins/executor-boundary.test.ts"]
            : []),
        ].includes(pattern),
      ),
    );
  if (test.setupFiles !== undefined)
    requireValue(
      strings(
        test.setupFiles,
        (path) =>
          /^(?:\.\/)?(?:src|tests)\/(?:[\w.-]+\/)*[\w.-]+\.[cm]?[jt]s$/.test(
            path,
          ) && !path.split("/").includes(".."),
      ),
    );
  for (const key of ["clearMocks", "passWithNoTests"])
    if (test[key] !== undefined) requireValue(typeof test[key] === "boolean");
  if (test.coverage !== undefined) {
    const coverage = test.coverage;
    requireValue(
      keys(coverage, [
        "provider",
        "include",
        "exclude",
        "reporter",
        "reportsDirectory",
      ]),
    );
    requireValue(coverage.provider === "v8");
    for (const key of ["include", "exclude"])
      if (coverage[key] !== undefined)
        requireValue(
          strings(coverage[key], (pattern) =>
            coveragePatterns.includes(pattern),
          ),
        );
    if (coverage.reporter !== undefined)
      requireValue(
        strings(coverage.reporter, (reporter) =>
          ["text", "lcov", "html"].includes(reporter),
        ),
      );
    if (coverage.reportsDirectory !== undefined)
      requireValue(
        /^\.\.\/target\/coverage\/[\w-]+$/.test(coverage.reportsDirectory),
      );
  }
  return (test.setupFiles ?? []).map(
    (file) => `${suite.cwd}/${file.replace(/^\.\//, "")}`,
  );
}

export function suiteConfigurationFiles(suite) {
  return suite.id === "client-core"
    ? ["client/Cargo.toml", "client/crates/situate-core/Cargo.toml"]
    : [
        `${suite.cwd}/tsconfig.json`,
        ...(suite.id.endsWith("-vue")
          ? [`${suite.cwd}/vitest.config.ts`, "client/scripts/ui-boundary.mjs"]
          : []),
      ];
}

export class CacheConfigurationError extends Error {
  constructor(file) {
    super("Configuration is outside the supported cache policy");
    this.file = file;
  }
}

export class CachePolicyUnavailableError extends Error {
  constructor() {
    super("Cache policy data is unavailable");
  }
}

export function validateSuiteConfiguration(file, data, suite) {
  if (data.length > 128 * 1024) throw new CacheConfigurationError(file);
  const source = data.toString("utf8");
  try {
    if (file.endsWith("Cargo.toml"))
      return cargo(source, file === "client/Cargo.toml") ?? [];
    else if (file.endsWith("tsconfig.json")) typescript(source, suite);
    else if (file.endsWith("vitest.config.ts")) return vitest(source, suite);
    else {
      if (boundarySource === undefined) throw new CachePolicyUnavailableError();
      requireValue(
        normalizeBoundary(source) === normalizeBoundary(boundarySource),
      );
    }
    return [];
  } catch (error) {
    if (error instanceof CachePolicyUnavailableError) throw error;
    throw new CacheConfigurationError(file);
  }
}

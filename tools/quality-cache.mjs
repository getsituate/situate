import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isPlainDocumentation } from "./test-inputs.mjs";

const scripts = {
  "root-lint": ["lint", "eslint . --max-warnings 0"],
  "root-format": ["format:check", "prettier . --check"],
};
const cacheDirectory = "node_modules/.cache/situate-quality";
const digest = (content) => createHash("sha256").update(content).digest("hex");

// These configurations exclude the same generated trees from lint, formatting
// and the type project. Changed ignore/type configs use the unpruned inventory.
const exclusionConfigurations = {
  "eslint.config.mjs":
    "be1bf3364a5ef45bb6f9b2396f3c24019f7f19bb8880d7a1d10dcb2ad121528e",
  "tsconfig.quality.json":
    "da8f95fb39c889521d9588eee7f3459b01b1a1fff8faef02184828a44b1112ab",
  ".prettierignore":
    "a6028b3ecb3774bfa35265192be84477bdb66393ba3fdd6877b111b92a8f590b",
};
const binaryExtensions = new Set([
  ".a",
  ".bmp",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".eot",
  ".epub",
  ".exe",
  ".gif",
  ".gz",
  ".ico",
  ".icns",
  ".jar",
  ".jpeg",
  ".jpg",
  ".mov",
  ".mp3",
  ".mp4",
  ".o",
  ".otf",
  ".pdf",
  ".png",
  ".rlib",
  ".rmeta",
  ".so",
  ".sqlite",
  ".tar",
  ".ttf",
  ".wasm",
  ".wav",
  ".webm",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
]);

function fingerprint(directory, id, environment) {
  if (
    id === "root-lint" &&
    (digest(readFileSync(join(directory, "eslint.config.mjs"))) !==
      exclusionConfigurations["eslint.config.mjs"] ||
      ["js", "cjs", "ts", "mts", "cts"].some((extension) =>
        existsSync(join(directory, `eslint.config.${extension}`)),
      ))
  )
    throw new Error("Unknown ESLint configuration requires an uncached check.");
  const prune = Object.entries(exclusionConfigurations).every(
    ([name, expected]) => {
      try {
        return digest(readFileSync(join(directory, name))) === expected;
      } catch (error) {
        if (error.code === "ENOENT") return false;
        throw error;
      }
    },
  );
  const hash = createHash("sha256");
  const visited = new Set();
  const deadline = performance.now() + 1500;
  let bytes = 0;
  let entries = 0;
  const add = (value) => hash.update(JSON.stringify(value)).update("\0");
  add(["quality-cache-v2", directory, id, process.version, process.platform]);
  add(Object.entries(environment).sort(([a], [b]) => a.localeCompare(b)));

  const file = (path, dependencies) => {
    if (
      !dependencies &&
      prune &&
      id === "root-lint" &&
      isPlainDocumentation(relative(directory, path).replaceAll("\\", "/"))
    )
      return;
    if (
      dependencies
        ? !/(?:\/(?:package|\.package-lock)\.json|\.d\.[cm]?ts)$/.test(path)
        : binaryExtensions.has(extname(path).toLowerCase())
    )
      return;
    if (!dependencies && id === "root-format") {
      const name = path.slice(dirname(path).length + 1);
      // Executable configs can read arbitrary source files. Keep these uncached
      // rather than invalidating every formatted file on ordinary source edits.
      if (/^(?:prettier\.config\.|\.prettierrc\.(?:[cm]?[jt]s)$)/.test(name))
        throw new Error(
          "Executable Prettier configuration requires an uncached check.",
        );
      if (
        !/^(?:\.editorconfig|\.(?:prettier|git)ignore|\.prettierrc(?:\.(?:json5?|ya?ml|toml))?|package(?:-lock)?\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(
          name,
        )
      )
        return;
    }
    if (!dependencies && statSync(path).size > 32 * 1024 * 1024)
      throw new Error("Quality cache source exceeds its byte budget.");
    const content = readFileSync(path);
    if (
      !dependencies &&
      id === "root-format" &&
      path.endsWith("/package.json") &&
      typeof JSON.parse(content).prettier === "string"
    )
      throw new Error(
        "Shared Prettier configuration requires an uncached check.",
      );
    if (
      !dependencies &&
      id === "root-format" &&
      /\bplugins\b/.test(content.toString())
    )
      throw new Error("Prettier plugins require an uncached check.");
    bytes += content.length;
    if (bytes > 256 * 1024 * 1024)
      throw new Error("Quality cache text inventory exceeds its byte budget.");
    add(path);
    add(content.length);
    hash.update(content);
  };
  const walk = (path, dependencies = false, relative = "") => {
    if (dependencies && id === "root-format") {
      for (const name of [".package-lock.json", "prettier/package.json"]) {
        const input = join(path, name);
        if (existsSync(input)) file(input, true);
      }
      return;
    }
    if (visited.has(path)) return;
    visited.add(path);
    for (const entry of readdirSync(path, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (++entries > 100000 || performance.now() > deadline)
        throw new Error(
          "Quality cache text inventory exceeds its scan budget.",
        );
      const name = entry.name;
      const child = join(path, name);
      const local = relative ? `${relative}/${name}` : name;
      if (name === ".git" || (dependencies && name === ".cache")) continue;
      if (
        !dependencies &&
        prune &&
        (["target", "build", "dist"].includes(name) ||
          local === "client/app/src-tauri/gen")
      )
        continue;
      const nestedDependencies = dependencies || name === "node_modules";
      if (entry.isSymbolicLink()) {
        const target = realpathSync(child);
        add([child, target]);
        // Resolve the directory/file distinction only for links, not every file.
        if (statSync(target).isDirectory())
          walk(target, nestedDependencies, local);
        else file(target, nestedDependencies);
      } else if (entry.isDirectory()) {
        walk(child, nestedDependencies, local);
      } else if (entry.isFile()) {
        file(child, dependencies);
      } else {
        throw new Error("Quality cache cannot fingerprint a special file.");
      }
    }
  };

  walk(directory);
  for (let parent = dirname(directory); ; parent = dirname(parent)) {
    for (const name of readdirSync(parent)) {
      if (name.startsWith(".prettierrc") || name.startsWith("prettier.config."))
        throw new Error("Prettier configuration is outside the workspace.");
      if (name === "package.json") {
        const manifest = JSON.parse(readFileSync(join(parent, name), "utf8"));
        if (manifest.prettier !== undefined)
          throw new Error("Prettier configuration is outside the workspace.");
        file(join(parent, name), false);
      }
      if (name === ".editorconfig") file(join(parent, name), false);
    }
    if (dirname(parent) === parent) break;
  }
  return hash.digest("hex");
}

/**
 * Read-only preparation for quick execution, after dependency preparation.
 * The returned command owns one native cache and key per suite/worktree; callers
 * must serialize execution and keep inputs unchanged until the check finishes.
 * Unsupported or incomplete inventories retain the original uncached command.
 */
export function cachedQualitySuite(
  suite,
  directory,
  environment = process.env,
) {
  const settings = scripts[suite.id];
  if (!settings || suite.cwd !== ".") return suite;
  const [script, expected] = settings;
  if (
    suite.command !== "npm" ||
    JSON.stringify(suite.args) !== JSON.stringify(["run", script])
  )
    return suite;
  try {
    const root = realpathSync(resolve(directory));
    const manifest = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    if (manifest.scripts?.[script] !== expected) return suite;
    const key = fingerprint(root, suite.id, environment);
    return {
      ...suite,
      command: process.execPath,
      args: [fileURLToPath(import.meta.url), "--run", root, suite.id, key],
    };
  } catch {
    // The original check, not the optional cache, reports dependency/I/O errors.
    return suite;
  }
}

async function executeCached(directory, id, key) {
  if (!scripts[id] || !/^[a-f0-9]{64}$/.test(key))
    throw new Error("Invalid quality cache command.");
  const root = realpathSync(directory);
  const slot = join(root, cacheDirectory, digest(root), id);
  const cache = `${slot}.cache`;
  const metadata = `${slot}.key`;
  mkdirSync(dirname(slot), { recursive: true });
  let previous;
  try {
    previous = readFileSync(metadata, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (previous !== key) {
    // Delete before recording the key: interruption cannot bless an old cache.
    rmSync(cache, { force: true });
    writeFileSync(metadata, key);
  }
  const child = spawn(
    "npm",
    [
      "run",
      scripts[id][0],
      "--",
      "--cache",
      "--cache-strategy",
      "content",
      "--cache-location",
      cache,
    ],
    { cwd: root, stdio: "inherit" },
  );
  return await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => done(code ?? 1));
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv[2] !== "--run" || process.argv.length !== 6)
      throw new Error("Invalid quality cache command.");
    process.exitCode = await executeCached(...process.argv.slice(3));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

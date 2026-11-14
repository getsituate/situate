import { spawn } from "node:child_process";
import { compilerCacheEnvironment } from "../../tools/compiler-cache.mjs";
import { createHash } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import {
  copyFileSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { acquireIosProject, assertLocalPath } from "./ios-project-lock.mjs";
export { assertLocalPath } from "./ios-project-lock.mjs";

export function sessionPaths(root) {
  root = realpathSync(root);
  const id = createHash("sha256").update(root).digest("hex").slice(0, 12);
  return {
    root,
    id,
    app: join(root, "app"),
    native: join(root, "app/src-tauri"),
    apple: join(root, "app/src-tauri/gen/apple"),
    output: join(root, "target/ios-xcode"),
    cli: join(root, "node_modules/@tauri-apps/cli/tauri.js"),
  };
}

export function acquireSession(
  paths,
  device = false,
  releaseLogger = console.error,
) {
  const unlock = acquireIosProject(paths.root, "xcode", releaseLogger);
  try {
    const file = join(paths.output, "session.lock/owner.json");
    const owner = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(
      file,
      JSON.stringify({ ...owner, mode: device ? "device" : "simulator" }),
    );
    return unlock;
  } catch (error) {
    unlock();
    throw error;
  }
}

export function buildEnvironment(environment, paths, rustBin) {
  const env = { ...environment };
  for (const key of Object.keys(env)) {
    if (
      /^(TAURI_|APPLE_|CSC_)/.test(key) ||
      ["RUSTUP_TOOLCHAIN", "CARGO_BUILD_TARGET"].includes(key)
    )
      delete env[key];
  }
  return {
    ...compilerCacheEnvironment(env),
    PATH: [rustBin, dirname(process.execPath), env.PATH]
      .filter(Boolean)
      .join(":"),
    CARGO_TARGET_DIR: join(paths.output, "cargo"),
  };
}

export function simulatorTarget(hostTriple) {
  if (hostTriple === "aarch64-apple-darwin") return "aarch64-apple-ios-sim";
  if (hostTriple === "x86_64-apple-darwin") return "x86_64-apple-ios";
  throw new Error(`Unsupported Rust host: ${hostTriple}`);
}

// A separate process group lets Ctrl-C stop Tauri's children without closing Xcode.
export function run(
  command,
  args,
  { cwd, env, signal, capture = false, terminationGraceMs = 2000 } = {},
) {
  if (
    !Number.isSafeInteger(terminationGraceMs) ||
    terminationGraceMs < 0 ||
    terminationGraceMs > 120_000
  )
    throw new Error("Invalid subprocess termination grace");
  signal?.throwIfAborted();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      detached: process.platform !== "win32",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let output = "";
    let errors = "";
    let timer;
    child.stdout?.on("data", (data) => {
      output += data;
    });
    child.stderr?.on("data", (data) => {
      errors += data;
    });
    const kill = (name) => {
      if (!child.pid) return;
      try {
        if (process.platform === "win32") child.kill(name);
        else process.kill(-child.pid, name);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    };
    const abort = () => {
      kill("SIGTERM");
      timer = setTimeout(() => kill("SIGKILL"), terminationGraceMs);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (error) => {
      cleanup();
      reject(new Error(`Could not start ${command}: ${error.message}`));
    });
    child.once("close", (code, exitSignal) => {
      if (signal?.aborted) kill("SIGKILL");
      cleanup();
      if (signal?.aborted) reject(signal.reason);
      else if (code !== 0)
        reject(
          new Error(
            `${command} failed (${code ?? exitSignal}).${errors ? `\n${errors.trim()}` : ""}`,
          ),
        );
      else resolvePromise(output.trim());
    });
  });
}

export async function checkPrerequisites(
  paths,
  {
    host = process.platform,
    execute = run,
    environment = process.env,
    signal,
    device = false,
  } = {},
) {
  if (host !== "darwin")
    throw new Error("Opening the iOS project requires macOS and Xcode.");
  if (Number(process.versions.node.split(".")[0]) < 24)
    throw new Error("Use Node 24 or newer (see client/.node-version).");
  if (!existsSync(paths.cli))
    throw new Error(
      "Client dependencies are missing. Run npm ci in client/ first.",
    );
  const clean = buildEnvironment(environment, paths);
  const options = { cwd: paths.root, env: clean, signal, capture: true };
  const rustBin = dirname(await execute("rustup", ["which", "rustc"], options));
  const env = buildEnvironment(environment, paths, rustBin);
  options.env = env;
  const rust = await execute("rustc", ["-vV"], options);
  const target = device
    ? "aarch64-apple-ios"
    : simulatorTarget(rust.match(/^host: (.+)$/m)?.[1]);
  const installed = await execute(
    "rustup",
    ["target", "list", "--installed"],
    options,
  );
  if (!installed.split(/\s+/).includes(target))
    throw new Error(
      `Missing ${device ? "device" : "Simulator"} target. Run rustup target add ${target} in client/.`,
    );
  const developer =
    env.DEVELOPER_DIR || (await execute("xcode-select", ["-p"], options));
  if (
    !existsSync(
      join(
        developer,
        device
          ? "Platforms/iPhoneOS.platform"
          : "Platforms/iPhoneSimulator.platform",
      ),
    )
  ) {
    throw new Error(
      `Select a full Xcode installation with the iOS ${device ? "device" : "Simulator"} SDK, not standalone Command Line Tools.`,
    );
  }
  await execute("xcodegen", ["--version"], options);
  await execute("pod", ["--version"], options);
  return { env, target };
}

function shellQuote(value) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
export function syncAppIcons(paths) {
  const catalog = join(paths.apple, "Assets.xcassets/AppIcon.appiconset");
  const manifest = join(catalog, "Contents.json");
  assertLocalPath(paths.root, manifest);
  const { images } = JSON.parse(readFileSync(manifest, "utf8"));
  if (!Array.isArray(images) || !images.length)
    throw new Error(
      "The iOS app icon catalog has no images. Regenerate it with tauri ios init.",
    );
  const files = [
    ...new Set(
      images.map(({ filename }) => {
        if (
          typeof filename !== "string" ||
          !/^AppIcon-[a-zA-Z0-9@.-]+\.png$/.test(filename)
        ) {
          throw new Error(
            "Unexpected filename in the iOS app icon catalog. Regenerate it with tauri ios init.",
          );
        }
        return filename;
      }),
    ),
  ].map((filename) => {
    const source = join(paths.native, "icons/ios", filename);
    const destination = join(catalog, filename);
    assertLocalPath(paths.root, source);
    assertLocalPath(paths.root, destination);
    return { source, destination, bytes: readFileSync(source) };
  });
  for (const { source, destination, bytes } of files) {
    if (!existsSync(destination) || !bytes.equals(readFileSync(destination)))
      copyFileSync(source, destination);
  }
}

export function developmentTeam(project) {
  const teams = [
    ...new Set(
      [...project.matchAll(/\bDEVELOPMENT_TEAM = "?([A-Z0-9]{10})"?;/g)].map(
        (match) => match[1],
      ),
    ),
  ];
  if (teams.length > 1)
    throw new Error(
      "Multiple signing teams found. Select the same development team for all iOS build configurations before restarting.",
    );
  return teams[0];
}

export function prepareProjectSpec(
  source,
  paths,
  node = process.execPath,
  team,
) {
  const phase =
    /^( +)- script: \|\n(?:(?:\1 {4}.*|[ \t]*)\n)*\1 {2}name: Build Rust Code$/m;
  const target = /^ {2}situate-client_iOS:\n(?: {4}.*\n|[ \t]*\n)*/m;
  const targetSource = source.match(target)?.[0];
  const settingGroups = /^settingGroups:\n(?: {2}.*\n|[ \t]*\n)*/m;
  const appSettings = /^( {2}app:\n {4}base:\n)((?: {6}.*\n|[ \t]*\n)*)/m;
  const appBase = source.match(settingGroups)?.[0].match(appSettings)?.[2];
  const dependencies = /^ {4}dependencies:\n(?: {6}.*\n|[ \t]*\n)*/m;
  const dependencySource = targetSource?.match(dependencies)?.[0];
  if (
    source.match(/^ {2}situate-client_iOS:/gm)?.length !== 1 ||
    targetSource?.match(/^ {4}dependencies:/gm)?.length !== 1 ||
    !dependencySource?.includes("      - ") ||
    !appBase ||
    !/^ {6}PRODUCT_NAME:/m.test(appBase) ||
    !phase.test(source) ||
    !/^ +- path: Externals$/m.test(source) ||
    /^schemes:/m.test(source)
  ) {
    throw new Error(
      "Unexpected generated iOS project format. Check the pinned Tauri CLI and gen/apple/project.yml.",
    );
  }
  // Xcode links libapp.a separately from Cargo, so its libgit2 SDK dependencies must be explicit.
  const missingLibraries = ["libz.tbd", "libiconv.tbd"].filter((library) => {
    const entry = new RegExp(
      `^      - sdk: ["']?(?:usr/lib/)?${library.replace(".", "\\.")}["']?(?:[ \\t]+#.*)?$`,
      "m",
    );
    return !entry.test(dependencySource);
  });
  source = source.replace(target, (block) =>
    block.replace(
      dependencies,
      (entries) =>
        entries +
        missingLibraries.map((library) => `      - sdk: ${library}\n`).join(""),
    ),
  );
  const args =
    '-v --platform "${PLATFORM_DISPLAY_NAME:?}" --sdk-root "${SDKROOT:?}" --framework-search-paths "${FRAMEWORK_SEARCH_PATHS:?}" --header-search-paths "${HEADER_SEARCH_PATHS:?}" --gcc-preprocessor-definitions "${GCC_PREPROCESSOR_DEFINITIONS:-}" --configuration "${CONFIGURATION:?}" ${FORCE_COLOR:-} ${ARCHS:?}';
  const script = [
    "set -eu",
    `exec ${shellQuote(node)} ${shellQuote(join(paths.root, "scripts/ios-xcode-build.mjs"))} --scheme-build ${args}`,
  ];
  source = source.replace(
    phase,
    (_, indent) =>
      `${indent}- script: |\n${script.map((line) => `${indent}    ${line}`).join("\n")}\n${indent}  name: Build Rust Code`,
  );
  // Static archives belong to the linker, not Xcode's copied resources.
  source = source.replace(
    /^( +)- path: Externals\n(?:\1 {2}excludes:.*\n)?/m,
    '$1- path: Externals\n$1  excludes: ["**/*.a"]\n',
  );
  if (team) {
    if (!/^[A-Z0-9]{10}$/.test(team))
      throw new Error("Invalid Apple development team identifier.");
    source = source.replace(
      /^ +(?:DEVELOPMENT_TEAM|CODE_SIGN_STYLE):.*\n/gm,
      "",
    );
    source = source.replace(
      /^( +)PRODUCT_NAME:/m,
      `$1DEVELOPMENT_TEAM: "${team}"\n$1CODE_SIGN_STYLE: Automatic\n$1PRODUCT_NAME:`,
    );
  }
  source = source.replace(settingGroups, (groups) =>
    groups.replace(appSettings, (_, header, base) => {
      const settings = [
        ["CODE_SIGNING_ALLOWED", "YES"],
        ["CODE_SIGNING_REQUIRED", "YES"],
        ["CODE_SIGN_IDENTITY", '"-"'],
        ["AD_HOC_CODE_SIGNING_ALLOWED", "YES"],
        ["CODE_SIGN_STYLE", "Manual"],
        ["DEVELOPMENT_TEAM", '""'],
      ];
      for (const [key] of settings) {
        const existing = new RegExp(
          `^ {6}["']?${key}\\[sdk=iphonesimulator\\*\\]["']?:[^\\r\\n]*\\n?`,
          "gm",
        );
        if ([...base.matchAll(existing)].length > 1)
          throw new Error(
            "Unexpected generated iOS simulator signing settings.",
          );
        base = base.replace(existing, "");
      }
      return (
        header +
        settings
          .map(
            ([key, value]) =>
              `      "${key}[sdk=iphonesimulator*]": ${value}\n`,
          )
          .join("") +
        base
      );
    }),
  );
  // XcodeGen writes target-generated schemes after explicit schemes of the same name.
  source = source.replace(/^ {4}scheme:\n(?: {6,}.*\n)*/gm, "");
  // A Rust pre-build phase ends before native linking; release ownership only
  // after the entire scheme build, including failed builds, has finished.
  return `${source}\nschemes:\n  situate-client_iOS:\n    build:\n      targets:\n        situate-client_iOS: all\n      runPostActionsOnFailure: true\n      postActions:\n        - name: Finish iOS build\n          script: |\n            ${shellQuote(node)} ${shellQuote(join(paths.root, "scripts/ios-xcode-build.mjs"))} --finish-build ${process.pid}\n    run:\n      config: debug\n      environmentVariables:\n        RUST_BACKTRACE: full\n        RUST_LOG: info\n`;
}

export async function startFrontend(paths) {
  const { createServer } = await import(
    pathToFileURL(join(paths.root, "node_modules/vite/dist/node/index.js")).href
  );
  let vite;
  const http = createHttpServer((request, response) => {
    if (vite) vite.middlewares(request, response);
    else {
      response.statusCode = 503;
      response.end();
    }
  });
  let closing;
  const close = () =>
    (closing ??= (async () => {
      try {
        await vite?.close();
      } finally {
        await new Promise((done) => {
          http.close(done);
          http.closeAllConnections();
        });
      }
    })());
  try {
    await new Promise((ready, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", ready);
    });
    const port = http.address().port;
    // Middleware mode leaves signals and process exit to this session, not Vite.
    vite = await createServer({
      root: paths.app,
      mode: "ios-simulator",
      cacheDir: join(paths.output, "vite"),
      server: {
        middlewareMode: true,
        port,
        host: "127.0.0.1",
        ws: { server: http, port, clientPort: port },
      },
    });
    return {
      server: { close, config: vite.config },
      url: `http://127.0.0.1:${port}`,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

export async function openIosXcode(
  paths,
  {
    signal,
    execute = run,
    prerequisites = checkPrerequisites,
    frontend = startFrontend,
    device = false,
  } = {},
) {
  const { env } = await prerequisites(paths, { signal, execute, device });
  const unlock = acquireSession(paths, device);
  let web;
  try {
    assertLocalPath(paths.root, paths.apple);
    const options = { cwd: paths.app, env, signal };
    if (!existsSync(join(paths.apple, "project.yml"))) {
      await execute(
        process.execPath,
        [paths.cli, "ios", "init", "--ci", "--skip-targets-install"],
        options,
      );
    }
    const baseSpec = join(paths.apple, "project.yml");
    const specPath = join(paths.apple, "project.ios-xcode.yml");
    assertLocalPath(paths.root, baseSpec);
    assertLocalPath(paths.root, specPath);
    const project = join(
      paths.apple,
      "situate-client.xcodeproj/project.pbxproj",
    );
    assertLocalPath(paths.root, project);
    const team = existsSync(project)
      ? developmentTeam(readFileSync(project, "utf8"))
      : undefined;
    const spec = prepareProjectSpec(
      readFileSync(baseSpec, "utf8"),
      paths,
      process.execPath,
      team,
    );
    writeFileSync(specPath, spec);
    assertLocalPath(paths.root, join(paths.apple, "situate-client.xcodeproj"));
    // Keep the base template for ios init when switching to non-session builds.
    // Regenerate every session, including after failed or interrupted generation.
    await execute("xcodegen", ["generate", "--spec", specPath], options);
    signal?.throwIfAborted();
    syncAppIcons(paths);
    if (!device) web = await frontend(paths);
    const base = JSON.parse(
      readFileSync(join(paths.native, "tauri.conf.json"), "utf8"),
    );
    const branch = await execute("git", ["branch", "--show-current"], {
      cwd: paths.root,
      env,
      signal,
      capture: true,
    });
    const config = {
      identifier: `${base.identifier}.dev.w${paths.id}`,
      productName:
        branch === "main"
          ? base.productName
          : `${base.productName} (${basename(dirname(paths.root))})`,
      ...(team ? { bundle: { iOS: { developmentTeam: team } } } : {}),
      build: device
        ? { beforeDevCommand: "", devUrl: null }
        : { beforeDevCommand: "", devUrl: web.url },
    };
    console.log(
      `Checkout: ${dirname(paths.root)}\nFrontend: ${device ? "bundled in the app" : web.url}\nApp: ${config.identifier}`,
    );
    console.log(
      device
        ? "In Xcode, select situate-client_iOS, your iPhone, and your development team under Signing & Capabilities, then Run (Cmd-R). Keep this terminal open while building; the installed app runs without it."
        : "In Xcode, select the situate-client_iOS scheme, an iOS Simulator, then Run (Cmd-R). Keep this terminal open; Ctrl-C ends the session.",
    );
    const command = device
      ? ["build", "--open", "--debug", "--target", "aarch64"]
      : ["dev", "--open", "--no-watch"];
    await execute(
      process.execPath,
      [paths.cli, "ios", ...command, "--config", JSON.stringify(config)],
      options,
    );
  } finally {
    try {
      await web?.server.close();
    } finally {
      unlock();
    }
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const controller = new AbortController();
  let interrupted;
  const stop = (signal) => {
    interrupted = signal;
    controller.abort(new Error("iOS session stopped."));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGHUP", stop);
  try {
    const { values } = parseArgs({
      options: {
        help: { type: "boolean" },
        check: { type: "boolean" },
        device: { type: "boolean" },
      },
    });
    if (values.help)
      console.log(
        "Usage: npm run ios:xcode -- [--device] [--check]\n\nOpen this checkout in Xcode with Simulator hot reload by default.\n--device bundles the frontend for installation on an iPhone without a development server.\n--check verifies prerequisites for the selected mode without opening Xcode.\nInstall npm dependencies first. Keep the terminal open while building in Xcode.",
      );
    else {
      const paths = sessionPaths(
        fileURLToPath(new URL("../", import.meta.url)),
      );
      if (values.check) {
        const { target } = await checkPrerequisites(paths, {
          signal: controller.signal,
          device: values.device,
        });
        console.log(
          `iOS prerequisites available (${target}). ${values.device ? "Select your iPhone and development team in Xcode." : "Select an installed iOS Simulator runtime in Xcode."}`,
        );
      } else
        await openIosXcode(paths, {
          signal: controller.signal,
          device: values.device,
        });
    }
  } catch (error) {
    if (!interrupted) console.error(error.message);
    process.exitCode =
      interrupted === "SIGINT"
        ? 130
        : interrupted === "SIGTERM"
          ? 143
          : interrupted === "SIGHUP"
            ? 129
            : 1;
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}

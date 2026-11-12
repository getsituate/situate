import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import jsSupplements from "./native-licenses-js-supplements.json" with { type: "json" };
import swiftSupplements from "./native-licenses-swift-supplements.json" with { type: "json" };
import { collectRustRuntimeLicenses } from "./native-licenses-runtime.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const noticeName =
  /(?:^|[._-])(?:licen[sc]e|copying|copyright|notice|authors|unlicense)(?:$|[._-])/i;
const hasLicense = (files) =>
  files.some(
    (file) =>
      /(?:^|[._-])(?:licen[sc]e|copying|unlicense)(?:$|[._-])/i.test(
        basename(file.path),
      ) || file.path.split("/").some((part) => /^licenses$/i.test(part)),
  );

export function noticeFiles(root, requireLicense = true) {
  const found = [];
  function visit(directory, inNotices = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if ([".git", "node_modules", "target", ".build"].includes(entry.name))
        continue;
      const path = join(directory, entry.name);
      const selected =
        inNotices ||
        noticeName.test(entry.name) ||
        /^(?:licenses|notices|legal)$/i.test(entry.name);
      if (entry.isSymbolicLink()) {
        if (selected)
          throw new Error("License material must not be a symbolic link.");
        continue;
      }
      if (entry.isDirectory()) visit(path, selected);
      else if (entry.isFile() && selected) {
        const text = readFileSync(path, "utf8");
        if (!text.trim() || text.includes("\0"))
          throw new Error("License material must be nonempty text.");
        found.push({ path: relative(root, path).replaceAll("\\", "/"), text });
      }
    }
  }
  visit(root);
  if (requireLicense && !hasLicense(found))
    throw new Error("Missing dependency license text.");
  return found;
}

export function renderNotices(components) {
  return (
    "Third-party software notices\n\n" +
    components
      .map(
        (component) =>
          `${component.name} ${component.version}\n${component.source ?? ""}\n` +
          (component.sourceArchive
            ? `Corresponding source: ${component.sourceArchive}\n${component.sourceUrl}\nSHA-256: ${component.sourceSha256}\n`
            : "") +
          component.notices
            .map((file) => `\n--- ${file.path} ---\n${file.text}\n`)
            .join(""),
      )
      .join("\n========================================\n\n")
  );
}

export function javascriptLicensesPlugin({ root, components = new Map() }) {
  const lock = json(join(root, "package-lock.json"));
  function include(id) {
    if (!id.includes("node_modules/")) return;
    let directory = dirname(id.split("?")[0]);
    while (
      directory !== dirname(directory) &&
      !existsSync(join(directory, "package.json"))
    )
      directory = dirname(directory);
    const key = relative(root, directory).replaceAll("\\", "/");
    if (!key.startsWith("node_modules/") || components.has(key)) return;
    const pkg = json(join(directory, "package.json"));
    const locked = lock.packages[key];
    if (!locked || locked.version !== pkg.version)
      throw new Error(`Unlocked bundled JavaScript dependency: ${pkg.name}`);
    const source = new URL(locked.resolved);
    if (source.protocol !== "https:" || source.username || source.password)
      throw new Error(`Unsupported JavaScript source provenance: ${pkg.name}`);
    if (/MPL|GPL|CDDL|EPL/i.test(String(pkg.license)))
      throw new Error(
        `Corresponding source delivery needs review for JavaScript dependency ${pkg.name} ${pkg.version}.`,
      );
    const notices = noticeFiles(directory, false);
    const supplement = jsSupplements[`${pkg.name}@${pkg.version}`];
    if (supplement && locked.integrity === supplement.integrity)
      notices.push(
        ...(supplement.notices ??
          jsSupplements[supplement.noticesFrom].notices),
      );
    if (!hasLicense(notices))
      throw new Error(
        `Missing dependency license text: ${pkg.name} ${pkg.version}`,
      );
    components.set(key, {
      name: pkg.name,
      version: pkg.version,
      source: [locked.resolved, supplement?.source].filter(Boolean).join("\n"),
      notices,
    });
  }
  return {
    name: "third-party-js-notices",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle))
        if (output.type === "chunk")
          for (const id of output.moduleIds) include(id);
      this.emitFile({
        type: "asset",
        fileName: "third-party-js-notices.txt",
        source: renderNotices(
          [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
        ),
      });
    },
  };
}

const githubTrees = new Map();

export async function githubNotices(repository, vcs, request = fetch) {
  const repo = repository?.match(
    /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/,
  )?.[1];
  const revision = vcs?.git?.sha1;
  const path = vcs?.path_in_vcs ?? "";
  if (
    !repo ||
    !/^[a-f0-9]{40}$/.test(revision ?? "") ||
    vcs.git.dirty ||
    path.split("/").some((part) => part === "..")
  )
    throw new Error("Missing exact upstream license source binding.");
  const key = `${repo}/${revision}`;
  async function get(url, asJson) {
    const response = await request(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(
        `Cannot retrieve exact upstream notices (${response.status}): ${key}`,
      );
    return asJson ? response.json() : response.text();
  }
  if (!githubTrees.has(key))
    githubTrees.set(
      key,
      await get(
        `https://api.github.com/repos/${repo}/git/trees/${revision}?recursive=1`,
        true,
      ),
    );
  const tree = githubTrees.get(key);
  if (tree.truncated || !Array.isArray(tree.tree))
    throw new Error("Incomplete upstream license tree.");
  const selected = tree.tree.filter((entry) => {
    const parent = dirname(entry.path);
    const within = !path || entry.path.startsWith(`${path}/`);
    const ancestor =
      parent === "." || path === parent || path.startsWith(`${parent}/`);
    const parts = entry.path.split("/");
    const legalDirectory = parts.slice(0, -1).some((part, index) => {
      const scope = parts.slice(0, index).join("/");
      return (
        /^(?:licenses|notices|legal)$/i.test(part) &&
        (!scope || path === scope || path.startsWith(`${scope}/`))
      );
    });
    return (
      entry.type === "blob" &&
      (within || ancestor || legalDirectory) &&
      (legalDirectory ||
        parts.some(
          (part) =>
            noticeName.test(part) || /^(?:licenses|notices|legal)$/i.test(part),
        ))
    );
  });
  const notices = [];
  for (const entry of selected) {
    const source = `https://raw.githubusercontent.com/${repo}/${revision}/${entry.path}`;
    const text = await get(source, false);
    if (!text.trim() || text.includes("\0"))
      throw new Error("Upstream license material must be nonempty text.");
    notices.push({ path: source, text });
  }
  return notices;
}

export function lockedCrates(text) {
  return new Map(
    text
      .split("[[package]]")
      .slice(1)
      .map((block) => {
        const value = (key) =>
          block.match(new RegExp(`^${key} = "([^"]+)"$`, "m"))?.[1];
        return [
          `${value("name")}@${value("version")}@${value("source")}`,
          value("checksum"),
        ];
      }),
  );
}

export async function crateComponent(pkg, checksums, output, execute, options) {
  if (
    !pkg.source?.startsWith(
      "registry+https://github.com/rust-lang/crates.io-index",
    )
  )
    throw new Error(`Unsupported Rust source provenance: ${pkg.name}`);
  const checksum = checksums.get(`${pkg.name}@${pkg.version}@${pkg.source}`);
  const directory = dirname(pkg.manifest_path);
  if (!checksum) throw new Error(`Rust checksum binding missing: ${pkg.name}`);
  const archive = join(
    dirname(dirname(dirname(directory))),
    "cache",
    basename(dirname(directory)),
    `${pkg.name}-${pkg.version}.crate`,
  );
  const bytes = readFileSync(archive);
  if (hash(bytes) !== checksum)
    throw new Error(`Rust source checksum mismatch: ${pkg.name}`);
  const notices = noticeFiles(directory, false);
  const mpl = /MPL-2\.0/.test(pkg.license ?? "");
  const verifySources = mpl || pkg.name === "libgit2-sys";
  const originals = JSON.parse(
    await execute(
      "python3",
      [
        "-I",
        "-S",
        "-c",
        `import hashlib, json, re, sys, tarfile
with tarfile.open(sys.argv[1], 'r:gz') as archive:
    result = {}
    manifest = next(member for member in archive.getmembers() if member.name.split('/')[1:] == ['Cargo.toml'])
    result['.manifest-sha256'] = hashlib.sha256(archive.extractfile(manifest).read()).hexdigest()
    for member in archive.getmembers():
        parts = member.name.split('/')[1:]
        if member.isfile() and (parts == ['.cargo_vcs_info.json'] or any(re.search(r'(?:^|[._-])(?:licen[sc]e|copying|copyright|notice|authors|unlicense)(?:$|[._-])|^(?:licenses|notices|legal)$', part, re.I) for part in parts)):
            result['/'.join(parts)] = archive.extractfile(member).read().decode('utf-8')
    if sys.argv[2] == 'sources':
        result['.source-sha256'] = {member.name.split('/', 1)[1]: hashlib.sha256(archive.extractfile(member).read()).hexdigest() for member in archive.getmembers() if member.isfile()}
    print(json.dumps(result))`,
        archive,
        verifySources ? "sources" : "notices",
      ],
      { ...options, capture: true },
    ),
  );
  if (originals[".manifest-sha256"] !== hash(readFileSync(pkg.manifest_path)))
    throw new Error(
      `Rust manifest differs from the locked archive: ${pkg.name}`,
    );
  if (
    Object.keys(originals)
      .filter(
        (path) =>
          ![
            ".cargo_vcs_info.json",
            ".source-sha256",
            ".manifest-sha256",
          ].includes(path),
      )
      .some((path) => !notices.some((file) => file.path === path))
  )
    throw new Error(`Rust archive notice missing from checkout: ${pkg.name}`);
  for (const file of notices) {
    if (originals[file.path] !== file.text)
      throw new Error(
        `Rust notice checksum mismatch: ${pkg.name}/${file.path}`,
      );
  }
  if (!hasLicense(notices)) {
    if (pkg.license === "MPL-2.0") {
      notices.push({
        path: "LICENSE-MPL-2.0.txt",
        text: readFileSync(
          new URL("./native-licenses-MPL-2.0.txt", import.meta.url),
          "utf8",
        ),
      });
    } else {
      const vcs = JSON.parse(originals[".cargo_vcs_info.json"] ?? "null");
      notices.push(...(await githubNotices(pkg.repository, vcs)));
    }
  }
  if (!hasLicense(notices))
    throw new Error(
      `Missing dependency license text: ${pkg.name} ${pkg.version}`,
    );
  const component = {
    name: pkg.name,
    version: pkg.version,
    source: `https://crates.io/crates/${pkg.name}/${pkg.version}`,
    notices,
  };
  if (verifySources) {
    if (!originals[".source-sha256"])
      throw new Error(`Missing locked source file hashes: ${pkg.name}`);
    const sourceHashes = originals[".source-sha256"];
    for (const [path, expected] of Object.entries(sourceHashes)) {
      if (
        path.split("/").includes("..") ||
        path.startsWith("/") ||
        hash(readFileSync(join(directory, path))) !== expected
      )
        throw new Error(
          `${mpl ? "MPL" : "Rust"} source differs from the locked archive: ${pkg.name}`,
        );
    }
    function checkFiles(folder, prefix = "") {
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (
          !prefix &&
          [".cargo-ok", ".cargo-checksum.json"].includes(entry.name)
        )
          continue;
        const path = `${prefix}${entry.name}`;
        if (entry.isDirectory())
          checkFiles(join(folder, entry.name), `${path}/`);
        else if (!entry.isFile() || !Object.hasOwn(sourceHashes, path))
          throw new Error(
            `Rust source has unrecognized files: ${pkg.name}/${path}`,
          );
      }
    }
    checkFiles(directory);
  }
  if (mpl) {
    component.sourceArchive = `${pkg.name}-${pkg.version}.tar.gz`;
    component.sourceUrl = `https://static.crates.io/crates/${pkg.name}/${pkg.name}-${pkg.version}.crate`;
    component.sourceSha256 = checksum;
    writeFileSync(join(output, component.sourceArchive), bytes);
  } else if (
    /GPL|CDDL|EPL/.test((pkg.license ?? "").replaceAll("LGPL", "GPL"))
  ) {
    throw new Error(
      `Corresponding source delivery needs review for Rust dependency ${pkg.name}.`,
    );
  }
  return component;
}

export function collectSwiftLicenses(
  directory,
  supplements = swiftSupplements,
) {
  const pins = json(join(directory, "Package.resolved")).pins;
  if (
    !Array.isArray(pins) ||
    !pins.length ||
    new Set(pins.map((pin) => pin.identity)).size !== pins.length
  )
    throw new Error("Missing or duplicate locked Swift packages.");
  return pins.map((pin) => {
    const reviewed = supplements[pin.identity];
    if (
      !reviewed ||
      pin.kind !== "remoteSourceControl" ||
      pin.location !== reviewed.location ||
      pin.state.version !== reviewed.version ||
      pin.state.revision !== reviewed.revision
    )
      throw new Error(`Unreviewed Swift license material: ${pin.identity}`);
    const bytes = readFileSync(join(directory, reviewed.noticeFile));
    if (hash(bytes) !== reviewed.noticeSha256)
      throw new Error(`Swift notice binding changed: ${pin.identity}`);
    return {
      name: pin.identity,
      version: pin.state.version,
      source: `${pin.location.replace(/\.git$/, "")}/tree/${pin.state.revision}`,
      notices: [{ path: reviewed.noticeFile, text: bytes.toString("utf8") }],
    };
  });
}

export async function collectNativeLicenses({
  root,
  targets,
  output,
  execute,
  options,
  collectRuntime = collectRustRuntimeLicenses,
}) {
  mkdirSync(output, { recursive: true });
  const components = new Map();
  const checksums = lockedCrates(
    readFileSync(join(root, "Cargo.lock"), "utf8"),
  );
  for (const target of targets) {
    const args = [
      "--manifest-path",
      join(root, "app/src-tauri/Cargo.toml"),
      "--locked",
    ];
    const metadata = JSON.parse(
      await execute(
        "cargo",
        [
          "metadata",
          ...args,
          "--format-version",
          "1",
          "--filter-platform",
          target,
          "--features",
          "custom-protocol",
        ],
        { ...options, capture: true },
      ),
    );
    const tree = await execute(
      "cargo",
      [
        "tree",
        ...args,
        "--target",
        target,
        "--features",
        "custom-protocol",
        "--edges",
        "normal",
        "--prefix",
        "none",
        "--format",
        "{p}",
      ],
      { ...options, capture: true },
    );
    const selected = new Set(
      tree.split("\n").map((line) => line.replace(/ \(.*$/, "").trim()),
    );
    if (
      !selected.has(
        "situate-client v" +
          metadata.packages.find((pkg) => pkg.name === "situate-client")
            ?.version,
      )
    )
      throw new Error("Missing app Cargo dependency graph.");
    for (const pkg of metadata.packages) {
      if (
        !pkg.source ||
        !selected.has(`${pkg.name} v${pkg.version}`) ||
        components.has(pkg.id)
      )
        continue;
      components.set(
        pkg.id,
        await crateComponent(pkg, checksums, output, execute, options),
      );
    }
  }
  if (targets.includes("aarch64-apple-darwin")) {
    for (const component of collectSwiftLicenses(
      join(root, "app/src-tauri/dictation"),
    ))
      components.set(component.name, component);
  }
  await collectRuntime({ root, targets, output, execute, options });
  writeFileSync(
    join(output, "third-party-native-notices.txt"),
    renderNotices(
      [...components.values()].sort((a, b) => a.name.localeCompare(b.name)),
    ),
  );
  writeFileSync(
    join(output, "situate-software-license.txt"),
    readFileSync(join(root, "../LICENSE")),
  );
  writeFileSync(
    join(output, "situate-artwork-license.txt"),
    readFileSync(join(root, "../LICENSES/CC-BY-4.0.txt")),
  );
  writeFileSync(
    join(output, "situate-artwork-attribution.txt"),
    "Original Situate artwork by Situate contributors.\nSource: https://github.com/getsituate/situate/tree/main/design/brand\nLicensed under Creative Commons Attribution 4.0 International.\nhttps://creativecommons.org/licenses/by/4.0/\nSee situate-artwork-license.txt for the license terms.\nThird-party artwork retains its own terms and notices.\n",
  );
  return licenseResources(output);
}

export function licenseResources(directory) {
  return Object.fromEntries(
    readdirSync(directory)
      .sort()
      .map((name) => [join(directory, name), `licenses/${name}`]),
  );
}

export function verifyLicenseResources(app, resources, { macos = true } = {}) {
  const base = join(app, macos ? "Contents/Resources" : "");
  for (const [source, destination] of Object.entries(resources)) {
    const packaged = join(base, destination);
    if (
      !existsSync(packaged) ||
      hash(readFileSync(packaged)) !== hash(readFileSync(source))
    )
      throw new Error(
        `Packaged third-party material missing or changed: ${destination}`,
      );
  }
}

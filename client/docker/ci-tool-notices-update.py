"""Regenerate CI tool notice pins with Python 3.11+ and network access.

Review release commits and notice-source supplements on tool upgrades. Dependencies
come from upstream manifests; the generated inventory is not edited by hand.
"""

import argparse
import concurrent.futures
import importlib.util
import json
import pathlib
import re
import subprocess
import tomllib
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "notices", pathlib.Path(__file__).with_name("ci-tool-notices.py")
)
notices = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(notices)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--cache", type=pathlib.Path, required=True)
args = parser.parse_args()
artifacts = {}
tools = {}
quality = json.loads((ROOT / "tools/toolchain.quality.json").read_text())
assets = json.loads((ROOT / "client/docker/ci-assets.json").read_text())

RELEASES = [
    ("cargo-deny", "EmbarkStudios/cargo-deny", "bca0dde53651ee946720e4540b5ce2610bec8f06", "0.20.2"),
    ("cargo-llvm-cov", "taiki-e/cargo-llvm-cov", "0dc905679ae6b4740b186f6e2c2ef1ab78fb76d7", "0.9.1"),
    ("gh", "cli/cli", "3d5a9e355a837f2f5ee78d7484c118cc1342ad1a", "2.104.0"),
    ("gitleaks", "gitleaks/gitleaks", "107a41827bb6698dbbff756b2300537774a1d84c", "8.24.3"),
    ("ktlint", "pinterest/ktlint", "21c3b05300bee577aca40e6c9b6f8e8812a86034", "1.7.1"),
]


def fetch(url):
    return notices.fetch(url, args.cache)


def add(id, url, expected=None):
    data = fetch(url)
    notices.require(not expected or notices.digest(data) == expected, f"Archive checksum: {id}")
    files = notices.archive_files(data)
    artifacts[id] = {
        "url": url,
        "sha256": notices.digest(data),
        "notices": notices.notice_inventory(files),
    }
    return files


def source_file(files, basename):
    return next(path for path in files if path.count("/") == 1 and path.endswith("/" + basename))


def github_source(id, repository, ref):
    if id not in artifacts:
        add(id, f"https://codeload.github.com/{repository}/tar.gz/{ref}")
    return id


pending = {}
for name, repository, commit, version in RELEASES:
    notices.require(quality[name]["version"] == version, f"Review source release pin: {name}")
    files = add(name, f"https://codeload.github.com/{repository}/tar.gz/{commit}")
    tool = tools[name] = {"version": version, "source": name, "dependencies": []}
    if name.startswith("cargo"):
        if name == "cargo-llvm-cov":
            # Its release repository omits Cargo.lock; the published crate includes one.
            id = f"crate:{name}@{version}"
            pin = assets[name]["source"]
            files = add(id, pin["url"], pin["sha256"])
            tool["source"] = id
            tool["dependencies"].append(name)
        path = source_file(files, "Cargo.lock")
        tool["manifest"] = {"path": path, "sha256": notices.digest(files[path]), "kind": "cargo-lock"}
        if name == "cargo-llvm-cov":
            notices.require(tool["manifest"]["sha256"] == assets[name]["source"]["lockSha256"], "Published build lock checksum mismatch")
        for id, checksum in notices.dependency_ids(files, tool["manifest"]):
            package, package_version = id.removeprefix("crate:").split("@")
            tool["dependencies"].append(id)
            request = (f"https://static.crates.io/crates/{package}/{package}-{package_version}.crate", checksum)
            notices.require(id not in pending or pending[id] == request, "Conflicting Cargo archive pins")
            pending[id] = request
    elif name in {"gitleaks", "gh"}:
        path = source_file(files, "go.mod")
        tool["manifest"] = {"path": path, "sha256": notices.digest(files[path]), "kind": "go-mod"}
        for id, _ in notices.dependency_ids(files, tool["manifest"]):
            module, module_version = id.removeprefix("go:").split("@")
            escape = lambda value: re.sub("[A-Z]", lambda match: "!" + match[0].lower(), value)
            tool["dependencies"].append(id)
            pending[id] = (f"https://proxy.golang.org/{escape(module)}/@v/{escape(module_version)}.zip", None)

# Include dev and other-platform entries rather than guessing which packages were linked.
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    list(pool.map(lambda item: add(item[0], *item[1]), pending.items()))

NAMESPACE = {"m": "http://maven.apache.org/POM/4.0.0"}
models = {}


def maven_model(group, artifact, version):
    key = (group, artifact, version)
    if key in models:
        return models[key]
    url = f"https://repo.maven.apache.org/maven2/{group.replace('.', '/')}/{artifact}/{version}/{artifact}-{version}.pom"
    data = fetch(url)
    project = ET.fromstring(data)
    properties = {}
    parents = []
    parent = project.find("m:parent", NAMESPACE)
    if parent is not None:
        coordinates = [parent.findtext("m:" + field, namespaces=NAMESPACE) for field in ["groupId", "artifactId", "version"]]
        inherited = maven_model(*coordinates)
        properties.update(inherited["properties"])
        parents = [*inherited["parents"], {"url": inherited["url"], "sha256": notices.digest(inherited["data"])}]
    properties.update({"project.version": version, "project.groupId": group, "pom.version": version, "pom.groupId": group})
    declared = project.find("m:properties", NAMESPACE)
    if declared is not None:
        properties.update({entry.tag.split("}")[-1]: entry.text for entry in declared})

    def substitute(value, strict=False):
        for _ in range(10):
            updated = re.sub(r"\$\{([^}]+)\}", lambda match: properties.get(match[1], match[0]), value)
            if updated == value:
                notices.require(not strict or "${" not in value, f"Unresolved Maven property: {key}: {value}")
                return value
            value = updated
        raise ValueError(f"Recursive Maven property: {key}")

    properties = {key: substitute(value) for key, value in properties.items()}
    dependencies = []
    for dependency in project.findall("m:dependencies/m:dependency", NAMESPACE):
        field = lambda name: dependency.findtext("m:" + name, namespaces=NAMESPACE)
        if field("scope") in ["test", "provided", "system"] or field("optional") == "true":
            continue
        dg, da, dv = field("groupId"), field("artifactId"), field("version")
        if not dv:
            # These are the parent-managed dependencies in the reviewed release POMs.
            if dg == "org.slf4j":
                dv = properties.get("slf4j.version", version)
            elif dg == "ch.qos.logback":
                dv = version
            else:
                raise ValueError(f"Unresolved Maven dependency: {key}: {dg}:{da}")
        dependencies.append(tuple(substitute(value, strict=True) for value in [dg, da, dv]))
    models[key] = {"properties": properties, "dependencies": dependencies, "parents": parents, "url": url, "data": data}
    return models[key]


# Preserve the requested-version superset, before Gradle conflict resolution.
queue = [("com.pinterest.ktlint", "ktlint-cli", tools["ktlint"]["version"])]
seen = set()
while queue:
    key = queue.pop()
    if key in seen:
        continue
    seen.add(key)
    group, artifact, version = key
    model = maven_model(*key)
    queue.extend(model["dependencies"])
    id = f"maven:{group}:{artifact}@{version}"
    tools["ktlint"]["dependencies"].append(id)
    add(id, model["url"][:-4] + ".jar")
    artifacts[id]["pom"] = {
        "url": model["url"],
        "sha256": notices.digest(model["data"]),
        "parents": model["parents"],
        "dependencies": [f"maven:{dg}:{da}@{dv}" for dg, da, dv in model["dependencies"]],
    }

# Full Kotlin sources include the compiler's copied IntelliJ code and license directory.
SUPPLEMENTS = {
    "com.github.ajalt.clikt": ("clikt", "ajalt/clikt", "{version}"),
    "com.github.ajalt.mordant": ("mordant", "ajalt/mordant", "{version}"),
    "com.github.ajalt.colormath": ("colormath", "ajalt/colormath", "{version}"),
    "dev.drewhamilton.poko": ("poko", "drewhamilton/poko", "{version}"),
    "io.github.oshai": ("kotlin-logging", "oshai/kotlin-logging", "{version}"),
    "io.github.detekt.sarif4k": ("sarif4k", "detekt/sarif4k", "{version}"),
    "ch.qos.logback": ("logback", "qos-ch/logback", "v_{version}"),
    "org.ec4j.core": ("ec4j", "ec4j/ec4j", "{version}"),
    "org.jetbrains.kotlin": ("kotlin", "JetBrains/kotlin", "v{version}"),
}
for id in list(tools["ktlint"]["dependencies"]):
    if artifacts[id]["notices"]:
        continue
    group, artifact_version = id.removeprefix("maven:").split(":")
    artifact, version = artifact_version.split("@")
    if group == "com.pinterest.ktlint":
        source = "ktlint"
    elif group == "org.jetbrains":
        source = "annotations-source@" + version
        add(source, artifacts[id]["url"][:-4] + "-sources.jar")
    else:
        supplement = SUPPLEMENTS.get(group)
        if group == "org.jetbrains.kotlinx":
            supplement = (
                ("kotlinx-coroutines", "Kotlin/kotlinx.coroutines", "{version}")
                if artifact.startswith("kotlinx-coroutines-")
                else ("kotlinx-serialization", "Kotlin/kotlinx.serialization", "v{version}")
            )
        notices.require(supplement, f"Missing Maven notice source: {id}")
        name, repository, tag = supplement
        source = github_source(name + "-source@" + version, repository, "refs/tags/" + tag.format(version=version))
    artifacts[id]["noticeSource"] = source
    tools["ktlint"]["dependencies"].append(source)

# Recover omitted crate license files from the published package's exact VCS commit.
for id, artifact in list(artifacts.items()):
    if not id.startswith("crate:") or artifact["notices"]:
        continue
    files = notices.archive_files(fetch(artifact["url"]))
    vcs = json.loads(files[source_file(files, ".cargo_vcs_info.json")])
    package = tomllib.loads(files[source_file(files, "Cargo.toml")].decode())["package"]
    repository = "/".join(package["repository"].split("/")[3:5]).removesuffix(".git")
    notices.require(package["repository"].startswith("https://github.com/"), "Unreviewed crate notice source")
    commit = vcs["git"]["sha1"]
    source = github_source(f"source:{repository}@{commit}", repository, commit)
    artifact["noticeSource"] = source
    for tool in tools.values():
        if id in tool["dependencies"]:
            tool["dependencies"].append(source)

for name, tool in tools.items():
    if name == "cargo-llvm-cov":
        notices.require(assets[name].get("sourceBuild") == "cargo-install-locked", "Expected locked source build")
        tool["sourceBuild"] = {
            "method": "cargo-install-locked",
            "rustVersion": tomllib.loads((ROOT / "client/rust-toolchain.toml").read_text())["toolchain"]["channel"],
            "binaryPath": f"{name}/{name}",
            "receiptPath": f"{name}/source-build.json",
        }
        tool["dependencies"] = sorted(set(tool["dependencies"]))
        continue
    tool["binaries"] = {}
    for arch in ["amd64", "arm64"]:
        if name == "ktlint":
            binary = fetch(f"https://github.com/pinterest/ktlint/releases/download/{tool['version']}/ktlint")
            notices.require(notices.digest(binary) == quality[name]["sha256"], "ktlint checksum mismatch")
        else:
            pin = assets[name][arch]
            data = fetch(pin["url"])
            notices.require(notices.digest(data) == pin["sha256"], f"Binary archive checksum: {name}/{arch}")
            binary = next(data for path, data in notices.archive_files(data).items() if path.split("/")[-1] == name)
        tool["binaries"][arch] = {"path": f"{name}/{name}", "sha256": notices.digest(binary)}
        if name in {"gitleaks", "gh"}:
            version, modules = notices.go_build_info(binary)
            notices.require(set(modules) <= set(tool["dependencies"]), "Go binary modules differ from go.mod")
            for id, checksum in modules.items():
                files = notices.archive_files(fetch(artifacts[id]["url"]))
                notices.require(notices.go_module_checksum(files) == checksum, f"Go module/binary checksum: {id}")
                artifacts[id]["goChecksum"] = checksum
            source = "go:stdlib@" + version
            if source not in artifacts:
                add(source, f"https://go.dev/dl/{version}.src.tar.gz")
            tool["dependencies"].append(source)
    tool["dependencies"] = sorted(set(tool["dependencies"]))

manifest = {"version": 1, "tools": tools, "artifacts": dict(sorted(artifacts.items()))}
notices.check_manifest(manifest, quality)
path = ROOT / "client/docker/ci-tool-notices.json"
path.write_text(json.dumps(manifest, indent=2) + "\n")
subprocess.run([
    "volta", "run", "node", str(ROOT / "node_modules/prettier/bin/prettier.cjs"),
    "--write", str(path),
], cwd=ROOT, check=True)
verify = ROOT / "client/docker/ci-verify.mjs"
pins = {
    "situate": notices.digest((ROOT / "LICENSE").read_bytes()),
    "manifest": notices.digest(path.read_bytes()),
    "verifier": notices.digest(pathlib.Path(notices.__file__).read_bytes()),
}
text = verify.read_text()
for key, value in pins.items():
    text, count = re.subn(rf'{key}: "[^"\n]+"', f'{key}: "{value}"', text)
    notices.require(count == 1, f"Missing source-free verifier pin: {key}")
verify.write_text(text)
print(f"Pinned {len(artifacts)} archives; review changed URLs, hashes and notice sources before building.")

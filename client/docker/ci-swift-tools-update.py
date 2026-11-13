"""Refresh Swift tool source/notice pins after reviewing release commits and SwiftPM locks."""

import argparse
import concurrent.futures
import hashlib
import importlib.util
import json
import pathlib
import re
import shutil
import subprocess
import urllib.request

HERE = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("swift_tools", HERE / "ci-swift-tools.py")
tools = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(tools)
COMPILER_IMAGE = "swift:6.2.4-bookworm@sha256:87947bfd51a61c86f487986ccf6390fc9cd4035cf98d74f7b8c9a7cb92d9282a"
RUNTIME_SOURCES = {
    "swift": "ee343b46aef81c3ac7c5d7960cb35a41a88c5a9b",
    "swift-corelibs-foundation": "f3a7a34302317a95665bf4ff1a62ee1b459c1695",
    "swift-corelibs-libdispatch": "2df91f94651f2d924d7506c9d14685929386d779",
    "swift-foundation": "7242fa9cb8993aaf9a0a72522206b96a45da9c28",
    "swift-foundation-icu": "ddd11fa3f970bd34924c418835986167b8e6efeb",
    "llvm-project": "8f0d2ca924db37c8f8161d55c21b9097b05b72f3",
    "swift-syntax": "5a87516fc3dddbd23cb76358eb489915ee86b444",
}
RELEASES = {
    "swift-format": ("swiftlang/swift-format", "65f9da9aad84adb7e2028eb32ca95164aa590e3b", "600.0.0"),
    "swiftlint": ("realm/SwiftLint", "6aba03e3d8302b33f106e0f922210f35ca4b52cf", "0.65.1"),
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=pathlib.Path, required=True)
    args = parser.parse_args()
    args.cache.mkdir(parents=True, exist_ok=True)
    quality = json.loads((HERE.parent.parent / "tools/toolchain.quality.json").read_text())
    artifacts = {}
    def source(repository, revision):
        identity = repository + "@" + revision
        artifacts[identity] = {"repository": "https://github.com/" + repository, "revision": revision}
        return identity
    runtime = [source("swiftlang/" + name, revision) for name, revision in RUNTIME_SOURCES.items()]
    selected = {}
    for name, (repository, revision, version) in RELEASES.items():
        tools.require(quality[name]["version"] == version, "Review the Swift source release pin: " + name)
        lock = HERE / ("ci-" + name + ".resolved.json")
        data = json.loads(lock.read_text())
        dependencies = {}
        for pin in data["pins"]:
            dependencies[pin["identity"]] = source(pin["location"].removesuffix(".git").removeprefix("https://github.com/"), pin["state"]["revision"])
        selected[name] = {"version": quality[name]["version"], "source": source(repository, revision), "lock": lock.name, "lockSha256": tools.file_digest(lock), "dependencies": dependencies}
    def inventory(item):
        identity, artifact = item
        artifact["url"] = artifact["repository"].replace("https://github.com/", "https://codeload.github.com/") + "/tar.gz/" + artifact["revision"]
        path = args.cache / hashlib.sha256(artifact["url"].encode()).hexdigest()
        if not path.exists():
            with urllib.request.urlopen(artifact["url"], timeout=180) as response, path.open("wb") as output:
                shutil.copyfileobj(response, output)
        artifact["sha256"] = tools.file_digest(path)
        artifact["notices"] = tools.notice_inventory(path)
        tools.require(artifact["notices"], "Missing source notices: " + identity)
        pinned = args.cache / (artifact["sha256"] + ".tar.gz")
        if not pinned.exists():
            pinned.hardlink_to(path)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(inventory, artifacts.items()))
    manifest = {"schemaVersion": 1, "compiler": {"image": COMPILER_IMAGE, "version": "6.2.4", "licenseSha256": "770af8291f708538d8ff885a0bbc4e045cd700531741c4f99528d435c14d7f55", "sources": runtime}, "tools": selected, "artifacts": dict(sorted(artifacts.items()))}
    tools.check_inputs(manifest, HERE, quality)
    destination = HERE / "ci-swift-tools.json"
    destination.write_text(json.dumps(manifest, indent=2) + "\n")
    root = HERE.parent.parent
    subprocess.run(["volta", "run", "node", str(root / "node_modules/prettier/bin/prettier.cjs"), "--write", str(destination)], cwd=root, check=True)
    verifier = HERE / "ci-verify.mjs"
    text = verifier.read_text()
    for key, checksum in {"swiftManifest": tools.file_digest(destination), "swiftVerifier": tools.file_digest(HERE / "ci-swift-tools.py")}.items():
        text, count = re.subn(rf'{key}:\s*"[a-f0-9]{{64}}"', f'{key}: "{checksum}"', text)
        tools.require(count == 1, "Missing source-free Swift verifier pin: " + key)
    verifier.write_text(text)
    subprocess.run(["volta", "run", "node", str(root / "node_modules/prettier/bin/prettier.cjs"), "--write", str(verifier)], cwd=root, check=True)
    print(f"Pinned {len(artifacts)} Swift tool/runtime source archives; review all source and notice changes.")


if __name__ == "__main__":
    main()

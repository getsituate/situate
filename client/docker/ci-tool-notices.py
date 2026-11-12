"""Retain tool notices, build locked Cargo sources, and verify installed artifacts."""

import argparse
import base64
import hashlib
import io
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile
import tomllib
import urllib.request
import zipfile

NOTICE = re.compile(
    r"(^|/)(licen[cs]e[^/]*|copying[^/]*|copyright[^/]*|notice[^/]*|authors[^/]*|legal)(/|$)",
    re.I,
)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def archive_files(data):
    # Never extract archive paths or follow archive links on the filesystem.
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            names = [n for n in archive.namelist() if not n.endswith("/")]
            require(len(names) == len(set(names)), "Duplicate archive members")
            return {n: archive.read(n) for n in names}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
        members = [m for m in archive if m.isfile()]
        require(len(members) == len({m.name for m in members}), "Duplicate archive members")
        return {m.name: archive.extractfile(m).read() for m in members}


def notice_inventory(files):
    named = any(NOTICE.search(name) and data for name, data in files.items())
    return [
        {"path": name, "sha256": digest(data)}
        for name, data in sorted(files.items())
        if data and (NOTICE.search(name) or (not named and b"copyright" in data[:4096].lower() and b"license" in data[:4096].lower()))
    ]


def fetch(url, cache):
    require(url.startswith("https://"), f"Expected HTTPS archive: {url}")
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / digest(url.encode())
    if not path.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "situate-notice-inventory"})
        with urllib.request.urlopen(request, timeout=120) as response:
            data = response.read()
        path.write_bytes(data)
    return path.read_bytes()


def dependency_ids(files, manifest):
    data = files[manifest["path"]]
    require(digest(data) == manifest["sha256"], "Dependency manifest hash mismatch")
    if manifest["kind"] == "cargo-lock":
        ids = []
        for package in tomllib.loads(data.decode())["package"]:
            if "source" not in package:
                continue
            require(
                package["source"] == "registry+https://github.com/rust-lang/crates.io-index",
                "Unreviewed Cargo source/replacement",
            )
            ids.append((f"crate:{package['name']}@{package['version']}", package["checksum"]))
        return ids
    require(manifest["kind"] == "go-mod", "Unknown dependency manifest")
    text = data.decode()
    require(not re.search(r"^\s*(replace|exclude)\b", text, re.M), "Unreviewed Go replacement/exclusion")
    dependencies = []
    block = False
    for line in text.splitlines():
        line = line.split("//", 1)[0].strip()
        if not line:
            continue
        if line == "require (" and not block:
            block = True
            continue
        if line == ")" and block:
            block = False
            continue
        if not block and re.match(r"^(module|go|toolchain)\s+\S+$", line):
            continue
        requirement = line if block else line.removeprefix("require ")
        match = re.fullmatch(r"(\S+) (v\S+)", requirement)
        require(match is not None, f"Unreviewed Go manifest directive: {line}")
        dependencies.append((f"go:{match[1]}@{match[2]}", None))
    require(not block, "Unterminated Go requirement block")
    return dependencies


def check_manifest(manifest, quality):
    require(manifest["version"] == 1, "Unsupported tool notice inventory")
    require(set(manifest["tools"]) == {"cargo-deny", "cargo-llvm-cov", "gitleaks", "ktlint"}, "Incomplete tool set")
    used = set()
    for name, tool in manifest["tools"].items():
        require(tool["version"] == quality[name]["version"], f"Stale tool notice version: {name}")
        require(len(tool["dependencies"]) == len(set(tool["dependencies"])), "Duplicate dependency")
        used.update([tool["source"], *tool["dependencies"]])
        if name == "cargo-llvm-cov":
            build = tool["sourceBuild"]
            require(build["method"] == "cargo-install-locked", "Unsupported source build method")
            require(build["binaryPath"] == f"{name}/{name}", "Unexpected source build binary path")
            require(build["receiptPath"] == f"{name}/source-build.json", "Unexpected build receipt path")
            require(re.fullmatch(r"\d+\.\d+\.\d+", build["rustVersion"]), "Unpinned build toolchain")
            require("binaries" not in tool, "Source build must not use upstream binary hashes")
        else:
            require("sourceBuild" not in tool, "Unreviewed source build")
            require(set(tool["binaries"]) == {"amd64", "arm64"}, "Missing binary notice binding")
            for binary in tool["binaries"].values():
                require(binary["path"] == f"{name}/{name}", "Unexpected tool binary path")
                require(re.fullmatch(r"[a-f0-9]{64}", binary["sha256"]), "Invalid binary hash")
    require(used == set(manifest["artifacts"]), "Missing or unreferenced notice artifact")
    ktlint = manifest["tools"]["ktlint"]
    expected = set()
    queue = [f"maven:com.pinterest.ktlint:ktlint-cli@{ktlint['version']}"]
    while queue:
        id = queue.pop()
        if id in expected:
            continue
        expected.add(id)
        require(id in manifest["artifacts"], f"Missing Maven artifact: {id}")
        queue.extend(manifest["artifacts"][id]["pom"]["dependencies"])
    require(expected == {id for id in ktlint["dependencies"] if id.startswith("maven:")}, "Incomplete Maven runtime graph")
    for name, artifact in manifest["artifacts"].items():
        require(re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]), f"Invalid archive hash: {name}")
        require(artifact["url"].startswith("https://"), "Expected HTTPS archive")
        if not artifact["notices"]:
            source = manifest["artifacts"].get(artifact.get("noticeSource"))
            require(source and source["notices"], f"Missing notice texts: {name}")


def collect(manifest, root, cache):
    destination = root / "tool-notices"
    destination.mkdir(parents=True, exist_ok=True)
    for artifact in manifest["artifacts"].values():
        data = fetch(artifact["url"], cache)
        require(digest(data) == artifact["sha256"], f"Archive checksum: {artifact['url']}")
        (destination / (artifact["sha256"] + ".archive")).write_bytes(data)
        if "pom" in artifact:
            for pom in [artifact["pom"], *artifact["pom"].get("parents", [])]:
                data = fetch(pom["url"], cache)
                require(digest(data) == pom["sha256"], "POM checksum mismatch")
                (destination / (pom["sha256"] + ".pom")).write_bytes(data)
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    verify_archives(manifest, root, write_texts=True)


def verify_archives(manifest, root, write_texts=False):
    destination = root / "tool-notices"
    for id, artifact in manifest["artifacts"].items():
        data = (destination / (artifact["sha256"] + ".archive")).read_bytes()
        require(digest(data) == artifact["sha256"], f"Retained archive checksum: {id}")
        files = archive_files(data)
        if "goChecksum" in artifact:
            require(go_module_checksum(files) == artifact["goChecksum"], f"Go module content checksum: {id}")
        require(notice_inventory(files) == artifact["notices"], f"Notice coverage changed: {id}")
        for notice in artifact["notices"]:
            text = destination / "texts" / notice["sha256"]
            if write_texts:
                text.parent.mkdir(exist_ok=True)
                text.write_bytes(files[notice["path"]])
            require(digest(text.read_bytes()) == notice["sha256"], f"Retained notice checksum: {id}/{notice['path']}")
        if "pom" in artifact:
            pom = artifact["pom"]
            for metadata in [pom, *pom.get("parents", [])]:
                require(digest((destination / (metadata["sha256"] + ".pom")).read_bytes()) == metadata["sha256"], "Retained POM checksum")
            require(set(pom["dependencies"]) <= set(manifest["tools"]["ktlint"]["dependencies"]), "Missing transitive Maven dependency")
        for tool in manifest["tools"].values():
            if tool["source"] != id or "manifest" not in tool:
                continue
            expected = dependency_ids(files, tool["manifest"])
            kind = "crate:" if tool["manifest"]["kind"] == "cargo-lock" else "go:"
            actual = {i for i in tool["dependencies"] if i.startswith(kind) and not i.startswith("go:stdlib@")}
            require(actual == {i for i, _ in expected}, "Incomplete dependency notice coverage")
            for dependency, checksum in expected:
                if checksum:
                    require(manifest["artifacts"][dependency]["sha256"] == checksum, "Cargo checksum binding mismatch")


def retained_notices(root):
    volta = json.loads((root.parent / "volta/toolchain.json").read_text())
    paths = [
        root.parent / "volta/LICENSE",
        root.parent / f"volta/tools/image/node/{volta['node']}/LICENSE",
        root / "NOTICES.md",
        root / "LICENSE-Situate.txt",
        root.parent / "java/openjdk/NOTICE",
    ]
    directories = [
        root.parent / f"volta/tools/image/npm/{volta['npm']}",
        pathlib.Path("/usr/local/rustup/toolchains"),
        root.parent / "java/openjdk/legal",
        pathlib.Path("/usr/share/doc"),
        *sorted(root.glob("playwright-*")),
        *(root / name for name in ["cargo-deny", "cargo-llvm-cov", "gitleaks", "ktlint"]),
    ]
    for directory in directories:
        require(directory.is_dir(), f"Missing distribution notices: {directory}")
        selected = [p for p in directory.rglob("*") if p.is_file() and (NOTICE.search(str(p.relative_to(directory))) or directory.name == "legal")]
        require(selected, f"Empty distribution notices: {directory}")
        paths.extend(selected)
    return {str(p): digest(p.read_bytes()) for p in sorted(set(paths))}


def go_build_info(data):
    start = data.index(b"\xff Go buildinf:")
    require(data[start + 15] & 2, "Unsupported Go build metadata encoding")
    offset = start + 32

    def read_string():
        nonlocal offset
        length = shift = 0
        while True:
            byte = data[offset]
            offset += 1
            length |= (byte & 127) << shift
            if byte < 128:
                break
            shift += 7
            require(shift < 64, "Invalid Go build metadata")
        value = data[offset:offset + length]
        offset += length
        return value

    version = read_string().decode()
    module_info = read_string()[16:-16].decode()
    require("\n=>\t" not in module_info, "Unreviewed Go binary replacement")
    dependencies = {}
    for module, module_version, checksum in re.findall(r"\ndep\t([^\t]+)\t([^\t\n]+)\t([^\n]*)", module_info):
        if module_version == "(devel)":
            require(module == "github.com/zricethezav/gitleaks/v8", "Unreviewed Go development module")
            continue
        dependencies[f"go:{module}@{module_version}"] = checksum
    return version, dependencies


def go_module_checksum(files):
    lines = "".join(f"{digest(data)}  {name}\n" for name, data in sorted(files.items()))
    return "h1:" + base64.b64encode(hashlib.sha256(lines.encode()).digest()).decode()


SOURCE_BUILD_COMMAND = ["cargo", "install", "--path", ".", "--locked", "--root", "../install"]


def compiler_identity(env=None, cwd=None):
    return {
        "rustc": subprocess.check_output(["rustc", "-vV"], env=env, cwd=cwd, text=True).strip(),
        "cargo": subprocess.check_output(["cargo", "--version"], env=env, cwd=cwd, text=True).strip(),
    }


def source_build_binding(manifest, name, arch):
    tool = manifest["tools"][name]
    return {
        "version": tool["version"],
        "architecture": arch,
        "method": tool["sourceBuild"]["method"],
        "source": tool["source"],
        "sourceArchiveSha256": manifest["artifacts"][tool["source"]]["sha256"],
        "lockSha256": tool["manifest"]["sha256"],
        "command": SOURCE_BUILD_COMMAND,
    }


def build_source_tool(manifest, root, name, arch):
    tool = manifest["tools"][name]
    build = tool["sourceBuild"]
    require(build["method"] == "cargo-install-locked", "Unsupported source build method")
    artifact = manifest["artifacts"][tool["source"]]
    archive_path = root / "tool-notices" / (artifact["sha256"] + ".archive")
    data = archive_path.read_bytes()
    require(digest(data) == artifact["sha256"], "Build source archive checksum")
    files = archive_files(data)
    dependency_ids(files, tool["manifest"])
    prefix = f"{name}-{tool['version']}"
    package_manifest = files[prefix + "/Cargo.toml"]
    package = tomllib.loads(package_manifest.decode())["package"]
    require((package["name"], package["version"]) == (name, tool["version"]), "Build source package identity")
    require(tool["manifest"]["path"] == prefix + "/Cargo.lock", "Unexpected build lock path")
    with tempfile.TemporaryDirectory(prefix="ci-cargo-build-") as temporary:
        work = pathlib.Path(temporary)
        source = work / "source"
        source.mkdir()
        with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as archive:
            for member in archive:
                path = pathlib.PurePosixPath(member.name)
                require(path.parts[0] == prefix and ".." not in path.parts, "Unsafe build source path")
                require(not path.is_absolute(), "Absolute build source path")
                if member.isdir():
                    continue
                require(member.isfile(), "Unsupported build source link")
                destination = source.joinpath(*path.parts[1:])
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(files[member.name])
                destination.chmod(member.mode & 0o777)
        (work / "home").mkdir()
        env = {
            "PATH": os.environ["PATH"],
            "RUSTUP_HOME": os.environ["RUSTUP_HOME"],
            "RUSTUP_TOOLCHAIN": build["rustVersion"],
            "HOME": str(work / "home"),
            "CARGO_HOME": str(work / "cargo"),
            "CARGO_TARGET_DIR": str(work / "target"),
            "CARGO_BUILD_JOBS": "4",
            "LANG": "C.UTF-8",
        }
        compiler = compiler_identity(env, source)
        require(compiler["rustc"].startswith("rustc " + build["rustVersion"] + " "), "Build compiler version mismatch")
        subprocess.run(SOURCE_BUILD_COMMAND, cwd=source, env=env, check=True)
        require((source / "Cargo.toml").read_bytes() == package_manifest, "Build changed package manifest")
        require(digest((source / "Cargo.lock").read_bytes()) == tool["manifest"]["sha256"], "Build changed Cargo.lock")
        require(digest(archive_path.read_bytes()) == artifact["sha256"], "Build changed retained source archive")
        output = work / "install/bin" / name
        binary_hash = digest(output.read_bytes())
        destination = root / build["binaryPath"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(output, destination)
        destination.chmod(0o755)
        receipt = {
            **source_build_binding(manifest, name, arch),
            "compiler": compiler,
            "binarySha256": binary_hash,
        }
        (root / build["receiptPath"]).write_text(json.dumps(receipt, indent=2) + "\n")


def verify_source_build(manifest, root, name, arch):
    tool = manifest["tools"][name]
    build = tool["sourceBuild"]
    receipt = json.loads((root / build["receiptPath"]).read_text())
    for key, value in source_build_binding(manifest, name, arch).items():
        require(receipt.get(key) == value, f"Source build receipt mismatch: {key}")
    require(receipt["compiler"] == compiler_identity(), "Source build compiler identity mismatch")
    require(receipt["compiler"]["rustc"].startswith("rustc " + build["rustVersion"] + " "), "Source build compiler version mismatch")
    require(digest((root / build["binaryPath"]).read_bytes()) == receipt["binarySha256"], "Source build binary checksum mismatch")


def verify_binaries(manifest, root, arch):
    for name, tool in manifest["tools"].items():
        if "sourceBuild" in tool:
            verify_source_build(manifest, root, name, arch)
            continue
        binary = tool["binaries"][arch]
        data = (root / binary["path"]).read_bytes()
        require(digest(data) == binary["sha256"], f"Notice/binary binding mismatch: {name}")
        if name == "gitleaks":
            version, dependencies = go_build_info(data)
            expected = set(tool["dependencies"])
            require("go:stdlib@" + version in expected, "Missing Go runtime notices")
            require(set(dependencies) <= expected, "Missing Go binary dependency notices")
            for id, checksum in dependencies.items():
                require(manifest["artifacts"][id]["goChecksum"] == checksum, "Go binary/module checksum binding mismatch")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["collect", "verify"])
    parser.add_argument("--root", type=pathlib.Path, default=pathlib.Path("/opt/ci-tools"))
    parser.add_argument("--manifest", type=pathlib.Path)
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path("/var/cache/situate-ci-tool-notices"))
    args = parser.parse_args()
    manifest = json.loads((args.manifest or args.root / "tool-notices/manifest.json").read_text())
    quality = json.loads((args.root / "toolchain.quality.json").read_text())
    check_manifest(manifest, quality)
    arch = {"x86_64": "amd64", "aarch64": "arm64"}[platform.machine()]
    if args.action == "collect":
        collect(manifest, args.root, args.cache)
        build_source_tool(manifest, args.root, "cargo-llvm-cov", arch)
        verify_binaries(manifest, args.root, arch)
        if args.manifest:
            (args.root / "tool-notices/manifest.json").write_bytes(args.manifest.read_bytes())
        (args.root / "tool-notices/retained-notices.json").write_text(json.dumps(retained_notices(args.root), indent=2) + "\n")
    else:
        verify_binaries(manifest, args.root, arch)
        verify_archives(manifest, args.root)
        expected = json.loads((args.root / "tool-notices/retained-notices.json").read_text())
        require(expected == retained_notices(args.root), "Distribution notice inventory/hash mismatch")
    print(f"{len(manifest['artifacts'])} tool archives and retained distribution notices verified.")


if __name__ == "__main__":
    main()

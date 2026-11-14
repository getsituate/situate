"""Build pinned Swift source tools and retain their sources, runtime closure and notices."""

import argparse
import hashlib
import json
import os
import pathlib
import platform
import re
import shutil
import subprocess
import tarfile
import urllib.request

NOTICE = re.compile(r"(^|/)(licen[cs]e[^/]*|copying[^/]*|copyright[^/]*|notice[^/]*|authors[^/]*|legal)(/|$)", re.I)
BUILD_ARGS = ["build", "-c", "release", "--disable-automatic-resolution", "--skip-update", "--disable-experimental-prebuilts", "--jobs", "6"]


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def file_digest(path):
    with open(path, "rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def notice_inventory(path):
    records = []
    with tarfile.open(path, "r:gz") as archive:
        for member in archive:
            if member.isfile() and NOTICE.search(member.name) and member.size:
                records.append({"path": member.name, "sha256": digest(archive.extractfile(member).read())})
    return sorted(records, key=lambda record: record["path"])


def fetch(artifact, cache):
    require(re.fullmatch(r"https://codeload.github.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/tar.gz/[a-f0-9]{40}", artifact["url"]), "Unpinned Swift source URL")
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (artifact["sha256"] + ".tar.gz")
    if not path.exists():
        temporary = path.with_suffix(".download")
        with urllib.request.urlopen(artifact["url"], timeout=180) as response, temporary.open("wb") as output:
            shutil.copyfileobj(response, output)
        require(file_digest(temporary) == artifact["sha256"], "Swift source archive checksum mismatch")
        temporary.replace(path)
    require(file_digest(path) == artifact["sha256"], "Cached Swift source archive checksum mismatch")
    return path


def lock_revisions(lock):
    require(lock["version"] in {2, 3}, "Unsupported SwiftPM lock")
    pins = {}
    for pin in lock["pins"]:
        require(pin["kind"] == "remoteSourceControl" and re.fullmatch(r"[a-f0-9]{40}", pin["state"]["revision"]), "Unpinned SwiftPM dependency")
        require(pin["identity"] not in pins, "Duplicate SwiftPM dependency")
        pins[pin["identity"]] = (pin["location"].removesuffix(".git").lower(), pin["state"]["revision"])
    return pins


def check_inputs(manifest, inputs, quality=None):
    require(manifest["schemaVersion"] == 1, "Unsupported Swift tool inventory")
    if quality is None:
        quality = json.loads((inputs / "toolchain.quality.json").read_text())
    require(set(manifest["tools"]) == {"swift-format", "swiftlint"}, "Incomplete Swift source tools")
    referenced = set(manifest["compiler"]["sources"])
    for name, tool in manifest["tools"].items():
        require(tool["version"] == quality[name]["version"], "Swift quality pin differs from source tool inventory")
        if "revision" in quality[name]:
            require(manifest["artifacts"][tool["source"]]["revision"] == quality[name]["revision"], "Swift quality source revision differs")
        lock = inputs / tool["lock"]
        require(file_digest(lock) == tool["lockSha256"], "SwiftPM lock checksum mismatch")
        require(set(lock_revisions(json.loads(lock.read_text()))) == set(tool["dependencies"]), "SwiftPM source inventory is incomplete")
        for identity, (url, revision) in lock_revisions(json.loads(lock.read_text())).items():
            artifact = manifest["artifacts"][tool["dependencies"][identity]]
            require(artifact["repository"].lower() == url and artifact["revision"] == revision, "SwiftPM source revision differs")
        referenced.update([tool["source"], *tool["dependencies"].values()])
    require(referenced == set(manifest["artifacts"]), "Unreferenced or missing Swift source inventory")
    for artifact in manifest["artifacts"].values():
        require(re.fullmatch(r"[a-f0-9]{64}", artifact["sha256"]) and artifact["notices"], "Missing Swift source integrity or notices")
        require(artifact["url"] == artifact["repository"].replace("https://github.com/", "https://codeload.github.com/") + "/tar.gz/" + artifact["revision"], "Swift source URL differs from repository revision")


def extract_tree(archive_path, destination):
    root = destination.resolve()
    seen = set()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            path = pathlib.PurePosixPath(member.name)
            require(not path.is_absolute() and ".." not in path.parts and member.name not in seen, "Unsafe or duplicate Swift archive path")
            seen.add(member.name)
            target = destination / path
            require(target.resolve().is_relative_to(root), "Swift archive path escapes its directory")
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.issym():
                require(not pathlib.PurePosixPath(member.linkname).is_absolute() and (target.parent / member.linkname).resolve().is_relative_to(root), "Swift archive link escapes its directory")
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to(member.linkname)
            else:
                require(member.isfile() and not target.is_symlink(), "Unsupported Swift archive entry")
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("xb") as output:
                    shutil.copyfileobj(archive.extractfile(member), output)
                target.chmod(0o755 if member.mode & 0o111 else 0o644)


def tree_matches(archive_path, directory, extra=None):
    expected = set()
    with tarfile.open(archive_path, "r:gz") as archive:
        for member in archive:
            relative = pathlib.PurePosixPath(member.name)
            require(".." not in relative.parts and not relative.is_absolute(), "Unsafe Swift source archive path")
            path = pathlib.Path(*relative.parts[1:])
            if not str(path) or str(path) == "." or member.isdir():
                continue
            expected.add(str(path))
            actual = directory / path
            if extra and str(path) == "Package.resolved":
                require(file_digest(actual) == extra, "SwiftPM build lock changed")
                continue
            if member.issym():
                require(actual.is_symlink() and os.readlink(actual) == member.linkname, "Swift source link changed")
            else:
                require(member.isfile() and actual.is_file() and not actual.is_symlink(), "Unexpected Swift source entry")
                require(file_digest(actual) == digest(archive.extractfile(member).read()), "Swift source tree differs from retained archive")
    actual = {str(path.relative_to(directory)) for path in directory.rglob("*") if (path.is_file() or path.is_symlink()) and path.relative_to(directory).parts[0] not in {".git", ".build"}}
    require(actual == expected | ({"Package.resolved"} if extra else set()), "Swift source tree contains unreviewed files")
    if (directory / ".git").exists():
        tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=directory).decode().split("\0")[:-1]
        require(set(tracked) == expected, "Swift checkout contains unreviewed tracked files")
    if extra:
        require(file_digest(directory / "Package.resolved") == extra, "SwiftPM build lock changed")


def runtime_closure(binaries, inspect=None):
    inspect = inspect or (lambda path: subprocess.check_output(["ldd", str(path)], text=True, stderr=subprocess.STDOUT))
    runtime = {pathlib.Path("/usr/lib/libsourcekitdInProc.so")}
    for binary in [*binaries, "/usr/lib/libsourcekitdInProc.so"]:
        output = inspect(binary)
        require("not found" not in output, "Swift runtime has unresolved libraries")
        for name in re.findall(r"=>\s+(/\S+)", output):
            path = pathlib.Path(os.path.normpath(name))
            if path.is_relative_to("/usr/lib/swift") or path == pathlib.Path("/usr/lib/libsourcekitdInProc.so"):
                runtime.add(path)
            else:
                require(str(path).startswith(("/lib/", "/usr/lib/")), "Unexpected Swift runtime dependency")
    return sorted(runtime)


def retain_sources(manifest, output, cache):
    destination = output / "swift-sources"
    destination.mkdir(parents=True)
    for artifact in manifest["artifacts"].values():
        path = fetch(artifact, cache)
        require(notice_inventory(path) == artifact["notices"], "Swift source notice inventory changed")
        shutil.copyfile(path, destination / path.name)
        with tarfile.open(path, "r:gz") as archive:
            for notice in artifact["notices"]:
                text = destination / "notices" / notice["sha256"]
                text.parent.mkdir(exist_ok=True)
                text.write_bytes(archive.extractfile(notice["path"]).read())


def build(manifest, manifest_path, inputs, output, cache):
    require(platform.machine() in {"aarch64", "x86_64"}, "Unsupported Swift build architecture")
    compiler = subprocess.check_output(["swift", "--version"], text=True).strip()
    require(compiler.splitlines()[0] == f"Swift version {manifest['compiler']['version']} (swift-{manifest['compiler']['version']}-RELEASE)", "Swift compiler differs from pinned image")
    retain_sources(manifest, output, cache)
    build_root = pathlib.Path("/tmp/ci-swift-build")
    build_root.mkdir()
    binaries = []
    for name, tool in manifest["tools"].items():
        source_archive = fetch(manifest["artifacts"][tool["source"]], cache)
        work = build_root / name
        work.mkdir()
        extract_tree(source_archive, work)
        directory = next(work.iterdir())
        lock = inputs / tool["lock"]
        shutil.copyfile(lock, directory / "Package.resolved")
        subprocess.run(["swift", "package", "resolve", "--only-use-versions-from-resolved-file", "--disable-experimental-prebuilts"], cwd=directory, check=True)
        def verify_tree():
            tree_matches(source_archive, directory, tool["lockSha256"])
            require(file_digest(directory / "Package.resolved") == tool["lockSha256"], "Swift build changed the locked input")
            for identity, source in tool["dependencies"].items():
                checkouts = [path for path in (directory / ".build/checkouts").iterdir() if path.name.lower() == identity]
                require(len(checkouts) == 1, "Missing or ambiguous Swift dependency checkout")
                tree_matches(fetch(manifest["artifacts"][source], cache), checkouts[0])
        verify_tree()
        subprocess.run(["swift", *BUILD_ARGS, "--product", name], cwd=directory, check=True)
        verify_tree()
        binary = directory / ".build/release" / name
        destination = output / name / name
        destination.parent.mkdir()
        shutil.copy2(binary, destination)
        binaries.append(binary)
    runtime = output / "swift-runtime"
    for path in runtime_closure(binaries):
        destination = runtime / path.relative_to("/")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination, follow_symlinks=True)
    license_path = pathlib.Path("/usr/share/swift/LICENSE.txt")
    require(file_digest(license_path) == manifest["compiler"]["licenseSha256"], "Swift distribution license checksum mismatch")
    shutil.copyfile(license_path, runtime / "LICENSE.txt")
    shutil.copyfile(manifest_path, output / "ci-swift-tools.json")
    for name, tool in manifest["tools"].items():
        shutil.copyfile(inputs / tool["lock"], output / tool["lock"])
    shutil.copyfile(inputs / "toolchain.quality.json", output / "swift-toolchain.quality.json")
    files = {str(path.relative_to(output)): file_digest(path) for path in sorted(output.rglob("*")) if path.is_file()}
    receipt = {"schemaVersion": 1, "method": "swift-build-locked", "manifestSha256": file_digest(manifest_path), "builderSha256": file_digest(__file__), "compilerImage": manifest["compiler"]["image"], "compiler": compiler, "architecture": platform.machine(), "arguments": BUILD_ARGS, "files": files}
    (output / "swift-source-build.json").write_text(json.dumps(receipt, indent=2) + "\n")


def verify(manifest, manifest_path, root):
    check_inputs(manifest, root)
    receipt = json.loads((root / "swift-source-build.json").read_text())
    require(receipt["schemaVersion"] == 1 and receipt["method"] == "swift-build-locked" and receipt["arguments"] == BUILD_ARGS, "Invalid Swift source build method")
    require(receipt["manifestSha256"] == file_digest(manifest_path) and receipt["builderSha256"] == file_digest(__file__) and receipt["compilerImage"] == manifest["compiler"]["image"] and receipt["architecture"] == platform.machine(), "Swift source build identity differs")
    require(receipt["compiler"].splitlines()[0] == f"Swift version {manifest['compiler']['version']} (swift-{manifest['compiler']['version']}-RELEASE)", "Swift source build compiler differs")
    for name, checksum in receipt["files"].items():
        path = pathlib.PurePosixPath(name)
        require(not path.is_absolute() and ".." not in path.parts and re.fullmatch(r"[a-f0-9]{64}", checksum), "Invalid Swift output inventory")
        target = root / path
        require(target.is_file() and not target.is_symlink() and target.resolve().is_relative_to(root.resolve()), "Swift installed file is not a regular owned-tree file")
        require(file_digest(target) == checksum, "Swift installed binary, runtime, source or notice changed")
    runtime = root / "swift-runtime"
    expected = {name for name in receipt["files"] if name.startswith("swift-runtime/")}
    actual = {str(path.relative_to(root)) for path in runtime.rglob("*") if path.is_file()}
    require(expected == actual and "swift-runtime/usr/lib/libsourcekitdInProc.so" in actual, "Swift runtime closure inventory differs")
    for tool in ["swift-format", "swiftlint"]:
        require(f"{tool}/{tool}" in receipt["files"], "Missing compiled Swift tool integrity")
    for artifact in manifest["artifacts"].values():
        archive = root / "swift-sources" / (artifact["sha256"] + ".tar.gz")
        require(file_digest(archive) == artifact["sha256"] and notice_inventory(archive) == artifact["notices"], "Retained Swift sources or notices differ")
        for notice in artifact["notices"]:
            require(file_digest(root / "swift-sources/notices" / notice["sha256"]) == notice["sha256"], "Retained Swift notice text differs")
    require(file_digest(runtime / "LICENSE.txt") == manifest["compiler"]["licenseSha256"], "Retained Swift distribution license differs")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["build", "verify"])
    parser.add_argument("--input", type=pathlib.Path, default=pathlib.Path("/swift-input"))
    parser.add_argument("--output", type=pathlib.Path, default=pathlib.Path("/export/opt/ci-tools"))
    parser.add_argument("--cache", type=pathlib.Path, default=pathlib.Path("/var/cache/ci-swift-sources"))
    args = parser.parse_args()
    manifest_path = args.input / "ci-swift-tools.json"
    manifest = json.loads(manifest_path.read_text())
    check_inputs(manifest, args.input)
    if args.operation == "build":
        args.output.mkdir(parents=True)
        build(manifest, manifest_path, args.input, args.output, args.cache)
    else:
        verify(manifest, manifest_path, args.input)


if __name__ == "__main__":
    main()

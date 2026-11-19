#!/usr/bin/env python3
"""Install the pinned Volta bootstrap before invoking Node.js."""

import hashlib
import io
import json
import os
import pathlib
import platform
import stat
import subprocess
import tarfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
MACOS = {
    "url": "https://github.com/volta-cli/volta/releases/download/v2.0.2/volta-2.0.2-macos.tar.gz",
    "sha256": "57f7b51d6fb975f5c48b5ddf68f75103055e19fd822e3e2ce58d2be6ab78977d",
}

WINDOWS_X64 = {
    "version": "2.0.2",
    "url": "https://github.com/volta-cli/volta/releases/download/v2.0.2/volta-2.0.2-windows.zip",
    "sha256": "d7678a485e2fc9b1a3f7e9da256d8b88a97d7e4c45e63701c4874f6c2a587e0f",
}


def download(url):
    if not url.startswith("https://"):
        raise ValueError("Bootstrap downloads require HTTPS")
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read(64 * 1024 * 1024 + 1)


def bootstrap_windows(root, home, fetch, execute):
    if home is None:
        home = os.environ.get("VOLTA_HOME")
        if not home:
            home = pathlib.Path(os.environ["RUNNER_TEMP"]) / "situate-volta"
    home = pathlib.Path(home)
    binary_directory = home / "bin"
    asset = WINDOWS_X64
    limit = 64 * 1024 * 1024
    archive = fetch(asset["url"])
    if len(archive) > limit or hashlib.sha256(archive).hexdigest() != asset["sha256"]:
        raise ValueError("Volta archive digest mismatch")
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        expected = {"volta.exe", "volta-shim.exe", "volta-migrate.exe"}
        entries = source.infolist()
        if (
            len(entries) != len(expected)
            or {entry.filename for entry in entries} != expected
            or sum(entry.file_size for entry in entries) > limit
            or any(entry.is_dir() or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) for entry in entries)
        ):
            raise ValueError("Unexpected Volta archive contents")
        files = {entry.filename: source.read(entry) for entry in entries}
    binary_directory.mkdir(parents=True)
    for name, data in files.items():
        (binary_directory / name).write_bytes(data)
    # These are Volta's Windows cmd shims without its user-PATH mutation.
    for name in ("node", "npm"):
        (binary_directory / f"{name}.cmd").write_bytes(b"@echo off\r\nvolta run %~n0 %*\r\n")
    versions = json.loads((root / "package.json").read_text())["volta"]
    environment = {**os.environ, "VOLTA_HOME": str(home), "PATH": str(binary_directory) + os.pathsep + os.environ.get("PATH", "")}
    volta = str(binary_directory / "volta.exe")
    options = {"cwd": root, "env": environment, "check": True}
    version = execute([volta, "--version"], capture_output=True, text=True, **options)
    if version.stdout.strip() != asset["version"]:
        raise ValueError("Pinned Volta installation failed")
    execute([volta, "install", "node@" + versions["node"], "npm@" + versions["npm"]], **options)
    for name in ("node", "npm"):
        result = execute(["cmd.exe", "/d", "/c", name, "--version"], capture_output=True, text=True, **options)
        if result.stdout.strip().removeprefix("v") != versions[name]:
            raise ValueError("Pinned " + name + " installation failed")
    for key, value in (("GITHUB_PATH", binary_directory), ("GITHUB_ENV", "VOLTA_HOME=" + str(home))):
        if os.environ.get(key):
            with open(os.environ[key], "a", encoding="utf-8") as output:
                output.write(f"{value}\n")


def bootstrap(root=ROOT, home=None, system=None, machine=None, fetch=download, execute=subprocess.run):
    root = pathlib.Path(root)
    system = system or platform.system()
    machine = machine or platform.machine()
    if system == "Windows" and machine.lower() == "amd64":
        return bootstrap_windows(root, home, fetch, execute)
    home = pathlib.Path(home or os.environ.get("VOLTA_HOME", pathlib.Path.home() / ".volta"))
    pins = json.loads((root / "client/docker/ci-volta.json").read_text())
    if system == "Darwin":
        asset = MACOS
    elif system == "Linux" and machine in ("x86_64", "aarch64", "arm64"):
        asset = pins["x64" if machine == "x86_64" else "arm64"]
    else:
        raise ValueError("Unsupported bootstrap host")
    binary = home / "bin/volta"
    current = execute([str(binary), "--version"], capture_output=True, text=True, check=False) if binary.is_file() else None
    if current is None or current.returncode != 0 or current.stdout.strip() != pins["version"]:
        archive = fetch(asset["url"])
        if len(archive) > 64 * 1024 * 1024 or hashlib.sha256(archive).hexdigest() != asset["sha256"]:
            raise ValueError("Volta archive digest mismatch")
        with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as source:
            members = source.getmembers()
            expected = {"volta", "volta-shim", "volta-migrate"}
            if {member.name for member in members} != expected or any(not member.isfile() for member in members):
                raise ValueError("Unexpected Volta archive contents")
            (home / "bin").mkdir(parents=True, exist_ok=True)
            for member in members:
                destination = home / "bin" / member.name
                if destination.is_symlink():
                    raise ValueError("Refusing linked bootstrap binary")
                destination.write_bytes(source.extractfile(member).read())
                destination.chmod(0o755)
    versions = json.loads((root / "package.json").read_text())["volta"]
    environment = {**os.environ, "VOLTA_HOME": str(home), "PATH": str(home / "bin") + os.pathsep + os.environ.get("PATH", "")}
    installed = execute([str(binary), "--version"], cwd=root, env=environment, capture_output=True, text=True, check=True)
    if installed.stdout.strip() != pins["version"]:
        raise ValueError("Pinned Volta installation failed")
    execute([str(binary), "install", "node@" + versions["node"], "npm@" + versions["npm"]], cwd=root, env=environment, check=True)
    for name, arguments in (("node", ["--version"]), ("npm", ["--version"])):
        result = execute([str(home / "bin" / name), *arguments], cwd=root, env=environment, capture_output=True, text=True, check=True)
        if result.stdout.strip().removeprefix("v") != versions[name]:
            raise ValueError("Pinned " + name + " installation failed")
    if os.environ.get("GITHUB_PATH"):
        with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as output:
            output.write(str(home / "bin") + "\n")
    if os.environ.get("GITHUB_ENV"):
        with open(os.environ["GITHUB_ENV"], "a", encoding="utf-8") as output:
            output.write("VOLTA_HOME=" + str(home) + "\n")


if __name__ == "__main__":
    bootstrap()

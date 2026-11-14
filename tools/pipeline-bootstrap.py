#!/usr/bin/env python3
"""Install the pinned Volta bootstrap before invoking Node.js."""

import hashlib
import io
import json
import os
import pathlib
import platform
import subprocess
import tarfile
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
MACOS = {
    "url": "https://github.com/volta-cli/volta/releases/download/v2.0.2/volta-2.0.2-macos.tar.gz",
    "sha256": "57f7b51d6fb975f5c48b5ddf68f75103055e19fd822e3e2ce58d2be6ab78977d",
}


def download(url):
    if not url.startswith("https://"):
        raise ValueError("Bootstrap downloads require HTTPS")
    with urllib.request.urlopen(url, timeout=120) as response:
        return response.read(64 * 1024 * 1024 + 1)


def bootstrap(root=ROOT, home=None, system=None, machine=None, fetch=download, execute=subprocess.run):
    root = pathlib.Path(root)
    home = pathlib.Path(home or os.environ.get("VOLTA_HOME", pathlib.Path.home() / ".volta"))
    system = system or platform.system()
    machine = machine or platform.machine()
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

#!/usr/bin/env python3
import argparse
import os
import shutil
import subprocess
import tempfile
from html import escape
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import quote, unquote, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "docs/architecture"
RENDERER_VERSION = "2.0.26"


class ArchitecturePage(HTMLParser):
    def __init__(self, html, revision):
        super().__init__(convert_charrefs=False)
        self.html = html
        self.revision = revision
        self.anchors = set()
        self.fragments = set()
        self.images = set()
        self.edits = []
        self.line_offsets = [0]
        self.line_offsets.extend(i + 1 for i, char in enumerate(html) if char == "\n")

    def handle_starttag(self, tag, attrs):
        updated = []
        for key, value in attrs:
            if key == "id" or (tag == "a" and key == "name"):
                self.anchors.add(value)
            if tag == "a" and key == "href":
                value = self.link(value)
            if tag == "img" and key == "src":
                value = self.image(value)
            updated.append((key, value))
        if updated != attrs:
            line, column = self.getpos()
            start = self.line_offsets[line - 1] + column
            end = start + len(self.get_starttag_text())
            attributes = "".join(
                f' {key}="{escape(value, quote=True)}"' if value is not None else f" {key}"
                for key, value in updated
            )
            self.edits.append((start, end, f"<{tag}{attributes}>"))

    def link(self, value):
        url = urlsplit(value)
        if url.scheme or url.netloc:
            return value
        if not url.path:
            if url.fragment:
                self.fragments.add(unquote(url.fragment))
            return value
        target = (SOURCE / unquote(url.path)).resolve()
        if target == SOURCE / "index.adoc":
            if url.fragment:
                self.fragments.add(unquote(url.fragment))
                return f"#{url.fragment}"
            return "index.html"
        if not target.is_relative_to(ROOT) or not target.exists():
            raise ValueError(f"Missing repository link target: {value}")
        kind = "tree" if target.is_dir() else "blob"
        path = quote(target.relative_to(ROOT).as_posix())
        repo_path = f"/getsituate/situate/{kind}/{self.revision}/{path}"
        return urlunsplit(("https", "github.com", repo_path, url.query, url.fragment))

    def image(self, value):
        url = urlsplit(value)
        path = PurePosixPath(unquote(url.path))
        source = SOURCE / path
        if (
            url.scheme
            or url.netloc
            or path.parts[:1] != ("diagrams",)
            or len(path.parts) != 2
            or path.suffix != ".svg"
            or not source.is_file()
            or source.resolve() != source
        ):
            raise ValueError(f"Expected an architecture SVG: {value}")
        self.images.add(path)
        return quote(path.as_posix())

    def render(self):
        self.feed(self.html)
        self.close()
        missing = self.fragments - self.anchors
        if missing:
            raise ValueError(f"Missing architecture anchors: {', '.join(sorted(missing))}")
        parts = []
        offset = 0
        for start, end, replacement in self.edits:
            parts.extend((self.html[offset:start], replacement))
            offset = end
        parts.append(self.html[offset:])
        return "".join(parts)


def build(output):
    if output.exists() or output.is_symlink():
        raise ValueError(f"Output already exists: {output}")
    renderer = os.environ.get("ASCIIDOCTOR", "asciidoctor")
    version = subprocess.check_output([renderer, "--version"], text=True)
    if version.split()[:2] != ["Asciidoctor", RENDERER_VERSION]:
        raise ValueError(f"Asciidoctor {RENDERER_VERSION} is required")
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=ROOT, text=True
    ).strip()
    html = subprocess.check_output(
        [
            renderer, "--failure-level", "WARN", "--safe-mode", "safe",
            "-o", "-", str(SOURCE / "index.adoc"),
        ],
        cwd=ROOT,
        encoding="utf-8",
    )
    page = ArchitecturePage(html, revision)
    rendered = page.render()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=output.parent) as temporary:
        site = Path(temporary) / "site"
        (site / "diagrams").mkdir(parents=True)
        (site / "index.html").write_text(rendered, encoding="utf-8")
        for image in sorted(page.images):
            shutil.copyfile(SOURCE / image, site / image)
        site.rename(output)


def main():
    parser = argparse.ArgumentParser(description="Build the static Situate architecture site.")
    parser.add_argument("output", type=Path, help="New directory for the generated site")
    args = parser.parse_args()
    try:
        build(args.output.absolute())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"{error}\n")


if __name__ == "__main__":
    main()

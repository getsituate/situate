import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const runtimeLicenses = [
  "Apache-2.0.txt",
  "MIT.txt",
  "Unicode-3.0.txt",
  "BSD-2-Clause.txt",
  "LLVM-exception.txt",
];

export async function collectRustRuntimeLicenses({
  root,
  targets,
  output,
  execute,
  options,
  request = fetch,
}) {
  const compiler = (
    await execute("rustup", ["which", "rustc"], { ...options, capture: true })
  ).trim();
  if (!isAbsolute(compiler))
    throw new Error(
      "Cannot bind Rust runtime notices to the selected compiler.",
    );
  const version = await execute(compiler, ["-vV"], {
    ...options,
    capture: true,
  });
  const release = version.match(/^release: (\S+)$/m)?.[1];
  const commit = version.match(/^commit-hash: ([a-f0-9]{40})$/m)?.[1];
  const pinned = readFileSync(join(root, "rust-toolchain.toml"), "utf8").match(
    /^channel\s*=\s*"([^"]+)"/m,
  )?.[1];
  if (!commit || release !== pinned)
    throw new Error(
      "Rust runtime notices require the repository-pinned compiler release and commit.",
    );
  const sysroot = (
    await execute(compiler, ["--print", "sysroot"], {
      ...options,
      capture: true,
    })
  ).trim();
  if (!isAbsolute(sysroot))
    throw new Error("Cannot locate the selected Rust sysroot.");
  const components = [];
  for (const target of targets) {
    if (!/^(?:aarch64|x86_64)-apple-(?:darwin|ios)$/.test(target))
      throw new Error("Unsupported Rust runtime notice target.");
    const directory = join(sysroot, "lib/rustlib", target, "lib");
    if (!existsSync(directory))
      throw new Error(`Missing selected target Rust runtime: ${target}`);
    const files = readdirSync(directory);
    for (const component of [
      "std",
      "core",
      "alloc",
      "compiler_builtins",
      "rustc_demangle",
    ]) {
      const names = files.filter(
        (name) => name.startsWith(`lib${component}-`) && name.endsWith(".rlib"),
      );
      if (names.length !== 1)
        throw new Error(
          `Missing selected target Rust runtime: ${target}/${component}`,
        );
      components.push(
        `${target}/${names[0]}\nSHA-256: ${hash(readFileSync(join(directory, names[0])))}`,
      );
    }
  }
  const copyright = join(sysroot, "share/doc/rust/COPYRIGHT-library.html");
  if (!existsSync(copyright))
    throw new Error(
      "Missing selected Rust library copyright inventory. Install rust-docs for the pinned toolchain.",
    );
  const inventory = JSON.parse(
    await execute(
      "python3",
      [
        "-I",
        "-S",
        "-c",
        `import json, sys
from html.parser import HTMLParser
class NoticeText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
    def handle_starttag(self, tag, attrs):
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'pre', 'br'):
            self.parts.append('\\n')
    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'h1', 'h2', 'h3', 'li', 'pre'):
            self.parts.append('\\n')
    def handle_data(self, data):
        self.parts.append(data)
parser = NoticeText()
with open(sys.argv[1], encoding='utf-8') as source:
    parser.feed(source.read())
print(json.dumps(''.join(parser.parts)))`,
        copyright,
      ],
      { ...options, capture: true },
    ),
  );
  if (
    typeof inventory !== "string" ||
    !inventory.includes("Rust Standard Library")
  )
    throw new Error(
      "Missing selected Rust library copyright inventory. Install rust-docs for the pinned toolchain.",
    );
  const texts = [
    `Rust standard library and runtime ${release}\nCompiler commit: ${commit}\nhttps://github.com/rust-lang/rust/tree/${commit}/library\nCopyright inventory: https://doc.rust-lang.org/${release}/COPYRIGHT-library.html\nCopyright inventory SHA-256: ${hash(readFileSync(copyright))}\n\n${components.join("\n\n")}\n\n${inventory}`,
  ];
  for (const name of runtimeLicenses) {
    const text = readFileSync(
      join(sysroot, "share/doc/rust/licenses", name),
      "utf8",
    );
    if (!text.trim())
      throw new Error(`Missing Rust runtime license text: ${name}`);
    texts.push(`--- ${name} ---\n${text}`);
  }
  for (const path of [
    "library/compiler-builtins/LICENSE.txt",
    "library/compiler-builtins/libm/LICENSE.txt",
  ]) {
    const url = `https://raw.githubusercontent.com/rust-lang/rust/${commit}/${path}`;
    const response = await request(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
      throw new Error(`Missing exact Rust runtime notice: ${path}`);
    const text = await response.text();
    if (!text.trim() || text.includes("\0"))
      throw new Error(`Invalid Rust runtime notice: ${path}`);
    texts.push(`--- ${path} ---\n${url}\n${text}`);
  }
  writeFileSync(join(output, "rust-runtime-notices.txt"), texts.join("\n\n"));
}

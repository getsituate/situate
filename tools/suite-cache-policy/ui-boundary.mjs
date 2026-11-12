import { existsSync, realpathSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

function canonical(path) {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  return parent === absolute
    ? absolute
    : join(canonical(parent), basename(absolute));
}
function within(path, root) {
  const child = relative(root, path);
  return (
    child === "" ||
    (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`))
  );
}

export function assertUiModule(id, roots) {
  if (id.startsWith("\0")) return;
  const path = id.startsWith("file:")
    ? fileURLToPath(new URL(id))
    : id.split("?")[0];
  if (!isAbsolute(path)) return;
  const target = canonical(path);
  if (!roots.some((root) => within(target, canonical(root)))) {
    throw new Error(`UI import crosses the application boundary: ${path}`);
  }
}

export function uiBoundary(roots) {
  let projectRoot = process.cwd();
  return {
    name: "situate-ui-boundary",
    enforce: "pre",
    configResolved(config) {
      projectRoot = config.root;
    },
    config() {
      return {
        css: {
          postcss: {
            plugins: [
              {
                postcssPlugin: "situate-css-boundary",
                OnceExit(root, { result }) {
                  root.walk((node) => {
                    if (node.source?.input.file)
                      assertUiModule(node.source.input.file, roots);
                  });
                  for (const message of result.messages) {
                    if (message.type === "dependency")
                      assertUiModule(message.file, roots);
                  }
                },
                Declaration(node) {
                  for (const match of node.value.matchAll(
                    /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi,
                  )) {
                    const url = match[1];
                    if (/^(?:[a-z]+:|\/\/|#)/i.test(url)) continue;
                    const file = url.startsWith("/")
                      ? resolve(projectRoot, "." + url)
                      : resolve(dirname(node.source.input.file), url);
                    assertUiModule(file, roots);
                  }
                },
              },
            ],
          },
        },
      };
    },
    load(id) {
      assertUiModule(id, roots);
    },
    // Vite also emits static assets discovered in CSS without loading them as modules.
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type === "asset") {
          for (const name of output.originalFileNames)
            assertUiModule(resolve(projectRoot, name), roots);
        }
      }
    },
  };
}

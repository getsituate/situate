import { createServer } from "node:http";
import { constants } from "node:fs";
import {
  open,
  readFile,
  lstat,
  readdir,
  mkdir,
  writeFile,
  copyFile,
  realpath,
  mkdtemp,
  rename,
  rm,
} from "node:fs/promises";
import {
  resolve,
  basename,
  dirname,
  extname,
  relative,
  sep,
  isAbsolute,
} from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import {
  escapeHtml,
  translator,
  renderHeader,
  renderFooter,
  renderViewer,
  repositoryUrl,
  legalLinks,
} from "./components.mjs";
import { renderLegalPage } from "./legal/render.mjs";
export { escapeHtml };

export const landingContentSecurityPolicy =
  "default-src 'self'; script-src 'self' https://eocampaign1.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://gallery.eo.page; font-src 'self' https://fonts.gstatic.com https://gallery.eo.page; connect-src 'self' https://eocampaign1.com https://www.google.com/recaptcha/ https://eu.i.posthog.com; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

export function analyticsConfiguration(
  token = process.env.SITUATE_POSTHOG_TOKEN ?? "",
) {
  if (token && !/^phc_[A-Za-z0-9]{20,200}$/.test(token))
    throw new Error(
      "SITUATE_POSTHOG_TOKEN must be a public PostHog project token.",
    );
  return `window.situateAnalyticsConfig = Object.freeze(${JSON.stringify({ token })});\n`;
}

const website = dirname(fileURLToPath(import.meta.url));
const repository = resolve(website, "..");
export async function websiteAnalyticsToken({
  environment = process.env,
  directory = repository,
} = {}) {
  const key = "SITUATE_POSTHOG_TOKEN";
  if (Object.hasOwn(environment, key)) return environment[key];
  if (environment.CI) return "";
  try {
    const path = resolve(directory, ".env");
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 65536 || stat.mode & 0o077)
      throw new Error(
        "The root .env must be a regular, owner-only file (chmod 600 .env).",
      );
    return parseEnv(await readFile(path, "utf8"))[key] ?? "";
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
};

export function render(template, messages, { pathname = "/" } = {}) {
  const text = translator(messages);
  return template.replace(/\{\{([\w.-]+)\}\}/g, (_, key) => {
    if (key === "site.header")
      return renderHeader(messages, {
        home: pathname === "/",
        progress: true,
        pathname,
      });
    if (key === "site.footer") return renderFooter(messages, { pathname });
    if (key === "site.repositoryUrl") return escapeHtml(repositoryUrl);
    if (key === "site.viewer") return renderViewer(messages);
    return text(key);
  });
}

const defaultLegalDirectory = resolve(website, "legal");

export async function legalContent(directory = defaultLegalDirectory) {
  directory = resolve(directory);
  const root = directory === defaultLegalDirectory ? website : directory;
  const [pages, legal, shared] = await Promise.all([
    readPublicFile(directory, "pages.json", root),
    readPublicFile(directory, "messages.en.json", root),
    readPublicFile(website, "messages.en.json"),
  ]);
  if (!pages || !legal || !shared)
    throw Object.assign(
      new Error("Legal catalogs must stay within their content directories."),
      { code: "ENOENT" },
    );
  return {
    pages: JSON.parse(pages),
    messages: { ...JSON.parse(shared), ...JSON.parse(legal) },
  };
}

async function html(path) {
  const [template, catalog] = await Promise.all([
    readFile(path, "utf8"),
    readFile(resolve(dirname(path), "messages.en.json"), "utf8"),
  ]);
  const pathname =
    path === resolve(website, "index.html")
      ? "/"
      : `/${relative(website, path)}`;
  return render(template, JSON.parse(catalog), { pathname });
}

const contains = (parent, child) => {
  const path = relative(parent, child);
  return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
};

const publicSegment = (part) => /^[a-z\d_-][a-z\d_.-]*$/i.test(part);

function location(pathname, parts) {
  if (pathname === "/")
    return { file: "index.html", base: website, page: true };
  if (pathname === "/product.html")
    return { file: "product.html", base: website, page: true };
  if (
    ["/system", "/system/", "/system/index.html", "/index.html"].includes(
      pathname,
    )
  )
    return { redirect: "/" };
  if (
    [
      "/styles.css",
      "/product.css",
      "/script.js",
      "/platform-waitlist.js",
      "/download.js",
      "/components.css",
      "/navigation.js",
      "/analytics.js",
      "/vendor/posthog-1.447.4.min.js",
      "/vendor/posthog-LICENSE.txt",
      "/legal/styles.css",
    ].includes(pathname)
  )
    return { file: parts.join("/"), base: website };
  if (
    pathname === "/media/provider-icons-license.txt" ||
    (parts[0] === "media" &&
      [".svg", ".png", ".jpg", ".webp"].includes(extname(pathname)))
  )
    return {
      file: parts.slice(1).join("/"),
      base: resolve(website, "media"),
      root: website,
    };
  if (
    pathname === "/design/brand/tokens.css" ||
    /^\/design\/brand\/(assets|bend)\/[\w/-]+\.(svg|js)$/.test(pathname)
  ) {
    return {
      file: parts.slice(2).join("/"),
      base: resolve(repository, "design/brand"),
      root: repository,
    };
  }
  return null;
}

async function readPublicFile(base, file, root = base) {
  const directory = await realpath(base);
  if (root !== base && !contains(await realpath(root), directory)) return null;
  const path = resolve(directory, file);
  if (!contains(directory, path)) return null;
  const actual = await realpath(path);
  if (
    !contains(directory, actual) ||
    !relative(directory, actual).split(sep).every(publicSegment) ||
    extname(actual) !== extname(file)
  )
    return null;
  let handle;
  try {
    handle = await open(
      actual,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const info = await handle.stat();
    if (!info.isFile() || info.nlink !== 1) return null;
    return await handle.readFile();
  } catch (error) {
    if (error.code === "ELOOP") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

export function createPreviewServer({
  legalDirectory = defaultLegalDirectory,
} = {}) {
  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      if (pathname === "/analytics-config.js") {
        response.writeHead(200, {
          "Content-Type": mime[".js"],
          "Cache-Control": "no-store",
        });
        response.end(
          request.method === "HEAD" ? undefined : analyticsConfiguration(""),
        );
        return;
      }
      if (legalLinks.some(({ href }) => href === pathname)) {
        const { pages, messages } = await legalContent(legalDirectory);
        const page = pages.find((entry) => entry.path === pathname);
        if (!page) {
          response.writeHead(404).end();
          return;
        }
        const content = renderLegalPage(page, messages);
        response.writeHead(200, {
          "Content-Type": mime[".html"],
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src https://eu.i.posthog.com; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        });
        response.end(request.method === "HEAD" ? undefined : content);
        return;
      }
      const parts = pathname.split("/").filter(Boolean);
      const target = parts.every(publicSegment)
        ? location(pathname, parts)
        : null;
      if (target?.redirect) {
        response.writeHead(308, { Location: target.redirect }).end();
        return;
      }
      if (!target) {
        response.writeHead(404).end();
        return;
      }
      const bytes = await readPublicFile(target.base, target.file, target.root);
      if (!bytes) {
        response.writeHead(404).end();
        return;
      }
      const extension = extname(target.file);
      let content = bytes;
      if (target.page) {
        const catalog = await readPublicFile(website, "messages.en.json");
        if (!catalog) {
          response.writeHead(404).end();
          return;
        }
        content = render(bytes.toString("utf8"), JSON.parse(catalog), {
          pathname,
        });
      }
      response.writeHead(200, {
        "Content-Type": mime[extension] || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": landingContentSecurityPolicy,
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response
        .writeHead(
          error.code === "ENOENT" || error.code === "EISDIR"
            ? 404
            : error instanceof URIError
              ? 400
              : 500,
        )
        .end();
    }
  });
}

export function createBuildServer(directory) {
  const root = resolve(directory);
  return createServer(async (request, response) => {
    if (!["GET", "HEAD"].includes(request.method)) {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://localhost").pathname,
      );
      const parts = pathname.split("/").filter(Boolean);
      const file = pathname === "/" ? "index.html" : parts.join("/");
      const extension = extname(file);
      if (
        !parts.every(publicSegment) ||
        (!mime[extension] &&
          ![
            "media/provider-icons-license.txt",
            "vendor/posthog-LICENSE.txt",
          ].includes(file))
      ) {
        response.writeHead(404).end();
        return;
      }
      const content = await readPublicFile(root, file);
      if (!content) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "Content-Type": mime[extension] || "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
        "Content-Security-Policy": landingContentSecurityPolicy,
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      response
        .writeHead(
          error.code === "ENOENT" || error.code === "EISDIR"
            ? 404
            : error instanceof URIError
              ? 400
              : 500,
        )
        .end();
    }
  });
}

async function canonicalDestination(path) {
  const entry = await lstat(path).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (entry) return realpath(path);
  return resolve(await canonicalDestination(dirname(path)), basename(path));
}

async function buildDestination(path) {
  const source = await realpath(repository);
  const defaultOutput = resolve(website, "dist");
  const canonicalDefault = resolve(await realpath(website), "dist");
  const requested = resolve(path);
  const output = await canonicalDestination(requested);
  if (
    (contains(repository, requested) && requested !== defaultOutput) ||
    contains(output, source) ||
    (contains(source, output) && output !== canonicalDefault) ||
    (requested === defaultOutput && output !== canonicalDefault)
  )
    throw new Error(
      "Build output must not contain or overwrite repository source files.",
    );
  return output;
}

async function installBuild(staging, destination) {
  const directories = [];
  const files = [];
  async function check(source, target) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      const from = resolve(source, entry.name);
      const to = resolve(target, entry.name);
      const existing = await lstat(to).catch((error) => {
        if (error.code !== "ENOENT") throw error;
      });
      if (entry.isDirectory()) {
        if (existing && !existing.isDirectory())
          throw new Error(`Build output requires a real directory: ${to}`);
        if (!existing) directories.push(to);
        await check(from, to);
      } else {
        if (existing && !existing.isFile())
          throw new Error(`Build output requires a regular file: ${to}`);
        files.push([from, to]);
      }
    }
  }
  await check(staging, destination);
  for (const directory of directories) await mkdir(directory);
  // Replace directory entries, not file contents that may be hard-linked elsewhere.
  for (const [from, to] of files) await rename(from, to);
  for (const legacy of ["system", "retrieve", "momentum", "hub.css"])
    await rm(resolve(destination, legacy), { recursive: true, force: true });
}

export async function build(
  destination = resolve(website, "dist"),
  { analyticsToken } = {},
) {
  const output = await buildDestination(destination);
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(resolve(output, ".situate-website-"));
  try {
    await renderBuild(staging, analyticsToken);
    await installBuild(staging, output);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return resolve(destination);
}

async function renderBuild(destination, analyticsToken) {
  const analytics = analyticsConfiguration(
    analyticsToken === undefined
      ? await websiteAnalyticsToken()
      : analyticsToken,
  );
  async function emit(source, target) {
    await mkdir(dirname(target), { recursive: true });
    if (extname(source) === ".html")
      await writeFile(target, await html(source));
    else await copyFile(source, target);
  }
  async function tree(source, target, extensions = Object.keys(mime)) {
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (entry.isDirectory())
        await tree(
          resolve(source, entry.name),
          resolve(target, entry.name),
          extensions,
        );
      else if (entry.isFile() && extensions.includes(extname(entry.name)))
        await emit(resolve(source, entry.name), resolve(target, entry.name));
    }
  }
  for (const file of [
    "index.html",
    "product.html",
    "styles.css",
    "product.css",
    "script.js",
    "platform-waitlist.js",
    "download.js",
    "components.css",
    "navigation.js",
    "analytics.js",
    "vendor/posthog-1.447.4.min.js",
    "vendor/posthog-LICENSE.txt",
    "legal/styles.css",
  ])
    await emit(resolve(website, file), resolve(destination, file));
  await writeFile(resolve(destination, "analytics-config.js"), analytics);
  const { pages, messages } = await legalContent();
  for (const { href: path } of legalLinks) {
    const page = pages.find((entry) => entry.path === path);
    if (!page) throw new Error(`Missing legal page: ${path}`);
    await writeFile(
      resolve(destination, path.slice(1)),
      renderLegalPage(page, messages),
    );
  }
  await tree(resolve(website, "media"), resolve(destination, "media"));
  await emit(
    resolve(website, "media/provider-icons-license.txt"),
    resolve(destination, "media/provider-icons-license.txt"),
  );
  for (const folder of ["assets", "bend/svg", "bend/mini"])
    await tree(
      resolve(repository, "design/brand", folder),
      resolve(destination, "design/brand", folder),
      [".svg"],
    );
  for (const file of ["bend.js", "motion.js", "performance.js"])
    await emit(
      resolve(repository, "design/brand/bend", file),
      resolve(destination, "design/brand/bend", file),
    );
  await emit(
    resolve(repository, "design/brand/tokens.css"),
    resolve(destination, "design/brand/tokens.css"),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const built = process.argv.includes("--build");
  const serve = process.argv.includes("--serve");
  if (serve && !built) throw new Error("--serve requires --build.");
  const directory = built ? await build() : null;
  if (built && !serve) console.log(directory);
  else {
    const port = built ? 0 : Number(process.env.PORT ?? 4173);
    const server = built ? createBuildServer(directory) : createPreviewServer();
    server.on("error", (error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () =>
      console.log(
        `Website preview: http://127.0.0.1:${server.address().port}/`,
      ),
    );
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
      process.once(signal, () => {
        server.close();
        server.closeAllConnections();
      });
  }
}

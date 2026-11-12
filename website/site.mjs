import { createServer } from "node:http";
import {
  readFile,
  lstat,
  readdir,
  mkdir,
  writeFile,
  copyFile,
  realpath,
  rm,
} from "node:fs/promises";
import {
  resolve,
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
  legalLinks,
} from "./components.mjs";
import { renderLegalPage } from "./legal/render.mjs";
export { escapeHtml };

export const landingContentSecurityPolicy =
  "default-src 'self'; script-src 'self' https://eocampaign1.com https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https://gallery.eo.page; font-src 'self' https://fonts.gstatic.com https://gallery.eo.page; connect-src 'self' https://eocampaign1.com https://www.google.com/recaptcha/ https://eu.i.posthog.com; frame-src https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/; frame-ancestors 'none'; base-uri 'self'; form-action 'none'";

export function analyticsConfiguration(
  token = process.env.WEBSITE_POSTHOG_TOKEN ?? "",
) {
  if (token && !/^phc_[A-Za-z0-9]{20,200}$/.test(token))
    throw new Error(
      "WEBSITE_POSTHOG_TOKEN must be a public PostHog project token.",
    );
  return `window.situateAnalyticsConfig = Object.freeze(${JSON.stringify({ token })});\n`;
}

const website = dirname(fileURLToPath(import.meta.url));
const repository = resolve(website, "..");
export async function websiteAnalyticsToken({
  environment = process.env,
  directory = repository,
} = {}) {
  const key = "WEBSITE_POSTHOG_TOKEN";
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
    if (key === "site.viewer") return renderViewer(messages);
    return text(key);
  });
}

async function legalContent(directory) {
  const [pages, legal, shared] = await Promise.all([
    readFile(resolve(directory, "pages.json"), "utf8"),
    readFile(resolve(directory, "messages.en.json"), "utf8"),
    readFile(resolve(website, "messages.en.json"), "utf8"),
  ]);
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

function location(pathname) {
  if (pathname === "/" || pathname === "/product.html")
    return {
      path: resolve(website, pathname === "/" ? "index.html" : "product.html"),
      base: website,
    };
  const parts = pathname.split("/").filter(Boolean);
  if (parts.some((part) => part.startsWith(".") || part.includes("\\")))
    return null;
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
    return { path: resolve(website, `.${pathname}`), base: website };
  if (
    pathname === "/media/provider-icons-license.txt" ||
    (parts[0] === "media" &&
      [".svg", ".png", ".jpg", ".webp"].includes(extname(pathname)))
  )
    return {
      path: resolve(website, `.${pathname}`),
      base: resolve(website, "media"),
    };
  if (
    pathname === "/design/brand/tokens.css" ||
    /^\/design\/brand\/(assets|bend)\/[\w/-]+\.(svg|js)$/.test(pathname)
  ) {
    return {
      path: resolve(repository, `.${pathname}`),
      base: resolve(repository, "design/brand"),
    };
  }
  return null;
}

export function createPreviewServer({
  legalDirectory = resolve(website, "legal"),
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
      const target = location(pathname);
      if (target?.redirect) {
        response.writeHead(308, { Location: target.redirect }).end();
        return;
      }
      if (!target) {
        response.writeHead(404).end();
        return;
      }
      const actual = await realpath(target.path);
      const within = relative(await realpath(target.base), actual);
      if (within.startsWith(`..${sep}`) || within === "..") {
        response.writeHead(404).end();
        return;
      }
      const extension = extname(actual);
      const content =
        extension === ".html" ? await html(actual) : await readFile(actual);
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
          error.code === "ENOENT" ? 404 : error instanceof URIError ? 400 : 500,
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
        parts.some((part) => part.startsWith(".") || part.includes("\\")) ||
        (!mime[extension] &&
          ![
            "media/provider-icons-license.txt",
            "vendor/posthog-LICENSE.txt",
          ].includes(file))
      ) {
        response.writeHead(404).end();
        return;
      }
      const actual = await realpath(resolve(root, file));
      const within = relative(await realpath(root), actual);
      if (
        isAbsolute(within) ||
        within === ".." ||
        within.startsWith(`..${sep}`)
      ) {
        response.writeHead(404).end();
        return;
      }
      const content = await readFile(actual);
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

export async function build(
  destination = resolve(website, "dist"),
  { analyticsToken } = {},
) {
  const analytics = analyticsConfiguration(
    analyticsToken === undefined
      ? await websiteAnalyticsToken()
      : analyticsToken,
  );
  destination = resolve(destination);
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return !isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`);
  };
  if (
    contains(destination, website) ||
    (contains(website, destination) && destination !== resolve(website, "dist"))
  )
    throw new Error(
      "Build output must not contain or overwrite website source files.",
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
  const { pages, messages } = await legalContent(resolve(website, "legal"));
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
  for (const legacy of ["system", "retrieve", "momentum", "hub.css"])
    await rm(resolve(destination, legacy), { recursive: true, force: true });
  return destination;
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

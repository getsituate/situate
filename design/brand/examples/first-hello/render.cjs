"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");

async function render(destination) {
  const output = path.resolve(destination);
  if (fs.existsSync(output))
    throw new Error("The output already exists. Choose a new filename.");
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
  const temporary = fs.mkdtempSync(
    path.join(os.tmpdir(), "situate-intro-render-"),
  );
  const movie = path.join(temporary, "introduction.mp4");
  let browser, encoder;
  try {
    browser = await chromium.launch({
      channel: process.env.BROWSER_CHANNEL || "chrome",
      headless: true,
    });
    const page = await browser.newPage({
      viewport: { width: 1296, height: 1000 },
      deviceScaleFactor: 1,
      reducedMotion: "no-preference",
    });
    const failures = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("requestfailed", (request) =>
      failures.push(
        `Could not load ${new URL(request.url()).pathname.split("/").pop()}`,
      ),
    );
    await page.route(/^https?:/, (route) => {
      failures.push("Unexpected network request.");
      return route.abort();
    });
    await page.goto(pathToFileURL(path.join(__dirname, "index.html")).href);
    await page.waitForSelector("#actor svg");
    await page.locator("#position").evaluate((node) => {
      node.step = "any";
    });
    encoder = spawn(
      process.env.FFMPEG_BINARY || "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-n",
        "-f",
        "image2pipe",
        "-framerate",
        "30",
        "-vcodec",
        "png",
        "-i",
        "pipe:0",
        "-an",
        "-frames:v",
        "300",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-metadata",
        "title=Situate — A first hello",
        movie,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    let failure,
      log = "";
    encoder.stderr.on("data", (chunk) => {
      log = (log + chunk.toString()).slice(-4000);
    });
    encoder.stdin.on("error", (error) => {
      failure = error;
    });
    const complete = new Promise((resolve, reject) => {
      encoder.on("error", (error) => {
        failure = error;
        reject(error);
      });
      encoder.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`Video encoding failed (${code}). ${log}`)),
      );
    });
    complete.catch(() => {});
    for (let frame = 0; frame < 300; frame++) {
      if (failure) throw failure;
      if (failures.length) throw new Error(failures.join("\n"));
      await page.locator("#position").evaluate((node, seconds) => {
        node.value = String(seconds);
        node.dispatchEvent(new Event("input", { bubbles: true }));
      }, frame / 30);
      const png = await page.locator("#stage").screenshot({ type: "png" });
      if (!encoder.stdin.write(png))
        await Promise.race([
          once(encoder.stdin, "drain"),
          complete.then(() => {
            throw new Error("The encoder stopped before the final frame.");
          }),
        ]);
    }
    encoder.stdin.end();
    await complete;
    if (failures.length) throw new Error(failures.join("\n"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(movie, output, fs.constants.COPYFILE_EXCL);
    console.log(
      `Rendered 10 seconds at 30 fps, 1200 × 640, without audio: ${output}`,
    );
  } finally {
    if (encoder && encoder.exitCode === null) encoder.kill();
    await browser?.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === "--help") {
  console.log(
    "Usage: node design/brand/examples/first-hello/render.cjs /path/to/new-introduction.mp4",
  );
  console.log(
    "Requires existing Playwright, Chrome and ffmpeg. Does not install tools or overwrite an output.",
  );
  if (args[0] !== "--help") process.exitCode = 2;
} else
  render(args[0]).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });

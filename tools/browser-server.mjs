import { createServer as createHttpServer } from "node:http";

// Keep the OS-assigned listener open while Vite starts; probing and releasing a
// free port would allow another worktree to claim it before the server binds.
export async function startBrowserServer(
  { createServer, version },
  config,
  startupUrls = [],
) {
  let vite;
  const http = createHttpServer((request, response) => {
    if (vite) vite.middlewares(request, response);
    else {
      response.statusCode = 503;
      response.end();
    }
  });
  let closing;
  const close = () =>
    (closing ??= (async () => {
      try {
        await vite?.close();
      } finally {
        await new Promise((done) => {
          http.close(done);
          http.closeAllConnections();
        });
      }
    })());
  try {
    await new Promise((ready, reject) => {
      http.once("error", reject);
      http.listen(0, "127.0.0.1", ready);
    });
    const port = http.address().port;
    // Vite 8 moved transport options from hmr to ws; requirements uses Vite 7.
    const transport = Number(version.split(".")[0]) >= 8 ? "ws" : "hmr";
    vite = await createServer({
      ...config,
      server: {
        middlewareMode: true,
        host: "127.0.0.1",
        port,
        hmr: true,
        [transport]: {
          server: http,
          protocol: "ws",
          host: "127.0.0.1",
          port,
          clientPort: port,
        },
      },
    });
    if (startupUrls.length) {
      const client = vite.environments.client;
      await Promise.all(
        ["/@vite/client", ...startupUrls].map((url) =>
          client.transformRequest(url),
        ),
      );
      await client.waitForRequestsIdle();
      // Static transforms can finish before the dependency scan and bundle commit.
      await client.depsOptimizer?.scanProcessing;
      await Promise.all(
        Object.values(client.depsOptimizer?.metadata.discovered ?? {}).map(
          (dependency) => dependency.processing,
        ),
      );
    }
    return { url: `http://127.0.0.1:${port}`, close, config: vite.config };
  } catch (error) {
    await close();
    throw error;
  }
}

// Install handlers before asynchronous setup so cancellation also covers startup.
export async function serveBrowserTests(start) {
  let stopping = false,
    stopped;
  const shutdown = new Promise((resolve) => {
    stopped = resolve;
  });
  const stop = () => {
    stopping = true;
    stopped();
  };
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const signal of signals) process.on(signal, stop);
  let server;
  try {
    server = await start();
    if (!stopping) {
      console.log(`SITUATE_BROWSER_URL=${server.url}`);
      await shutdown;
    }
  } finally {
    try {
      await server?.close();
    } finally {
      for (const signal of signals) process.removeListener(signal, stop);
    }
  }
}

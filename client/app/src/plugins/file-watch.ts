import type {
  PluginFileChange,
  PluginFileEntry,
  PluginFileQuery,
} from "./types";

export async function watchPluginFiles(
  list: (
    query: PluginFileQuery,
    signal: AbortSignal,
  ) => Promise<PluginFileEntry[]>,
  query: PluginFileQuery,
  listener: (change: PluginFileChange) => void | Promise<void>,
  lifecycle: AbortSignal,
  signal?: AbortSignal,
): Promise<() => void> {
  const controller = new AbortController();
  const inputs = signal ? [lifecycle, signal] : [lifecycle];
  const callSignal = AbortSignal.any([...inputs, controller.signal]);
  const selection = {
    ...query,
    ...(query.roots === undefined ? {} : { roots: [...query.roots] }),
    ...(query.extensions === undefined
      ? {}
      : { extensions: [...query.extensions] }),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: Map<string, string>;
  const stop = () => {
    clearTimeout(timer);
    for (const input of inputs) input.removeEventListener("abort", stop);
    controller.abort();
  };
  const remember = (files: PluginFileEntry[]) =>
    new Map(files.map(({ path, changeToken }) => [path, changeToken]));
  for (const input of inputs)
    input.addEventListener("abort", stop, { once: true });
  try {
    callSignal.throwIfAborted();
    const files = await list(selection, callSignal);
    callSignal.throwIfAborted();
    previous = remember(files);
    await listener({ type: "reset", files });
    callSignal.throwIfAborted();
  } catch (error) {
    stop();
    throw error;
  }

  async function poll() {
    let files: PluginFileEntry[];
    try {
      files = await list(selection, callSignal);
      if (callSignal.aborted) return;
    } catch (error) {
      if (callSignal.aborted) return;
      stop();
      const message = error instanceof Error ? error.message : error;
      try {
        await listener({
          type: "error",
          message:
            typeof message === "string" && /^native\.[\w.]+$/.test(message)
              ? message
              : "native.plugins.hostFailed",
        });
      } catch {
        // A failed listener terminates its subscription.
      }
      return;
    }
    const next = remember(files);
    const paths = files
      .filter(({ path, changeToken }) => previous.get(path) !== changeToken)
      .map(({ path }) => path);
    const deleted = [...previous.keys()].filter((path) => !next.has(path));
    previous = next;
    try {
      if (paths.length || deleted.length)
        await listener({ type: "changed", paths, deleted });
    } catch {
      stop();
      return;
    }
    schedule();
  }
  function schedule() {
    if (!callSignal.aborted)
      timer = setTimeout(() => {
        void poll();
      }, 1000);
  }
  schedule();
  return stop;
}

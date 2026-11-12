import type {
  PluginHttpRequest,
  PluginInvocationContext,
  PluginProcessRequest,
} from "./types";

export type PluginHostRequest = (
  request: Record<string, unknown>,
) => Promise<unknown>;

// Each closure belongs to one admitted invocation; no mutable ambient authority.
export function createInvocationContext(
  invocationId: string,
  signal: AbortSignal,
  request: PluginHostRequest,
  progress: (value: unknown) => void,
): PluginInvocationContext {
  const call = <T>(value: Record<string, unknown>): Promise<T> => {
    signal.throwIfAborted();
    return request(value) as Promise<T>;
  };
  const files = (area: string) =>
    Object.freeze({
      read: (path: string) =>
        call<{ text: string; revision: string }>({
          operation: "read",
          area,
          path,
        }),
      write: (path: string, text: string, expectedRevision: string | null) =>
        call<string>({
          operation: "write",
          area,
          path,
          text,
          expectedRevision,
        }),
    });
  return Object.freeze({
    invocationId,
    signal,
    progress,
    files: Object.freeze({
      ...files("files"),
      list: (query = {}) => call({ operation: "filesList", query }),
      search: (query: unknown) => call({ operation: "filesSearch", query }),
      readMany: (paths: string[]) =>
        call({ operation: "filesReadMany", paths }),
    }),
    config: files("config"),
    data: files("data"),
    credentials: Object.freeze({
      get: (name: string) => call<string>({ operation: "credentialGet", name }),
      set: (name: string, value: string) =>
        call<void>({ operation: "credentialSet", name, value }),
      remove: (name: string) =>
        call<void>({ operation: "credentialRemove", name }),
    }),
    process: Object.freeze({
      capability: () => call({ operation: "processCapability" }),
      run: (input: PluginProcessRequest) =>
        call({
          operation: "process",
          executable: input.executable,
          args: input.args ?? [],
          ...(input.timeoutMs === undefined
            ? {}
            : { timeoutMs: input.timeoutMs }),
        }),
    }),
    network: Object.freeze({
      request: (input: PluginHttpRequest) =>
        call({
          operation: "http",
          url: input.url,
          method: input.method ?? "GET",
          ...(input.headers === undefined ? {} : { headers: input.headers }),
          ...(input.body === undefined ? {} : { body: input.body }),
        }),
    }),
    dependencies: Object.freeze({
      invoke: (pluginId: string, exportName: string, args: unknown) =>
        call({ operation: "dependenciesInvoke", pluginId, exportName, args }),
    }),
    preview: Object.freeze({
      open: (request: unknown) => call({ operation: "previewOpen", request }),
      step: (request: unknown) => call({ operation: "previewStep", request }),
      close: () => call({ operation: "previewClose" }),
    }),
  }) as PluginInvocationContext;
}

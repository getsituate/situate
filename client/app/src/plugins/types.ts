import type * as Vue from "vue";
import type * as Ui from "@situate/ui";
import type {
  UiCoordinator,
  ViewDefinition,
  ViewRegistry,
} from "../layout/registry";

export interface PluginManifest {
  schemaVersion: number;
  id: string;
  name: string;
  description: string;
  skills: string[];
  serviceEntry?: string;
  uiEntry?: string;
  kind?: "connection" | "tool";
  dependencies?: string[];
  exports?: string[];
  platforms?: ("macos" | "ios")[];
}
export interface InstalledPlugin {
  id: string;
  incarnation?: string;
  revision?: string;
  enabled: boolean;
  manifest: PluginManifest | null;
  error: string | null;
}
export interface PluginList {
  plugins: InstalledPlugin[];
  revision: string | null;
}
export interface PluginSource {
  manifest: PluginManifest;
  serviceEntry: string | null;
  uiEntry: string | null;
  modules?: Record<string, string>;
  skills: { path: string; text: string }[];
}
export type PluginRequest =
  | { operation: "list" }
  | { operation: "load"; pluginId: string; revision?: string }
  | { operation: "check"; pluginId: string }
  | {
      operation: "setEnabled";
      pluginId: string;
      enabled: boolean;
      expectedRevision: string | null;
    }
  | {
      operation: "uninstall";
      pluginId: string;
      expectedRevision: string | null;
    };
export interface PluginDisableSnapshot {
  id: string;
  pluginId: string;
  phase:
    "waiting" | "saving" | "disabled" | "cancelled" | "failed" | "uncertain";
  runningActions: readonly { pluginId: string; count: number }[];
  pendingRequests: number;
  error: string | null;
}
export type PluginDisableState = Omit<PluginDisableSnapshot, "phase"> & {
  phase: PluginDisableSnapshot["phase"] | "starting";
  stopRequested: boolean;
  checking: boolean;
};
export type PluginDisableRequest =
  | {
      operation: "begin";
      id: string;
      pluginId: string;
      expectedRevision: string | null;
    }
  | { operation: "status" | "cancel" | "stop"; id: string };

export interface PluginFileService {
  read(path: string): Promise<{ text: string; revision: string }>;
  write(
    path: string,
    text: string,
    expectedRevision: string | null,
  ): Promise<unknown>;
}
export interface PluginFileQuery {
  roots?: string[];
  extensions?: string[];
}
export interface PluginFileEntry {
  path: string;
  changeToken: string;
}
export type PluginFileChange =
  | { type: "reset"; files: PluginFileEntry[] }
  | { type: "changed"; paths: string[]; deleted: string[] }
  | { type: "error"; message: string };
export interface PluginWorkspaceFiles extends PluginFileService {
  list(query?: PluginFileQuery): Promise<PluginFileEntry[]>;
  search(query: PluginFileQuery & { text: string }): Promise<PluginFileEntry[]>;
  readMany(
    paths: string[],
  ): Promise<{ path: string; text: string; revision: string }[]>;
}
export interface PluginHttpRequest {
  url: string;
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: string;
}
export interface PluginProcessRequest {
  executable: string;
  args?: string[];
  timeoutMs?: number;
}
export interface PluginProcessCapability {
  available: boolean;
  platform: string;
  implementation: string;
  interpreter: string | null;
  interpreterDialect: string | null;
  interpreterArgs: string[];
  unavailableReason: string | null;
  ownership: string;
  detachedDescendantsContained: boolean;
  requiresPathBackedWorkspace: boolean;
  maxTimeoutMs: number;
  maxOutputBytesPerStream: number;
}
export interface PluginCommandOutput {
  text: string;
  capturedBytes: number;
  totalBytes: number;
  truncated: boolean;
  incomplete: boolean;
}
export interface PluginCommandResult {
  outcome: "exited" | "cancelled" | "timedOut";
  exitCode: number | null;
  signal: number | null;
  stdout: PluginCommandOutput;
  stderr: PluginCommandOutput;
}
export type PluginShellError =
  "unavailable" | "invalidRequest" | "spawnFailed" | "waitFailed";
export interface PluginProcessReply {
  isError: boolean;
  commandResult: { Ok: PluginCommandResult } | { Err: PluginShellError };
  beforeHistoryRevision: string | null;
  afterHistoryRevision: string | null;
  reconciliationError: string | null;
  attribution: "uncertainExternalChangesMayCoexist";
}
export type PluginExport = (
  args: unknown,
  context: PluginInvocationContext,
) => unknown | Promise<unknown>;
export interface PluginToolDescriptor {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface NativePluginUnavailable {
  pluginId: string | null;
  pluginName: string | null;
  reason: string;
  error: string;
  revision?: string;
  incarnation?: string;
}
export interface NativeServiceSnapshot {
  plugins: NativeServiceEntry[];
  unavailable?: NativePluginUnavailable[];
}
export interface NativeServiceEntry {
  pluginId: string;
  revision: string | null;
  incarnation: string;
  generation: number;
  tools: PluginToolDescriptor[];
  exports: string[];
  source: PluginSource;
}
export interface PluginServiceContributions {
  tools?: (PluginToolDescriptor & { execute: PluginExport })[];
  exports?: Record<string, PluginExport>;
}
export interface PluginInvocationContext extends PluginHostServices {
  readonly invocationId: string;
  readonly signal: AbortSignal;
  progress(value: unknown): void;
  readonly preview: {
    open(request: { viewId: string }): Promise<true>;
    step(
      request:
        | { action: "read"; selector?: string }
        | { action: "click"; selector: string }
        | { action: "fill"; selector: string; value: string }
        | { action: "capture" },
    ): Promise<string | true | { captured: true; mimeType: "image/png" }>;
    close(): Promise<true>;
  };
}
export interface PluginHostServices {
  readonly dependencies: {
    invoke(
      pluginId: string,
      exportName: string,
      args: unknown,
    ): Promise<unknown>;
  };
  readonly files: PluginWorkspaceFiles;
  readonly config: PluginFileService;
  readonly data: PluginFileService;
  readonly credentials: {
    get(name: string): Promise<string>;
    set(name: string, value: string): Promise<void>;
    remove(name: string): Promise<void>;
  };
  readonly process: {
    capability(): Promise<PluginProcessCapability>;
    run(request: PluginProcessRequest): Promise<PluginProcessReply>;
  };
  readonly network: {
    request(
      request: PluginHttpRequest,
    ): Promise<{ status: number; body: string }>;
  };
}
export interface PluginUiHost {
  readonly vue: Pick<
    typeof Vue,
    | "defineComponent"
    | "h"
    | "ref"
    | "shallowRef"
    | "reactive"
    | "computed"
    | "readonly"
    | "watch"
    | "watchEffect"
    | "onMounted"
    | "onUnmounted"
    | "onBeforeUnmount"
    | "nextTick"
    | "compile"
  >;
  readonly ui: Pick<typeof Ui, Extract<keyof typeof Ui, `Situate${string}`>>;
  readonly navigation: Pick<UiCoordinator, "open" | "reveal">;
  readonly service: {
    invoke(exportName: string, args: unknown): Promise<unknown>;
  };
  readonly dependencies: {
    invoke(
      pluginId: string,
      exportName: string,
      args: unknown,
    ): Promise<unknown>;
    component(pluginId: string, name: string): Vue.Component;
  };
}
export interface PluginUiContributions {
  components?: Record<string, Vue.Component>;
  views?: ViewDefinition[];
  settings?: ViewDefinition;
  dispose?: () => void | Promise<void>;
}
export interface PluginRuntimeOptions {
  scope: string;
  registry: ViewRegistry;
  coordinator: UiCoordinator;
  isCurrent: () => boolean;
  builtinToolNames?: readonly string[];
  platform?: "macos" | "ios";
}

import type { Page } from "@playwright/test";
import type { UpdateSnapshot } from "../../src/updates/runtime";
import {
  layoutFixture,
  legacyChatLayout,
  type LayoutFixtureOptions,
} from "./layout-fixture";
import type { Snapshot } from "../../src/workspaces/api";
import type { Config, ModelCatalog } from "../../src/ai/api";
import type { WorkspaceAiSettings } from "../../src/ai/settings";
import type { ConversationRecord } from "../../src/ai/conversation-record";
import type {
  ConversationSnapshot,
  ConversationInput,
  ConversationAction,
} from "../../src/ai/native-conversation";
import type {
  ConversationRuntime,
  AttachmentRef,
  ContentReference,
} from "../../src/ai/queue-runtime";
import type { ConversationQuestion } from "../../src/ai/question";
import type {
  UserMessage,
  TextContent,
  ImageContent,
} from "../../src/ai/contracts";

export type NativeConversationFixturePatch = Partial<
  Omit<ConversationSnapshot, "record" | "version" | "generation" | "position">
>;
export interface NativeConversationFixtureRequest {
  scope: string;
  conversation: string;
  actionId: string;
  config: Config | null;
  model: string;
  thinking: string;
}
export async function nativeRequests(
  page: Page,
): Promise<NativeConversationFixtureRequest[]> {
  return page.evaluate(() =>
    (
      Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture
    ).requests(),
  );
}
export interface NativeConversationFixture {
  getRecord(scope: string, conversation: string): ConversationRecord;
  saveRecord(
    scope: string,
    record: ConversationRecord,
    patch?: NativeConversationFixturePatch,
  ): ConversationSnapshot;
  snapshot(scope: string, conversation: string): ConversationSnapshot;
  publish(
    scope: string,
    conversation: string,
    patch?: NativeConversationFixturePatch,
  ): ConversationSnapshot;
  accept(
    scope: string,
    conversation: string,
    actionId: string,
    action: ConversationAction,
  ): Promise<ConversationSnapshot>;
  finish(
    scope: string,
    conversation: string,
    text?: string | null,
  ): ConversationSnapshot;
  requests(): NativeConversationFixtureRequest[];
}
import type { LocalizationSnapshot } from "@situate/localization";
import type { AppearanceSnapshot } from "../../src/settings/accents";
import type {
  InstalledPlugin,
  PluginSource,
  PluginDisableRequest,
  PluginDisableSnapshot,
} from "../../src/plugins/types";

export const garden = {
  id: "garden",
  name: "Garden notes",
  display: "/Documents/Garden notes",
};
export const reading = {
  id: "reading",
  name: "Reading room",
  display: "/Documents/Reading room",
};
export const shellState: Snapshot = {
  ready: true,
  mobile: false,
  known: [garden],
  open: [garden],
  current: garden,
  failures: [],
  error: null,
};
interface FixtureOptions {
  updates?: Partial<UpdateSnapshot>;
  updateCheckError?: string;
  updateInstallError?: string;
  dictationModel?:
    "ready" | "waiting" | "downloading" | "preparing" | "failed" | "storage";
  dictationPermission?: "granted" | "denied" | "pending";
  recovery?: boolean;
  recoveryError?: boolean;
  layout?: LayoutFixtureOptions;
  parent?: { id: string; name: string; display: string };
  collisions?: string[];
  createError?: string;
  aiReason?: string;
  aiConversationTitle?: string;
  aiConversations?: (Pick<
    ConversationRecord,
    "id" | "title" | "draft" | "development"
  > &
    Partial<Pick<ConversationRecord, "messages" | "runtime">>)[];
  installedPlugins?: InstalledPlugin[];
  pluginSources?: Record<string, PluginSource>;
  pluginExportResults?: Record<string, Record<string, unknown>>;
  pluginSourceFiles?: Record<string, Record<string, string>>;
  pluginListError?: string;
  pluginDisablePhase?: "waiting" | "failed" | "uncertain";
  pluginDisableRunningActions?: { pluginId: string; count: number }[];
  pluginDisableDeferCheck?: boolean;
  pluginSourceError?: string;
  changeRevisions?: Record<string, Record<string, string | null>>;
  changeLists?: Record<
    string,
    Record<
      string,
      { path: string; operation: "added" | "modified" | "deleted" }[]
    >
  >;
  aiSaveError?: boolean;
  aiConversationLoadErrors?: Record<string, string>;
  aiLoginOutcome?: "success" | "denied" | "pending";
  aiConnection?: Config;
  aiConnections?: Config[];
  aiCatalogs?: Record<string, ModelCatalog>;
  aiRefreshCatalogs?: Record<string, ModelCatalog[]>;
  aiRefreshError?: string;
  aiDeviceOutcome?: "success" | "denied" | "timeout" | "pending";
  aiModel?: string;
  showInlineModel?: boolean;
  aiModelError?: string;
  aiSelectionFailures?: number;
  aiSelectionSaveThenFail?: boolean;
  aiSelectionReadbackError?: boolean;
  aiDeferSelection?: boolean;
  aiHoldResponse?: boolean;
  aiHoldPartialResponse?: boolean;
  aiRequestError?: string;
  aiFailResponseSave?: boolean;
  aiResponseText?: string;
  aiComment?: string;
  appearance?: AppearanceSnapshot;
  appearanceByScope?: Record<string, AppearanceSnapshot>;
  appearanceLoadError?: boolean;
  appearanceSaveError?: boolean;
  appearanceDeferSave?: boolean;
  appearanceSaveThenFail?: boolean;
  localization?: LocalizationSnapshot;
  localizationByScope?: Record<string, LocalizationSnapshot>;
}
export async function workspaceFixture(
  page: Page,
  initial: Snapshot,
  options: FixtureOptions = {},
): Promise<void> {
  await layoutFixture(
    page,
    options.layout ?? {
      records: initial.onboarding
        ? {}
        : Object.fromEntries(
            initial.open.map((workspace) => [workspace.id, legacyChatLayout()]),
          ),
    },
  );
  await page.addInitScript<unknown>(
    (fixture) => {
      const { initial, options } = fixture as {
        initial: Snapshot;
        options: FixtureOptions;
      };
      Object.defineProperty(window, "isTauri", { value: true });
      const state = structuredClone(initial);
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      const connections = new Map<string, Config>();
      const records = new Map<string, Map<string, Config>>();
      const catalogs = new Map<string, ModelCatalog>();
      const catalogRefreshes = structuredClone(options.aiRefreshCatalogs ?? {});
      const forgotten = new Set<string>();
      const perConnectionSettings = new Map<string, WorkspaceAiSettings>();
      const localChoices = new Map<
        string,
        {
          model?: { connectionId: string; model: string };
          thinking: Record<string, string>;
        }
      >();
      let selectionReadbackFailed = false;
      let responseSaveBlocked = options.aiFailResponseSave ?? false;
      const recommendedModel = (config: Config): string | null =>
        config.provider === "custom"
          ? null
          : config.provider === "anthropic"
            ? "claude-sonnet-5-5"
            : config.provider === "openrouter"
              ? "openai/gpt-6.1-sol"
              : "gpt-6.1-sol";
      let connectionSequence = 0;
      const selectedModels = new Map<string, string>();
      const aiSettings = new Map<string, WorkspaceAiSettings>();
      const settingsFor = (
        scope: string,
        connectionId?: string,
      ): WorkspaceAiSettings => {
        if (
          connectionId &&
          connectionId !== connections.get(scope)?.connectionId
        ) {
          if (!records.get(scope)?.has(connectionId))
            throw "native.ai.access.required";
          const key = `${scope}:${connectionId}`;
          if (!perConnectionSettings.has(key))
            perConnectionSettings.set(key, {
              version: 1,
              chat: {
                model: "recommended",
                thinking: "recommended",
                catalogRevision: null,
              },
              comment: null,
              generatedComments: true,
              showInlineModel: options.showInlineModel ?? false,
            });
          return perConnectionSettings.get(key)!;
        }
        if (!aiSettings.has(scope)) {
          const model =
            selectedModels.get(scope) ??
            (connections.has(scope) ? "recommended" : undefined);
          aiSettings.set(scope, {
            version: 1,
            chat: model
              ? { model, thinking: "recommended", catalogRevision: null }
              : null,
            comment: null,
            generatedComments: true,
            showInlineModel: options.showInlineModel ?? false,
          });
        }
        return aiSettings.get(scope)!;
      };
      const pluginStates = new Map<
        string,
        { plugins: InstalledPlugin[]; revision: string | null }
      >();
      const pluginHosts = new Set<string>();
      const pluginDisables = new Map<string, PluginDisableSnapshot>();
      let nextDisablePhase = options.pluginDisablePhase;
      function saveDisabled(scope: string, pluginId: string) {
        const state = pluginsFor(scope);
        const affected = new Set([pluginId]);
        let changed = true;
        while (changed) {
          changed = false;
          for (const plugin of state.plugins)
            if (
              !affected.has(plugin.id) &&
              plugin.manifest?.dependencies?.some((id) => affected.has(id))
            ) {
              affected.add(plugin.id);
              changed = true;
            }
        }
        for (const plugin of state.plugins)
          if (affected.has(plugin.id)) plugin.enabled = false;
        state.revision = `plugins-${++pluginRevision}`;
      }
      Reflect.set(
        window,
        "__setPluginDisablePhase",
        (phase: PluginDisableSnapshot["phase"]) => {
          if (phase === "failed") nextDisablePhase = undefined;
          for (const [scope, disable] of pluginDisables) {
            disable.phase = phase;
            if (phase === "disabled") saveDisabled(scope, disable.pluginId);
          }
        },
      );
      let pluginRevision = 0;
      function pluginsFor(scope: string) {
        if (!pluginStates.has(scope))
          pluginStates.set(scope, {
            plugins: structuredClone(options.installedPlugins ?? []).map(
              (plugin, index) => ({
                ...plugin,
                incarnation:
                  plugin.incarnation ??
                  `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
              }),
            ),
            revision: options.installedPlugins?.length
              ? "plugins-initial"
              : null,
          });
        return pluginStates.get(scope)!;
      }
      const modelErrors = new Map<string, string>();
      const conversations = new Map<string, ConversationRecord>(
        (options.aiConversations ?? []).map((record) => [
          `${initial.current?.id}:${record.id}`,
          { version: 2, revision: 0, messages: [], ...structuredClone(record) },
        ]),
      );
      function conversation(scope: string, id = "legacy"): ConversationRecord {
        const key = `${scope}:${id}`;
        if (!conversations.has(key) && id === "legacy")
          conversations.set(key, {
            version: 2,
            id,
            title: options.aiConversationTitle ?? "",
            revision: 0,
            messages: [],
            draft: "",
          });
        const record = conversations.get(key);
        if (!record) throw new Error("Missing conversation");
        return record;
      }
      const appearances = new Map<string, AppearanceSnapshot>(
        JSON.parse(sessionStorage.getItem("appearance-fixture") ?? "null") ??
          Object.entries(options.appearanceByScope ?? {}),
      );
      const defaultAppearance: AppearanceSnapshot = options.appearance ?? {
        accent: "violet",
        writable: true,
        revision: null,
      };
      const preferences = new Map<string, LocalizationSnapshot>(
        Object.entries(options.localizationByScope ?? {}),
      );
      const defaultPreferences: LocalizationSnapshot = options.localization ?? {
        language: "en",
        formats: { time: "12", date: "mdy", number: "dot-comma" },
        writable: true,
      };
      if (initial.current) {
        const items =
          options.aiConnections ??
          (options.aiConnection ? [options.aiConnection] : []);
        for (const item of items) {
          const config = {
            ...item,
            connectionId:
              item.connectionId ?? `connection-${++connectionSequence}`,
          };
          if (!records.has(initial.current.id))
            records.set(initial.current.id, new Map());
          records.get(initial.current.id)!.set(config.connectionId, config);
          const discovered = options.aiCatalogs?.[config.connectionId];
          if (discovered)
            catalogs.set(
              `${initial.current.id}:${config.connectionId}`,
              discovered,
            );
          if (!connections.has(initial.current.id))
            connections.set(initial.current.id, config);
        }
      }
      if (initial.current && options.aiModel)
        selectedModels.set(initial.current.id, options.aiModel);
      if (initial.current && options.aiModelError)
        modelErrors.set(initial.current.id, options.aiModelError);
      let selectionFailures = options.aiSelectionFailures ?? 0;
      const status = (
        scope: string,
        conversationId?: string,
        savedConfig?: Config,
        preview?: { model: string | null; thinking: string | null },
      ) => {
        const preferences = conversationId
          ? localChoices.get(`${scope}:${conversationId}`)
          : undefined;
        const override = preferences?.model;
        const config =
          savedConfig ??
          (override
            ? records.get(scope)?.get(override.connectionId)
            : connections.get(scope)) ??
          null;
        const catalog = catalogs.get(`${scope}:${config?.connectionId}`);
        const settings = config
          ? settingsFor(scope, config.connectionId)
          : undefined;
        const preference =
          preview?.model ?? override?.model ?? settings?.chat?.model;
        const selectedModel = config
          ? preference === "recommended"
            ? recommendedModel(config)
            : (preference ?? null)
          : null;
        const thinkingKey = `${config?.connectionId}/${selectedModel}`;
        const thinkingPreference =
          preview?.thinking ??
          preferences?.thinking[thinkingKey] ??
          settings?.chat?.thinking ??
          "recommended";
        const thinkingLevel =
          thinkingPreference === "recommended"
            ? selectedModel?.includes("6.1-sol") ||
              selectedModel === "claude-sonnet-5-5"
              ? "medium"
              : "off"
            : thinkingPreference;
        const missing = forgotten.has(`${scope}:${config?.connectionId}`);
        return {
          config: config ? structuredClone(config) : null,
          ...(catalog ? { catalog: structuredClone(catalog) } : {}),
          available: !!config && !missing,
          reason: missing
            ? "native.ai.access.required"
            : (options.aiReason ?? null),
          selectedModel,
          modelInherited: !preview?.model && !override,
          modelPreference: preference ?? null,
          thinkingInherited:
            !preview?.thinking &&
            preferences?.thinking[thinkingKey] === undefined,
          thinkingPreference,
          thinkingLevel,
          recommendedThinkingLevel:
            selectedModel?.includes("6.1-sol") ||
            selectedModel === "claude-sonnet-5-5"
              ? "medium"
              : "off",
          inheritedThinkingLevel:
            settings?.chat?.thinking && settings.chat.thinking !== "recommended"
              ? settings.chat.thinking
              : selectedModel?.includes("6.1-sol") ||
                  selectedModel === "claude-sonnet-5-5"
                ? "medium"
                : "off",
          modelError: config
            ? (modelErrors.get(scope) ??
              (catalog?.source === "account" &&
              selectedModel &&
              !catalog.models.includes(selectedModel)
                ? "native.ai.model.savedUnavailable"
                : !selectedModel
                  ? "native.ai.model.required"
                  : null))
            : null,
        };
      };
      function selectRecord(scope: string, config: Config): void {
        const previous = connections.get(scope);
        if (previous?.connectionId)
          perConnectionSettings.set(
            `${scope}:${previous.connectionId}`,
            structuredClone(settingsFor(scope)),
          );
        connections.set(scope, config);
        const saved = perConnectionSettings.get(
          `${scope}:${config.connectionId}`,
        );
        aiSettings.delete(scope);
        selectedModels.delete(scope);
        modelErrors.delete(scope);
        if (saved) {
          aiSettings.set(scope, structuredClone(saved));
          if (saved.chat) selectedModels.set(scope, saved.chat.model);
        }
      }
      function saveRecord(scope: string, input: Config): Config {
        const existing =
          input.connectionId !== undefined &&
          records.get(scope)?.has(input.connectionId);
        const config = {
          ...input,
          connectionId:
            input.connectionId ?? `connection-${++connectionSequence}`,
        };
        if (!records.has(scope)) records.set(scope, new Map());
        records.get(scope)!.set(config.connectionId, config);
        forgotten.delete(`${scope}:${config.connectionId}`);
        if (!existing) {
          perConnectionSettings.set(`${scope}:${config.connectionId}`, {
            version: 1,
            chat: {
              model: "recommended",
              thinking: "recommended",
              catalogRevision: null,
            },
            comment: null,
            generatedComments: true,
            showInlineModel: options.showInlineModel ?? false,
          });
        }
        if (
          !connections.has(scope) ||
          connections.get(scope)?.connectionId === config.connectionId
        )
          selectRecord(scope, config);
        if (
          !existing &&
          connections.get(scope)?.connectionId === config.connectionId &&
          (config.auth ?? "api_key") === "api_key" &&
          config.endpoint === null
        ) {
          const model =
            config.provider === "openai"
              ? "gpt-4o-mini"
              : config.provider === "openrouter"
                ? "openai/gpt-4o-mini"
                : null;
          if (model)
            settingsFor(scope).comment = {
              model,
              thinking: "off",
              catalogRevision: null,
            };
        }
        return config;
      }
      const logins = new Map<
        string,
        {
          scope: string;
          cancelled: boolean;
          connectionId?: string;
          label?: string;
          cancel?: () => void;
        }
      >();
      let loginSequence = 0;
      Object.defineProperty(window, "__ipcCalls", { get: () => calls });
      Object.defineProperty(window, "__restoreSelectionReadback", {
        value: () => {
          selectionReadbackFailed = false;
        },
      });
      Object.defineProperty(window, "__allowResponseSave", {
        value: () => {
          responseSaveBlocked = false;
        },
      });

      const nativeChannels = new Map<
        string,
        { subscription: string; onmessage: (value: unknown) => void }
      >();
      const retainedNative = JSON.parse(
        sessionStorage.getItem("native-conversation-fixture-v2") ?? "null",
      ) as {
        records: [string, ConversationRecord][];
        owners: [string, Omit<ConversationSnapshot, "record">][];
        receipts: [string, string][];
        requests: NativeConversationFixtureRequest[];
        attachments: [string, { reference: AttachmentRef; bytes: number[] }][];
      } | null;
      for (const [key, record] of retainedNative?.records ?? [])
        conversations.set(key, record);
      const nativeOwners = new Map<
        string,
        Omit<ConversationSnapshot, "record">
      >(retainedNative?.owners ?? []);
      const nativeReceipts = new Map<string, string>(
        retainedNative?.receipts ?? [],
      );
      const nativeRequests: NativeConversationFixtureRequest[] =
        retainedNative?.requests ?? [];
      const nativeAttachments = new Map<
        string,
        { reference: AttachmentRef; bytes: number[] }
      >(retainedNative?.attachments ?? []);
      const nativeKey = (scope: string, id: string) => `${scope}:${id}`;
      function persistNative() {
        sessionStorage.setItem(
          "native-conversation-fixture-v2",
          JSON.stringify({
            records: [...conversations],
            owners: [...nativeOwners],
            receipts: [...nativeReceipts],
            requests: nativeRequests,
            attachments: [...nativeAttachments],
          }),
        );
      }
      function runtime(record: ConversationRecord): ConversationRuntime {
        return (record.runtime ??= {
          draftAttachments: [],
          draftReferences: [],
          pending: [],
          events: [],
          runs: [],
        });
      }
      function nativeState(
        scope: string,
        id: string,
      ): Omit<ConversationSnapshot, "record"> {
        const key = nativeKey(scope, id);
        let owner = nativeOwners.get(key);
        if (!owner) {
          const last = conversation(scope, id).runtime?.runs.at(-1);
          owner = {
            version: 1,
            generation: crypto.randomUUID(),
            position: 0,
            actionId: last?.id ?? null,
            phase: last && last.state !== "completed" ? "interrupted" : "idle",
            taskActive: false,
            questionBusy: false,
            error: null,
            partialMessage: null,
            activityComment: "",
          };
          nativeOwners.set(key, owner);
        }
        return owner;
      }
      function nativeSnapshot(scope: string, id: string): ConversationSnapshot {
        return structuredClone({
          ...nativeState(scope, id),
          record: conversation(scope, id),
        });
      }
      function nativePublish(
        scope: string,
        id: string,
        patch: NativeConversationFixturePatch = {},
      ): ConversationSnapshot {
        const owner = nativeState(scope, id);
        Object.assign(owner, structuredClone(patch));
        owner.position++;
        persistNative();
        const snapshot = nativeSnapshot(scope, id);
        nativeChannels.get(nativeKey(scope, id))?.onmessage({
          version: 1,
          generation: snapshot.generation,
          position: snapshot.position,
          subscription: nativeChannels.get(nativeKey(scope, id))!.subscription,
          type: "snapshot",
          snapshot,
        });
        return snapshot;
      }
      function nativeSave(
        scope: string,
        record: ConversationRecord,
        patch: NativeConversationFixturePatch = {},
      ): ConversationSnapshot {
        if (record.version !== 2) throw "native.ai.conversation.versionInvalid";
        const key = nativeKey(scope, record.id);
        const previous = conversations.get(key);
        conversations.set(
          key,
          structuredClone({
            ...record,
            revision: (previous?.revision ?? -1) + 1,
          }),
        );
        return nativePublish(scope, record.id, patch);
      }
      function nativeEvent(
        record: ConversationRecord,
        runId: string,
        type: string,
        data: unknown,
      ) {
        const events = runtime(record).events;
        const sequence =
          Math.max(
            0,
            ...events
              .filter((event) => event.runId === runId)
              .map((event) => event.sequence),
          ) + 1;
        events.push({
          id: `${runId}-${sequence}`,
          runId,
          sequence,
          type,
          data,
        });
      }
      function draftInput(record: ConversationRecord): ConversationInput {
        return {
          text: record.draft,
          attachments: record.runtime?.draftAttachments ?? [],
          references: record.runtime?.draftReferences ?? [],
        };
      }
      function setDraftInput(
        record: ConversationRecord,
        input: ConversationInput,
      ) {
        record.draft = input.text;
        runtime(record).draftAttachments = structuredClone(input.attachments);
        runtime(record).draftReferences = structuredClone(input.references);
      }
      const nativePayload = (value: unknown) =>
        JSON.stringify(value, (_key, item: unknown) =>
          item && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(
                Object.entries(item).sort(([left], [right]) =>
                  left.localeCompare(right),
                ),
              )
            : item,
        );
      function userMessage(
        input: ConversationInput,
        timestamp: number,
      ): UserMessage {
        if (!input.attachments.length)
          return { role: "user", content: input.text, timestamp };
        const content: (TextContent | ImageContent)[] = input.text
          ? [{ type: "text", text: input.text }]
          : [];
        for (const attachment of input.attachments) {
          if (attachment.mimeType.startsWith("image/"))
            content.push({
              type: "image",
              data: `attachment:${attachment.id}`,
              mimeType: attachment.mimeType,
            });
          else
            content.push({
              type: "text",
              text: `${attachment.name}\n${new TextDecoder().decode(new Uint8Array(nativeAttachments.get(attachment.id)?.bytes ?? []))}`,
            });
        }
        return { role: "user", content, timestamp };
      }
      function beginNativeRun(
        scope: string,
        record: ConversationRecord,
        actionId: string,
        timestamp: number,
        references: ContentReference[] = [],
      ) {
        const selected = status(scope, record.id);
        if (
          !selected.available ||
          !selected.selectedModel ||
          selected.modelError
        )
          throw selected.modelError ?? "native.ai.access.required";
        nativeRequests.push({
          scope,
          conversation: record.id,
          actionId,
          config: structuredClone(selected.config),
          model: selected.selectedModel,
          thinking: selected.thinkingLevel,
        });
        runtime(record).runs.push({
          id: actionId,
          state: "running",
          startedAt: timestamp,
          usage: [],
          references,
        });
        nativeEvent(record, actionId, "work_block_start", {
          workId: actionId,
          startMessageCount: record.messages.length,
          startedAt: timestamp,
        });
        Object.assign(nativeState(scope, record.id), {
          actionId,
          taskActive: true,
          questionBusy: false,
          phase: "running",
          error: null,
          partialMessage: null,
        });
      }
      function recallNative(record: ConversationRecord) {
        const pending = runtime(record).pending;
        const ordered = ["steering", "followUp"].flatMap((kind) =>
          pending.filter(
            (input) => input.state === "pending" && input.kind === kind,
          ),
        );
        const draft = draftInput(record);
        setDraftInput(record, {
          text: [...ordered.map((input) => input.text), draft.text]
            .filter(Boolean)
            .join("\n\n"),
          attachments: [
            ...new Map(
              [
                ...ordered.flatMap((input) => input.attachments),
                ...draft.attachments,
              ].map((attachment) => [attachment.id, attachment]),
            ).values(),
          ],
          references: [
            ...new Map(
              [
                ...ordered.flatMap((input) => input.references ?? []),
                ...draft.references,
              ].map((reference) => [nativePayload(reference), reference]),
            ).values(),
          ],
        });
        runtime(record).pending = pending.filter(
          (input) => input.state === "consumed",
        );
      }
      function finishNative(
        scope: string,
        id: string,
        text: string | null = options.aiResponseText ??
          "A streamed test response.",
        cancelled = false,
      ): ConversationSnapshot {
        const record = structuredClone(conversation(scope, id));
        const owner = nativeState(scope, id);
        const run = record.runtime?.runs.find(
          (run) => run.id === owner.actionId && run.state === "running",
        );
        if (!run && !owner.questionBusy && !owner.taskActive)
          return nativeSnapshot(scope, id);
        const message = cancelled
          ? owner.partialMessage
          : text === null
            ? null
            : {
                role: "assistant" as const,
                content: [{ type: "text" as const, text }],
                timestamp: owner.partialMessage?.timestamp ?? Date.now(),
                usage: null,
                stopReason: "stop" as const,
              };
        if (message)
          record.messages.push({
            ...structuredClone(message),
            stopReason: cancelled ? "aborted" : "stop",
          });
        if (run) {
          run.state = cancelled
            ? "interrupted"
            : options.aiRequestError
              ? "error"
              : "completed";
          run.endedAt = Math.max(run.startedAt, Date.now());
          const start = runtime(record).events.find(
            (event) =>
              event.runId === run.id && event.type === "work_block_start",
          )?.data as { startMessageCount?: number } | undefined;
          nativeEvent(record, run.id, "work_block_end", {
            workId: run.id,
            startMessageCount: start?.startMessageCount ?? 0,
            messageCount: record.messages.length,
            durationMs: 1200,
            outcome: cancelled
              ? "cancelled"
              : options.aiRequestError
                ? "error"
                : "complete",
          });
          nativeEvent(record, run.id, "execution_finished", {
            state: run.state,
          });
        }
        return nativeSave(scope, record, {
          taskActive: false,
          questionBusy: false,
          partialMessage: null,
          activityComment: "",
          phase: responseSaveBlocked
            ? "persistenceFailed"
            : cancelled || options.aiRequestError
              ? "interrupted"
              : "idle",
          error: responseSaveBlocked
            ? "native.ai.conversation.saveFailed"
            : cancelled
              ? null
              : (options.aiRequestError ?? null),
        });
      }
      async function acceptNative(
        scope: string,
        id: string,
        actionId: string,
        action: ConversationAction,
      ): Promise<ConversationSnapshot> {
        if (action.version !== 1) throw "native.ai.conversation.versionInvalid";
        const key = `${nativeKey(scope, id)}:${actionId}`;
        const payload = nativePayload(action);
        const owner = nativeState(scope, id);
        const previous = nativeReceipts.get(key);
        if (previous !== undefined) {
          if (previous !== payload) throw "native.ai.conversation.conflict";
          if (owner.phase === "persistenceFailed")
            throw "native.ai.conversation.saveFailed";
          return nativeSnapshot(scope, id);
        }
        if (
          owner.phase === "persistenceFailed" &&
          action.type !== "retryPersistence"
        )
          throw "native.ai.conversation.saveFailed";
        const record = structuredClone(conversation(scope, id));
        const retained = runtime(record);
        const timestamp = Date.now();
        switch (action.type) {
          case "draft":
            if (
              nativePayload(draftInput(record)) !==
              nativePayload(action.expected)
            )
              throw "native.ai.conversation.conflict";
            setDraftInput(record, action.input);
            break;
          case "submit":
            if (owner.taskActive || owner.questionBusy)
              throw "native.ai.response.finishFirst";
            if (!record.title)
              record.title = Array.from(
                action.input.text.trim().split(/\s+/u).slice(0, 7).join(" "),
              )
                .slice(0, 60)
                .join("");
            beginNativeRun(
              scope,
              record,
              actionId,
              action.timestamp,
              action.input.references,
            );
            record.messages.push(userMessage(action.input, action.timestamp));
            retained.pending.push({
              id: actionId,
              kind: "steering",
              state: "consumed",
              ...structuredClone(action.input),
              timestamp: action.timestamp,
            });
            if (
              nativePayload(draftInput(record)) === nativePayload(action.input)
            )
              setDraftInput(record, {
                text: "",
                attachments: [],
                references: [],
              });
            nativeEvent(record, actionId, "input_accepted", {
              input: action.input,
            });
            break;
          case "enqueue":
            retained.pending.push({
              id: actionId,
              kind: action.kind,
              state: "pending",
              ...structuredClone(action.input),
              timestamp: action.timestamp,
            });
            if (
              nativePayload(draftInput(record)) === nativePayload(action.input)
            )
              setDraftInput(record, {
                text: "",
                attachments: [],
                references: [],
              });
            if (!owner.taskActive) recallNative(record);
            break;
          case "recall":
            recallNative(record);
            break;
          case "cancel":
            if (owner.actionId !== action.runId)
              throw "native.ai.turn.inactive";
            nativeReceipts.set(key, payload);
            nativeEvent(record, actionId, "action_accepted", { action });
            conversations.set(nativeKey(scope, id), record);
            return finishNative(scope, id, null, true);
          case "retryPersistence":
            if (owner.taskActive || owner.questionBusy)
              throw "native.ai.response.finishFirst";
            if (responseSaveBlocked) throw "native.ai.conversation.saveFailed";
            Object.assign(owner, { phase: "idle", error: null });
            break;
          case "renameTitle":
            if (record.title !== action.expected)
              throw "native.ai.conversation.conflict";
            record.title = action.title;
            record.titleInput = action.title;
            break;
          case "presentQuestion":
            if (
              retained.events.some(
                (event) =>
                  event.type === "question_presented" &&
                  (event.data as { id: string }).id === action.question.id,
              )
            )
              throw "chatQuestion.stale";
            nativeEvent(record, actionId, "question_presented", {
              ...action.question,
              timestamp,
            });
            break;
          case "answerQuestion": {
            const presented = [...retained.events]
              .reverse()
              .find(
                (event) =>
                  event.type === "question_presented" &&
                  (event.data as { id: string }).id ===
                    action.response.questionId,
              );
            if (
              !presented ||
              retained.events.some(
                (event) =>
                  ["question_answered", "question_superseded"].includes(
                    event.type,
                  ) &&
                  (event.data as { questionId: string }).questionId ===
                    action.response.questionId,
              )
            )
              throw "chatQuestion.stale";
            const question = presented.data as ConversationQuestion;
            const choice =
              action.response.choiceId === undefined
                ? undefined
                : question.suggestions?.find(
                    (choice) => choice.id === action.response.choiceId,
                  );
            if (action.response.choiceId !== undefined && !choice)
              throw "chatQuestion.invalid";
            const accepted = choice
              ? { text: choice.label, attachments: [], references: [] }
              : action.input;
            record.messages.push(userMessage(accepted, action.timestamp));
            retained.pending.push({
              id: actionId,
              kind: "steering",
              state: "consumed",
              ...structuredClone(accepted),
              timestamp: action.timestamp,
            });
            if (nativePayload(draftInput(record)) === nativePayload(accepted))
              setDraftInput(record, {
                text: "",
                attachments: [],
                references: [],
              });
            nativeEvent(record, actionId, "question_answered", {
              questionId: question.id,
              inputId: actionId,
              answer: {
                text: accepted.text,
                ...(choice ? { choiceId: choice.id } : {}),
              },
              response: action.response,
            });
            Object.assign(owner, {
              actionId,
              questionBusy: question.context !== undefined,
              error: null,
            });
            if (question.context === undefined) {
              nativeEvent(record, actionId, "question_action_completed", {
                questionId: question.id,
              });
              if (status(scope, id).available)
                beginNativeRun(
                  scope,
                  record,
                  actionId,
                  action.timestamp,
                  accepted.references,
                );
            }
            break;
          }
          case "retryQuestionAction": {
            const answered = retained.events.some(
              (event) =>
                event.type === "question_answered" &&
                (event.data as { questionId: string }).questionId ===
                  action.questionId,
            );
            if (
              !answered ||
              retained.events.some(
                (event) =>
                  event.type === "question_action_completed" &&
                  (event.data as { questionId: string }).questionId ===
                    action.questionId,
              )
            )
              throw "chatQuestion.stale";
            Object.assign(owner, { actionId, questionBusy: true, error: null });
            break;
          }
          case "supersedeQuestion":
            nativeEvent(record, actionId, "question_superseded", {
              questionId: action.questionId,
            });
            break;
          case "notifyPluginAvailable": {
            const plugin = pluginsFor(scope).plugins.find(
              (plugin) =>
                plugin.id === action.pluginId &&
                plugin.enabled &&
                plugin.manifest,
            );
            if (!plugin?.manifest) throw "native.ai.tool.unavailable";
            nativeEvent(
              record,
              owner.actionId ?? actionId,
              "plugin_available",
              {
                pluginId: plugin.id,
                pluginName: plugin.manifest.name,
                timestamp,
              },
            );
            break;
          }
          default:
            throw "native.ai.conversation.versionInvalid";
        }
        nativeEvent(record, actionId, "action_accepted", { action });
        nativeReceipts.set(key, payload);
        return nativeSave(scope, record);
      }
      const nativeFixture: NativeConversationFixture = {
        getRecord(scope, id) {
          return structuredClone(conversation(scope, id));
        },
        saveRecord: nativeSave,
        snapshot: nativeSnapshot,
        publish: nativePublish,
        accept: acceptNative,
        finish(scope, id, text) {
          return finishNative(scope, id, text);
        },
        requests() {
          return structuredClone(nativeRequests);
        },
      };
      Reflect.set(window, "__nativeConversationFixture", nativeFixture);
      function respondNative(scope: string, id: string) {
        const owner = nativeState(scope, id);
        const actionId = owner.actionId;
        if (!owner.taskActive) return;
        if (options.aiRequestError) {
          finishNative(scope, id, null);
          return;
        }
        const text = options.aiResponseText ?? "A streamed test response.";
        nativePublish(scope, id, {
          partialMessage: {
            role: "assistant",
            content: [{ type: "text", text }],
            timestamp: Date.now(),
            usage: null,
            stopReason: "pending",
          },
          activityComment:
            options.aiComment && settingsFor(scope).generatedComments
              ? options.aiComment
              : "",
        });
        const finish = () => {
          if (
            nativeState(scope, id).taskActive &&
            nativeState(scope, id).actionId === actionId
          )
            finishNative(scope, id, text);
        };
        if (options.aiHoldResponse || options.aiHoldPartialResponse)
          Reflect.set(window, "__finishResponse", finish);
        else setTimeout(finish, 0);
      }

      const parent = options.parent ?? {
        id: "documents",
        name: "Documents",
        display: "/Documents",
      };
      const callbacks = new Map<number, (event: unknown) => void>();
      const updateListeners = new Set<number>();
      const updates: UpdateSnapshot = {
        supported: false,
        installedVersion: "1.0.0",
        phase: "current",
        availableVersion: null,
        artifactId: null,
        downloadedBytes: 0,
        totalBytes: null,
        lastSuccessfulCheck: null,
        error: null,
        runningActions: false,
        ...options.updates,
      };
      Object.defineProperty(window, "__updatesTest", {
        value: {
          change(value: Partial<UpdateSnapshot>) {
            Object.assign(updates, value);
            for (const id of updateListeners)
              callbacks.get(id)?.({
                event: "updates-changed",
                id,
                payload: structuredClone(updates),
              });
          },
          listenerCount: () => updateListeners.size,
        },
      });
      const appearanceListeners = new Set<number>();
      const dictationListeners = new Map<number, string>();
      const dictation = {
        supported: true,
        model: options.dictationModel ?? "waiting",
        progress: 0,
        busy: false,
        owner: null as null | {
          id: string;
          scope: string;
          conversation: string;
          phase: string;
        },
      };
      const dictationEvent = (event: string, payload: unknown) => {
        for (const [id, name] of dictationListeners)
          if (name === event) callbacks.get(id)?.({ event, id, payload });
      };
      const completeDictation = (text?: string, notice?: string) => {
        const id = dictation.owner?.id;
        dictation.owner = null;
        dictation.busy = false;
        dictationEvent("dictation-result", { id, text, notice });
        dictationEvent("dictation-changed", null);
      };
      Object.defineProperty(window, "__dictationTest", {
        value: {
          complete: completeDictation,
          level: (level: number, id = dictation.owner?.id) => {
            dictationEvent("dictation-level", { id, level });
          },
          model: (model: string, progress = 0) => {
            Object.assign(dictation, { model, progress });
            dictationEvent("dictation-changed", null);
          },
        },
      });
      const recoveryListeners = new Set<number>();
      const recovery = {
        revision: 0,
        recovery: options.recovery ?? false,
        resumed: [] as [string, string][],
      };
      const blocked = (scope: string, plugin: string) =>
        recovery.recovery &&
        !recovery.resumed.some(
          ([owner, id]) => owner === scope && id === plugin,
        );
      const resumePlugins = (scope: string, plugin?: string) => {
        if (plugin) recovery.resumed.push([scope, plugin]);
        else recovery.recovery = false;
        if (
          [...pluginStates].every(([owner, state]) =>
            state.plugins.every(
              (item) => !item.enabled || !blocked(owner, item.id),
            ),
          )
        )
          recovery.recovery = false;
        recovery.revision++;
        for (const id of recoveryListeners)
          callbacks.get(id)?.({
            event: "plugin-recovery-changed",
            id,
            payload: structuredClone(recovery),
          });
        return structuredClone(recovery);
      };
      let callbackId = 0;
      const appearanceChanged = (scope: string) => {
        for (const id of appearanceListeners)
          callbacks.get(id)?.({
            event: "appearance-changed",
            id,
            payload: { scope },
          });
      };
      Object.defineProperty(window, "__appearanceChanged", {
        value: appearanceChanged,
      });
      Object.defineProperty(window, "__TAURI_INTERNALS__", {
        value: {
          transformCallback: (callback: (event: unknown) => void) => {
            callbacks.set(++callbackId, callback);
            return callbackId;
          },
          unregisterCallback: (id: number) => callbacks.delete(id),
          invoke: async (
            command: string,
            args: Record<string, unknown> = {},
          ) => {
            calls.push({ command, args });
            if (command === "recovery_register")
              return "fixture-recovery-registration";
            if (command === "recovery_open_email") return false;
            if (command === "plugin_recovery_mode") {
              if (options.recoveryError) throw new Error("Startup unavailable");
              return recovery.recovery;
            }
            if (command === "plugin_recovery_state")
              return structuredClone(recovery);
            if (command === "plugin_recovery_resume")
              return resumePlugins(
                String(args.scope),
                typeof args.pluginId === "string" ? args.pluginId : undefined,
              );
            if (command === "plugin:app|version")
              return updates.installedVersion;
            if (command === "updates_snapshot") return structuredClone(updates);
            if (command === "updates_check") {
              if (options.updateCheckError) throw options.updateCheckError;
              return structuredClone(updates);
            }
            if (command === "updates_install") {
              if (!updates.artifactId || args.artifactId !== updates.artifactId)
                throw "native.updates.changed";
              if (options.updateInstallError) throw options.updateInstallError;
              return structuredClone(updates);
            }
            if (command === "plugin:event|listen") {
              if (args.event === "updates-changed")
                updateListeners.add(Number(args.handler));
              if (String(args.event).startsWith("dictation-"))
                dictationListeners.set(
                  Number(args.handler),
                  String(args.event),
                );
              if (args.event === "plugin-recovery-changed")
                recoveryListeners.add(Number(args.handler));
              if (args.event === "appearance-changed")
                appearanceListeners.add(Number(args.handler));
              return Number(args.handler);
            }
            if (command === "plugin:event|unlisten") {
              updateListeners.delete(Number(args.eventId));
              appearanceListeners.delete(Number(args.eventId));
              recoveryListeners.delete(Number(args.eventId));
              dictationListeners.delete(Number(args.eventId));
              return;
            }
            if (command === "dictation_snapshot")
              return structuredClone(dictation);
            if (command === "dictation_start") {
              if (dictation.busy || dictation.model !== "ready")
                throw "dictation.elsewhere";
              dictation.busy = true;
              dictation.owner = {
                id: String(args.id),
                scope: String(args.scope),
                conversation: String(args.conversation),
                phase:
                  options.dictationPermission === "pending"
                    ? "permission"
                    : "recording",
              };
              if (options.dictationPermission === "denied")
                completeDictation(undefined, "denied");
              else dictationEvent("dictation-changed", null);
              return;
            }
            if (command === "dictation_control") {
              if (args.action === "stop" && dictation.owner)
                dictation.owner.phase = "transcribing";
              if (args.action === "discard") completeDictation();
              if (args.action === "retry") dictation.model = "waiting";
              dictationEvent("dictation-changed", null);
              return;
            }
            if (command === "workspace_snapshot") return structuredClone(state);
            if (command === "layout_load")
              return window.__layoutTest.load(String(args.workspaceId));
            if (command === "layout_save")
              return window.__layoutTest.save(
                String(args.workspaceId),
                args.expectedRevision as string | null,
                args.data,
                args.pluginIncarnations as Record<string, string> | undefined,
              );
            if (command === "appearance_snapshot") {
              if (options.appearanceLoadError)
                throw "native.appearance.invalid";
              return structuredClone(
                appearances.get(String(args.scope)) ?? defaultAppearance,
              );
            }
            if (command === "appearance_update") {
              const scope = String(args.scope);
              const current = appearances.get(scope) ?? defaultAppearance;
              if (!current.writable) throw "native.appearance.readOnly";
              if (args.expectedRevision !== current.revision)
                throw "native.appearance.changed";
              if (options.appearanceDeferSave)
                await new Promise<void>((resolve) => {
                  Object.defineProperty(window, "__finishAppearanceSave", {
                    value: resolve,
                    configurable: true,
                  });
                });
              if (options.appearanceSaveError)
                throw "native.appearance.storage";
              const value: AppearanceSnapshot = {
                accent: args.accent as AppearanceSnapshot["accent"],
                writable: true,
                revision: `${current.revision ?? "initial"}-next`,
              };
              appearances.set(scope, value);
              sessionStorage.setItem(
                "appearance-fixture",
                JSON.stringify([...appearances]),
              );
              if (options.appearanceSaveThenFail)
                throw "native.appearance.durability";
              appearanceChanged(scope);
              return structuredClone(value);
            }
            if (command === "localization_snapshot")
              return structuredClone(
                preferences.get(String(args.scope)) ?? defaultPreferences,
              );
            if (command === "localization_update") {
              const current =
                preferences.get(String(args.scope)) ?? defaultPreferences;
              if (!current.writable) throw "native.localization.readOnly";
              const expected = args.expected as
                | {
                    language?: string;
                    formats?: LocalizationSnapshot["formats"];
                  }
                | undefined;
              if (
                expected?.language !== current.language ||
                (["time", "date", "number"] as const).some(
                  (key) => expected?.formats?.[key] !== current.formats[key],
                )
              )
                throw "native.localization.changed";
              const value = {
                ...(args.preferences as LocalizationSnapshot),
                writable: current.writable,
              };
              preferences.set(String(args.scope), value);
              return structuredClone(value);
            }
            if (command === "plugin_executor") {
              const request = args.request as {
                operation: string;
                pluginId?: string;
                exportName?: string;
                generation?: number;
              };
              if (request.operation === "pendingPersistences") return [];
              if (
                request.operation === "activity" ||
                request.operation === "stop"
              )
                return { runningActions: 0 };
              const scope = String(args.scope);
              const plugins = pluginsFor(scope)
                .plugins.filter(
                  (plugin) =>
                    plugin.enabled &&
                    !plugin.error &&
                    plugin.manifest &&
                    !blocked(scope, plugin.id),
                )
                .map((plugin) => ({
                  pluginId: plugin.id,
                  incarnation: plugin.incarnation,
                  revision: plugin.revision ?? null,
                  generation: 1,
                  tools: [],
                  exports: plugin.manifest?.exports ?? [],
                  source: structuredClone(
                    options.pluginSources?.[plugin.id] ?? {
                      manifest: plugin.manifest,
                      serviceEntry: null,
                      uiEntry: null,
                      skills: [],
                    },
                  ),
                }));
              if (request.operation === "snapshot")
                return { plugins, unavailable: [] };
              if (request.operation === "invoke") {
                const plugin = plugins.find(
                  (plugin) =>
                    plugin.pluginId === request.pluginId &&
                    plugin.generation === request.generation,
                );
                const values =
                  options.pluginExportResults?.[String(request.pluginId)];
                if (
                  !plugin ||
                  !plugin.exports.includes(String(request.exportName)) ||
                  !values ||
                  !Object.hasOwn(values, String(request.exportName))
                )
                  throw "native.plugins.unavailable";
                return {
                  outcome: "completed",
                  value: structuredClone(values[String(request.exportName)]),
                };
              }
              throw "native.plugins.unavailable";
            }
            if (command === "plugin_runtime") {
              const request = args.request as {
                operation: string;
                pluginId?: string;
                enabled?: boolean;
                expectedRevision?: string | null;
              };
              const state = pluginsFor(String(args.scope));
              if (request.operation === "list") {
                if (options.pluginListError) throw options.pluginListError;
                return structuredClone(state);
              }
              const plugin = state.plugins.find(
                (item) => item.id === request.pluginId,
              );
              if (!plugin) throw "native.plugins.unavailable";
              if (request.operation === "setEnabled") {
                if (request.expectedRevision !== state.revision)
                  throw "native.plugins.stateConflict";
                plugin.enabled = request.enabled === true;
                if (plugin.enabled)
                  resumePlugins(String(args.scope), plugin.id);
                state.revision = `plugins-${++pluginRevision}`;
                return { revision: state.revision };
              }
              if (blocked(String(args.scope), plugin.id))
                throw "native.plugins.recoveryBlocked";
              if (!plugin.enabled) throw "native.plugins.disabled";
              if (request.operation === "check") return { enabled: true };
              if (request.operation === "load" && plugin.manifest)
                return structuredClone(
                  options.pluginSources?.[plugin.id] ?? {
                    manifest: plugin.manifest,
                    serviceEntry: null,
                    uiEntry: null,
                    skills: [],
                  },
                );
              throw "native.plugins.unavailable";
            }
            if (command === "plugin_disable") {
              const request = args.request as PluginDisableRequest;
              const scope = String(args.scope);
              if (request.operation === "begin") {
                if (request.expectedRevision !== pluginsFor(scope).revision)
                  throw "native.plugins.stateConflict";
                const phase = nextDisablePhase ?? "disabled";
                if (phase === "failed") nextDisablePhase = undefined;
                const disable: PluginDisableSnapshot = {
                  id: request.id,
                  pluginId: request.pluginId,
                  phase,
                  runningActions:
                    phase === "waiting"
                      ? structuredClone(
                          options.pluginDisableRunningActions ?? [
                            { pluginId: request.pluginId, count: 1 },
                          ],
                        )
                      : [],
                  pendingRequests: 0,
                  error:
                    phase === "failed"
                      ? "native.plugins.stateSaveFailed"
                      : null,
                };
                pluginDisables.set(scope, disable);
                if (phase === "disabled") saveDisabled(scope, request.pluginId);
              }
              const disable = pluginDisables.get(scope);
              if (!disable || disable.id !== request.id)
                throw "native.plugins.unavailable";
              if (request.operation === "cancel" && disable.phase === "waiting")
                disable.phase = "cancelled";
              if (
                request.operation === "status" &&
                disable.phase === "uncertain" &&
                options.pluginDisableDeferCheck
              )
                await new Promise<void>((resolve) => {
                  Reflect.set(window, "__releasePluginDisableCheck", resolve);
                });
              return structuredClone(disable);
            }
            if (command === "plugin_action") {
              const request = args.request as { operation: string };
              return request.operation === "begin"
                ? { actionId: crypto.randomUUID() }
                : null;
            }
            if (command === "plugin_host_request") {
              if (!pluginHosts.has(String(args.hostId)))
                throw "native.plugins.unavailable";
              const request = args.request as { operation: string };
              if (request.operation !== "process")
                throw "native.plugins.unavailable";
              const output = (text: string) => ({
                text,
                capturedBytes: new TextEncoder().encode(text).length,
                totalBytes: new TextEncoder().encode(text).length,
                truncated: false,
                incomplete: false,
              });
              return {
                isError: false,
                commandResult: {
                  Ok: {
                    outcome: "exited",
                    exitCode: 0,
                    signal: null,
                    stdout: output("A small reading list"),
                    stderr: output(""),
                  },
                },
                beforeHistoryRevision: null,
                afterHistoryRevision: null,
                reconciliationError: null,
                attribution: "uncertainExternalChangesMayCoexist",
              };
            }
            if (command === "plugin_host_open") {
              if (
                !args.testId &&
                blocked(String(args.scope), String(args.pluginId))
              )
                throw "native.plugins.recoveryBlocked";
              if (
                !pluginsFor(String(args.scope)).plugins.some(
                  (plugin) => plugin.id === args.pluginId && plugin.enabled,
                )
              )
                throw "native.plugins.disabled";
              const id = crypto.randomUUID();
              pluginHosts.add(id);
              return id;
            }
            if (
              command === "plugin_host_close" ||
              command === "plugin_host_cancel"
            ) {
              if (!pluginHosts.has(String(args.hostId)))
                throw "native.plugins.unavailable";
              if (command === "plugin_host_close")
                pluginHosts.delete(String(args.hostId));
              return null;
            }
            if (command === "plugins_source") {
              if (options.pluginSourceError) throw options.pluginSourceError;
              const request = args.request as {
                operation: string;
                pluginId: string;
                path?: string;
              };
              if (
                !pluginsFor(String(args.scope)).plugins.some(
                  (item) => item.id === request.pluginId,
                )
              )
                throw "native.plugins.unavailable";
              const files = options.pluginSourceFiles?.[request.pluginId] ?? {};
              if (request.operation === "files") {
                const directories = new Set(
                  Object.keys(files).flatMap((path) => {
                    const parts = path.split("/");
                    return parts
                      .slice(0, -1)
                      .map((_, index) => parts.slice(0, index + 1).join("/"));
                  }),
                );
                return {
                  files: [
                    ...[...directories].map((path) => ({
                      path,
                      isDirectory: true,
                    })),
                    ...Object.keys(files).map((path) => ({
                      path,
                      isDirectory: false,
                    })),
                  ],
                };
              }
              if (
                request.operation === "read" &&
                request.path &&
                Object.hasOwn(files, request.path)
              )
                return { text: files[request.path] };
              throw "native.plugins.readFailed";
            }
            if (command === "workspace_file_tool") {
              const request = args.request as { operation: string };
              if (request.operation === "capabilities")
                return {
                  writable: true,
                  history: true,
                  conversations: true,
                  shell: { available: false },
                };
              if (request.operation === "instructions") return { text: "" };
              throw new Error(
                "Unexpected workspace tool operation: " + request.operation,
              );
            }
            if (command === "files_request") {
              const request = args.request as {
                operation: string;
                workspaceId: string;
                pluginId?: string;
                path?: string;
              };
              if (request.pluginId) {
                if (options.pluginSourceError) throw options.pluginSourceError;
                if (
                  !pluginsFor(request.workspaceId).plugins.some(
                    (item) => item.id === request.pluginId,
                  )
                )
                  throw "native.plugins.unavailable";
                const files =
                  options.pluginSourceFiles?.[request.pluginId] ?? {};
                if (request.operation === "snapshot") {
                  const folders = new Set(
                    Object.keys(files).flatMap((path) => {
                      const parts = path.split("/");
                      return parts
                        .slice(0, -1)
                        .map((_, index) => parts.slice(0, index + 1).join("/"));
                    }),
                  );
                  return {
                    status: "ok",
                    snapshot: {
                      writable: false,
                      reason: null,
                      drafts: [],
                      entries: [
                        ...[...folders].map((path) => ({
                          path,
                          isDirectory: true,
                        })),
                        ...Object.keys(files).map((path) => ({
                          path,
                          isDirectory: false,
                        })),
                      ],
                    },
                  };
                }
                if (
                  request.operation === "read" &&
                  request.path &&
                  Object.hasOwn(files, request.path)
                ) {
                  const text = files[request.path]!;
                  if (text.includes("\0")) return { status: "binary" };
                  const escape = (value: string) =>
                    value
                      .replaceAll("&", "&amp;")
                      .replaceAll("<", "&lt;")
                      .replaceAll(">", "&gt;");
                  const html = /\.(?:md|markdown)$/iu.test(request.path)
                    ? text
                        .split("\n")
                        .map((line) =>
                          line.startsWith("# ")
                            ? `<h1>${escape(line.slice(2))}</h1>`
                            : `<p>${escape(line)}</p>`,
                        )
                        .join("")
                    : "";
                  return {
                    status: "ok",
                    document: {
                      path: request.path,
                      version: { text, revision: "plugin-source" },
                      html,
                      issues: [],
                    },
                  };
                }
                if (request.operation === "openExternal")
                  return { status: "ok" };
                throw "native.plugins.readFailed";
              }
              if (request.operation === "snapshot")
                return {
                  status: "ok",
                  snapshot: {
                    writable: true,
                    canExport: !state.mobile,
                    reason: null,
                    entries: [],
                    drafts: [],
                    deleted: [],
                  },
                };
              if (request.operation === "detach") return { status: "ok" };
              throw new Error(
                "Unexpected files operation: " + request.operation,
              );
            }
            if (command === "ai_settings_load")
              return structuredClone(
                settingsFor(
                  String(args.scope),
                  args.connectionId as string | undefined,
                ),
              );
            if (command === "ai_settings_save") {
              if (options.aiDeferSelection)
                await new Promise<void>((resolve) => {
                  Object.defineProperty(window, "__finishModelSelection", {
                    value: resolve,
                    configurable: true,
                  });
                });
              if (selectionFailures-- > 0)
                throw new Error("Synthetic model selection failure");
              const scope = String(args.scope);
              const settings = JSON.parse(
                JSON.stringify(args.settings),
              ) as WorkspaceAiSettings;
              if (
                args.connectionId &&
                args.connectionId !== connections.get(scope)?.connectionId
              ) {
                settingsFor(scope, String(args.connectionId));
                perConnectionSettings.set(
                  `${scope}:${args.connectionId}`,
                  settings,
                );
              } else {
                aiSettings.set(scope, settings);
                if (settings.chat)
                  selectedModels.set(scope, settings.chat.model);
                else selectedModels.delete(scope);
              }
              modelErrors.delete(scope);
              return structuredClone(settings);
            }
            if (command === "ai_status") {
              if (selectionReadbackFailed)
                throw new Error("Synthetic selection readback failure");
              return status(
                String(args.scope),
                typeof args.conversation === "string"
                  ? args.conversation
                  : undefined,
              );
            }
            if (
              command === "ai_select_conversation_model" ||
              command === "ai_select_conversation_thinking"
            ) {
              const scope = String(args.scope),
                id = String(args.conversation);
              if (options.aiDeferSelection)
                await new Promise<void>((resolve) => {
                  Object.defineProperty(window, "__finishModelSelection", {
                    value: resolve,
                    configurable: true,
                  });
                });
              const fail = selectionFailures-- > 0;
              if (fail && !options.aiSelectionSaveThenFail) {
                selectionReadbackFailed =
                  options.aiSelectionReadbackError ?? false;
                throw new Error("Synthetic model selection failure");
              }
              const key = `${scope}:${id}`;
              const preferences = localChoices.get(key) ?? { thinking: {} };
              const current = status(scope, id);
              if (command === "ai_select_conversation_model") {
                if (args.model === null) delete preferences.model;
                else {
                  if (!current.config?.connectionId)
                    throw "native.ai.access.required";
                  preferences.model = {
                    connectionId: current.config.connectionId,
                    model: String(args.model),
                  };
                }
              } else {
                const key = `${current.config?.connectionId}/${current.selectedModel}`;
                if (args.thinking === null) delete preferences.thinking[key];
                else preferences.thinking[key] = String(args.thinking);
              }
              localChoices.set(key, preferences);
              modelErrors.delete(scope);
              if (fail) {
                selectionReadbackFailed =
                  options.aiSelectionReadbackError ?? false;
                throw new Error("Synthetic uncertain model save");
              }
              selectionReadbackFailed = false;
              return status(scope, id);
            }
            if (command === "ai_rename_connection") {
              const scope = String(args.scope),
                id = String(args.connectionId),
                label = String(args.label).trim();
              const config = records.get(scope)?.get(id);
              if (
                !config ||
                !label ||
                [...records.get(scope)!.values()].some(
                  (item) =>
                    item.connectionId !== id &&
                    item.label?.toLowerCase() === label.toLowerCase(),
                )
              )
                throw "native.ai.connection.labelInvalid";
              config.label = label;
              return status(scope, undefined, config);
            }
            if (command === "ai_refresh_models") {
              if (options.aiRefreshError) throw options.aiRefreshError;
              const scope = String(args.scope);
              const id =
                (args.connectionId as string | undefined) ??
                connections.get(scope)?.connectionId;
              if (!id || !records.get(scope)?.has(id))
                throw "native.ai.access.required";
              const result = catalogRefreshes[id]?.shift();
              if (!result)
                throw new Error(
                  "Model refresh is not configured in this fixture.",
                );
              catalogs.set(`${scope}:${id}`, result);
              return status(scope, undefined, records.get(scope)!.get(id));
            }
            if (command === "ai_connections") {
              const scope = String(args.scope);
              return [...(records.get(scope)?.values() ?? [])].map(
                (config) => ({
                  ...status(scope, undefined, config),
                  available: !forgotten.has(`${scope}:${config.connectionId}`),
                  reason: forgotten.has(`${scope}:${config.connectionId}`)
                    ? "native.ai.access.required"
                    : null,
                }),
              );
            }
            if (command === "ai_select_connection") {
              const scope = String(args.scope);
              const config = records.get(scope)?.get(String(args.connectionId));
              if (!config) throw "native.ai.access.required";
              selectRecord(scope, config);
              return status(scope);
            }
            if (command === "ai_forget_connection") {
              const scope = String(args.scope);
              forgotten.add(`${scope}:${args.connectionId}`);
              return status(
                scope,
                undefined,
                records.get(scope)?.get(String(args.connectionId)),
              );
            }
            if (command === "ai_save") {
              if (options.aiSaveError)
                throw new Error("Synthetic save failure");
              const scope = String(args.scope),
                config = args.config as Config;
              return status(scope, undefined, saveRecord(scope, config));
            }
            if (command === "ai_select_model") {
              if (options.aiDeferSelection)
                await new Promise<void>((resolve) => {
                  Object.defineProperty(window, "__finishModelSelection", {
                    value: resolve,
                    configurable: true,
                  });
                });
              if (selectionFailures-- > 0)
                throw new Error("Synthetic model selection failure");
              const scope = String(args.scope);
              if (!connections.has(scope)) throw new Error("No connection");
              selectedModels.set(scope, String(args.model));
              settingsFor(scope).chat = {
                model: String(args.model),
                thinking: "off",
                catalogRevision: null,
              };
              modelErrors.delete(scope);
              return status(scope);
            }
            if (command === "ai_openai_start") {
              if (!options.aiLoginOutcome)
                throw new Error(
                  "Browser sign-in is not configured in this fixture.",
                );
              const id = `login-${++loginSequence}`;
              logins.set(id, {
                scope: String(args.scope),
                cancelled: false,
                connectionId: args.connectionId as string | undefined,
                label: args.label as string | undefined,
              });
              return id;
            }
            if (command === "ai_openai_wait") {
              const login = logins.get(String(args.id));
              if (!login || login.scope !== args.scope || login.cancelled)
                throw "native.ai.login.cancelled";
              if (options.aiLoginOutcome === "denied")
                throw "native.ai.login.denied";
              if (options.aiLoginOutcome === "pending")
                return new Promise((_resolve, reject) => {
                  login.cancel = () => reject("native.ai.login.cancelled");
                });
              const config: Config = {
                provider: "openai",
                endpoint: null,
                auth: "oauth",
                connectionId: login.connectionId,
                label: login.label,
              };
              return status(
                login.scope,
                undefined,
                saveRecord(login.scope, config),
              );
            }
            if (command === "ai_codex_start") {
              if (!options.aiDeviceOutcome)
                throw new Error(
                  "Device sign-in is not configured in this fixture.",
                );
              const id = `device-${++loginSequence}`;
              logins.set(id, {
                scope: String(args.scope),
                cancelled: false,
                connectionId: args.connectionId as string | undefined,
                label: args.label as string | undefined,
              });
              return {
                id,
                userCode: "FAKE-CODE",
                verificationUri: "https://example.invalid/device",
                expiresAt: 4102444800,
              };
            }
            if (command === "ai_codex_open") {
              const login = logins.get(String(args.id));
              if (!login || login.scope !== args.scope || login.cancelled)
                throw "native.ai.login.cancelled";
              return;
            }
            if (command === "ai_codex_wait") {
              const login = logins.get(String(args.id));
              if (!login || login.scope !== args.scope || login.cancelled)
                throw "native.ai.login.cancelled";
              if (options.aiDeviceOutcome === "denied")
                throw "native.ai.login.denied";
              if (options.aiDeviceOutcome === "timeout")
                throw "native.ai.login.timeout";
              const finish = () => {
                const saved = saveRecord(login.scope, {
                  provider: "openai-codex",
                  endpoint: null,
                  auth: "oauth",
                  connectionId: login.connectionId,
                  label: login.label,
                });
                return status(login.scope, undefined, saved);
              };
              if (options.aiDeviceOutcome === "pending")
                return new Promise((resolve, reject) => {
                  login.cancel = () => reject("native.ai.login.cancelled");
                  Object.defineProperty(window, "__finishDeviceLogin", {
                    configurable: true,
                    value: () => {
                      if (!login.cancelled) resolve(finish());
                    },
                  });
                });
              return finish();
            }
            if (
              command === "ai_openai_cancel" ||
              command === "ai_codex_cancel"
            ) {
              const login = logins.get(String(args.id));
              if (login && login.scope === args.scope) {
                login.cancelled = true;
                login.cancel?.();
              }
              return;
            }
            if (command === "ai_remove") {
              const scope = String(args.scope);
              const id = String(
                args.connectionId ?? connections.get(scope)?.connectionId,
              );
              records.get(scope)?.delete(id);
              perConnectionSettings.delete(`${scope}:${id}`);
              if (connections.get(scope)?.connectionId === id) {
                connections.delete(scope);
                selectedModels.delete(scope);
                aiSettings.delete(scope);
              }
              return;
            }
            if (command === "ai_conversations") {
              if (!initial.onboarding) conversation(String(args.scope));
              return [...conversations.entries()]
                .filter(([key]) => key.startsWith(`${args.scope}:`))
                .map(([, record]) => ({
                  id: record.id,
                  title: record.title,
                  revision: record.revision,
                  ...(record.development
                    ? { development: record.development }
                    : {}),
                }));
            }
            if (command === "change_list") {
              const changes =
                options.changeLists?.[String(args.before)]?.[
                  String(args.after)
                ];
              if (!changes) throw "native.content.history.unavailable";
              return {
                status: "ready",
                changes: changes.map((change) => ({
                  store: "workspace",
                  operation: change.operation,
                  before:
                    change.operation === "added"
                      ? null
                      : { path: change.path, revision: args.before },
                  after:
                    change.operation === "deleted"
                      ? null
                      : { path: change.path, revision: args.after },
                  attribution: "uncertain",
                })),
              };
            }
            if (command === "change_revision") {
              const path = args.pluginId
                ? `.situate/plugins/${args.pluginId}/code/${args.path}`
                : String(args.path);
              const text =
                options.changeRevisions?.[String(args.revision)]?.[path];
              if (text === undefined)
                throw "native.content.history.unavailable";
              return text === null
                ? { status: "unsupported" }
                : { status: "available", text };
            }
            if (command === "plugin_development_create") {
              const request = args.request as {
                developmentId: string;
                pluginId?: string;
                title: string;
              };
              const record: ConversationRecord = {
                version: 2,
                id: request.developmentId,
                title: request.title,
                titleInput: "",
                revision: 0,
                messages: [],
                draft: "",
                development: {
                  version: 2,
                  ...(request.pluginId ? { pluginId: request.pluginId } : {}),
                },
              };
              conversations.set(`${args.scope}:${record.id}`, record);
              persistNative();
              return { conversation: structuredClone(record), ready: true };
            }
            if (command === "ai_preview_conversation_status")
              return status(String(args.scope), undefined, undefined, {
                model: args.model as string | null,
                thinking: args.thinking as string | null,
              });
            if (command === "ai_create_conversation") {
              const initial = args.initial as
                | {
                    draft: string;
                    attachments?: AttachmentRef[];
                    references?: ContentReference[];
                    development?: ConversationRecord["development"];
                  }
                | undefined;
              if (
                initial &&
                Object.keys(initial).some(
                  (key) =>
                    ![
                      "draft",
                      "attachments",
                      "references",
                      "development",
                    ].includes(key),
                )
              )
                throw "native.ai.conversation.versionInvalid";
              const record: ConversationRecord = {
                version: 2,
                id: String(args.id),
                title: String(args.title),
                revision: 0,
                messages: [],
                draft: initial?.draft ?? "",
                runtime: {
                  draftAttachments: structuredClone(initial?.attachments ?? []),
                  ...(initial?.references?.length
                    ? { draftReferences: structuredClone(initial.references) }
                    : {}),
                  pending: [],
                  events: [],
                  runs: [],
                },
                ...(initial?.development
                  ? { development: initial.development }
                  : {}),
              };
              conversations.set(`${args.scope}:${args.id}`, record);
              persistNative();
              return structuredClone(record);
            }
            if (command === "ai_conversation")
              throw new Error("Unexpected IPC: ai_conversation");
            if (command === "ai_conversation_read") {
              if (
                Object.keys(args).some(
                  (key) => !["scope", "conversation"].includes(key),
                )
              )
                throw "native.ai.conversation.versionInvalid";
              const loadError =
                options.aiConversationLoadErrors?.[String(args.conversation)];
              if (loadError) throw loadError;
              return structuredClone(
                conversation(String(args.scope), String(args.conversation)),
              );
            }
            if (
              command === "ai_conversation_snapshot" ||
              command === "ai_conversation_subscribe"
            ) {
              const scope = String(args.scope),
                id = String(args.conversation);
              const error = options.aiConversationLoadErrors?.[id];
              if (error) throw error;
              if (command === "ai_conversation_subscribe")
                nativeChannels.set(nativeKey(scope, id), {
                  subscription: crypto.randomUUID(),
                  onmessage: (event: unknown) =>
                    (
                      args.channel as { onmessage: (event: unknown) => void }
                    ).onmessage(event),
                });
              const snapshot = nativeSnapshot(scope, id);
              persistNative();
              if (
                snapshot.taskActive &&
                (options.aiHoldResponse || options.aiHoldPartialResponse)
              )
                Reflect.set(window, "__finishResponse", () =>
                  finishNative(scope, id),
                );
              return snapshot;
            }
            if (command === "ai_conversation_action") {
              const scope = String(args.scope),
                id = String(args.conversation),
                actionId = String(args.actionId);
              const action = args.action as ConversationAction;
              if (args.generation !== nativeState(scope, id).generation)
                throw "native.ai.conversation.conflict";
              const duplicate = nativeReceipts.has(
                `${nativeKey(scope, id)}:${actionId}`,
              );
              const snapshot = await acceptNative(scope, id, actionId, action);
              if (
                !duplicate &&
                ["submit", "answerQuestion"].includes(action.type) &&
                snapshot.taskActive
              )
                setTimeout(() => respondNative(scope, id), 0);
              return snapshot;
            }
            if (command === "ai_model_check") {
              const selected = status(String(args.scope));
              if (
                !selected.available ||
                !selected.selectedModel ||
                selected.modelError
              )
                throw selected.modelError ?? "native.ai.access.required";
              if (options.aiRequestError) throw options.aiRequestError;
              return;
            }
            if (command === "ai_conversations_abort") {
              const scope = String(args.scope);
              for (const [key, owner] of nativeOwners)
                if (
                  key.startsWith(`${scope}:`) &&
                  (owner.taskActive || owner.questionBusy)
                ) {
                  const record = conversations.get(key);
                  if (record) finishNative(scope, record.id, null, true);
                }
              return;
            }
            if (
              command === "ai_conversation_ack" ||
              command === "ai_model_check_cancel" ||
              command === "ai_prepare_close" ||
              command === "ai_cancel_close"
            )
              return;
            if (command === "ai_attachment_put") {
              const reference: AttachmentRef = {
                id: crypto.randomUUID(),
                name: String(args.name),
                mimeType: String(args.mimeType),
                size: (args.bytes as number[]).length,
              };
              nativeAttachments.set(reference.id, {
                reference,
                bytes: args.bytes as number[],
              });
              persistNative();
              return structuredClone(reference);
            }
            if (command === "ai_attachment_read") {
              const stored = nativeAttachments.get(String(args.id));
              if (!stored) throw "native.ai.attachment.unavailable";
              return structuredClone(stored);
            }
            if (command === "workspace_parent")
              return args.pick ? null : parent;
            if (command === "workspace_preflight") {
              if (
                (options.collisions ?? ["Existing"]).includes(String(args.name))
              )
                throw "native.workspace.folder.exists";
              return parent.display + "/" + args.name;
            }
            if (command === "workspace_action") {
              const id = String(args.id);
              if (args.action === "pick") return false;
              if (args.action === "ai-setup-done") {
                state.aiSetup = false;
                return true;
              }
              if (args.action === "entry") {
                state.current = null;
                return true;
              }
              if (args.action === "remove")
                state.known = state.known.filter((w) => w.id !== id);
              if (args.action === "close") {
                state.open = state.open.filter((w) => w.id !== id);
                state.current = state.open[0] ?? null;
              }
              if (args.action === "open") {
                const w = [...state.open, ...state.known].find(
                  (w) => w.id === id,
                )!;
                state.open = [w, ...state.open.filter((o) => o.id !== id)];
                state.current = w;
              }
              if (args.action === "create") {
                if (options.createError) throw options.createError;
                const w = {
                  id: String(args.name),
                  name: String(args.name),
                  display: parent.display + "/" + args.name,
                };
                if (args.accent) {
                  appearances.set(w.id, {
                    accent: args.accent as AppearanceSnapshot["accent"],
                    writable: true,
                    revision: "created",
                  });
                  sessionStorage.setItem(
                    "appearance-fixture",
                    JSON.stringify([...appearances]),
                  );
                }
                state.known.push(w);
                state.open.push(w);
                state.current = w;
                state.aiSetup = true;
              }
              return true;
            }
            throw new Error("Unexpected IPC: " + command);
          },
        },
      });
      Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", {
        value: { unregisterListener: () => {} },
      });
    },
    { initial, options },
  );
}

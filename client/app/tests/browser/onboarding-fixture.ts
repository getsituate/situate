import type { Page } from "./test";
import "@situate/localization/onboarding";
import { t } from "@situate/localization";
import questionCopy from "../../../packages/localization/src/catalogs/en.onboarding-agent.json" with { type: "json" };
import {
  shellState,
  workspaceFixture,
  type NativeConversationFixture,
  type NativeConversationFixturePatch,
} from "./workspace-fixture";
import type { ConversationRecord } from "../../src/ai/conversation-record";
import type {
  ConversationAction,
  ConversationSnapshot,
} from "../../src/ai/native-conversation";
import {
  newOnboardingRecord,
  type OnboardingRecord,
} from "../../src/onboarding/types";

export async function onboardingFixture(
  page: Page,
  options: {
    record?: OnboardingRecord;
    startAtEntry?: boolean;
    connected?: boolean;
    modelProvider?: "custom" | "openai";
    importResult?: boolean;
    importMissing?: string[];
    importFollowUpText?: string;
    noIdeas?: boolean;
    holdResponse?: boolean;
    questionFirst?: boolean;
    clarification?: {
      prompt: string;
      suggestions: { id: string; label: string }[];
    };
    revisedScope?: Pick<
      OnboardingRecord,
      "sourceDescription" | "fresh" | "intent" | "description"
    >;
    holdImportResponse?: boolean;
    holdSupportResponse?: boolean;
    holdMethodResponse?: boolean;
    openPoints?: string[];
    files?: { path: string; text: string; html: string }[];
    instructionHtml?: string;
    failFirstLoad?: boolean;
  } = {},
) {
  await workspaceFixture(
    page,
    {
      ...shellState,
      ...(options.startAtEntry ? { current: null, known: [], open: [] } : {}),
      aiSetup: true,
      onboarding: true,
      onboardingAvailable: true,
    },
    {
      ...(options.connected === false
        ? {}
        : {
            aiConnection: {
              provider: options.modelProvider ?? "custom",
              endpoint:
                options.modelProvider === "openai"
                  ? null
                  : "https://model.example.invalid/v1",
              auth: "api_key",
            },
            aiModel:
              options.modelProvider === "openai"
                ? "gpt-4o-mini"
                : "fixture-model",
          }),
      aiHoldResponse: options.holdResponse,
      aiResponseText: "The requested work is available in this conversation.",
    },
  );
  await page.addInitScript(
    (options) => {
      const host = Reflect.get(window, "__TAURI_INTERNALS__") as {
        invoke: (
          command: string,
          args: Record<string, unknown>,
        ) => Promise<unknown>;
      };
      const original = host.invoke.bind(host);
      let record = JSON.parse(
        sessionStorage.getItem("setup-progress") ??
          JSON.stringify(options.record),
      );
      let serial = Number(sessionStorage.getItem("setup-revision") ?? 1);
      let failProgressSave = false;
      let failLoad = options.failFirstLoad ?? false;
      let importHeld = false;
      const files = new Map<string, string>(
        JSON.parse(sessionStorage.getItem("setup-files") ?? "null") ?? [
          ["Reading.md", "# Reading\n\nAn imported reading note.\n"],
          ...(options.files ?? []).map(
            (file) => [file.path, file.text] as [string, string],
          ),
        ],
      );
      const folders = new Set<string>(
        JSON.parse(sessionStorage.getItem("setup-folders") ?? "[]"),
      );
      for (const path of files.keys()) {
        if (path.includes("/"))
          folders.add(path.slice(0, path.lastIndexOf("/")));
      }
      const fileRevisions = new Map<string, string>(
        JSON.parse(sessionStorage.getItem("setup-file-revisions") ?? "[]"),
      );
      let fileSerial = Number(
        sessionStorage.getItem("setup-file-sequence") ?? 100,
      );
      const methodInstructions = {
        path: ".situate/working-method.md",
        text: "# Working instructions\n\nKeep notes in their existing structure.\n",
        html: "<h1>Working instructions</h1><p>Keep notes in their existing structure.</p>",
      };
      const rendered = new Map([
        [methodInstructions.path, methodInstructions],
        ...(options.files ?? []).map((file) => [file.path, file] as const),
      ]);
      const native = Reflect.get(
        window,
        "__nativeConversationFixture",
      ) as NativeConversationFixture;
      const retainedIds: string[] = JSON.parse(
        sessionStorage.getItem("native-onboarding-conversation-ids-v2") ?? "[]",
      );
      const conversations = new Map<string, Record<string, unknown>>(
        retainedIds.map((id) => [
          id,
          native.getRecord("garden", id) as unknown as Record<string, unknown>,
        ]),
      );
      const saveConversations = () =>
        sessionStorage.setItem(
          "native-onboarding-conversation-ids-v2",
          JSON.stringify([...conversations.keys()]),
        );
      const calls: { command: string; args: Record<string, unknown> }[] = [];
      Reflect.set(window, "__onboardingFixture", {
        calls,
        progress: () => structuredClone(record),
        conversations: () => structuredClone([...conversations.values()]),
        failNextProgressSave: () => {
          failProgressSave = true;
        },
      });
      const revision = () => serial.toString(16).padStart(40, "0");
      const document = (path: string, text = files.get(path) ?? "") => ({
        path,
        version: {
          text,
          revision: fileRevisions.get(path) ?? "1".padStart(40, "0"),
        },
        html:
          rendered.get(path)?.text === text
            ? rendered.get(path)!.html
            : `<pre>${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</pre>`,
        issues: [],
      });
      const snapshot = () => ({
        record: structuredClone(record),
        revision: revision(),
        writable: true,
      });
      type Conversation = {
        version: 2;
        id: string;
        title: string;
        revision: number;
        draft: string;
        messages: Record<string, unknown>[];
        development?: {
          version: 2;
          pluginId?: string;
          originConversationId?: string;
        };
        runtime: {
          runs: {
            id: string;
            state: string;
            startedAt: number;
            endedAt?: number;
          }[];
          events: {
            id: string;
            runId: string;
            sequence: number;
            type: string;
            data: Record<string, unknown>;
          }[];
          pending: unknown[];
          draftAttachments: unknown[];
        };
      };
      const owners = new Map<string, NativeConversationFixturePatch>();
      const turns: {
        conversation: string;
        stage: string;
        context: Record<string, unknown>;
      }[] = [];
      const effects: {
        name: string;
        input: Record<string, unknown>;
        result?: unknown;
      }[] = [];
      Object.assign(Reflect.get(window, "__onboardingFixture"), {
        turns: () => structuredClone(turns),
        effects: () => structuredClone(effects),
      });
      const emptyRuntime = () => ({
        runs: [],
        events: [],
        pending: [],
        draftAttachments: [],
      });
      const getConversation = (id: string): Conversation => {
        const saved = conversations.get(id);
        if (!saved) throw "native.ai.conversation.readFailed";
        return saved as unknown as Conversation;
      };
      const owner = (id: string) => {
        let value = owners.get(id);
        if (!value) {
          const snapshot = native.snapshot("garden", id);
          value = {
            phase: snapshot.phase,
            taskActive: snapshot.taskActive,
            actionId: snapshot.actionId,
            error: snapshot.error,
            questionBusy: snapshot.questionBusy,
          };
          owners.set(id, value);
        }
        return value;
      };
      const remember = (snapshot: ConversationSnapshot) => {
        conversations.set(
          snapshot.record.id,
          snapshot.record as unknown as Record<string, unknown>,
        );
        owners.set(snapshot.record.id, {
          phase: snapshot.phase,
          taskActive: snapshot.taskActive,
          actionId: snapshot.actionId,
          error: snapshot.error,
          questionBusy: snapshot.questionBusy,
        });
        saveConversations();
        return snapshot;
      };
      const publish = (id: string) =>
        remember(
          native.saveRecord(
            "garden",
            getConversation(id) as unknown as ConversationRecord,
            owner(id),
          ),
        );
      const saveProgress = (next: typeof record) => {
        record = structuredClone(next);
        serial++;
        sessionStorage.setItem("setup-progress", JSON.stringify(record));
        sessionStorage.setItem("setup-revision", String(serial));
        if (failProgressSave) {
          failProgressSave = false;
          throw "native.onboarding.storage.durability";
        }
      };
      const addEvent = (
        id: string,
        run: string,
        type: string,
        data: Record<string, unknown>,
      ) => {
        const conversation = getConversation(id);
        conversation.runtime ??= emptyRuntime();
        const sequence =
          Math.max(
            0,
            ...conversation.runtime.events
              .filter((e) => e.runId === run)
              .map((e) => e.sequence),
          ) + 1;
        conversation.runtime.events.push({
          id: crypto.randomUUID(),
          runId: run,
          sequence,
          type,
          data: structuredClone(data),
        });
      };
      const assistant = (id: string, text: string) => {
        getConversation(id).messages.push({
          role: "assistant",
          content: text ? [{ type: "text", text }] : [],
          timestamp: 1000,
          stopReason: "stop",
          usage: null,
        });
      };
      const toolResult = (
        id: string,
        run: string,
        name: string,
        input: Record<string, unknown>,
        details: Record<string, unknown>,
      ) => {
        const callId = crypto.randomUUID();
        const result = {
          content: [{ type: "text", text: JSON.stringify(details) }],
          details,
          isError: false,
        };
        const previous = getConversation(id).messages.at(-1);
        if (previous?.role === "assistant") {
          (previous.content as unknown[]).push({
            type: "toolCall",
            id: callId,
            name,
            arguments: input,
          });
          previous.stopReason = "toolUse";
        }
        addEvent(id, run, "tool_intent", {
          toolCallId: callId,
          name,
          args: input,
          messageIndex: getConversation(id).messages.length - 1,
        });
        addEvent(id, run, "tool_execution_start", {
          toolCallId: callId,
          toolName: name,
          args: input,
        });
        getConversation(id).messages.push({
          role: "toolResult",
          toolCallId: callId,
          toolName: name,
          ...result,
          timestamp: 1001,
        });
        addEvent(id, run, "tool_execution_end", {
          toolCallId: callId,
          toolName: name,
          args: input,
          isError: false,
          result,
        });
        effects.push({ name, input, result: details });
      };
      const setupQuestion = (action: "method" | "import", id: string) => {
        const choices =
          action === "method" ? ["confirm", "adjust"] : ["support", "retry"];
        const text = options.questionCopy as Record<string, string>;
        const fresh = action === "method" && record.fresh;
        const question: Record<string, unknown> = {
          id: crypto.randomUUID(),
          prompt:
            text[`onboardingAgent.question.${fresh ? "methodFresh" : action}`],
          suggestions: choices.map((choice) => ({
            id: choice,
            label:
              text[
                `onboardingAgent.choice.${fresh && choice === "confirm" ? "confirmFresh" : choice}`
              ],
          })),
          context: {
            kind: "onboarding",
            action,
            conversation: id,
            record: structuredClone(record),
          },
        };
        if (
          action === "method" &&
          record.instructionBase?.text === record.proposal
        )
          question.preview = {
            title: options.previewTitle,
            text: record.proposal,
            summary: [
              options.previewSource,
              record.fresh ? options.previewNoImport : record.sourceDescription,
              options.previewIntent,
              options.intentCopy[
                (record.intent ?? "help") as "keep" | "change" | "help"
              ],
              options.previewPreferences,
              record.description,
            ].join("\n\n"),
          };
        return question;
      };
      const present = (
        id: string,
        run: string,
        question: Record<string, unknown>,
      ) => addEvent(id, run, "question_presented", question);
      const sameSetup = (
        a: Record<string, unknown>,
        b: Record<string, unknown>,
      ) => {
        const normalize = (value: Record<string, unknown>) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(value)
                .filter(([key]) => !["entered", "paused"].includes(key))
                .sort(([a], [b]) => a.localeCompare(b)),
            ),
          );
        return normalize(a) === normalize(b);
      };
      const saveMethod = () => {
        const path = ".situate/working-method.md";
        const current = files.has(path) ? document(path).version : null;
        if (
          (current?.revision ?? null) !==
            (record.instructionBase?.revision ?? null) &&
          current?.text !== record.proposal
        )
          throw "onboarding.conflict";
        if (
          record.instructionRevision &&
          current &&
          current.text === record.proposal &&
          current.revision === record.instructionRevision
        )
          return;
        files.set(path, record.proposal);
        fileRevisions.set(path, (++fileSerial).toString(16).padStart(40, "0"));
        sessionStorage.setItem("setup-files", JSON.stringify([...files]));
        sessionStorage.setItem(
          "setup-file-revisions",
          JSON.stringify([...fileRevisions]),
        );
        sessionStorage.setItem("setup-file-sequence", String(fileSerial));
        effects.push({
          name: "save_working_method",
          input: { path, text: record.proposal },
        });
        saveProgress({
          ...record,
          instructionRevision: document(path).version.revision,
          instructionBase: document(path).version,
          step: record.fresh ? "support" : "sources",
        });
      };
      const supportText = () =>
        options.noIdeas
          ? "Your working method is ready. No additional plugins are needed for this workflow."
          : (record.fresh
              ? "Your working method is ready."
              : "Your notes are available in Situate.") +
            " I have two optional plugin ideas.\n\n**Reading view** — Browse your reading notes in one place.\n\n**Review helper** — Review your current notes together.\n\nSituate can develop these additional tools as plugins. Would you like to develop either idea, change it or save it for later? You can also finish setup without plugins.";
      const child = (
        id: string,
        pluginId: string | undefined,
        assignment: string,
        origin?: string,
      ) => {
        if (!conversations.has(id)) {
          const conversation: Conversation = {
            version: 2,
            id,
            title: assignment.slice(0, 80),
            revision: 0,
            messages: [{ role: "user", content: assignment, timestamp: 1000 }],
            draft: "",
            runtime: emptyRuntime(),
            development: {
              version: 2,
              ...(pluginId ? { pluginId } : {}),
              ...(origin ? { originConversationId: origin } : {}),
            },
          };
          conversation.runtime.runs.push({
            id: `start-${id}`,
            state: "completed",
            startedAt: 1000,
            endedAt: 1001,
          });
          conversations.set(
            id,
            conversation as unknown as Record<string, unknown>,
          );
          remember(
            native.saveRecord(
              "garden",
              getConversation(id) as unknown as ConversationRecord,
            ),
          );
        }
        return getConversation(id);
      };
      const finish = () => {
        saveProgress({ ...record, step: "complete", paused: false });
        for (const idea of record.ideas.filter(
          (idea: { choice: string }) => idea.choice === "develop",
        ))
          child(idea.developmentId, idea.pluginId, idea.assignment);
      };
      const serviceTurn = async (id: string, run: string, text: string) => {
        if (cancelled.has(id)) return;
        const stage =
          record.step === "complete"
            ? "ordinary"
            : ["sources", "review"].includes(record.step)
              ? "import"
              : record.step === "support"
                ? "support"
                : "method";
        turns.push({
          conversation: id,
          stage,
          context: {
            preferences: record.description,
            sources: record.sourceDescription,
            fresh: record.fresh ?? false,
            intent: record.intent ?? "help",
          },
        });
        if (options.holdResponse) await waitForRelease(id);
        if (cancelled.has(id)) return;
        if (stage === "ordinary") {
          assistant(
            id,
            "The requested work is available in this conversation.",
          );
          return;
        }
        if (stage === "method") {
          if (
            options.questionFirst &&
            !sessionStorage.getItem("setup-clarified")
          ) {
            sessionStorage.setItem("setup-clarified", "true");
            const question = {
              id: crypto.randomUUID(),
              prompt:
                options.clarification?.prompt ??
                "When would you like to review your notes?",
              suggestions: options.clarification?.suggestions ?? [
                { id: "friday", label: "Each Friday" },
                { id: "monday", label: "Each Monday" },
              ],
            };
            assistant(id, "");
            toolResult(id, run, "ask_question", question, { question });
            present(id, run, question);
            return;
          }
          if (options.holdMethodResponse)
            await waitForRelease(id, "__finishMethodResponse");
          if (cancelled.has(id)) return;
          const revised =
            options.revisedScope && record.proposal ? options.revisedScope : {};
          saveProgress({
            ...record,
            ...revised,
            proposal: methodInstructions.text,
            openPoints: options.openPoints ?? [],
            step: "proposal",
          });
          assistant(
            id,
            "I suggest keeping notes in their existing structure." +
              (options.openPoints?.length
                ? "\n\nI still need your input: " + options.openPoints.join(" ")
                : ""),
          );
          const question = setupQuestion("method", id);
          toolResult(
            id,
            run,
            "propose_working_method",
            { markdown: record.proposal, openPoints: record.openPoints ?? [] },
            {
              proposed: true,
              savedAsInstructions: false,
              proposedMarkdown: record.proposal,
              question,
            },
          );
          present(id, run, question);
          return;
        }
        if (stage === "import") {
          if (options.importFollowUpText && record.imported.length) {
            assistant(id, options.importFollowUpText);
            return;
          }
          if (options.holdImportResponse && !importHeld) {
            importHeld = true;
            await waitForRelease(id, "__finishImportResponse");
            if (cancelled.has(id)) return;
          }
          if (!options.importResult) {
            assistant(
              id,
              "The requested work is available in this conversation.",
            );
            return;
          }
          const missing = options.importMissing ?? [
            "The second source is not accessible.",
          ];
          const reference = {
            kind: "live",
            workspaceId: "garden",
            path: "Reading.md",
            anchorRevision: "a".repeat(40),
          };
          saveProgress({
            ...record,
            imported: [reference],
            ...(record.step === "complete"
              ? {}
              : { step: missing.length ? "sources" : "support" }),
          });
          assistant(id, "");
          const question =
            missing.length && record.step !== "complete"
              ? setupQuestion("import", id)
              : undefined;
          toolResult(
            id,
            run,
            "show_imported_files",
            { paths: ["Reading.md"], missing },
            {
              files: [reference],
              missing,
              complete: !missing.length,
              ...(question ? { question } : {}),
            },
          );
          if (question) {
            present(id, run, question);
            return;
          }
          if (record.step !== "complete") await serviceTurn(id, run, "");
          return;
        }
        if (options.holdSupportResponse) {
          await waitForRelease(id, "__finishSupportResponse");
          if (cancelled.has(id)) return;
        }
        if (text.includes("Develop the reading view.")) {
          const developmentId = crypto.randomUUID();
          const assignment =
            "Build a view over existing reading notes without moving them.";
          assistant(id, "");
          const conversation = child(developmentId, undefined, assignment, id);
          toolResult(
            id,
            run,
            "start_plugin_development",
            { developmentId, assignment },
            { conversation, ready: true },
          );
          assistant(
            id,
            "The reading view development has started in its own conversation. You can finish setup while it runs.",
          );
        } else if (text.includes("Save the review helper for later.")) {
          const path = "Review helper idea.md",
            text =
              "# Review helper\n\nBuild a review helper using the existing notes.\n";
          files.set(path, text);
          sessionStorage.setItem("setup-files", JSON.stringify([...files]));
          assistant(id, "");
          toolResult(
            id,
            run,
            "write",
            { path, text, expectedRevision: null },
            { path },
          );
          assistant(id, "I saved the review helper as a note for later.");
        } else assistant(id, supportText());
      };
      const cancelled = new Set<string>();
      const operations = new Map<string, Promise<void>>();
      const held = new Map<string, () => void>();
      const waitForRelease = (id: string, key?: string) =>
        new Promise<void>((resolve) => {
          const release = () => {
            held.delete(id);
            resolve();
          };
          held.set(id, release);
          if (key) Reflect.set(window, key, release);
        });
      const runTurn = (id: string, run: string, text: string) => {
        cancelled.delete(id);
        Object.assign(owner(id), {
          phase: "running",
          taskActive: true,
          actionId: run,
          error: null,
          questionBusy: false,
        });
        if (
          !getConversation(id).runtime.runs.some((entry) => entry.id === run)
        ) {
          getConversation(id).runtime.runs.push({
            id: run,
            state: "running",
            startedAt: Date.now(),
          });
          addEvent(id, run, "work_block_start", {
            workId: run,
            startMessageCount: Math.max(
              0,
              getConversation(id).messages.length - 1,
            ),
            startedAt: Date.now(),
          });
        }
        const admitted = publish(id);
        const operation = new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        })
          .then(() => serviceTurn(id, run, text))
          .then(() => {
            if (cancelled.has(id)) return;
            publish(id);
            remember(native.finish("garden", id, null));
          })
          .catch((error) => {
            if (cancelled.has(id)) return;
            Object.assign(owner(id), {
              phase: "persistenceFailed",
              taskActive: false,
              questionBusy: false,
              error: String(error),
            });
            publish(id);
          })
          .finally(() => {
            if (operations.get(id) === operation) operations.delete(id);
          });
        operations.set(id, operation);
        return admitted;
      };
      const answerQuestion = (
        id: string,
        response: Record<string, unknown>,
        run: string,
      ) => {
        const conversation = getConversation(id);
        const shown = [...conversation.runtime.events]
          .reverse()
          .find(
            (event) =>
              event.type === "question_presented" &&
              event.data.id === response.questionId,
          )?.data;
        if (!shown) throw "chatQuestion.stale";
        const context = shown.context as
          { action: string; record: Record<string, unknown> } | undefined;
        const answered = [...conversation.runtime.events]
          .reverse()
          .find(
            (event) =>
              event.type === "question_answered" &&
              event.data.questionId === response.questionId,
          )?.data.answer as { text: string };
        try {
          if (context?.action === "method" && response.choiceId === "confirm")
            saveMethod();
          if (context?.action === "import" && response.choiceId === "support")
            saveProgress({ ...record, step: "support" });
          addEvent(id, run, "question_action_completed", {
            questionId: response.questionId,
          });
          return runTurn(id, run, answered.text);
        } catch (error) {
          Object.assign(owner(id), {
            phase: "idle",
            taskActive: false,
            questionBusy: false,
            error: String(error),
          });
          return publish(id);
        }
      };
      host.invoke = async (command, args = {}) => {
        calls.push({
          command,
          args: structuredClone(
            args.channel ? { ...args, channel: undefined } : args,
          ),
        });
        if (command === "workspace_snapshot")
          return {
            ...((await original(command, args)) as object),
            onboarding: !record.entered && record.step !== "complete",
            aiSetup: !record.entered && record.step !== "complete",
          };
        if (command === "onboarding_load") {
          if (failLoad) {
            failLoad = false;
            throw "native.onboarding.storage.failed";
          }
          return snapshot();
        }
        if (command === "onboarding_preview")
          return (
            options.instructionHtml ??
            document(".situate/working-method.md", String(args.text)).html
          );
        if (command === "onboarding_save") {
          if (args.expectedRevision !== revision())
            throw "native.onboarding.storage.conflict";
          record = structuredClone(args.record);
          serial++;
          sessionStorage.setItem("setup-progress", JSON.stringify(record));
          sessionStorage.setItem("setup-revision", String(serial));
          if (failProgressSave) {
            failProgressSave = false;
            throw "native.onboarding.storage.durability";
          }
          return snapshot();
        }
        if (
          command === "workspace_action" &&
          args.action === "ai-setup-done" &&
          !record.entered &&
          record.step !== "complete"
        )
          throw "native.onboarding.storage.incomplete";
        if (command === "files_request") {
          const request = args.request as {
            operation: string;
            path?: string;
            text?: string;
            reference?: { path: string };
            base?: { revision: string };
          };
          const path = request.path ?? request.reference?.path ?? "";
          if (request.operation === "snapshot")
            return {
              status: "ok",
              snapshot: {
                writable: true,
                canExport: true,
                reason: null,
                drafts: [],
                deleted: [],
                entries: [
                  ...[...folders]
                    .filter((path) => path !== ".situate")
                    .map((path) => ({ path, isDirectory: true })),
                  ...[...files.keys()].map((path) => ({
                    path,
                    isDirectory: false,
                  })),
                ],
              },
            };
          if (
            request.operation === "read" ||
            request.operation === "resolveReference"
          ) {
            if (request.text === undefined && !files.has(path))
              return { status: "deleted" };
            return {
              status: "ok",
              document: document(path, request.text),
              ...(request.reference ? { reference: request.reference } : {}),
            };
          }
          if (request.operation === "mkdir") {
            if (files.has(path) || folders.has(path))
              throw "native.files.path.exists";
            folders.add(path);
            sessionStorage.setItem(
              "setup-folders",
              JSON.stringify([...folders]),
            );
            return { status: "ok" };
          }
          if (request.operation === "create" || request.operation === "save") {
            const parent = path.slice(0, path.lastIndexOf("/"));
            if (
              path !== ".situate/working-method.md" &&
              path.includes("/") &&
              !folders.has(parent)
            )
              throw "native.files.path.missing";
            if (request.operation === "create" && files.has(path))
              throw "native.files.path.exists";
            if (
              request.operation === "save" &&
              request.base?.revision !== document(path).version.revision
            )
              return { status: "changed" };
            effects.push({
              name: "file_save",
              input: { path, text: request.text ?? "" },
            });
            files.set(path, request.text ?? "");
            fileRevisions.set(
              path,
              (++fileSerial).toString(16).padStart(40, "0"),
            );
            sessionStorage.setItem("setup-files", JSON.stringify([...files]));
            sessionStorage.setItem(
              "setup-file-revisions",
              JSON.stringify([...fileRevisions]),
            );
            sessionStorage.setItem("setup-file-sequence", String(fileSerial));
            return { status: "saved", document: document(path) };
          }
          if (request.operation === "captureReference")
            return {
              status: "ok",
              reference: {
                kind: "live",
                workspaceId: "garden",
                path,
                anchorRevision: "a".repeat(40),
              },
            };
          if (request.operation === "inspectTasks")
            return { status: "ok", document: document(path), tasks: [] };
        }
        if (command === "ai_model_check") {
          turns.push({ conversation: "", stage: "check", context: {} });
          return;
        }
        if (command === "ai_model_check_cancel") return;
        if (command === "ai_conversations_abort" && args.scope === "garden") {
          for (const id of operations.keys()) {
            cancelled.add(id);
            held.get(id)?.();
            const snapshot = native.snapshot("garden", id);
            if (snapshot.taskActive && snapshot.actionId)
              remember(
                await native.accept("garden", id, crypto.randomUUID(), {
                  version: 1,
                  type: "cancel",
                  runId: snapshot.actionId,
                }),
              );
          }
          const result = await original(command, args);
          await Promise.allSettled([...operations.values()]);
          for (const id of conversations.keys())
            remember(native.snapshot("garden", id));
          return result;
        }
        if (command === "ai_create_conversation" && args.scope === "garden") {
          const id = String(args.id);
          if (conversations.has(id)) throw "native.ai.conversation.conflict";
          conversations.set(id, {
            version: 2,
            id,
            title: String(args.title),
            revision: 0,
            draft: "",
            messages: [],
            runtime: emptyRuntime(),
          });
          remember(
            native.saveRecord(
              "garden",
              getConversation(id) as unknown as ConversationRecord,
            ),
          );
          return structuredClone(getConversation(id));
        }
        if (command === "ai_conversations" && args.scope === "garden") {
          const listed = (await original(command, args)) as { id: string }[];
          return [
            ...listed.filter((item) => !conversations.has(item.id)),
            ...[...conversations.values()].map(
              ({ id, title, revision, development }) => ({
                id,
                title,
                revision,
                ...(development ? { development } : {}),
              }),
            ),
          ];
        }
        const id = args.scope === "garden" ? String(args.conversation) : "";
        if (command === "ai_conversation")
          throw "native.ai.conversation.versionInvalid";
        if (
          command === "ai_conversation_read" &&
          Object.keys(args).some(
            (key) => !["scope", "conversation"].includes(key),
          )
        )
          throw "native.ai.conversation.versionInvalid";
        if (command === "ai_conversation_read" && conversations.has(id))
          return structuredClone(getConversation(id));
        if (
          [
            "ai_conversation_read",
            "ai_conversation_snapshot",
            "ai_conversation_subscribe",
            "ai_conversation_action",
          ].includes(command) &&
          !conversations.has(id) &&
          id === record.conversationId
        )
          throw "native.ai.conversation.readFailed";
        if (
          ["ai_conversation_snapshot", "ai_conversation_subscribe"].includes(
            command,
          ) &&
          conversations.has(id)
        )
          return original(command, args);
        if (command === "ai_conversation_action" && conversations.has(id)) {
          if (args.generation !== native.snapshot("garden", id).generation)
            throw "native.ai.conversation.conflict";
          const action = args.action as ConversationAction;
          if (action.type === "cancel") {
            cancelled.add(id);
            held.get(id)?.();
          }
          const actionId = String(args.actionId);
          if (action.type === "answerQuestion") {
            const shown = [...getConversation(id).runtime.events]
              .reverse()
              .find(
                (event) =>
                  event.type === "question_presented" &&
                  event.data.id === action.response.questionId,
              )?.data;
            const context = shown?.context as
              { record: Record<string, unknown> } | undefined;
            if (context && !sameSetup(context.record, record))
              throw "chatQuestion.stale";
          }
          const previous = getConversation(id).runtime.events.some(
            (event) =>
              event.runId === actionId && event.type === "action_accepted",
          );
          const accepted = remember(
            await native.accept(String(args.scope), id, actionId, action),
          );
          if (previous) return accepted;
          if (action.type === "cancel") await operations.get(id);
          if (action.type === "answerQuestion")
            return answerQuestion(
              id,
              action.response as unknown as Record<string, unknown>,
              actionId,
            );
          if (action.type === "retryQuestionAction") {
            const answered = [...getConversation(id).runtime.events]
              .reverse()
              .find(
                (event) =>
                  event.type === "question_answered" &&
                  event.data.questionId === action.questionId,
              )?.data;
            if (!answered) throw "chatQuestion.stale";
            return answerQuestion(
              id,
              {
                questionId: action.questionId,
                ...(answered.answer as Record<string, unknown>),
              },
              actionId,
            );
          }
          if (action.type === "submit")
            return runTurn(id, actionId, action.input.text);
          return accepted;
        }
        if (command === "onboarding_action") {
          if (args.action === "confirm") {
            if (!sameSetup(args.expected as Record<string, unknown>, record))
              throw "native.onboarding.storage.conflict";
            saveMethod();
          } else if (args.action === "enter") {
            if (!sameSetup(args.expected as Record<string, unknown>, record))
              throw "native.onboarding.storage.conflict";
            if (
              record.step !== "complete" &&
              (!record.instructionRevision ||
                (!["sources", "review", "support"].includes(record.step) &&
                  !(record.entered && record.step === "proposal")))
            )
              throw "native.onboarding.storage.incomplete";
            saveProgress({
              ...record,
              step: "complete",
              entered: true,
              paused: false,
            });
          } else if (args.action === "finish") {
            if (!sameSetup(args.expected as Record<string, unknown>, record))
              throw "native.onboarding.storage.conflict";
            finish();
          } else if (args.action === "recover" && record.step === "proposal") {
            const path = ".situate/working-method.md",
              current = files.has(path) ? document(path).version : null;
            if (
              (current?.revision ?? null) !==
                (record.instructionBase?.revision ?? null) &&
              current?.text !== record.proposal
            )
              saveProgress({
                ...record,
                instructionBase: current,
                proposal: current?.text ?? record.proposal,
                openPoints: [],
                ...(!record.entered ? { instructionRevision: null } : {}),
              });
          }
          return snapshot();
        }
        if (command === "onboarding_development_prepare") {
          const idea = record.ideas.find(
            (idea: { developmentId: string; choice: string }) =>
              idea.developmentId === args.developmentId &&
              idea.choice === "develop",
          );
          if (record.step !== "complete" || !idea)
            throw "native.plugins.developmentToolDenied";
          return {
            conversation: child(
              idea.developmentId,
              idea.pluginId,
              idea.assignment,
            ),
            ready: true,
          };
        }
        return original(command, args);
      };
    },
    {
      ...options,
      record: options.record ?? newOnboardingRecord(),
      questionCopy,
      previewTitle: t("onboarding.proposal.file"),
      previewSource: t("chat.proposedSource"),
      previewNoImport: t("chat.noImport"),
      previewIntent: t("onboarding.conversation.intent"),
      previewPreferences: t("chat.proposedPreferences"),
      intentCopy: {
        keep: t("onboarding.conversation.keep"),
        change: t("onboarding.conversation.change"),
        help: t("onboarding.conversation.help"),
      },
    },
  );
}

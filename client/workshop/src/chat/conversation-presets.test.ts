import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import {
  canonicalScenario,
  createSimulation,
  reduceSimulation,
} from "../workshop/simulation";
import { scenarioForState } from "../workshop/scenario-catalog";
import {
  conversationAliases,
  conversationScenarios,
} from "./conversation-presets";
import { conversationBlocks } from "./conversation-transcript";
import { setConversationExample } from "./conversation-examples";
import ConversationTranscript from "./ConversationTranscript.vue";
import ChatControls from "./ChatControls.vue";
import { currentWorkspace } from "../ai/model";
import { changePhase, events } from "./model";
import { questionExamples, setQuestionExample } from "./question-examples";
import {
  finishWorkTime,
  sendWorkTimeMessage,
  advanceWorkTime,
} from "./work-time";

describe("conversation starting states", () => {
  it("offers distinct situations rather than output and question variants", () => {
    const ids = scenarioForState("chat-work-history").states.map((s) => s.id);
    expect(ids).toEqual(conversationScenarios.map((s) => s.id));
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it.each(
    Object.keys(conversationAliases) as (keyof typeof conversationAliases)[],
  )("retains %s as a reproducible link", (id) => {
    const state = createSimulation(id);
    expect(state.scenario).toBe(canonicalScenario(id));
    expect(state.chat.transcriptStyle).toBe("history");
    state.chat.draft = "Draft";
    const reset = reduceSimulation(state, { type: "reset" });
    expect(reset.chat).toEqual(createSimulation(id).chat);
  });
  it("retains model and question configurations behind their compact starting states", () => {
    const question = createSimulation("chat-question-ten-long");
    expect(question.scenario).toBe("chat-question");
    expect(
      question.chat.transcript?.find((event) => event.kind === "question")
        ?.options,
    ).toHaveLength(10);
    const long = createSimulation("chat-reasoning-long");
    expect(long.scenario).toBe("chat-work-history");
    expect(long.chat.workHistory?.example).toBe("long");
    expect(
      currentWorkspace(createSimulation("ai-chat-zero").chat.ai).model.count,
    ).toBe("zero");
  });
  it.each([
    "ai-chat-unconfigured",
    "ai-chat-load-error",
    "ai-chat-save-error",
  ] as const)(
    "keeps saved output independent of access problems in %s",
    (id) => {
      const state = createSimulation(id).chat;
      expect(state.phase).toBe("complete");
      expect(state.workHistory?.example).toBe("mixed");
      expect(
        state.transcript?.some(
          (event) => event.kind === "message" && event.answer,
        ),
      ).toBe(true);
      expect(
        state.transcript?.some(
          (event) => event.kind === "call" && event.state === "error",
        ),
      ).toBe(false);
    },
  );
  it.each(["complete", "working", "error", "cancelled"] as const)(
    "switches output examples without losing %s, locale or model settings",
    (phase) => {
      const state = changePhase(
        createSimulation("chat-work-history").chat,
        phase,
      );
      state.composerLocale = "de";
      state.draft = "Discard when replacing example data";
      const followup = setConversationExample(state, "followup");
      expect(followup.phase).toBe(phase);
      expect(followup.draft).toBe("");
      expect(followup.workHistory).toBeUndefined();
      expect(followup.workTimeMs).toBe(phase === "working" ? 69000 : 0);
      expect(followup.composerLocale).toBe("de");
      expect(followup.thinking).toEqual(state.thinking);
      const restored = setConversationExample(followup, "long");
      expect(restored.workTimeMs).toBeUndefined();
      expect(restored.workHistory?.example).toBe("long");
      expect(restored.phase).toBe(phase);
      expect(restored.ai).toEqual(followup.ai);
    },
  );
  it("keeps all question examples in controls and cancels pending work on replacement", () => {
    const state = changePhase(
      createSimulation("chat-question").chat,
      "working",
    );
    state.draft = "Discard with example data";
    for (const example of questionExamples) {
      const next = setQuestionExample(state, example.id);
      expect(next.phase).toBe("complete");
      expect(next.run).toBeNull();
      expect(currentWorkspace(next.ai).response).toBe("idle");
      expect(next.draft).toBe("");
      expect(next.questionVariant).toBe(example.id);
    }
    const view = mount(ChatControls, { props: { state } });
    expect(view.findAll("#question-example + select option")).toHaveLength(
      questionExamples.length,
    );
    expect(view.find("#system-message-language").exists()).toBe(false);
    view.unmount();
  });
});

describe("conversation transcript presentation", () => {
  it("uses the same collapsed history for older tool data without inventing elapsed time", () => {
    const state = createSimulation("chat-complete").chat;
    const view = mount(ConversationTranscript, {
      props: { events: state.transcript ?? events, phase: state.phase },
    });
    expect(view.get(".work-history-toggle").text()).toBe("Work history");
    expect(view.find(".work-duration, .speaker, .activity").exists()).toBe(
      false,
    );
    expect(view.findAll(".change-card")).toHaveLength(2);
    view.unmount();
  });
  it("preserves completed blocks and gives later work a separate history", () => {
    let state = createSimulation("chat-work-time-working").chat;
    state = finishWorkTime(state, "complete");
    state.draft = "A second selection";
    state = advanceWorkTime(sendWorkTimeMessage(state));
    const source = structuredClone(state.transcript!);
    const blocks = conversationBlocks(
      state.transcript!,
      state.phase,
      state.workTimeMs,
    );
    expect(blocks.map((block) => block.phase)).toEqual(["complete", "working"]);
    expect(blocks.map((block) => block.history.milliseconds)).toEqual([
      69000, 15000,
    ]);
    expect(
      blocks.flatMap((block) => block.events).map((event) => event.id),
    ).toEqual(source.map((event) => event.id));
    expect(
      blocks
        .flatMap((block) => block.events)
        .some((event) => event.kind === "message" && event.workDuration),
    ).toBe(false);
    expect(state.transcript).toEqual(source);
    const view = mount(ConversationTranscript, {
      props: {
        events: state.transcript!,
        phase: state.phase,
        milliseconds: state.workTimeMs,
      },
    });
    expect(view.findAll(".work-history-toggle")).toHaveLength(1);
    expect(view.get(".work-history-time").text()).toBe("Working…");
    expect(
      view
        .findAll(".work-history-toggle, .work-history-time")
        .map((el) => el.text()),
    ).toEqual(["Worked for 1 min 9 sec", "Working…"]);
    expect(view.find(".work-duration, .speaker, .activity").exists()).toBe(
      false,
    );
    view.unmount();
  });
  it.each(["chat-question", "chat-plugin-available"] as const)(
    "keeps %s visible without fabricating a work history",
    (id) => {
      const state = createSimulation(id).chat;
      const view = mount(ConversationTranscript, {
        props: { events: state.transcript!, phase: state.phase },
      });
      expect(view.find(".work-history").exists()).toBe(false);
      expect(view.find(".speaker").exists()).toBe(false);
      expect(view.text()).not.toContain("Worked for");
      view.unmount();
    },
  );
});

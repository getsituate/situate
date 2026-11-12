import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WorkHistory from "./WorkHistory.vue";
import { changePhase, createChatState, type Call } from "./model";
import {
  advanceHistory,
  continueHistory,
  historyEntries,
  historyExamples,
  historyFixture,
  historyLabel,
  historyToolLabel,
  historyCallLabel,
  historySections,
  isCollapsibleDetail,
  isWorkDetail,
  setHistoryExample,
} from "./work-history";
import { replyToQuestion } from "./question-examples";
import { activeQuestion } from "./question";
import { createSimulation, reduceSimulation } from "../workshop/simulation";
import { screenControls } from "../workshop/screen-controls";
import { scenarioForState } from "../workshop/scenario-catalog";

describe("work history projection", () => {
  it.each(historyExamples)(
    "preserves every event and its chronological position for %s",
    (example) => {
      const transcript = historyFixture(example, "complete");
      const sections = historySections(transcript, "complete");
      expect([
        ...sections.before,
        ...sections.segments.flatMap((s) => s.events),
        ...sections.after,
      ]).toEqual(transcript);
      expect(
        sections.segments
          .filter((s) => s.collapsible)
          .flatMap((s) => s.events)
          .every(isWorkDetail),
      ).toBe(true);
    },
  );
  it("never infers reasoning or progress from ordinary message text", () => {
    const text = {
      kind: "message" as const,
      id: "plain",
      speaker: "assistant" as const,
      text: "**Thinking:** I will keep working.",
    };
    expect(isWorkDetail(text)).toBe(false);
    expect(isWorkDetail({ ...text, purpose: "progress" })).toBe(true);
    expect(
      isCollapsibleDetail({ ...text, purpose: "progress" }, "working"),
    ).toBe(false);
    expect(
      isCollapsibleDetail({ ...text, purpose: "progress" }, "complete"),
    ).toBe(true);
    expect(
      isWorkDetail({ ...text, speaker: "user", purpose: "progress" }),
    ).toBe(false);
  });
  it("groups only adjacent calls of the same kind without crossing reasoning or visible changes", () => {
    const transcript = historyFixture("mixed", "complete");
    const calls = transcript.filter(
      (event): event is Call => event.kind === "call",
    );
    expect(
      historyEntries(calls).map((entry) =>
        entry.kind === "tools" ? entry.calls.length : 0,
      ),
    ).toEqual([1, 2]);
    const sections = historySections(
      historyFixture("changes", "complete"),
      "complete",
    );
    expect(
      sections.segments.find((s) => s.id === "history-visible-change")
        ?.collapsible,
    ).toBe(false);
  });
  it("keeps question and approval entries outside the folded details", () => {
    for (const example of ["question", "approval"] as const) {
      const sections = historySections(
        historyFixture(example, "complete"),
        "complete",
      );
      expect(sections.after.at(-1)?.kind).toBe("question");
    }
  });
  it.each(["error", "cancelled"] as const)(
    "retains streamed text, completed calls and visible changes when %s",
    (phase) => {
      const state = continueHistory(
        setHistoryExample(
          createChatState("chat-work-history-working"),
          "changes",
        ),
      );
      const before = state.transcript!;
      const next = changePhase(state, phase);
      expect(
        before.every((event) =>
          next.transcript!.some((retained) => retained.id === event.id),
        ),
      ).toBe(true);
      expect(
        next.transcript!.find((event) => event.id === "history-visible-change"),
      ).toMatchObject({
        visible: true,
        after: "19:00 — Arrive and settle in.",
      });
      expect(JSON.stringify(next.transcript)).toContain("Timing check:");
      expect(
        next.transcript!.some(
          (event) => event.kind === "message" && event.answer,
        ),
      ).toBe(false);
      if (phase === "error")
        expect(next.transcript!.at(-1)).toMatchObject({ state: "error" });
    },
  );
  it("does not treat empty reasoning as an inspectable step or a failed read as completed", () => {
    const blank = {
      kind: "reasoning" as const,
      id: "blank",
      status: "complete" as const,
      text: "  ",
    };
    expect(isWorkDetail(blank)).toBe(false);
    expect(historySections([blank], "complete").segments).toHaveLength(0);
    const failed = {
      kind: "call" as const,
      id: "failed",
      tool: "read",
      label: "Read the plan",
      input: "",
      result: "Could not read",
      visible: false,
      state: "error" as const,
    };
    expect(historyToolLabel([failed], "read", "en")).toBe("File read");
    expect(isCollapsibleDetail(failed, "complete")).toBe(true);
    expect(isCollapsibleDetail({ ...failed, visible: true }, "complete")).toBe(
      true,
    );
    expect(
      historyToolLabel(
        [{ ...failed, state: "complete", args: { path: "Reading notes.md" } }],
        "read",
        "en",
      ),
    ).toBe("Read 1 file");
  });
  it("uses supplied durations and a plain fallback when no duration is available", () => {
    expect(
      historyLabel(
        { example: "mixed", milliseconds: 103000 },
        "complete",
        "en",
      ),
    ).toBe("Worked for 1 min 43 sec");
    expect(
      historyLabel({ example: "mixed", milliseconds: NaN }, "complete", "en"),
    ).toBe("Work history");
  });
  it("keeps drafts on clock and environment changes and resets the example deterministically", () => {
    let state = createSimulation("chat-work-history-working");
    state.chat.draft = "Keep my draft";
    state.chat = continueHistory(advanceHistory(state.chat));
    expect(state.chat.workHistory?.milliseconds).toBe(133000);
    state = reduceSimulation(state, { type: "platform", mobile: true });
    expect(state.chat.draft).toBe("Keep my draft");
    expect(screenControls(state).label).toBe("Chat · work history");
    expect(screenControls(state).controls).toEqual(["chat"]);
    expect(scenarioForState("chat-work-history").id).toBe(
      scenarioForState("chat-complete").id,
    );
    const reset = reduceSimulation(state, { type: "reset" });
    expect(reset.chat.workHistory?.milliseconds).toBe(103000);
    expect(reset.chat.draft).toBe("");
    expect(JSON.stringify(reset.chat.transcript)).not.toContain(
      "Timing check:",
    );
  });
  it("uses only available tool arguments and never the descriptive fixture label", () => {
    const base: Call = {
      kind: "call",
      id: "call",
      tool: "read",
      label: "Invented description",
      input: "",
      result: "",
      visible: false,
      state: "complete",
    };
    expect(
      historyCallLabel({
        ...base,
        args: { path: "Projects/Reading notes.md" },
      }),
    ).toBe("Projects/Reading notes.md");
    expect(
      historyCallLabel({ ...base, args: { path: { token: "hidden" } } }),
    ).toBe("read");
    expect(
      historyCallLabel({
        ...base,
        tool: "grep",
        args: { query: "reading evening", path: "Notes" },
      }),
    ).toBe("reading evening · Notes");
    expect(
      historyCallLabel({
        ...base,
        tool: "find",
        args: { query: "reading evening" },
      }),
    ).toBe("reading evening");
    expect(
      historyCallLabel({
        ...base,
        tool: "books.search",
        args: { token: "hidden", query: "private" },
      }),
    ).toBe("books.search");
    const repeated = { ...base, args: { path: "Reading notes.md" } };
    expect(
      historyToolLabel(
        [
          repeated,
          {
            ...repeated,
            id: "second",
            args: { path: "Reading notes.md", offset: 200 },
          },
        ],
        "read",
        "en",
      ),
    ).toBe("Read 1 file");
  });
  it("redirects retired reasoning examples to the retained work history states", () => {
    for (const [previous, current] of [
      ["chat-reasoning", "chat-work-history"],
      ["chat-reasoning-long", "chat-work-history"],
      ["chat-reasoning-working", "chat-work-history-working"],
      ["chat-reasoning-error", "chat-work-history-error"],
      ["chat-reasoning-cancelled", "chat-work-history-cancelled"],
    ] as const) {
      expect(createSimulation(previous).scenario).toBe(current);
      expect(
        scenarioForState(current).states.map((state) => state.id),
      ).not.toContain(previous);
    }
  });
  it("does not interpret written approval feedback or stale replies as permission", () => {
    const state = createChatState("chat-work-history-approval");
    replyToQuestion(state, {
      questionId: "history-approval",
      text: "What will the invitation say?",
    });
    expect(activeQuestion(state.transcript!)?.id).toBe("history-approval");
    expect(state.transcript!.at(-1)).toMatchObject({
      text: "The invitation has not been sent. Choose whether to send it or keep it as a draft.",
    });
    replyToQuestion(state, {
      questionId: "history-approval",
      optionId: "draft",
    });
    expect(activeQuestion(state.transcript!)).toBeUndefined();
    expect(state.transcript!.at(-1)).toMatchObject({
      text: "The invitation remains a draft. It has not been sent.",
    });
    const length = state.transcript!.length;
    replyToQuestion(state, { questionId: "history-approval", text: "Send" });
    expect(state.transcript).toHaveLength(length);
  });
});

describe("work history view", () => {
  it("starts folded without a global plugin attribution and expands real tool details", async () => {
    const events = historyFixture("mixed", "complete");
    const wrapper = mount(WorkHistory, {
      props: {
        events,
        history: { example: "mixed", milliseconds: 103000 },
        phase: "complete",
      },
    });
    await flushPromises();
    expect(wrapper.get(".work-history-toggle").text()).toBe(
      "Worked for 1 min 43 sec",
    );
    expect(
      wrapper.get(".work-history-toggle").attributes("aria-expanded"),
    ).toBe("false");
    expect(wrapper.find(".history-plugin").exists()).toBe(false);
    expect(wrapper.findAll(".call-plugin")).toHaveLength(0);
    expect(wrapper.get('[aria-label="Answer"]').isVisible()).toBe(true);
    expect(wrapper.get('[aria-label="Answer"]').find(".speaker").exists()).toBe(
      false,
    );
    expect(wrapper.get(".history-reasoning").isVisible()).toBe(false);
    await wrapper.get(".work-history-toggle").trigger("click");
    expect(
      wrapper.get(".work-history-toggle").attributes("aria-expanded"),
    ).toBe("true");
    expect(
      wrapper.get(".history-segment").attributes("hidden"),
    ).toBeUndefined();
    expect(wrapper.findAll(".history-tools")).toHaveLength(2);
    expect(wrapper.findAll(".history-call")).toHaveLength(3);
    expect(
      wrapper
        .findAll(".history-tools")
        .every((group) => group.attributes("open") === undefined),
    ).toBe(true);
    wrapper.unmount();
  });
  it("attributes a plugin only to its actual call and uses paths for built-in reads", async () => {
    const wrapper = mount(WorkHistory, {
      props: {
        events: historyFixture("plugin", "complete"),
        history: { example: "plugin", milliseconds: 103000 },
        phase: "complete",
      },
    });
    await flushPromises();
    expect(wrapper.find(".history-plugin").exists()).toBe(false);
    expect(wrapper.findAll(".call-plugin")).toHaveLength(1);
    const pluginCall = wrapper
      .findAll(".history-call")
      .find((call) => call.find(".call-plugin").exists())!;
    expect(pluginCall.get(".call-label").text()).toBe("books.search");
    expect(pluginCall.get(".call-plugin").text()).toBe("Book shelf");
    expect(wrapper.findAll(".call-label").map((label) => label.text())).toEqual(
      ["books.search", "Reading evenings.md", "Reading notes.md"],
    );
    wrapper.unmount();
  });
  it("escapes model HTML and does not load images or unsafe links", async () => {
    const wrapper = mount(WorkHistory, {
      props: {
        events: [
          {
            kind: "reasoning",
            id: "unsafe",
            status: "complete",
            text: "<script>alert(1)</script>\n\n![image](https://example.invalid/image.png)\n\n[unsafe](javascript:alert(1))\n\n**Plain text**",
          },
        ],
        history: { example: "mixed", milliseconds: 103000 },
        phase: "complete",
      },
    });
    await flushPromises();
    expect(wrapper.find("script, img, iframe").exists()).toBe(false);
    expect(wrapper.find('a[href^="javascript:"]').exists()).toBe(false);
    expect(wrapper.get("strong").text()).toBe("Plain text");
    wrapper.unmount();
  });
  it.each(["error", "cancelled"] as const)(
    "keeps %s write attempts folded and distinct from confirmed changes",
    async (phase) => {
      const wrapper = mount(WorkHistory, {
        props: {
          events: [
            {
              kind: "call",
              id: "failed-write",
              tool: "write",
              label: "Write the plan",
              input: "path: Reading evening.md",
              result: "The file could not be written.",
              after: "A proposed plan",
              state: phase,
              visible: true,
            },
          ],
          history: { example: "mixed", milliseconds: 103000 },
          phase,
        },
      });
      await flushPromises();
      expect(wrapper.find(".change-card").exists()).toBe(false);
      expect(wrapper.get<HTMLElement>(".history-segment").element.hidden).toBe(
        true,
      );
      await wrapper.get(".work-history-toggle").trigger("click");
      expect(wrapper.get<HTMLElement>(".history-segment").element.hidden).toBe(
        false,
      );
      expect(wrapper.get(".group-state").text()).toBe(
        phase === "error" ? "Failed" : "Stopped",
      );
      wrapper.unmount();
    },
  );
  it("has no empty reasoning entry or empty disclosure for answer-only output", async () => {
    const wrapper = mount(WorkHistory, {
      props: {
        events: historyFixture("text-only", "complete"),
        history: { example: "text-only", milliseconds: 103000 },
        phase: "complete",
      },
    });
    await flushPromises();
    expect(
      wrapper
        .find(".work-history-toggle, .history-reasoning, details")
        .exists(),
    ).toBe(false);
    expect(wrapper.get(".work-history-time").text()).toBe(
      "Worked for 1 min 43 sec",
    );
    wrapper.unmount();
  });
});

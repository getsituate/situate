import { describe, expect, it } from "vitest";
import { greetings, nextGreeting } from "./greetings";
import {
  addChat,
  createNavigationState,
  selectTab,
  updateDraft,
} from "./model";
import { createSimulation, reduceSimulation } from "../workshop/simulation";

describe("new conversation greetings", () => {
  it("cycles through all greetings without adjacent repeats", () => {
    const texts = Array.from({ length: greetings.length + 1 }, () =>
      nextGreeting("conversation"),
    );
    expect(new Set(texts).size).toBe(greetings.length);
    texts.slice(1).forEach((text, i) => expect(text).not.toBe(texts[i]));
  });
  it("assigns a new greeting to a new tab and retains existing text on switching and typing", () => {
    const initial = createNavigationState();
    const first = initial.tabs[0].greeting;
    let state = addChat(initial);
    expect(state.tabs[1].greeting).not.toBe(first);
    state = selectTab(state, "chat");
    state = updateDraft(state, "chat", "A thought");
    expect(state.tabs[0].greeting).toBe(first);
  });
  it("does not change the empty chat greeting during resize or drafting", () => {
    let state = createSimulation("chat-empty");
    const greeting = state.chat.greeting;
    state = reduceSimulation(state, { type: "platform", mobile: true });
    state = reduceSimulation(state, {
      type: "chat",
      state: { ...state.chat, draft: "A thought" },
    });
    expect(state.chat.greeting).toBe(greeting);
    expect(reduceSimulation(state, { type: "reset" }).chat.greeting).not.toBe(
      greeting,
    );
  });
});

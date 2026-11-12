import { describe, expect, it } from "vitest";
import { developmentTranscript } from "./development-transcript";
import {
  createPluginState,
  currentDevelopment,
  sendPluginRequest,
} from "./model";
import {
  startAssignmentChecks,
  finishAssignmentChecks,
  activateAssignment,
  growAssignment,
} from "./assignment-model";
import { groupEvents } from "../chat/model";

describe("development chat presentation", () => {
  it("groups implementation writes in Activity and displays note writes with their actual contents", () => {
    const d = currentDevelopment(
      createPluginState("plugins-development-changes"),
    )!;
    const events = developmentTranscript(d);
    const calls = events.filter((e) => e.kind === "call");
    expect(
      calls.some(
        (call) => call.visible && call.file === "Notes/Weekly review.md",
      ),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.file?.startsWith(".situate/plugins/"))
        .every((call) => !call.visible),
    ).toBe(true);
    expect(groupEvents(events).some((block) => block.kind === "activity")).toBe(
      true,
    );
    expect(
      events.filter((e) => e.kind === "message").map((e) => e.speaker),
    ).toEqual(["user", "assistant"]);
    expect(
      calls.find((call) => call.file === "Notes/Weekly review.md")?.after,
    ).toBe("# Weekly review\n\nReview tasks and notes.\n");
  });
  it("keeps individual writes in their own turns during follow-up work", () => {
    const state = createPluginState("plugins-development-changes");
    const d = currentDevelopment(state)!;
    const original = developmentTranscript(d).filter((e) => e.kind === "call");
    startAssignmentChecks(d);
    finishAssignmentChecks(d);
    activateAssignment(state);
    d.draft = "Change it again.";
    sendPluginRequest(state);
    const events = developmentTranscript(d);
    expect(
      events.filter((e) => e.kind === "call").slice(0, original.length),
    ).toEqual(original);
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const second = events.findIndex((e) => e.id === "request-1");
    expect(events.slice(second).some((e) => e.kind === "call")).toBe(true);
  });
  it("shows newly discovered work in the current turn rather than a future message", () => {
    const state = createPluginState("plugins-development-changes");
    growAssignment(state);
    const d = currentDevelopment(state)!;
    expect(
      developmentTranscript(d).some(
        (event) =>
          event.kind === "call" &&
          event.file === ".situate/plugins/weekly/code/src/index.ts",
      ),
    ).toBe(true);
  });
  it("excludes uncertain observations and keeps missing note contents explicit", () => {
    const d = currentDevelopment(
      createPluginState("plugins-development-parallel"),
    )!;
    expect(
      developmentTranscript(d).some((e) => e.id.includes("observed")),
    ).toBe(false);
    const note = d.inspection.recordedChanges.find(
      (change) => change.group === "workspace",
    )!;
    note.after!.status = "unavailable";
    expect(
      developmentTranscript(d).find((e) => e.id === `call-${note.id}`),
    ).toMatchObject({
      visible: true,
      contentNotice: expect.stringContaining("earlier contents"),
      after: undefined,
    });
  });
});

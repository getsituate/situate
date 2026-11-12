import { describe, expect, it } from "vitest";
import {
  createPluginState,
  finishConnectionAttempt,
  startConnectionAttempt,
  currentDevelopment,
} from "./model";
import {
  connectionAvailability,
  consumerAccessReason,
  hasConnectedAccess,
} from "./connection-readiness";

describe("connection readiness", () => {
  it("keeps enabled code separate from account access and consumer choices", () => {
    const state = createPluginState("plugins-connections");
    const inbox = state.plugins.find((p) => p.id === "inbox")!;
    expect(hasConnectedAccess(state, "gmail")).toBe(true);
    expect(consumerAccessReason(state, inbox)).toBe("");
    state.accountSelections.inbox = [];
    expect(consumerAccessReason(state, inbox)).toContain("Choose an account");
    state.accounts.gmail = [];
    expect(consumerAccessReason(state, inbox)).toContain(
      "Account access needed",
    );
    expect(state.plugins.find((p) => p.id === "gmail")!.enabled).toBe(true);
  });
  it("propagates unavailable connection functions through indirect consumers", () => {
    const state = createPluginState();
    state.connectionAvailability.calendar = "not-implemented";
    const consumer = state.plugins.find((p) => p.id === "morning")!;
    expect(consumerAccessReason(state, consumer)).toContain(
      "Access not implemented",
    );
    state.connectionAvailability.calendar = "permission";
    expect(consumerAccessReason(state, consumer)).toContain(
      "Permission needed",
    );
  });
  it("distinguishes unsupported platform access from a missing implementation", () => {
    const state = createPluginState("plugins-connection-platform");
    state.connectionPlatform = "ios";
    expect(connectionAvailability(state, "calendar")).toBe("unsupported");
    state.connectionAvailability.calendar = "permission";
    expect(connectionAvailability(state, "calendar")).toBe("unsupported");
    startConnectionAttempt(state, "calendar");
    expect(state.connectionAttempt).toBeNull();
    state.connectionAvailability.calendar = "not-implemented";
    expect(connectionAvailability(state, "calendar")).toBe("not-implemented");
  });
  it("keeps active code pending access until setup completes without extending account selections", () => {
    const state = createPluginState("plugins-development-access-needed");
    const d = currentDevelopment(state)!;
    const connection = d.packages.find((p) => p.kind === "connector")!;
    expect(d.activation).toBe("active");
    expect(connection.access).toBe("needed");
    const choices = structuredClone(state.accountSelections);
    startConnectionAttempt(state, connection.id);
    state.connectionAttempt = null;
    expect(connection.access).toBe("needed");
    startConnectionAttempt(state, connection.id);
    finishConnectionAttempt(state, true);
    expect(connection.access).toBe("ready");
    expect(state.accountSelections).toEqual(choices);
  });
});

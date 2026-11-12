import { describe, expect, it } from "vitest";
import {
  acceptHttpConsent,
  cancelHttpConsent,
  normalizeDestination,
  setAuthValue,
} from "./transport";
import {
  applyOutcome,
  beginConnection,
  cancelConnection,
  createAiState,
  currentWorkspace,
  navigate,
  startConnection,
} from "./model";
import { validateAuth } from "./fields";

function endpoint(url = "http://LAN.example.invalid:80/v1") {
  const state = createAiState("endpoint");
  state.values = { endpoint: url, credential: "example-only" };
  currentWorkspace(state).connection = {
    id: "compatible-2",
    label: "Home server",
    provider: "compatible",
    method: "key",
    endpoint: "https://previous.invalid/v1",
  };
  currentWorkspace(state).draft = "Keep this draft.";
  return state;
}
describe("destination-specific HTTP consent", () => {
  it.each([
    "localhost:8080",
    "http://",
    "http:///host.invalid",
    "http://@host.invalid",
    "http://host.invalid:",
    "http://user:secret@localhost/v1",
    "https://user@host.invalid",
    "https://host.invalid/#fragment",
    "http://host.invalid:99999",
    "http://host.invalid\\other",
    "http://host.invalid/a b",
  ])("rejects %s before connecting", (url) => {
    const state = endpoint(url);
    expect(normalizeDestination(url)).toBeNull();
    expect(validateAuth(state)).toBe(false);
    beginConnection(state);
    expect(state.screen).toBe("endpoint");
    expect(state.invalidField).toBe("endpoint");
  });
  it.each(["compatible", "llama.cpp"])(
    "requires consent before %s connection and preserves saved access until success",
    (provider) => {
      const state = endpoint();
      state.provider = provider;
      const previous = structuredClone(currentWorkspace(state));
      beginConnection(state);
      expect(state.screen).toBe("http-warning");
      expect(state.httpDestination).toBe("http://lan.example.invalid/v1");
      applyOutcome(state, "success");
      expect(currentWorkspace(state)).toEqual(previous);
      cancelHttpConsent(state);
      expect(state.screen).toBe("endpoint");
      expect(state.values.credential).toBe("example-only");
      expect(currentWorkspace(state)).toEqual(previous);
      beginConnection(state);
      expect(acceptHttpConsent(state)).toBe(true);
      beginConnection(state);
      expect(state.screen).toBe("connecting");
      expect(currentWorkspace(state)).toEqual(previous);
      applyOutcome(state, "save-error");
      expect(currentWorkspace(state)).toEqual(previous);
      beginConnection(state);
      applyOutcome(state, "success");
      expect(currentWorkspace(state).connection).toMatchObject({
        id: "compatible-2",
        label: "Home server",
        provider,
        endpoint: "http://lan.example.invalid/v1",
        httpAcknowledgement: "http://lan.example.invalid/v1",
      });
      expect(currentWorkspace(state).draft).toBe(previous.draft);
    },
  );
  it("accepts HTTPS without warning and accepts keyless endpoint access", () => {
    const state = endpoint("https://server.invalid/v1");
    state.method = "key";
    delete state.values.credential;
    expect(validateAuth(state)).toBe(true);
    beginConnection(state);
    expect(state.screen).toBe("connecting");
    expect(state.httpConsent).toBe("");
    applyOutcome(state, "success");
    expect(currentWorkspace(state).connection?.method).toBe("none");
    expect(
      currentWorkspace(state).connection?.httpAcknowledgement,
    ).toBeUndefined();
  });
  it("invalidates consent when any address edit occurs, even if changed back", () => {
    const state = endpoint();
    beginConnection(state);
    acceptHttpConsent(state);
    const approved = state.values.endpoint;
    setAuthValue(state, "endpoint", "http://other.invalid/v1");
    setAuthValue(state, "endpoint", approved);
    expect(state.httpConsent).toBe("");
    beginConnection(state);
    expect(state.screen).toBe("http-warning");
    setAuthValue(state, "endpoint", "http://third.invalid/v1");
    expect(acceptHttpConsent(state)).toBe(false);
    beginConnection(state);
    expect(state.httpDestination).toBe("http://third.invalid/v1");
  });
  it("checks the override destination and fences cancellation, restart and reset", () => {
    const state = endpoint();
    state.values["base-override"] = "http://override.invalid/v1";
    beginConnection(state);
    expect(state.httpDestination).toBe("http://override.invalid/v1");
    acceptHttpConsent(state);
    beginConnection(state);
    const attempt = state.attempt;
    const previous = structuredClone(currentWorkspace(state));
    cancelConnection(state);
    applyOutcome(state, "success", attempt);
    expect(currentWorkspace(state)).toEqual(previous);
    expect(state.httpConsent).toBe("");
    navigate(state, "settings");
    startConnection(state, "settings");
    expect(state.httpConsent).toBe("");
    expect(createAiState("endpoint").httpDestination).toBe("");
  });
});

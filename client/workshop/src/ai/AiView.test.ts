import "../ui/popover-test-environment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import AiView from "./AiView.vue";
import AiControls from "./AiControls.vue";
import { aiFixtures } from "./scenarios";
import {
  applyOutcome,
  cloneAiState,
  createAiState,
  type AiState,
} from "./model";

enableAutoUnmount(afterEach);
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});
function view(fixture = "offer") {
  let current = createAiState(fixture);
  const wrapper = mount(AiView, {
    attachTo: document.body,
    props: {
      state: current,
      "onUpdate:state": (state: AiState) => {
        current = state;
        void wrapper.setProps({ state });
      },
    },
  });
  return {
    wrapper,
    state: () => current,
    outcome: async (outcome: string) => {
      current = cloneAiState(current);
      applyOutcome(current, outcome);
      await wrapper.setProps({ state: current });
      await nextTick();
    },
  };
}
async function button(wrapper: VueWrapper, text: string) {
  const button = wrapper
    .findAll("button")
    .find(
      (button) =>
        button.text() === text ||
        button.attributes("aria-label") === text ||
        (button.find("strong").exists() &&
          button.get("strong").text() === text),
    );
  expect(button, text).toBeDefined();
  await button!.trigger("click");
  await nextTick();
}

describe("AI views", () => {
  it("identifies a named connection and permits adding another of the same provider", async () => {
    const state = createAiState("settings");
    state.workspaces.Personal.connection = {
      id: "openai-2",
      label: "Writing account",
      provider: "openai",
      method: "key",
    };
    const wrapper = mount(AiView, {
      props: {
        state,
        connectionContext: { workspace: "Personal", connected: ["openai"] },
      },
    });
    expect(wrapper.get(".heading [tabindex]").text()).toBe("Writing account");
    expect(wrapper.find(".heading").text()).toContain(
      "OpenAI · API key or token",
    );
    const add = createAiState("providers");
    await wrapper.setProps({ state: add });
    expect(
      wrapper.get('[data-provider="openai"]').attributes("disabled"),
    ).toBeUndefined();
    expect(wrapper.findAll("[data-provider]")).toHaveLength(6);
  });
  it("keeps HTTP consent on a separate destination-specific decision with drafts intact", async () => {
    const { wrapper, state, outcome } = view("endpoint");
    await wrapper.get("#endpoint").setValue("http://LAN.example.invalid:80/v1");
    await button(wrapper, "Connect endpoint");
    expect(state().screen).toBe("http-warning");
    expect(wrapper.get(".http-destination").text()).toBe(
      "http://lan.example.invalid/v1",
    );
    expect(wrapper.find("input[type=checkbox]").exists()).toBe(false);
    await button(wrapper, "Back to address");
    expect(wrapper.get<HTMLInputElement>("#endpoint").element.value).toBe(
      "http://lan.example.invalid/v1",
    );
    await button(wrapper, "Connect endpoint");
    await button(wrapper, "Connect to this address");
    expect(state().screen).toBe("connecting");
    expect(state().workspaces.Personal.connection).toBeNull();
    await outcome("success");
    expect(state().workspaces.Personal.connection?.endpoint).toBe(
      "http://lan.example.invalid/v1",
    );
  });
  it("requires a checked own-risk acknowledgement and reports guidance handoff for independent sign-in", async () => {
    const { wrapper, state } = view("warning");
    const acknowledge = () =>
      wrapper.findAll("button").find((node) => node.text() === "Continue")!;
    expect(acknowledge().attributes("disabled")).toBeDefined();
    await wrapper.get(".guidance-address").trigger("click");
    expect(state().handoff).toBe(
      "Provider guidance requested: https://orbit.example.invalid/account-access",
    );
    expect(wrapper.text()).not.toContain("Provider guidance requested");
    await wrapper.get("#warning-ack").setValue(true);
    await acknowledge().trigger("click");
    expect(state().screen).toBe("browser");
    await button(wrapper, "Open sign-in in browser");
    expect(state().browserOpened).toBe(true);
  });
  it("does not offer acknowledgement or handoff for a known prohibited method", () => {
    const { wrapper } = view("blocked-subscription");
    expect(wrapper.text()).toContain("Anthropic does not allow");
    expect(wrapper.find("#warning-ack").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Open sign-in in browser");
  });
  it("distinguishes forgetting this device from connection removal and provider revocation", async () => {
    const { wrapper, state } = view("settings");
    const original = cloneAiState(state()).workspaces;
    await button(wrapper, "Forget sign-in");
    expect(wrapper.text()).toContain(
      "Other devices and workspaces are not affected",
    );
    await button(wrapper, "Keep sign-in");
    expect(state().workspaces).toEqual(original);
    await button(wrapper, "Forget sign-in");
    await button(wrapper, "Forget sign-in");
    expect(state().workspaces.Personal.connection).toEqual(
      original.Personal.connection,
    );
    expect(state().workspaces.Personal.unavailable).toBe("missing");
    expect(state().workspaces.Studio).toEqual(original.Studio);
    expect(wrapper.text()).toContain("does not do that");
    await button(wrapper, "Remove connection");
    expect(wrapper.text()).toContain(
      "Other devices and workspaces keep their connections",
    );
    await button(wrapper, "Remove connection");
    expect(state().workspaces.Personal.connection).toBeNull();
    expect(state().workspaces.Studio).toEqual(original.Studio);
  });
  it("offers storage retry for a lock but ordinary setup on a new device", async () => {
    const { wrapper, state, outcome } = view("locked");
    expect(wrapper.text()).toContain("Your sign-in details are locked");
    await button(wrapper, "Try again");
    expect(state().storeRetry).toBe(true);
    await outcome("store-ready");
    expect(state().workspaces.Personal.unavailable).toBeNull();
    const missing = view("missing");
    expect(missing.wrapper.text()).toContain("Set up AI on this device");
    expect(missing.wrapper.text()).not.toContain("Try again");
    expect(missing.wrapper.find('input[type="password"]').exists()).toBe(false);
  });
  it("removes local bypasses only inside required guided setup", async () => {
    const { wrapper } = view("offer");
    expect(wrapper.find('[data-action="skip"]').exists()).toBe(true);
    await wrapper.setProps({
      requiredSetup: true,
      connectionContext: { workspace: "Reading room", connected: [] },
    });
    expect(wrapper.find('[data-action="skip"]').exists()).toBe(false);
    expect(wrapper.find(".setup-progress").exists()).toBe(false);
    await wrapper.setProps({ state: createAiState("offline") });
    expect(wrapper.find('[data-action="local"]').exists()).toBe(false);
    expect(wrapper.find('[data-action="providers"]').exists()).toBe(true);
    expect(wrapper.find('[data-action="retry"]').exists()).toBe(true);
  });
  it.each(aiFixtures.map((fixture) => fixture.state))(
    "renders %s without raw HTML replicas or host chrome",
    (fixture) => {
      const { wrapper } = view(fixture);
      expect(wrapper.get("h1").text()).not.toBe("");
      expect(wrapper.find("iframe").exists()).toBe(false);
      expect(wrapper.find(".window-titlebar").exists()).toBe(false);
    },
  );
  it("keeps setup separate, confirms skip, returns focus and leaves local editing available", async () => {
    const { wrapper, state } = view();
    await nextTick();
    expect(wrapper.find("nav").exists()).toBe(false);
    expect(wrapper.find("#workspace").exists()).toBe(false);
    await button(wrapper, "Skip for now");
    expect(wrapper.get<HTMLDialogElement>("#skip-dialog").element.open).toBe(
      true,
    );
    expect(document.activeElement?.id).toBe("dismiss-skip");
    await wrapper.get("#skip-dialog").trigger("cancel");
    await nextTick();
    expect(state().dialog).toBeNull();
    expect(document.activeElement?.getAttribute("data-action")).toBe("skip");
    await button(wrapper, "Skip for now");
    await button(wrapper, "Continue without AI");
    await wrapper.get("#local-note").setValue("A local change");
    await button(wrapper, "Open chat");
    expect(state().screen).toBe("chat");
    expect(state().workspaces.Personal.note).toBe("A local change");
    expect(wrapper.find('.chat-layout [data-action="connect"]').exists()).toBe(
      false,
    );
  });
  it("filters providers, focuses invalid fields and reveals only example values", async () => {
    const { wrapper, state } = view("providers");
    await wrapper.get("#search").setValue("no such provider");
    expect(wrapper.text()).toContain("No matching provider");
    await wrapper.get("#search").setValue("OpenAI");
    await wrapper.get('[data-provider="openai"]').trigger("click");
    await wrapper.get('[data-method="key"]').trigger("click");
    await button(wrapper, "Connect");
    expect(document.activeElement?.id).toBe("credential");
    expect(wrapper.get("#credential").attributes("aria-invalid")).toBe("true");
    await wrapper.get("#credential").setValue("example-only");
    await button(wrapper, "Show value");
    expect(wrapper.get("#credential").attributes("type")).toBe("text");
    await button(wrapper, "Connect");
    expect(state().screen).toBe("connecting");
    await button(wrapper, "Cancel connection");
    expect(state().values).toEqual({});
  });
  it("emits synchronous snapshots without mutating props or losing same-tick edits", () => {
    const original = createAiState("key");
    original.explorationMode = true;
    const wrapper = mount(AiView, { props: { state: original } });
    const credential = wrapper.get<HTMLInputElement>("#credential").element;
    credential.value = "example";
    credential.dispatchEvent(new Event("input", { bubbles: true }));
    const override = wrapper.get<HTMLInputElement>("#base-override").element;
    override.value = "https://example.invalid";
    override.dispatchEvent(new Event("input", { bubbles: true }));
    const emitted = wrapper.emitted("update:state")!.at(-1)![0] as AiState;
    expect(emitted.values).toEqual({
      credential: "example",
      "base-override": "https://example.invalid",
    });
    expect(original.values).toEqual({});
    expect(JSON.parse(JSON.stringify(emitted))).toEqual(emitted);
  });
  it("shows only live pending outcomes in controls and keeps managed handoff outside the preview", async () => {
    const { wrapper, state } = view("offer");
    await button(wrapper, "Situate managed AI");
    expect(wrapper.text()).not.toContain("Managed AI handoff");
    expect(state().workspaces.Personal.connection).toBeNull();
    const controls = mount(AiControls, { props: { state: state() } });
    expect(controls.text()).toContain("Managed AI handoff");
    expect(controls.find("[data-outcome]").exists()).toBe(false);
    await controls.setProps({ state: createAiState("chat-saving") });
    expect(
      controls
        .findAll("[data-outcome]")
        .map((node) => node.attributes("data-outcome")),
    ).toEqual(["model-saved", "model-save-error", "model-save-uncertain"]);
    await controls.setProps({ state: createAiState("chat-streaming") });
    expect(
      controls
        .findAll("[data-outcome]")
        .map((node) => node.attributes("data-outcome")),
    ).toEqual(["model-response-finished"]);
  });
});

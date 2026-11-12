import { mount, enableAutoUnmount } from "@vue/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, provide, ref } from "vue";
import SetupFrame from "./SetupFrame.vue";
import { creationTransition } from "./creation-transition";
import { transitionFrame, type SetupTransitionFrame } from "./setup-transition";

enableAutoUnmount(afterEach);
let callbacks: Map<number, FrameRequestCallback>;
let reduce: () => void;
let preference: {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  callbacks = new Map();
  let id = 0;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callbacks.set(++id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => callbacks.delete(id));
  preference = {
    matches: false,
    addEventListener: vi.fn((_event, listener) => {
      reduce = listener;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal("matchMedia", () => preference);
});
afterEach(() => vi.unstubAllGlobals());
async function tick(time: number) {
  for (const [id, callback] of [...callbacks]) {
    callbacks.delete(id);
    callback(time);
  }
  await nextTick();
}
function fixture(initial = 1) {
  const step = ref(initial),
    blocked = ref(false),
    paused = ref(false);
  const view = mount(
    defineComponent({
      setup() {
        return () =>
          h(
            SetupFrame,
            { step: step.value, blocked: blocked.value, paused: paused.value },
            {
              default: () => [
                h("h1", `Task ${step.value}`),
                h("button", `Continue ${step.value}`),
              ],
            },
          );
      },
    }),
    { attachTo: document.body },
  );
  return {
    view,
    step,
    blocked,
    paused,
    panel: () => view.get<HTMLElement>(".setup-panel"),
  };
}
it("mounts into an existing handoff without rendering the next task before its reveal", async () => {
  const frame = ref<SetupTransitionFrame | undefined>(
    transitionFrame(250, 0, 1),
  );
  const restoreFocus = ref(true);
  const finish = vi.fn(() => {
    frame.value = undefined;
  });
  const view = mount(
    defineComponent({
      setup() {
        provide(creationTransition, { frame, restoreFocus, finish });
        return () =>
          h(SetupFrame, { step: 1 }, { default: () => h("h1", "Provider") });
      },
    }),
    { attachTo: document.body },
  );
  const panel = view.get<HTMLElement>(".setup-panel");
  expect(panel.element.style.opacity).toBe("0");
  expect(view.find("h1").exists()).toBe(false);
  expect(callbacks.size).toBe(0);
  frame.value = transitionFrame(2350, 0, 1);
  await nextTick();
  expect(view.get("h1").text()).toBe("Provider");
  expect(panel.element.style.opacity).toBe("0");
  frame.value = undefined;
  await nextTick();
  await nextTick();
  expect(document.activeElement).toBe(view.get("h1").element);
  expect(panel.attributes("inert")).toBeUndefined();
  expect(finish).not.toHaveBeenCalled();
});

it.each([false, true])(
  "does not steal outside focus when a shared handoff ends (removed: %s)",
  async (removed) => {
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    try {
      const frame = ref<SetupTransitionFrame | undefined>(
        transitionFrame(250, 0, 1),
      );
      const view = mount(
        defineComponent({
          setup() {
            provide(creationTransition, {
              frame,
              restoreFocus: ref(true),
              finish: () => {
                frame.value = undefined;
              },
            });
            return () =>
              h(
                SetupFrame,
                { step: 1 },
                { default: () => h("h1", "Provider") },
              );
          },
        }),
        { attachTo: document.body },
      );
      expect(document.activeElement).toBe(outside);
      if (removed) view.unmount();
      frame.value = undefined;
      await nextTick();
      await nextTick();
      expect(document.activeElement).toBe(outside);
      expect(callbacks.size).toBe(0);
    } finally {
      outside.remove();
    }
  },
);

it.each(["blocked", "paused"] as const)(
  "settles a shared creation handoff on %s",
  async (reason) => {
    const frame = ref<SetupTransitionFrame | undefined>(
      transitionFrame(250, 0, 1),
    );
    const suppressed = ref(false);
    const finish = vi.fn(() => {
      frame.value = undefined;
    });
    const view = mount(
      defineComponent({
        setup() {
          provide(creationTransition, {
            frame,
            restoreFocus: ref(false),
            finish,
          });
          return () =>
            h(
              SetupFrame,
              { step: 1, [reason]: suppressed.value },
              { default: () => h("h1", "Provider") },
            );
        },
      }),
    );
    expect(view.find("h1").exists()).toBe(false);
    suppressed.value = true;
    await nextTick();
    expect(finish).toHaveBeenCalledOnce();
    expect(view.get("h1").text()).toBe("Provider");
    expect(view.get(".setup-panel").attributes("inert")).toBeUndefined();
    view.unmount();
    expect(callbacks.size).toBe(0);
  },
);

it("retains the outgoing task, then completes Spark, travel and incoming fade in order", async () => {
  const f = fixture();
  f.view.get("button").element.focus();
  f.step.value = 2;
  await nextTick();
  expect(f.panel().text()).toContain("Task 1");
  expect(f.panel().attributes("inert")).toBeDefined();
  expect(document.activeElement).toBe(document.body);
  await tick(0);
  await tick(125);
  expect(Number(f.panel().element.style.opacity)).toBeGreaterThan(0);
  expect(Number(f.panel().element.style.opacity)).toBeLessThan(1);
  await tick(250);
  expect(f.panel().element.style.visibility).toBe("hidden");
  expect(f.view.find(".sparkles").exists()).toBe(false);
  const origin = f.view.get(".setup-illustration").attributes("data-position");
  await tick(900);
  expect(f.view.find(".sparkles").exists()).toBe(true);
  expect(f.view.get(".setup-illustration").attributes("data-position")).toBe(
    origin,
  );
  expect(f.panel().text()).not.toContain("Task 2");
  await tick(1150);
  expect(f.view.find(".sparkles").exists()).toBe(false);
  await tick(1750);
  expect(f.panel().attributes("data-transition-phase")).toBe("travel");
  expect(
    f.view.get(".setup-illustration").attributes("data-position"),
  ).not.toBe(origin);
  expect(f.panel().element.style.visibility).toBe("hidden");
  await tick(2350);
  expect(f.panel().text()).toContain("Task 2");
  expect(f.panel().element.style.opacity).toBe("0");
  const destination = f.view
    .get(".setup-illustration")
    .attributes("data-position");
  await tick(2500);
  expect(f.panel().attributes("inert")).toBeDefined();
  expect(f.view.get(".setup-illustration").attributes("data-position")).toBe(
    destination,
  );
  await tick(2700);
  await nextTick();
  expect(f.panel().attributes("inert")).toBeUndefined();
  expect(f.panel().element.style.opacity).toBe("");
  expect(document.activeElement).toBe(f.view.get("h1").element);
  expect(callbacks.size).toBe(0);
});
it.each(["blocked", "paused"] as const)(
  "settles on %s without keeping errors or controls hidden",
  async (reason) => {
    const f = fixture();
    f.step.value = 2;
    await nextTick();
    await tick(0);
    await tick(900);
    f[reason].value = true;
    await nextTick();
    expect(f.panel().text()).toContain("Task 2");
    expect(f.panel().attributes("inert")).toBeUndefined();
    expect(callbacks.size).toBe(0);
  },
);
it("settles on repeated navigation and rollback without queuing celebrations", async () => {
  const f = fixture();
  f.step.value = 2;
  await nextTick();
  f.step.value = 3;
  await nextTick();
  expect(f.panel().text()).toContain("Task 3");
  expect(callbacks.size).toBe(0);
  f.step.value = 1;
  await nextTick();
  expect(f.panel().text()).toContain("Task 1");
  expect(callbacks.size).toBe(0);
});
it("does not replay resumed progress and honors initial and live reduced motion", async () => {
  preference.matches = true;
  const f = fixture(3);
  expect(callbacks.size).toBe(0);
  f.step.value = 4;
  await nextTick();
  expect(f.panel().text()).toContain("Task 4");
  expect(f.panel().attributes("inert")).toBeUndefined();
  preference.matches = false;
  reduce();
  f.step.value = 5;
  await nextTick();
  expect(f.panel().attributes("inert")).toBeDefined();
  preference.matches = true;
  reduce();
  await nextTick();
  expect(f.panel().text()).toContain("Task 5");
  expect(f.panel().attributes("inert")).toBeUndefined();
  f.view.unmount();
  expect(callbacks.size).toBe(0);
});

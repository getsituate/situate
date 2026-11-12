import { afterEach, expect, it, vi } from "vitest";
import {
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  nextTick,
  onMounted,
  ref,
  type Component,
} from "vue";
import { flushPromises } from "@vue/test-utils";
import { withPluginCheckFocus } from "../../tests/support/native-plugin-focus";
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function button() {
  const element = document.createElement("button");
  document.body.append(element);
  return element;
}

it.each([true, false])(
  "retains a stable DOM focus target when window focus changes from %s",
  async (initial) => {
    const previous = button();
    previous.focus();
    const focused = vi.spyOn(document, "hasFocus").mockReturnValue(initial);
    const result = await withPluginCheckFocus(async () => {
      expect(document.activeElement).not.toBe(previous);
      focused.mockReturnValue(!initial);
      return "checked";
    });
    expect(result).toBe("checked");
    expect(document.activeElement).toBe(previous);
    expect(document.body.children.length).toBe(1);
  },
);

it("installs the sentinel after queued host focus is delivered", async () => {
  const previous = button();
  previous.focus();
  const header = button();
  header.className = "pane-title";
  void nextTick(() => header.focus());
  await withPluginCheckFocus(async () => {
    await nextTick();
  });
  expect(document.activeElement).toBe(header);
});

it("rejects focus from an unresolved lazy host mounted after checks begin", async () => {
  let resolve!: (component: Component) => void;
  const loaded = new Promise<Component>((done) => {
    resolve = done;
  });
  const host = document.createElement("div");
  host.className = "topic-window";
  document.body.append(host);
  const app = createApp(defineAsyncComponent(() => loaded));
  app.mount(host);
  try {
    await expect(
      withPluginCheckFocus(async () => {
        resolve(
          defineComponent({
            setup() {
              const title = ref<HTMLButtonElement>();
              onMounted(() => title.value?.focus());
              return () => h("button", { ref: title, class: "pane-title" });
            },
          }),
        );
        await flushPromises();
      }),
    ).rejects.toThrow("Plugin checks changed workspace focus");
    expect(document.activeElement).toBe(host.querySelector("button"));
  } finally {
    app.unmount();
  }
});

it("does not confuse replacement of the previous view with preview focus", async () => {
  const previous = button();
  previous.focus();
  await withPluginCheckFocus(async () => {
    previous.remove();
    button();
  });
  expect(document.activeElement).toBe(document.body);
  expect(document.body.children.length).toBe(1);
});

it("rejects focus taken by plugin code without hiding the new target", async () => {
  const previous = button();
  previous.focus();
  const other = button();
  other.dataset.pluginPreview = "";
  other.className = "synthetic-preview";
  other.textContent = "Private fixture content";
  const failure = await withPluginCheckFocus(async () => other.focus()).catch(
    (error: Error) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  expect((failure as Error).message).toContain(
    "Plugin checks changed workspace focus",
  );
  expect((failure as Error).message).toContain('"preview":true');
  expect((failure as Error).message).toContain(
    '"classes":["synthetic-preview"]',
  );
  expect((failure as Error).message).not.toContain("Private fixture content");
  expect(document.activeElement).toBe(other);
  expect(document.body.children.length).toBe(2);
});

it("detects a transient preview even when it preserves focus and is removed before completion", async () => {
  const previous = button();
  previous.focus();
  await expect(
    withPluginCheckFocus(async () => {
      const preview = document.createElement("div");
      preview.dataset.pluginPreview = "";
      document.body.append(preview);
      expect(document.activeElement).not.toBe(preview);
      preview.remove();
    }),
  ).rejects.toThrow("Plugin checks mounted a preview in the workspace window");
  expect(document.activeElement).toBe(previous);
  expect(document.body.children.length).toBe(1);
});

it("cleans up and restores the previous focus when execution fails", async () => {
  const previous = button();
  previous.focus();
  const error = new Error("check failed");
  await expect(
    withPluginCheckFocus(async () => {
      throw error;
    }),
  ).rejects.toBe(error);
  expect(document.activeElement).toBe(previous);
  expect(document.body.children.length).toBe(1);
});

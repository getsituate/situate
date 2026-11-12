import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { defineComponent, ref } from "vue";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { loadModelCatalog } from "./api";
import * as metadata from "./model-catalog";
import { useModelCatalog } from "./useModelCatalog";

vi.mock("./api", () => ({ loadModelCatalog: vi.fn() }));
enableAutoUnmount(afterEach);
beforeEach(() =>
  vi.mocked(loadModelCatalog).mockReset().mockResolvedValue(metadata),
);

function harness(initial = true) {
  const needed = ref(initial);
  let state!: ReturnType<typeof useModelCatalog>;
  const wrapper = mount(
    defineComponent({
      setup() {
        state = useModelCatalog(() => needed.value);
        return () => null;
      },
    }),
  );
  return { needed, state, wrapper };
}

test("loads only when needed and retains ready metadata without another request", async () => {
  const { needed, state } = harness(false);
  expect(loadModelCatalog).not.toHaveBeenCalled();
  expect(state.catalog.value).toBeNull();
  needed.value = true;
  await flushPromises();
  expect(loadModelCatalog).toHaveBeenCalledOnce();
  expect(state.catalog.value).toBe(metadata);
  needed.value = false;
  await flushPromises();
  needed.value = true;
  await flushPromises();
  expect(loadModelCatalog).toHaveBeenCalledOnce();
});

test("exposes failure without partial metadata or automatic retries", async () => {
  vi.mocked(loadModelCatalog).mockRejectedValueOnce(
    new Error("Unavailable chunk"),
  );
  const { state } = harness();
  expect(state.loading.value).toBe(true);
  await flushPromises();
  expect(state.catalog.value).toBeNull();
  expect(state.loading.value).toBe(false);
  expect(state.failed.value).toBe(true);
  expect(loadModelCatalog).toHaveBeenCalledOnce();
  await state.reload();
  expect(state.failed.value).toBe(false);
  expect(state.catalog.value).toBe(metadata);
  expect(loadModelCatalog).toHaveBeenCalledTimes(2);
});

test("ignores a superseded load even when it fails after a newer load succeeds", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(loadModelCatalog).mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { needed, state } = harness();
  needed.value = false;
  await flushPromises();
  needed.value = true;
  await flushPromises();
  expect(state.catalog.value).toBe(metadata);
  reject(new Error("Late load failure"));
  await flushPromises();
  expect(state.catalog.value).toBe(metadata);
  expect(state.failed.value).toBe(false);
  expect(state.loading.value).toBe(false);
});

test("does not publish a pending result after unmount", async () => {
  let finish!: (value: typeof metadata) => void;
  vi.mocked(loadModelCatalog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { state, wrapper } = harness();
  wrapper.unmount();
  finish(metadata);
  await flushPromises();
  expect(state.catalog.value).toBeNull();
});

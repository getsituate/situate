import { onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { loadModelCatalog } from "./api";

export function useModelCatalog(needed: () => boolean) {
  const catalog = shallowRef<Awaited<
    ReturnType<typeof loadModelCatalog>
  > | null>(null);
  const loading = ref(false);
  const failed = ref(false);
  let revision = 0;
  let alive = true;

  async function reload(): Promise<void> {
    if (!alive || !needed()) return;
    const request = ++revision;
    loading.value = true;
    failed.value = false;
    try {
      const loaded = await loadModelCatalog();
      if (alive && request === revision) catalog.value = loaded;
    } catch {
      if (alive && request === revision) failed.value = true;
    } finally {
      if (alive && request === revision) loading.value = false;
    }
  }
  watch(
    needed,
    (value) => {
      revision++;
      loading.value = false;
      failed.value = false;
      if (value && !catalog.value) void reload();
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    alive = false;
    revision++;
  });
  return { catalog, loading, failed, reload };
}

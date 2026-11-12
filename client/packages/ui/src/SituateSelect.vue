<script setup lang="ts">
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  ref,
  shallowRef,
  useAttrs,
  useId,
  watch,
} from "vue";
import SituateIcon from "./SituateIcon.vue";
import { t } from "@situate/localization";
import { selectEnvironment } from "./select-context";
import "./select.css";

defineOptions({ inheritAttrs: false });
const props = defineProps<{
  id?: string;
  value?: string | number;
  modelValue?: string | number;
  modelModifiers?: { number?: boolean };
  name?: string;
  disabled?: boolean;
  required?: boolean;
  form?: string;
  appearance?: "field" | "toolbar";
}>();
const emit = defineEmits<{
  change: [event: Event];
  input: [event: Event];
  "update:modelValue": [value: string | number];
}>();
const c = computed(() => ({
  title: t("ui.select.title"),
  close: t("ui.select.close"),
  empty: t("ui.select.empty"),
  required: t("ui.select.required"),
}));
const boundValue = computed(() => props.modelValue ?? props.value);
const attrs = useAttrs();
const environment = inject(selectEnvironment, undefined);
const generatedId = useId();
const controlId = computed(() => props.id ?? `select-${generatedId}`);
const popupId = `choices-${generatedId}`;
const native = ref<HTMLSelectElement>();
const trigger = ref<HTMLButtonElement>();
const popup = ref<HTMLDialogElement>();
const list = ref<HTMLElement>();
const options = shallowRef<
  {
    value: string;
    label: string;
    disabled: boolean;
    group: string;
    content: string | undefined;
  }[]
>([]);
const selected = ref(-1);
const active = ref(-1);
const currentValue = ref("");
const open = ref(false);
const sheet = ref(false);
const label = ref("");
const invalid = ref(false);
const display = computed(
  () => options.value[selected.value]?.label ?? c.value.title,
);
const enabled = computed(() =>
  options.value.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0),
);
let observer: ResizeObserver | undefined;
let frame = 0;
let media: MediaQueryList | undefined;
let prefix = "";
let lastKey = 0;

function accessibleLabel() {
  if (attrs["aria-label"]) return String(attrs["aria-label"]);
  if (attrs["aria-labelledby"])
    return String(attrs["aria-labelledby"])
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
  return (
    Array.from(trigger.value?.labels ?? [])
      .map((element) => {
        const copy = element.cloneNode(true) as HTMLElement;
        copy
          .querySelectorAll(".situate-select, small")
          .forEach((node) => node.remove());
        return copy.textContent?.trim() ?? "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim() || c.value.title
  );
}
function sync() {
  if (!native.value) return;
  const next = Array.from(native.value.options).map((o) => ({
    value: o.value,
    label: o.label.trim(),
    content: o.dataset.localizationContent,
    disabled:
      o.disabled ||
      (o.parentElement instanceof HTMLOptGroupElement &&
        o.parentElement.disabled),
    group:
      o.parentElement instanceof HTMLOptGroupElement
        ? o.parentElement.label
        : "",
  }));
  if (JSON.stringify(next) !== JSON.stringify(options.value))
    options.value = next;
  selected.value = native.value.selectedIndex;
  currentValue.value = native.value.value;
  if (native.value.validity.valid) invalid.value = false;
  label.value = accessibleLabel();
  if (open.value && !enabled.value.includes(active.value))
    active.value = enabled.value[0] ?? -1;
}
function bounds() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const right = left + (viewport?.width ?? innerWidth);
  const bottom = top + (viewport?.height ?? innerHeight);
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}
function place() {
  if (!open.value || !popup.value || !trigger.value) return;
  const box = bounds();
  const anchor = trigger.value.getBoundingClientRect();
  sheet.value =
    !!environment?.mobile.value || !!media?.matches || box.width < 480;
  const panel = popup.value;
  panel.style.width = `${sheet.value ? box.width : Math.min(Math.max(anchor.width, 288), box.width - 16)}px`;
  panel.style.maxHeight = `${Math.max(0, Math.min(sheet.value ? 560 : 400, box.height - 16))}px`;
  const height = panel.getBoundingClientRect().height;
  const below = box.bottom - anchor.bottom - 8;
  const above = anchor.top - box.top - 8;
  const upward = !sheet.value && height > below && above > below;
  if (!sheet.value)
    panel.style.maxHeight = `${Math.max(0, Math.min(400, Math.max(below, above), box.height - 16))}px`;
  const finalHeight = panel.getBoundingClientRect().height;
  panel.style.left = `${sheet.value ? box.left : Math.max(box.left + 8, Math.min(anchor.left, box.right - panel.getBoundingClientRect().width - 8))}px`;
  panel.style.top = `${sheet.value ? box.bottom - finalHeight : Math.max(box.top + 8, Math.min(upward ? anchor.top - finalHeight - 4 : anchor.bottom + 4, box.bottom - finalHeight - 8))}px`;
}
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(place);
}
async function reveal() {
  await nextTick();
  list.value
    ?.querySelector<HTMLElement>(`[data-option-index="${active.value}"]`)
    ?.scrollIntoView({ block: "nearest" });
}
async function show() {
  if (props.disabled || open.value) return;
  sync();
  active.value = enabled.value.includes(selected.value)
    ? selected.value
    : (enabled.value[0] ?? -1);
  prefix = "";
  open.value = true;
  await nextTick();
  popup.value?.showModal();
  place();
  await nextTick();
  place();
  list.value?.focus({ preventScroll: true });
  await reveal();
}
function dismiss() {
  popup.value?.close();
  open.value = false;
  if (trigger.value?.isConnected && !props.disabled)
    trigger.value.focus({ preventScroll: true });
}
function choose(index: number) {
  const option = options.value[index];
  if (!option || option.disabled || !native.value || props.disabled) return;
  const changed = native.value.selectedIndex !== index;
  native.value.selectedIndex = index;
  invalid.value = false;
  dismiss();
  if (changed) {
    native.value.dispatchEvent(new Event("input", { bubbles: true }));
    native.value.dispatchEvent(new Event("change", { bubbles: true }));
  }
  sync();
}
function input(event: Event) {
  sync();
  emit("input", event);
}
function change(event: Event) {
  sync();
  invalid.value = false;
  const value = (event.target as HTMLSelectElement).value;
  const number = Number.parseFloat(value);
  emit(
    "update:modelValue",
    props.modelModifiers?.number && !Number.isNaN(number) ? number : value,
  );
  emit("change", event);
  sync();
}
function keyboard(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
    return;
  }
  if (["Enter", " "].includes(event.key)) {
    event.preventDefault();
    choose(active.value);
    return;
  }
  let index = enabled.value.indexOf(active.value);
  if (event.key === "ArrowDown")
    index = Math.min(index + 1, enabled.value.length - 1);
  else if (event.key === "ArrowUp") index = Math.max(index - 1, 0);
  else if (event.key === "Home") index = 0;
  else if (event.key === "End") index = enabled.value.length - 1;
  else if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    const now = Date.now();
    prefix = now - lastKey > 700 ? event.key : prefix + event.key;
    lastKey = now;
    const search = [
      ...enabled.value.slice(index + 1),
      ...enabled.value.slice(0, index + 1),
    ];
    const repeated = [...prefix].every((char) => char === prefix[0]);
    const found = search.find((i) =>
      options.value[i]!.label.toLocaleLowerCase().startsWith(
        (repeated ? event.key : prefix).toLocaleLowerCase(),
      ),
    );
    if (found !== undefined) {
      active.value = found;
      void reveal();
    }
    event.preventDefault();
    return;
  } else return;
  event.preventDefault();
  active.value = enabled.value[index] ?? -1;
  void reveal();
}
function triggerKey(event: KeyboardEvent) {
  if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    void show();
  }
}
function trapTab(event: KeyboardEvent) {
  if (event.key !== "Tab") return;
  event.preventDefault();
  if (document.activeElement === list.value)
    popup.value?.querySelector<HTMLButtonElement>(".select-close")?.focus();
  else list.value?.focus();
}
function backdrop(event: MouseEvent) {
  if (event.target !== popup.value) return;
  const box = popup.value.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    dismiss();
}
function reset() {
  invalid.value = false;
  void nextTick(sync);
}
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && open.value) dismiss();
  },
);
watch(() => environment?.mobile.value, schedule);
onMounted(() => {
  sync();
  media = window.matchMedia?.("(pointer: coarse)");
  media?.addEventListener("change", schedule);
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  native.value?.form?.addEventListener("reset", reset);
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(schedule);
    if (trigger.value) observer.observe(trigger.value);
  }
});
onUpdated(() => {
  sync();
  if (open.value) schedule();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  cancelAnimationFrame(frame);
  media?.removeEventListener("change", schedule);
  window.removeEventListener("resize", schedule);
  window.visualViewport?.removeEventListener("resize", schedule);
  window.visualViewport?.removeEventListener("scroll", schedule);
  native.value?.form?.removeEventListener("reset", reset);
  popup.value?.close();
});
defineExpose({
  element: native,
  focus: (options?: FocusOptions) => trigger.value?.focus(options),
});
</script>
<template>
  <span
    class="situate-select"
    :class="{ 'situate-select-toolbar': appearance === 'toolbar' }"
  >
    <button
      v-bind="$attrs"
      :id="controlId"
      ref="trigger"
      class="situate-select-trigger"
      type="button"
      tabindex="0"
      role="combobox"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-controls="open ? popupId : undefined"
      :aria-required="required || undefined"
      :aria-describedby="
        [attrs['aria-describedby'], invalid ? `${popupId}-error` : '']
          .filter(Boolean)
          .join(' ') || undefined
      "
      :aria-invalid="
        invalid
          ? true
          : (attrs['aria-invalid'] as
              boolean | 'true' | 'false' | 'grammar' | 'spelling' | undefined)
      "
      :data-value="currentValue"
      @click="show"
      @keydown="triggerKey"
    >
      <span
        class="select-value"
        :data-localization-content="options[selected]?.content"
        >{{ display }}</span
      >
      <span class="select-chevron" aria-hidden="true"
        ><SituateIcon name="chevron"
      /></span>
    </button>
    <select
      ref="native"
      hidden
      aria-hidden="true"
      tabindex="-1"
      :name="name"
      :form="form"
      :disabled="disabled"
      :required="required"
      v-bind="boundValue === undefined ? {} : { value: boundValue }"
      @input="input"
      @change="change"
      @invalid.prevent="
        invalid = true;
        trigger?.focus();
      "
    >
      <slot />
    </select>
    <span
      v-if="invalid"
      :id="`${popupId}-error`"
      class="select-validation"
      role="alert"
      >{{ c.required }}</span
    >
    <Teleport :to="environment?.popupTarget?.value ?? 'body'">
      <dialog
        v-if="open"
        :id="popupId"
        ref="popup"
        class="situate-select-popup"
        :class="{ 'select-sheet': sheet }"
        :aria-labelledby="`${popupId}-title`"
        @cancel.prevent.stop="dismiss"
        @click="backdrop"
        @keydown="trapTab"
      >
        <header class="select-popup-header">
          <h2 :id="`${popupId}-title`">{{ label }}</h2>
          <button
            type="button"
            class="select-close"
            :aria-label="c.close"
            @click="dismiss"
          >
            <SituateIcon name="close" />
          </button>
        </header>
        <div
          ref="list"
          class="select-options"
          role="listbox"
          tabindex="0"
          :aria-label="label"
          :aria-activedescendant="
            active >= 0 ? `${popupId}-option-${active}` : undefined
          "
          @keydown="keyboard"
        >
          <template
            v-for="(option, index) in options"
            :key="`${index}-${option.value}`"
          >
            <p
              v-if="option.group && option.group !== options[index - 1]?.group"
              class="select-option-group"
            >
              {{ option.group }}
            </p>
            <div
              v-if="option.value !== '' || !option.disabled"
              :id="`${popupId}-option-${index}`"
              role="option"
              :aria-label="
                option.group ? `${option.group}: ${option.label}` : undefined
              "
              :aria-selected="index === selected"
              :aria-disabled="option.disabled || undefined"
              :data-option-index="index"
              :data-option-value="option.value"
              class="select-option"
              :class="{ 'is-active': index === active }"
              @click="choose(index)"
            >
              <span :data-localization-content="option.content">{{
                option.label
              }}</span
              ><span class="select-check" aria-hidden="true">{{
                index === selected ? "✓" : ""
              }}</span>
            </div>
          </template>
          <p v-if="!options.length" class="select-empty">{{ c.empty }}</p>
        </div>
      </dialog>
    </Teleport>
  </span>
</template>

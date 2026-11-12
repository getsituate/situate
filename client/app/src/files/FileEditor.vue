<script setup lang="ts">
import {
  t,
  localizeError,
  formatDateTime,
  isMessageKey,
  localizeHistorySummary,
} from "@situate/localization";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  toRaw,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import {
  SituateEmptyState,
  SituateTextarea,
  SituateButton,
  SituateDialogActions,
  SituateInput,
  SituateRadio,
  SituateIcon,
  SituateIconButton,
  SituateResizeHandle,
} from "@situate/ui";
import FileDialog from "./FileDialog.vue";
import FileActionMenu from "./FileActionMenu.vue";
import {
  actionRequest,
  creationFolder,
  duplicatePath,
  fileMenu,
  inFolder,
  itemName,
  parentFolder,
  type FileAction,
  markdownWordCount,
  compareFileEntries,
} from "./fileActions";
import RenderedFile from "./RenderedFile.vue";
import SourceText from "./SourceText.vue";
import { highlightSource } from "./source-highlighting";
import ErrorActions from "../errors/ErrorActions.vue";
import {
  discardFile,
  loadWorkspace,
  openFile,
  pollWorkspace,
  request,
  retryFile,
  saveFile,
  workspaceSession,
  editFile,
  retainConflict,
  observeFiles,
  type FileSession,
} from "./sessions";
import type { PresentationValue } from "../layout/navigation";
import { referenceKey } from "../ai/content-references";
import {
  filePresentation,
  safeFileTarget,
  type FilePaneTarget,
  type FilePaneNavigation,
  type FilePaneReference,
  type FilePaneIdentityChange,
} from "./presentation";
import {
  localizeFileError,
  type FileDocument,
  type FilesOperation,
  type FilesReply,
  type HistoryEntry,
} from "./api";
import { newMarkdownPath } from "./paths";
import { diagnosticsFor } from "../diagnostics";
import "./files.css";

const props = defineProps<{
  workspaceId: string;
  workspaceName: string;
  pluginId?: string;
  showNavigation?: boolean;
  target?: FilePaneTarget;
  presentation?: PresentationValue;
  embedded?: boolean;
}>();
const emit = defineEmits<{
  navigation: [event: MouseEvent];
  leave: [];
  navigate: [target: FilePaneNavigation, presentation?: PresentationValue];
  presentation: [value: PresentationValue];
  reference: [value: FilePaneReference];
  identity: [value: FilePaneIdentityChange];
}>();
const actionErrorId = useId();
const browserId = useId();
const session = computed(() =>
  workspaceSession(props.workspaceId, props.pluginId),
);
const documentTitle = useTemplateRef<HTMLElement>("documentTitle");
const filterControl =
  useTemplateRef<InstanceType<typeof SituateInput>>("filterControl");
const viewedFile = shallowRef<FileSession>();
const selectedPath = ref("");
const selected = computed(() =>
  props.target === undefined
    ? session.value.selected
    : (viewedFile.value?.path ?? selectedPath.value),
);
const file = computed(() => {
  const retained = viewedFile.value;
  const candidate =
    retained && session.value.files[retained.path] === retained
      ? retained
      : session.value.files[selected.value];
  const reference = !props.target?.revision
    ? viewState.value.reference
    : undefined;
  if (reference === null) return undefined;
  if (
    reference &&
    (!candidate?.reference ||
      referenceKey(reference) !== referenceKey(candidate.reference))
  )
    return undefined;
  return candidate;
});
const viewState = ref(
  filePresentation(props.presentation, !props.target?.contentId),
);
const pane = useTemplateRef<HTMLElement>("pane");
const documentScroll = useTemplateRef<HTMLElement>("documentScroll");
const paneWidth = ref(window.innerWidth);
let resizeObserver: ResizeObserver | undefined;
watch(
  pane,
  (element) => {
    resizeObserver?.disconnect();
    if (!element || typeof ResizeObserver === "undefined") return;
    resizeObserver = new ResizeObserver(([entry]) => {
      if (entry) paneWidth.value = entry.contentRect.width;
    });
    resizeObserver.observe(element);
  },
  { flush: "post" },
);
const treeWidth = ref(viewState.value.treeWidth);
const maxTreeWidth = computed(() => Math.max(180, paneWidth.value - 280));
const browserWidth = computed(() =>
  Math.max(180, Math.min(treeWidth.value, maxTreeWidth.value)),
);
const writable = computed(
  () => !!session.value.snapshot?.writable && !session.value.closing,
);
const query = ref("");
const treeOpen = ref(
  props.target === undefined ? true : viewState.value.treeOpen,
);
const collapsed = ref(new Set<string>());
const mode = ref<"read" | "source">(viewState.value.mode);
const sourceControl =
  useTemplateRef<InstanceType<typeof SituateTextarea>>("sourceControl");
const source = computed(() => sourceControl.value?.element);
const busy = ref(false);
const documentLoading = ref(false);
const historyOpen = ref(false);
const historyPath = ref("");
const historyExactPath = ref(false);
const historySeed = ref<string>();
const historicalDeleted = ref("");
const history = ref<HistoryEntry[]>([]);
const historyLoading = ref(false);
const historical = ref<FileDocument | null>(null);
const selectedRevision = ref("");
const selectedVersion = ref<HistoryEntry | null>(null);
const historyToggleControl = useTemplateRef<InstanceType<typeof SituateButton>>(
  "historyToggleControl",
);
const historyToggle = computed(() => historyToggleControl.value?.element);
const historicalContext = useTemplateRef<HTMLDivElement>("historicalContext");
const comparison = ref(false);
const deletedOpen = ref(false);
const deletedLoading = ref(false);
const deletedError = ref<unknown>("");
const conflictOpen = ref(false);
const choice = ref<"editor" | "external" | "">("");
const inspect = ref<"editor" | "external">("editor");
const action = ref<{
  operation: FilesOperation;
  path: string;
  revision?: string;
  exactPath?: boolean;
  kind?: "rename" | "move";
  folder?: string;
} | null>(null);
const menu = ref<{
  anchor: HTMLElement;
  path: string;
  plus: boolean;
  documentContext?: boolean;
  point?: { x: number; y: number };
} | null>(null);
const live = computed(
  () =>
    !props.target?.revision && !historical.value && !historicalDeleted.value,
);
const documentPath = computed(() =>
  live.value ? selected.value : historyPath.value,
);
const documentFolder = computed(
  () =>
    parentFolder(documentPath.value).split("/").join(" / ") ||
    props.workspaceName,
);
const fileCount = computed(
  () =>
    (session.value.snapshot?.entries ?? []).filter(
      (entry) => !entry.isDirectory,
    ).length,
);
const isMarkdown = computed(() =>
  /\.(?:md|markdown)$/iu.test(documentPath.value),
);
const wordCount = computed(() => markdownWordCount(displayedText.value));
const tokens = computed(() =>
  highlightSource(displayedText.value, documentPath.value),
);
const menuItems = computed(() => {
  const items = fileMenu({
    path: menu.value?.path ?? "",
    directory: isDirectory(menu.value?.path ?? ""),
    plus: !!menu.value?.plus,
    writable: writable.value,
    live: live.value,
    mode: mode.value,
    selected: menu.value?.documentContext ? documentPath.value : selected.value,
    documentContext: menu.value?.documentContext,
    text:
      /\.(?:md|markdown)$/iu.test(menu.value?.path ?? "") ||
      !!session.value.files[menu.value?.path ?? ""]?.document ||
      (!!menu.value?.documentContext && !!historical.value),
  });
  return props.pluginId
    ? items.filter((item) => item && ["read", "source"].includes(item.action))
    : items;
});
const destination = ref("");
const actionError = ref<unknown>("");
const referenceError = ref<unknown>("");
let generation = 0;
let openAttempt = 0;
let deletedGeneration = 0;
let stopObserving: (() => void) | undefined;
let restoring = false;
const presentationEchoes = new WeakSet<object>();
let pressTimer: ReturnType<typeof setTimeout> | undefined;
let pressPoint: { x: number; y: number } | undefined;
let suppressClick = false;
const entries = computed(() => {
  const stored = session.value.snapshot?.entries ?? [];
  const drafts = Object.values(session.value.files)
    .filter(
      (file) => file.dirty && !stored.some((entry) => entry.path === file.path),
    )
    .map((file) => ({ path: file.path, isDirectory: false }));
  return [...stored, ...drafts]
    .filter((entry) => {
      if (query.value)
        return entry.path
          .toLocaleLowerCase()
          .includes(query.value.toLocaleLowerCase());
      return ![...collapsed.value].some((path) =>
        entry.path.startsWith(`${path}/`),
      );
    })
    .sort(compareFileEntries);
});
const displayedText = computed(
  () => historical.value?.version.text ?? file.value?.text ?? "",
);
const deleted = computed(() => session.value.snapshot?.deleted ?? []);
const actionTitles = computed<Partial<Record<FilesOperation, string>>>(() => ({
  discard: t("files.discardDraft"),
  create: t("files.newFile"),
  mkdir: t("files.newFolder"),
  rename: t("files.rename"),
  copy: t("files.duplicate"),
  delete: t("files.delete"),
  historicalCopy: t("files.copyHistoricalVersion"),
  restore: t("files.restoreDeletedFile"),
  revert: t("files.reverseThisChange"),
}));
const actionTitle = computed(() =>
  action.value?.kind === "move"
    ? t("files.moveTo")
    : (actionTitles.value[action.value?.operation ?? "create"] ??
      t("files.fileAction")),
);
const submitLabel = computed(() =>
  action.value?.kind === "move"
    ? t("files.move")
    : action.value?.operation === "create"
      ? t("files.createFile")
      : action.value?.operation === "mkdir"
        ? t("files.createFolder")
        : actionTitle.value,
);
const destinationLabel = computed(() =>
  action.value?.kind === "move"
    ? t("files.destinationFolder")
    : action.value?.kind === "rename"
      ? t("files.newName")
      : action.value?.operation === "create"
        ? t("files.fileName")
        : action.value?.operation === "mkdir"
          ? t("files.folderName")
          : t("files.destinationPath"),
);
const needsDestination = computed(() =>
  ["create", "mkdir", "rename", "copy", "historicalCopy", "restore"].includes(
    action.value?.operation ?? "",
  ),
);
const saveLabel = computed(() =>
  !file.value
    ? ""
    : file.value.saving
      ? t("files.saving")
      : file.value.error
        ? t("files.notSaved")
        : file.value.dirty
          ? t("files.unsavedChanges")
          : t("files.saved"),
);

watch(
  session,
  async () => {
    generation++;
    stopObserving?.();
    stopObserving = observeFiles(session.value, () => selected.value);
    viewedFile.value = undefined;
    selectedPath.value = "";
    documentLoading.value = false;
    deletedGeneration++;
    deletedOpen.value = false;
    deletedLoading.value = false;
    deletedError.value = "";
    historical.value = null;
    historicalDeleted.value = "";
    historyOpen.value = false;
    historyLoading.value = false;
    selectedRevision.value = "";
    selectedVersion.value = null;
    comparison.value = false;
    action.value = null;
    menu.value = null;
    cancelPress();
    conflictOpen.value = false;
    await loadWorkspace(session.value);
  },
  { immediate: true },
);
watch(
  () => file.value?.outcome,
  (outcome) => {
    choice.value = "";
    if (outcome?.status === "deleted") destination.value = "";
    conflictOpen.value =
      (props.target === undefined ||
        !!pane.value?.contains(document.activeElement)) &&
      !!outcome &&
      ["conflict", "changed", "deleted", "identityConfirmation"].includes(
        outcome.status,
      );
  },
);
watch(
  () => file.value?.text,
  async () => {
    const textarea = source.value;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const scroll = textarea.scrollTop;
    await nextTick();
    if (source.value === textarea) {
      textarea.setSelectionRange(start, end);
      textarea.scrollTop = scroll;
    }
  },
);
watch(
  [
    () => props.workspaceId,
    () => props.pluginId,
    () => props.target !== undefined,
    () => props.target?.contentId,
    () => props.target?.revision,
    () => {
      const reference = filePresentation(props.presentation).reference;
      return reference ? referenceKey(reference) : reference;
    },
  ],
  async () => {
    if (props.target === undefined) return;
    const current = ++generation;
    const workspace = session.value;
    restoring = true;
    documentLoading.value = false;
    referenceError.value = "";
    action.value = null;
    menu.value = null;
    conflictOpen.value = false;
    cancelPress();
    viewedFile.value = undefined;
    selectedPath.value = "";
    historical.value = null;
    historicalDeleted.value = "";
    historyOpen.value = false;
    comparison.value = false;
    historyPath.value = props.target.contentId ?? "";
    selectedRevision.value = props.target.revision ?? "";
    selectedVersion.value = null;
    viewState.value = filePresentation(
      props.presentation,
      !props.target.contentId,
    );
    mode.value = viewState.value.mode;
    treeOpen.value = viewState.value.treeOpen;
    treeWidth.value = viewState.value.treeWidth;
    const path = props.target.contentId;
    const context =
      props.target.revision === viewState.value.history?.version.revision
        ? viewState.value.history
        : null;
    if (!props.target.revision && viewState.value.reference === null) {
      referenceError.value = "native.content.reference.invalid";
    } else if (path && safeFileTarget(path)) {
      const livePath = context?.currentPath ?? path;
      selectedPath.value = livePath;
      documentLoading.value = true;
      const opened = livePath
        ? await openFile(
            workspace,
            livePath,
            false,
            props.target.revision
              ? undefined
              : (viewState.value.reference ?? undefined),
            { openBinary: false, isCurrent: () => current === generation },
          )
        : undefined;
      if (current !== generation) return;
      viewedFile.value = opened;
      if (!opened && viewState.value.reference && !props.target.revision)
        referenceError.value = workspace.error || "references.unavailable";
      if (props.target.revision) {
        historyPath.value = context?.path ?? path;
        historyExactPath.value = context?.exactPath ?? true;
        historySeed.value = context
          ? (context.seed ?? undefined)
          : props.target.revision;
        selectedVersion.value = context?.version ?? null;
        if (context?.version.deleted) historicalDeleted.value = path;
        else
          try {
            const reply = await request(workspace, {
              operation: "revision",
              path,
              revision: props.target.revision,
              exactPath: context
                ? !!context.version.path || context.exactPath
                : true,
            });
            if (current !== generation) return;
            if (reply.document) historical.value = reply.document;
            else historicalDeleted.value = path;
          } catch (error) {
            if (current !== generation) return;
            workspace.error = error;
            historicalDeleted.value = path;
          }
      }
    } else if (path) workspace.error = "files.theFileCouldNotBeRead";
    if (current !== generation) return;
    documentLoading.value = false;
    await restorePosition();
    if (current === generation) restoring = false;
  },
  { immediate: true },
);
watch(
  () => session.value.snapshot,
  () => {
    if (deletedOpen.value && !deletedLoading.value) void refreshDeleted();
  },
);
watch([mode, treeOpen, treeWidth], () => publishPresentation());
watch(
  () => props.presentation,
  async (value) => {
    if (
      value &&
      typeof value === "object" &&
      presentationEchoes.delete(toRaw(value))
    )
      return;
    if (restoring) return;
    const incoming = filePresentation(value, !props.target?.contentId);
    const current = {
      ...viewState.value,
      mode: mode.value,
      treeOpen: treeOpen.value,
      treeWidth: treeWidth.value,
    };
    if (
      Object.keys(incoming).every(
        (key) =>
          incoming[key as keyof typeof incoming] ===
          current[key as keyof typeof current],
      )
    )
      return;
    restoring = true;
    viewState.value = incoming;
    mode.value = incoming.mode;
    treeOpen.value = incoming.treeOpen;
    treeWidth.value = incoming.treeWidth;
    await restorePosition();
    restoring = false;
  },
);
async function restorePosition(): Promise<void> {
  await nextTick();
  source.value?.setSelectionRange(
    viewState.value.selectionStart,
    viewState.value.selectionEnd,
  );
  if (source.value) source.value.scrollTop = viewState.value.scrollTop;
  if (documentScroll.value)
    documentScroll.value.scrollTop = viewState.value.readScrollTop;
}
function publishPresentation(): void {
  if (restoring || viewState.value.reference === null) return;
  const presentation = {
    ...viewState.value,
    mode: mode.value,
    treeOpen: treeOpen.value,
    treeWidth: treeWidth.value,
  };
  presentationEchoes.add(presentation);
  emit("presentation", presentation);
}
function rememberScroll(): void {
  if (documentScroll.value)
    viewState.value.readScrollTop = documentScroll.value.scrollTop;
  publishPresentation();
}
function navigate(
  path: string,
  revision?: string,
  presentation?: PresentationValue,
): void {
  if (!safeFileTarget(path)) return;
  const target: FilePaneNavigation = {
    kind: "view",
    viewId: "files",
    contentId: path,
    ...(revision ? { revision } : {}),
  };
  if (presentation === undefined) emit("navigate", target);
  else emit("navigate", target, presentation);
}
async function retryWorkspace(): Promise<void> {
  const workspace = session.value;
  const reference = viewState.value.reference;
  const initial = generation;
  await loadWorkspace(workspace);
  if (initial !== generation || workspace !== session.value) return;
  if (!referenceError.value || !reference) {
    if (selected.value)
      await openFile(workspace, selected.value, true, undefined, {
        isCurrent: () => initial === generation,
      });
    return;
  }
  const current = ++generation;
  const opened = await openFile(
    workspace,
    selectedPath.value || reference.path,
    false,
    reference,
  );
  if (current !== generation) return;
  if (opened) {
    viewedFile.value = opened;
    selectedPath.value = opened.path;
    referenceError.value = "";
    await restorePosition();
  } else referenceError.value = workspace.error || "references.unavailable";
}
function reference(): void {
  if (!safeFileTarget(documentPath.value)) return;
  const expectedRevision = file.value?.document?.version.revision;
  if (!selectedRevision.value && !expectedRevision) return;
  const base = { workspaceId: props.workspaceId, path: documentPath.value };
  emit(
    "reference",
    selectedRevision.value
      ? { ...base, kind: "historical", revision: selectedRevision.value }
      : { ...base, kind: "live", expectedRevision: expectedRevision! },
  );
}
onBeforeUnmount(() => {
  generation++;
  stopObserving?.();
  resizeObserver?.disconnect();
  cancelPress();
  rememberSelection();
});
function rememberSelection(): void {
  if (source.value && !restoring) {
    viewState.value.selectionStart = source.value.selectionStart;
    viewState.value.selectionEnd = source.value.selectionEnd;
    viewState.value.scrollTop = source.value.scrollTop;
    publishPresentation();
  }
}
async function select(path: string): Promise<void> {
  rememberSelection();
  const previousTreeOpen = treeOpen.value;
  if ((pane.value?.clientWidth || window.innerWidth) <= 560)
    treeOpen.value = false;
  if (props.target !== undefined) {
    const current = generation;
    const attempt = ++openAttempt;
    const isCurrent = () => current === generation && attempt === openAttempt;
    documentLoading.value = true;
    const opened = await openFile(session.value, path, false, undefined, {
      isCurrent,
    });
    if (!isCurrent()) return;
    documentLoading.value = false;
    if (!opened) {
      treeOpen.value = previousTreeOpen;
      return;
    }
    navigate(path, undefined, {
      treeOpen:
        treeOpen.value && (pane.value?.clientWidth || window.innerWidth) > 560,
      treeWidth: treeWidth.value,
    });
    return;
  }
  const current = ++generation;
  historical.value = null;
  historicalDeleted.value = "";
  selectedRevision.value = "";
  selectedVersion.value = null;
  historyOpen.value = false;
  comparison.value = false;
  documentLoading.value = true;
  const opened = await openFile(session.value, path, true, undefined, {
    isCurrent: () => current === generation,
  });
  if (current !== generation) return;
  documentLoading.value = false;
  if (!opened) {
    treeOpen.value = previousTreeOpen;
    return;
  }
  mode.value = "read";
  if (file.value && (pane.value?.clientWidth || window.innerWidth) <= 560)
    treeOpen.value = false;
  await nextTick();
  documentTitle.value?.focus();
  if (documentScroll.value) documentScroll.value.scrollTop = 0;
}
async function showTree(): Promise<void> {
  treeOpen.value = true;
  historyOpen.value = false;
  await nextTick();
  filterControl.value?.element?.focus();
}
defineExpose({ showTree });
async function sourceMode(): Promise<void> {
  mode.value = "source";
  await nextTick();
  if (source.value && file.value) {
    source.value.setSelectionRange(
      viewState.value.selectionStart,
      viewState.value.selectionEnd,
    );
    source.value.scrollTop = viewState.value.scrollTop;
  }
}
async function returnToCurrent(): Promise<void> {
  if (props.target !== undefined) {
    const presentation = {
      ...viewState.value,
      mode: mode.value,
      treeOpen: false,
      history: null,
    };
    if (selected.value) navigate(selected.value, undefined, presentation);
    else
      emit(
        "navigate",
        { kind: "view", viewId: "files" },
        { ...presentation, treeOpen: true },
      );
    return;
  }
  generation++;
  historical.value = null;
  historicalDeleted.value = "";
  selectedRevision.value = "";
  selectedVersion.value = null;
  comparison.value = false;
  historyOpen.value = false;
  await nextTick();
  if (mode.value === "source") await sourceMode();
  historyToggle.value?.focus();
}
function versionDate(version: HistoryEntry): string {
  return formatDateTime(new Date(version.timestamp * 1000));
}
function suppliedHistoryMessage(message: string): boolean {
  message = message.split("\n\n", 1)[0] ?? "";
  if (
    isMessageKey(message) ||
    /^Reverse change [0-9a-f]{40,64}$/iu.test(message)
  )
    return true;
  try {
    const value: unknown = JSON.parse(message);
    return (
      !!value &&
      typeof value === "object" &&
      "key" in value &&
      typeof value.key === "string" &&
      isMessageKey(value.key)
    );
  } catch {
    return false;
  }
}
function historyMessage(message: string): string {
  if (/^Reverse change [0-9a-f]{40,64}$/iu.test(message))
    return t("files.reversedEarlierVersion");
  return localizeHistorySummary(message);
}
function revisionLabel(revision?: string): string {
  const version =
    history.value.find((entry) => entry.revision === revision) ??
    (selectedVersion.value?.revision === revision
      ? selectedVersion.value
      : null);
  return version
    ? t("files.versionFrom", { date: versionDate(version) })
    : t("files.theSelectedRetainedVersion");
}
function input(event: Event): void {
  if (file.value && live.value)
    editFile(
      session.value,
      file.value,
      (event.target as HTMLTextAreaElement).value,
    );
}
function toggleFolder(path: string): void {
  if (collapsed.value.has(path)) collapsed.value.delete(path);
  else collapsed.value.add(path);
}
function isDirectory(path: string): boolean {
  return !!session.value.snapshot?.entries.find((entry) => entry.path === path)
    ?.isDirectory;
}
function startAction(
  operation: FilesOperation,
  path = "",
  revision?: string,
  exactPath = false,
  kind?: "rename" | "move",
): void {
  const folder = creationFolder(path, isDirectory(path));
  action.value = { operation, path, revision, exactPath, kind, folder };
  destination.value =
    kind === "rename"
      ? itemName(path)
      : kind === "move"
        ? parentFolder(path)
        : operation === "copy"
          ? duplicatePath(path)
          : ["rename", "restore"].includes(operation)
            ? path
            : "";
  actionError.value = "";
}
function openMenu(
  event: MouseEvent,
  path: string,
  plus = false,
  documentContext = false,
): void {
  const anchor = event.currentTarget as HTMLElement;
  menu.value =
    menu.value?.anchor === anchor
      ? null
      : { anchor, path, plus, documentContext };
}
function contextMenu(event: MouseEvent, path: string): void {
  cancelPress();
  event.preventDefault();
  const row = event.currentTarget as HTMLElement;
  menu.value = {
    anchor: row.querySelector<HTMLButtonElement>(".row-menu") ?? row,
    path,
    plus: false,
    point:
      event.clientX || event.clientY
        ? { x: event.clientX, y: event.clientY }
        : undefined,
  };
}
function cancelPress(): void {
  clearTimeout(pressTimer);
  pressTimer = undefined;
  pressPoint = undefined;
}
function pointerDown(event: PointerEvent, path: string): void {
  cancelPress();
  suppressClick = false;
  if (event.pointerType === "mouse" || event.button !== 0) return;
  const row = event.currentTarget as HTMLElement;
  pressPoint = { x: event.clientX, y: event.clientY };
  const point = pressPoint;
  pressTimer = setTimeout(() => {
    suppressClick = true;
    menu.value = {
      anchor: row.querySelector<HTMLButtonElement>(".row-menu") ?? row,
      path,
      plus: false,
      point,
    };
    cancelPress();
  }, 550);
}
function pointerMove(event: PointerEvent): void {
  if (
    pressPoint &&
    Math.hypot(event.clientX - pressPoint.x, event.clientY - pressPoint.y) > 10
  )
    cancelPress();
}
function rowClick(event: MouseEvent): void {
  if (suppressClick) {
    event.preventDefault();
    event.stopPropagation();
    suppressClick = false;
  }
}
async function refreshDeleted(): Promise<void> {
  const current = ++deletedGeneration;
  const workspace = session.value;
  deletedLoading.value = true;
  deletedError.value = "";
  await loadWorkspace(workspace, true);
  if (current !== deletedGeneration || workspace !== session.value) return;
  deletedError.value = workspace.error;
  deletedLoading.value = false;
}
async function chooseMenu(
  command: FileAction,
  target: { path: string; plus: boolean; documentContext?: boolean },
): Promise<void> {
  const path = target.path;
  if (command === "deleted") {
    deletedOpen.value = true;
    await refreshDeleted();
    return;
  }
  if (command === "history") {
    await showHistory(
      path,
      !!target.documentContext && !live.value && historyExactPath.value,
      target.documentContext && !live.value ? historySeed.value : undefined,
    );
    return;
  }
  if (command === "read" || command === "source") {
    const workspace = session.value;
    if (!target.documentContext && (path !== selected.value || !live.value)) {
      await select(path);
      if (props.target !== undefined) return;
    }
    if (
      session.value !== workspace ||
      (!target.documentContext && selected.value !== path)
    )
      return;
    if (command === "source") {
      await sourceMode();
      source.value?.focus();
    } else {
      mode.value = "read";
      rememberSelection();
    }
    return;
  }
  startAction(
    command === "move" ? "rename" : command,
    path,
    undefined,
    false,
    command === "move" || command === "rename" ? command : undefined,
  );
}
async function editSource(offset: number): Promise<void> {
  if (!live.value || !writable.value || !file.value) return;
  const current = generation;
  await sourceMode();
  if (current !== generation || !source.value) return;
  const position = Math.max(0, Math.min(file.value.text.length, offset));
  source.value.focus();
  source.value.setSelectionRange(position, position);
  rememberSelection();
}
function incompleteAction(reply: FilesReply): unknown[] {
  return [
    reply.message ?? "files.thisActionDidNotComplete",
    ...(reply.changedPaths?.length
      ? [
          {
            key: "files.changedPaths",
            params: { paths: reply.changedPaths.join(", ") },
          },
        ]
      : []),
    ...(reply.recoveryRevision
      ? ["files.aRecoveryVersionIsRetainedInFileHistory"]
      : []),
  ];
}
async function runAction(): Promise<void> {
  if (!action.value || !writable.value || busy.value) return;
  busy.value = true;
  actionError.value = "";
  const workspace = session.value;
  const target = { ...action.value };
  const enteredDestination = destination.value;
  const current = generation;
  try {
    if (target.operation === "discard") {
      const retained = workspace.files[target.path];
      if (retained) await discardFile(workspace, retained);
      action.value = null;
      return;
    }
    const affectsSource = [
      "rename",
      "copy",
      "delete",
      "revert",
      "restore",
    ].includes(target.operation);
    const affected = Object.values(workspace.files).filter(
      (file) =>
        affectsSource &&
        (file.path === target.path || file.path.startsWith(`${target.path}/`)),
    );
    if (
      !(
        await Promise.all(
          affected
            .filter((file) => file.dirty)
            .map((file) => saveFile(workspace, file)),
        )
      ).every(Boolean)
    )
      throw new Error("files.someEditsInThisItemCouldNotBeSaved");
    if (current !== generation || workspace !== session.value) return;
    if (
      (target.kind === "rename" ||
        ["create", "mkdir"].includes(target.operation)) &&
      (!enteredDestination.trim() ||
        enteredDestination.includes("/") ||
        enteredDestination.includes("\\") ||
        [".", ".."].includes(enteredDestination))
    )
      throw new Error("files.enterANameWithoutFolderSeparators");
    const targetDestination =
      target.kind === "rename"
        ? inFolder(parentFolder(target.path), enteredDestination)
        : target.kind === "move"
          ? inFolder(enteredDestination, itemName(target.path))
          : enteredDestination;
    const creationPath = inFolder(
      target.folder ?? "",
      target.operation === "create"
        ? newMarkdownPath(enteredDestination)
        : enteredDestination,
    );
    const wasSelected = selected.value;
    const reply = await request(
      workspace,
      actionRequest(target, creationPath, targetDestination),
    );
    if (reply.status === "ok") {
      if (target.operation === "rename")
        emit("identity", {
          workspaceId: workspace.id,
          kind: "rename",
          from: target.path,
          to: targetDestination,
        });
      else if (target.operation === "delete")
        emit("identity", {
          workspaceId: workspace.id,
          kind: "delete",
          path: target.path,
        });
    }
    if (current !== generation || workspace !== session.value) {
      await loadWorkspace(workspace);
      return;
    }
    if (reply.status === "conflict" && target.operation === "revert") {
      retainConflict(workspace, target.path, reply, props.target === undefined);
      action.value = null;
      return;
    }
    if (reply.status === "partialFailure") {
      await loadWorkspace(workspace);
      throw incompleteAction(reply);
    }
    if (!["ok", "saved"].includes(reply.status))
      throw reply.message ?? "files.thisActionDidNotComplete";
    await loadWorkspace(workspace);
    if (current !== generation || workspace !== session.value) return;
    action.value = null;
    if (
      props.target === undefined &&
      (wasSelected === target.path ||
        wasSelected.startsWith(`${target.path}/`) ||
        historyPath.value === target.path ||
        historyPath.value.startsWith(`${target.path}/`))
    ) {
      historical.value = null;
      historicalDeleted.value = "";
      selectedRevision.value = "";
      selectedVersion.value = null;
      comparison.value = false;
    }
    if (target.operation === "create") {
      const path = reply.document?.path ?? creationPath;
      if (props.target !== undefined)
        navigate(path, undefined, { mode: "source" });
      else {
        await select(path);
        await sourceMode();
      }
    } else await pollWorkspace(workspace);
    if (historyOpen.value)
      await showHistory(
        historyPath.value,
        historyExactPath.value,
        historySeed.value,
      );
  } catch (error) {
    if (current === generation && workspace === session.value)
      actionError.value = error;
  } finally {
    busy.value = false;
  }
}
async function showHistory(
  path: string,
  exactPath = false,
  revision?: string,
): Promise<void> {
  const current = ++generation;
  historyPath.value = path;
  historyExactPath.value = exactPath;
  historySeed.value = revision;
  historyOpen.value = true;
  treeOpen.value = false;
  history.value = [];
  historyLoading.value = true;
  try {
    if (current !== generation) return;
    if (exactPath && !revision)
      throw new Error("native.files.deleted.chooseRevision");
    const reply = await request(
      session.value,
      exactPath && revision
        ? { operation: "history", path, exactPath: true, revision }
        : { operation: "history", path },
    );
    if (current !== generation) return;
    if (!reply.history)
      throw new Error(reply.message ?? "files.historyCouldNotBeLoaded");
    history.value = reply.history;
  } catch (error) {
    if (current === generation) session.value.error = error;
  } finally {
    if (current === generation) historyLoading.value = false;
  }
}
async function inspectRevision(version: HistoryEntry): Promise<void> {
  if (props.target !== undefined) {
    rememberSelection();
    navigate(version.path ?? historyPath.value, version.revision, {
      ...viewState.value,
      mode: mode.value,
      treeOpen: false,
      history: {
        currentPath: selected.value,
        path: historyPath.value,
        exactPath: historyExactPath.value,
        seed: historySeed.value ?? null,
        version: {
          ...version,
          path: version.path ?? null,
          deleted: !!version.deleted,
        },
      },
    });
    return;
  }
  const current = ++generation;
  try {
    const reply = version.deleted
      ? { status: "deleted" as const, document: undefined }
      : await request(session.value, {
          operation: "revision",
          path: version.path ?? historyPath.value,
          revision: version.revision,
          exactPath: !!version.path || historyExactPath.value,
        });
    if (current !== generation) return;
    if (reply.status === "deleted") {
      historical.value = null;
      historicalDeleted.value = version.path ?? historyPath.value;
      selectedRevision.value = version.revision;
      selectedVersion.value = version;
      comparison.value = false;
      historyOpen.value = false;
      treeOpen.value = false;
      await nextTick();
      historicalContext.value?.focus();
      return;
    }
    if (!reply.document)
      throw new Error(
        reply.message ?? "files.thisRevisionCannotBeReadAsMarkdownYouCan",
      );
    historical.value = reply.document;
    historicalDeleted.value = "";
    selectedRevision.value = version.revision;
    selectedVersion.value = version;
    comparison.value = false;
    historyOpen.value = false;
    treeOpen.value = false;
    await nextTick();
    historicalContext.value?.focus();
  } catch (error) {
    if (current === generation) session.value.error = error;
  }
}
function retrySelected(): void {
  if (!file.value) return;
  const context = diagnosticsFor(props.workspaceId).action(
    "retry",
    "button",
    "editor",
  );
  if (file.value.outcome) conflictOpen.value = true;
  else void retryFile(session.value, file.value, context);
}
async function resolve(): Promise<void> {
  if (!file.value || !choice.value) return;
  busy.value = true;
  const current = generation;
  const saved = await saveFile(session.value, file.value, {
    choice: choice.value,
    diagnostic: diagnosticsFor(props.workspaceId).action(
      "save",
      "button",
      "editor",
    ),
  });
  if (current !== generation) {
    busy.value = false;
    return;
  }
  if (saved) conflictOpen.value = false;
  else choice.value = "";
  busy.value = false;
}
async function confirmIdentity(): Promise<void> {
  if (!file.value) return;
  busy.value = true;
  const current = generation;
  if (
    (await saveFile(session.value, file.value, {
      confirmIdChange: true,
      diagnostic: diagnosticsFor(props.workspaceId).action(
        "save",
        "button",
        "editor",
      ),
    })) &&
    current === generation
  )
    conflictOpen.value = false;
  busy.value = false;
}
async function recoverDeleted(operation: "restore" | "create"): Promise<void> {
  const draft = file.value;
  const workspace = session.value;
  const current = generation;
  if (!draft || busy.value || !writable.value) return;
  busy.value = true;
  let securedPath: string | undefined;
  try {
    if (operation === "restore" && !draft.base)
      throw new Error("The deleted file’s base version is missing.");
    const reply = await request(
      workspace,
      operation === "restore" && draft.base
        ? {
            operation: "restore",
            path: draft.path,
            text: draft.text,
            base: draft.base,
          }
        : {
            operation: "create",
            path: draft.path,
            text: draft.text,
            destination: isMarkdown.value
              ? newMarkdownPath(destination.value)
              : destination.value,
          },
    );
    if (current !== generation) return;
    if (reply.status !== "saved" || !reply.document) {
      await loadWorkspace(workspace);
      throw incompleteAction(reply);
    }
    const savedPath = reply.document.path;
    securedPath = savedPath;
    await discardFile(workspace, draft);
    if (current !== generation) return;
    delete workspace.files[draft.path];
    await loadWorkspace(workspace);
    if (current !== generation) return;
    await select(savedPath);
    conflictOpen.value = false;
  } catch (error) {
    draft.error = securedPath
      ? [
          { key: "files.savedDraftRetained", params: { path: securedPath } },
          error,
        ]
      : error;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section
    ref="pane"
    class="files-pane"
    :aria-label="embedded ? undefined : t('navigation.files')"
    :data-embedded="embedded || undefined"
  >
    <div
      v-if="referenceError || session.error"
      class="file-notice"
      role="alert"
    >
      {{ localizeFileError(referenceError || session.error) }}
      <SituateButton variant="plain" type="button" @click="retryWorkspace">
        {{ t("navigation.retry") }}
      </SituateButton>
      <ErrorActions
        boundary="files"
        :error="referenceError || session.error"
        :scope="workspaceId"
      />
    </div>
    <p
      v-if="!pluginId && session.snapshot && !session.snapshot.writable"
      class="file-notice"
    >
      {{
        session.snapshot.reason
          ? localizeError(session.snapshot.reason)
          : t("files.thisWorkspaceIsReadOnly")
      }}
    </p>
    <div
      class="file-layout"
      :class="{ 'tree-open': treeOpen, 'history-open': historyOpen }"
      :style="{ '--file-browser-width': `${browserWidth}px` }"
    >
      <div
        v-show="treeOpen"
        :id="browserId"
        class="file-browser"
        :role="embedded ? 'group' : 'complementary'"
        :aria-label="pluginId ? workspaceName : t('files.workspaceFiles')"
      >
        <div class="browser-header">
          <SituateIconButton
            v-if="showNavigation"
            class="files-navigation"
            icon="menu"
            :label="t('navigation.openNavigation')"
            @click="emit('navigation', $event)"
          /><span>{{ t("navigation.files") }}</span
          ><SituateIconButton
            v-if="!pluginId"
            icon="plus"
            :label="t('files.newFileOrFolder')"
            aria-haspopup="menu"
            :aria-expanded="!!menu?.plus"
            @click="openMenu($event, '', true)"
          /><SituateIconButton
            icon="split"
            :label="t('files.collapseFileBrowser')"
            @click="treeOpen = false"
          /><SituateIconButton
            class="browser-close"
            icon="close"
            :label="t('files.closeFiles')"
            @click="emit('leave')"
          />
        </div>
        <label class="file-filter"
          ><SituateIcon name="search" /><SituateInput
            appearance="plain"
            ref="filterControl"
            v-model="query"
            type="search"
            :placeholder="t('files.findAFile')"
            :aria-label="t('files.findAFileDetail')"
        /></label>
        <div class="file-tree">
          <p v-if="session.loading && !session.snapshot" class="tree-empty">
            {{ t("files.loadingFiles") }}
          </p>
          <p v-else-if="!entries.length" class="tree-empty">
            {{ query ? t("files.noMatchingFiles") : t("files.noFilesYet") }}
          </p>
          <div
            v-for="entry in entries"
            :key="entry.path"
            class="tree-row"
            :class="{
              'context-target': menu?.path === entry.path && !menu.plus,
            }"
            :data-selected="selected === entry.path"
            @contextmenu="contextMenu($event, entry.path)"
            @pointerdown="pointerDown($event, entry.path)"
            @pointermove="pointerMove"
            @pointerup="cancelPress"
            @pointercancel="cancelPress"
            @pointerleave="cancelPress"
            @click.capture="rowClick"
          >
            <SituateButton
              variant="plain"
              :class="entry.isDirectory ? 'folder-entry' : 'file-entry'"
              type="button"
              :title="t('files.pathLabel', { path: entry.path })"
              :style="{
                paddingInlineStart: `${8 + (query ? 0 : entry.path.split('/').length - 1) * 12}px`,
              }"
              :aria-current="
                !entry.isDirectory && selected === entry.path
                  ? 'true'
                  : undefined
              "
              :aria-expanded="
                entry.isDirectory ? !collapsed.has(entry.path) : undefined
              "
              @click="
                entry.isDirectory
                  ? toggleFolder(entry.path)
                  : select(entry.path)
              "
            >
              <SituateIcon
                v-if="entry.isDirectory"
                name="chevron"
                class="folder-chevron"
              /><span
                v-else
                class="folder-spacer"
                aria-hidden="true"
              /><SituateIcon
                :name="entry.isDirectory ? 'folder' : 'notes'"
              /><span data-localization-content="user">{{
                query ? entry.path : entry.path.split("/").at(-1)
              }}</span
              ><span
                v-if="session.files[entry.path]?.dirty"
                class="draft-dot"
                :aria-label="t('files.unsavedChanges')"
                >•</span
              >
            </SituateButton>
            <SituateIconButton
              icon="more"
              class="row-menu"
              :label="t('files.actionsFor', { name: entry.path })"
              aria-haspopup="menu"
              :aria-expanded="
                menu?.anchor.getAttribute('aria-label') ===
                t('files.actionsFor', { name: entry.path })
              "
              @click="openMenu($event, entry.path)"
            />
          </div>
        </div>
        <footer class="browser-footer">
          <span>{{
            fileCount === 1
              ? t("files.countOne", { count: fileCount })
              : t("files.countMany", { count: fileCount })
          }}</span
          ><span>{{ t("workspace.onThisDevice") }}</span>
        </footer>
        <SituateResizeHandle
          class="file-browser-resize"
          :model-value="browserWidth"
          @update:model-value="treeWidth = $event"
          :min="180"
          :max="maxTreeWidth"
          :reset-value="228"
          :label="t('files.resizeFileBrowser')"
          :controls="browserId"
        />
      </div>
      <div
        class="document-pane"
        :role="embedded ? 'group' : 'region'"
        :aria-label="t('files.document')"
        :aria-busy="documentLoading || undefined"
      >
        <header class="document-bar">
          <SituateIconButton
            v-if="showNavigation && !treeOpen"
            class="files-navigation"
            icon="menu"
            :label="t('navigation.openNavigation')"
            @click="emit('navigation', $event)"
          />
          <SituateIconButton
            v-if="!treeOpen"
            icon="split"
            :label="t('files.expandFileBrowser')"
            @click="showTree()"
          />
          <div class="document-location">
            <p v-if="documentPath" data-localization-content="user">
              {{ documentFolder }}
            </p>
            <h3
              ref="documentTitle"
              tabindex="-1"
              :data-localization-content="documentPath ? 'user' : undefined"
            >
              {{ itemName(documentPath) || t("navigation.files") }}
            </h3>
          </div>
          <SituateButton
            variant="ghost"
            size="small"
            v-if="documentPath && !pluginId"
            ref="historyToggleControl"
            type="button"
            class="text-button history-toggle"
            :aria-expanded="historyOpen"
            :aria-label="t('files.versionHistory')"
            @click="
              historyOpen
                ? (historyOpen = false)
                : !live
                  ? showHistory(historyPath, historyExactPath, historySeed)
                  : showHistory(selected)
            "
          >
            <SituateIcon name="history" /><span>{{ t("files.history") }}</span>
          </SituateButton>
          <div class="document-actions">
            <SituateIconButton
              v-if="documentPath && !pluginId"
              class="document-chat"
              icon="chat"
              :label="t('files.newChatWithThisFile')"
              :disabled="
                props.target === undefined ||
                !!historicalDeleted ||
                !safeFileTarget(documentPath)
              "
              :unavailable-reason="
                props.target === undefined
                  ? t('files.documentChatIsUnavailable')
                  : undefined
              "
              @click="reference"
            /><SituateIconButton
              v-if="documentPath"
              icon="more"
              :label="t('files.fileActions')"
              aria-haspopup="menu"
              :aria-expanded="
                menu?.anchor.getAttribute('aria-label') ===
                t('files.fileActions')
              "
              @click="openMenu($event, documentPath, false, true)"
            /><SituateIconButton
              icon="close"
              :label="t('files.closeFiles')"
              @click="emit('leave')"
            />
          </div>
        </header>
        <div v-if="documentLoading" class="empty-document" role="status">
          <p>{{ t("files.loadingDocument") }}</p>
        </div>
        <template
          v-else-if="
            (file && !props.target?.revision) || historical || historicalDeleted
          "
        >
          <div
            v-if="historical || historicalDeleted"
            ref="historicalContext"
            class="historical-notice"
            tabindex="-1"
            :aria-label="t('files.historicalVersionReadOnly')"
          >
            <div class="historical-details">
              <strong
                >{{ t("files.historicalVersion") }}
                <span class="historical-readonly">{{
                  t("files.readOnly")
                }}</span></strong
              ><span
                v-if="selectedVersion"
                class="historical-date"
                data-localization-content="formatted"
                >{{ versionDate(selectedVersion) }}</span
              >
            </div>
            <div class="historical-actions">
              <SituateButton
                variant="primary"
                size="small"
                type="button"
                class="primary-action"
                @click="returnToCurrent"
              >
                {{ t("files.returnToCurrentFile") }}</SituateButton
              ><SituateButton
                variant="ghost"
                size="small"
                v-if="!historicalDeleted"
                type="button"
                class="text-button"
                :aria-pressed="comparison"
                @click="comparison = !comparison"
              >
                {{ t("files.compareWithCurrent") }}
              </SituateButton>
            </div>
          </div>
          <div
            v-if="file?.error && !historical && !historicalDeleted"
            class="file-notice"
            role="alert"
          >
            {{ localizeFileError(file.error) }}
            <SituateButton
              variant="plain"
              type="button"
              :disabled="file.saving || !writable"
              @click="retrySelected"
            >
              {{
                file.outcome ? t("navigation.review") : t("navigation.retry")
              }}
            </SituateButton>
          </div>
          <p
            v-if="file?.dirty && file.recovery === 'memory'"
            class="file-notice"
            role="alert"
          >
            {{ t("files.yourTextIsOnlyInThisRunningAppKeep") }}
          </p>
          <p
            v-for="issue in historical?.issues ?? file?.document?.issues ?? []"
            :key="`${issue.line}:${issue.message}`"
            class="file-notice"
          >
            {{
              t("files.issue", {
                line: issue.line,
                message: localizeError(issue.message),
              })
            }}
            <SituateButton
              variant="ghost"
              size="small"
              class="text-button"
              type="button"
              @click="sourceMode"
            >
              {{ t("files.inspectSource") }}
            </SituateButton>
          </p>
          <div
            ref="documentScroll"
            class="document-scroll"
            @scroll="rememberScroll"
          >
            <SituateEmptyState v-if="historicalDeleted" class="empty-document">
              <h2>{{ t("files.fileDeletedInThisChange") }}</h2>
              <p data-localization-content="user">{{ historicalDeleted }}</p>
              <p>
                {{ t("files.chooseAnEarlierRetainedVersionToInspectOrCopy") }}
              </p>
            </SituateEmptyState>
            <div
              v-else-if="comparison && historical"
              class="revision-comparison"
            >
              <section>
                <h3>{{ t("files.historicalVersion") }}</h3>
                <p
                  v-if="selectedVersion"
                  class="comparison-date"
                  data-localization-content="formatted"
                >
                  {{ versionDate(selectedVersion) }}
                </p>
                <pre tabindex="0" data-localization-content="user">{{
                  historical.version.text
                }}</pre>
              </section>
              <section>
                <h3>
                  {{
                    session.files[historyPath]?.dirty
                      ? t("files.currentUnsaved")
                      : t("files.current")
                  }}
                </h3>
                <pre
                  tabindex="0"
                  :data-localization-content="
                    session.files[historyPath] ? 'user' : undefined
                  "
                  >{{
                    session.files[historyPath]?.text ??
                    t("files.thereIsNoCurrentFileAtThisLocation")
                  }}</pre>
              </section>
            </div>
            <div v-else-if="mode === 'source'" class="source-wrap">
              <SituateTextarea
                appearance="plain"
                ref="sourceControl"
                class="source-text"
                :aria-label="
                  t(isMarkdown ? 'files.markdownSource' : 'files.textSource')
                "
                :value="displayedText"
                :readonly="!live || !writable"
                spellcheck="false"
                @input="input"
                @select="rememberSelection"
                @scroll="rememberSelection"
              />
            </div>
            <pre
              v-else-if="!isMarkdown"
              class="text-document"
              tabindex="0"
              :aria-label="t('files.textSource')"
            ><SourceText :tokens="tokens" /></pre>
            <RenderedFile
              v-else
              :session="session"
              :path="historical?.path ?? selected"
              :text="displayedText"
              :document="historical ?? file?.document ?? null"
              :historical="!!historical"
              :editable="live && writable"
              @edit-source="editSource"
              @navigate="select"
            />
          </div>
          <footer class="document-footer">
            <span>{{ t(isMarkdown ? "files.markdown" : "files.text") }}</span
            ><span>{{
              wordCount === 1
                ? t("files.wordsOne", { count: wordCount })
                : t("files.wordsMany", { count: wordCount })
            }}</span
            ><span
              v-if="live && file?.dirty && file.recovery === 'persisted'"
              >{{ t("files.recoveryDraftStored") }}</span
            ><span class="save-state">{{
              live && writable ? saveLabel : t("files.readOnly")
            }}</span>
          </footer>
        </template>
        <SituateEmptyState v-else-if="!documentPath" class="empty-document">
          <SituateIcon name="folder" />
          <h2>{{ t("files.yourFilesInPlace") }}</h2>
          <p>{{ t("files.chooseATextFileToReadOrEdit") }}</p>
          <SituateButton
            variant="primary"
            size="small"
            type="button"
            class="primary-action"
            v-if="!pluginId"
            :disabled="!writable"
            @click="startAction('create')"
          >
            {{ t("files.newFileDetail") }}
          </SituateButton>
        </SituateEmptyState>
      </div>
      <div
        v-if="historyOpen"
        class="version-panel"
        :role="embedded ? 'group' : 'complementary'"
        :aria-label="t('files.fileHistory')"
      >
        <header>
          <div>
            <p class="eyebrow">{{ t("files.history") }}</p>
            <h3 data-localization-content="user">{{ historyPath }}</h3>
          </div>
          <SituateIconButton
            icon="close"
            :label="t('files.closeHistory')"
            @click="historyOpen = false"
          />
        </header>
        <p class="history-help">
          {{ t("files.reversingOneChangePreservesLaterIndependentEdits") }}
        </p>
        <p v-if="historyLoading" class="history-help" role="status">
          {{ t("files.loadingHistory") }}
        </p>
        <p v-else-if="!history.length" class="history-help">
          {{ t("files.noChangesToShow") }}
        </p>
        <div class="versions">
          <section
            v-for="version in history"
            :key="version.revision"
            class="version-entry"
          >
            <SituateButton
              variant="plain"
              class="version"
              type="button"
              :aria-pressed="selectedRevision === version.revision"
              @click="inspectRevision(version)"
            >
              <strong
                ><span v-if="version.deleted">{{ t("files.deleted") }}</span
                ><span
                  :data-localization-content="
                    suppliedHistoryMessage(version.message) ? undefined : 'user'
                  "
                  >{{ historyMessage(version.message) }}</span
                ></strong
              ><span v-if="version.path" data-localization-content="user">{{
                version.path
              }}</span
              ><span data-localization-content="formatted">{{
                versionDate(version)
              }}</span>
            </SituateButton>
            <div class="history-actions">
              <SituateButton
                variant="ghost"
                size="small"
                type="button"
                class="text-button"
                :disabled="!writable || version.deleted"
                @click="
                  startAction(
                    'historicalCopy',
                    version.path ?? historyPath,
                    version.revision,
                    !!version.path || historyExactPath,
                  )
                "
              >
                {{ t("files.copyVersion") }}</SituateButton
              ><SituateButton
                variant="ghost"
                size="small"
                type="button"
                class="text-button"
                :disabled="!writable"
                @click="
                  startAction(
                    'revert',
                    historyPath,
                    version.revision,
                    historyExactPath,
                  )
                "
              >
                {{ t("files.reverseChange") }}
              </SituateButton>
            </div>
          </section>
        </div>
      </div>
    </div>

    <FileActionMenu
      v-if="menu"
      :key="`${menu.path}:${menu.plus}:${menu.documentContext}`"
      :anchor="menu.anchor"
      :point="menu.point"
      :title="
        menu.plus
          ? t('files.create')
          : isDirectory(menu.path)
            ? t('files.folderActions')
            : t('files.fileActions')
      "
      :context="
        menu.plus
          ? creationFolder(menu.path, isDirectory(menu.path)) || workspaceName
          : itemName(menu.path)
      "
      :items="menuItems"
      @choose="chooseMenu($event, menu)"
      @dismiss="menu = null"
    />
    <FileDialog
      v-if="action"
      :title="actionTitle"
      :busy="busy"
      @dismiss="action = null"
    >
      <div class="dialog-body">
        <p class="path" data-localization-content="user">
          {{ action.path || workspaceName }}
        </p>
        <form @submit.prevent="runAction">
          <p v-if="action.operation === 'discard'">
            {{ t("files.discardThisRetainedDraftTheUnsavedTextCannotBe") }}
          </p>
          <p v-if="action.operation === 'delete'">
            {{
              session.snapshot?.entries.find(
                (entry) => entry.path === action?.path,
              )?.isDirectory
                ? t("files.deleteFolderConfirmation")
                : t("files.deleteConfirmation")
            }}
          </p>
          <p v-if="action.operation === 'revert'">
            {{
              t("files.reverseConfirmation", {
                version: revisionLabel(action.revision),
              })
            }}
          </p>
          <p v-if="action.operation === 'historicalCopy'">
            {{
              t("files.copyConfirmation", {
                version: revisionLabel(action.revision),
              })
            }}
          </p>
          <p v-if="action.operation === 'restore'">
            {{ t("files.restoreTheSameFileAndIdentityChooseAnotherLocation") }}
          </p>
          <p v-if="['create', 'mkdir'].includes(action.operation)">
            {{ t("files.inFolder", { name: action.folder || workspaceName }) }}
          </p>
          <p v-if="action.kind === 'move'">
            {{ t("files.leaveTheFolderEmptyToMoveThisItemTo") }}
          </p>
          <label v-if="needsDestination" class="destination-label"
            >{{ destinationLabel
            }}<SituateInput
              v-model="destination"
              autofocus
              :required="action.kind !== 'move'"
              :disabled="busy"
              :aria-invalid="!!actionError"
              :aria-describedby="actionError ? actionErrorId : undefined"
          /></label>
          <p v-if="actionError" :id="actionErrorId" role="alert">
            {{ localizeFileError(actionError) }}
          </p>
          <SituateDialogActions>
            <SituateButton
              variant="secondary"
              type="button"
              :disabled="busy"
              @click="action = null"
            >
              {{ t("navigation.cancel") }}</SituateButton
            ><SituateButton
              :variant="
                ['delete', 'discard'].includes(action.operation)
                  ? 'danger'
                  : 'primary'
              "
              type="submit"
              :disabled="busy || !writable"
            >
              {{ busy ? t("workspace.working") : submitLabel }}
            </SituateButton>
          </SituateDialogActions>
        </form>
      </div>
    </FileDialog>
    <FileDialog
      v-if="deletedOpen"
      :title="t('files.deletedFiles')"
      @dismiss="deletedOpen = false"
      ><div class="dialog-body">
        <p v-if="deletedLoading" role="status">
          {{ t("files.loadingHistory") }}
        </p>
        <p v-else-if="deletedError" role="alert">
          {{ localizeFileError(deletedError) }}
        </p>
        <p v-else-if="!deleted.length">
          {{ t("files.noDeletedFilesInRetainedHistory") }}
        </p>
        <div
          v-for="item in deletedLoading || deletedError ? [] : deleted"
          :key="`${item.path}:${item.revision}`"
          class="deleted-entry"
        >
          <p class="path" data-localization-content="user">{{ item.path }}</p>
          <SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="text-button"
            :disabled="!writable"
            @click="
              deletedOpen = false;
              startAction('restore', item.path, item.revision, true);
            "
          >
            {{
              item.isDirectory
                ? t("files.restoreFolder")
                : t("files.restoreSameFile")
            }}</SituateButton
          ><SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="text-button"
            :disabled="!writable"
            @click="
              deletedOpen = false;
              startAction('historicalCopy', item.path, item.revision, true);
            "
          >
            {{
              item.isDirectory
                ? t("files.copyFolder")
                : t("files.copyAsNewFile")
            }}</SituateButton
          ><SituateButton
            variant="ghost"
            size="small"
            type="button"
            class="text-button"
            @click="
              deletedOpen = false;
              showHistory(item.path, true, item.revision);
            "
          >
            {{ t("files.history") }}
          </SituateButton>
        </div>
      </div></FileDialog
    >
    <FileDialog
      v-if="conflictOpen && file?.outcome"
      :title="
        file.outcome.status === 'identityConfirmation'
          ? t('files.changeSystemManagedIDs')
          : file.outcome.status === 'deleted'
            ? t('files.thisFileWasDeleted')
            : t('files.chooseAVersionToKeep')
      "
      :wide="['conflict', 'changed'].includes(file.outcome.status)"
      :busy="busy"
      @dismiss="conflictOpen = false"
    >
      <p class="path dialog-path" data-localization-content="user">
        {{ file.path }}
      </p>
      <template v-if="file.outcome.status === 'identityConfirmation'"
        ><div class="dialog-body">
          <p>
            {{ t("files.changingOrRemovingAnIDCanBreakExistingReferences") }}
          </p>
          <SituateDialogActions>
            <SituateButton
              variant="secondary"
              type="button"
              :disabled="busy"
              @click="conflictOpen = false"
            >
              {{ t("files.keepEditing") }}</SituateButton
            ><SituateButton
              variant="primary"
              type="button"
              :disabled="busy || !writable"
              @click="confirmIdentity"
            >
              {{ t("files.changeIDsAndSave") }}
            </SituateButton>
          </SituateDialogActions>
        </div></template
      >
      <template v-else-if="file.outcome.status === 'deleted'"
        ><div class="dialog-body">
          <p>
            {{ t("files.theOriginalWasDeletedOutsideSituateYourDraftHas") }}
          </p>
          <label class="destination-label"
            >{{ t("files.newFilePath")
            }}<SituateInput
              v-model="destination"
              :disabled="busy"
              :placeholder="t('files.notesRecoveredMd')"
          /></label>
          <p v-if="file.error" role="alert">
            {{ localizeFileError(file.error) }}
          </p>
          <SituateDialogActions>
            <SituateButton
              variant="secondary"
              type="button"
              :disabled="busy || !writable"
              @click="recoverDeleted('restore')"
            >
              {{ t("files.restoreSameFile") }}</SituateButton
            ><SituateButton
              variant="secondary"
              type="button"
              :disabled="busy || !writable || !destination"
              @click="recoverDeleted('create')"
            >
              {{ t("files.saveAsNewFile") }}</SituateButton
            ><SituateButton
              variant="secondary"
              type="button"
              :disabled="busy || !writable"
              @click="
                startAction('discard', file.path);
                conflictOpen = false;
              "
            >
              {{ t("files.discardDraftDetail") }}
            </SituateButton>
          </SituateDialogActions>
        </div></template
      >
      <template v-else>
        <p class="notice" role="alert">
          {{
            file.outcome.status === "changed"
              ? t("files.theFileChangedAgainReviewTheUpdatedCandidatesBefore")
              : localizeFileError(file.error)
          }}
        </p>
        <div class="inspect-switch">
          <SituateButton
            variant="plain"
            type="button"
            :aria-pressed="inspect === 'editor'"
            @click="inspect = 'editor'"
          >
            {{ t("files.editorText") }}</SituateButton
          ><SituateButton
            variant="plain"
            type="button"
            :aria-pressed="inspect === 'external'"
            @click="inspect = 'external'"
          >
            {{ t("files.changedFile") }}
          </SituateButton>
        </div>
        <div class="candidates" :data-inspect="inspect">
          <section class="candidate" data-candidate="editor">
            <header>
              <h3>{{ t("files.yourEditorText") }}</h3>
              <p data-dialog-help>
                {{ t("files.completeVersionRetainedInSituate") }}
              </p>
            </header>
            <pre
              data-dialog-document
              tabindex="0"
              data-localization-content="user"
              >{{ file.outcome.editor ?? file.text }}</pre>
          </section>
          <section class="candidate" data-candidate="external">
            <header>
              <h3>{{ t("files.changedFile") }}</h3>
              <p data-dialog-help>
                {{ t("files.completeVersionFoundInTheWorkspace") }}
              </p>
            </header>
            <pre
              data-dialog-document
              tabindex="0"
              data-localization-content="user"
              >{{ file.outcome.external?.text }}</pre>
          </section>
        </div>
        <form class="decision" @submit.prevent="resolve">
          <fieldset :disabled="busy || !writable">
            <legend>{{ t("files.whichCompleteVersionShouldBeSaved") }}</legend>
            <label
              ><SituateRadio
                appearance="plain"
                v-model="choice"
                type="radio"
                value="editor"
              />{{ t("files.keepEditorText") }}</label
            ><label
              ><SituateRadio
                appearance="plain"
                v-model="choice"
                type="radio"
                value="external"
              />{{ t("files.keepChangedFile") }}</label
            >
          </fieldset>
          <p>{{ t("files.theUnselectedTextWillNotBeAppliedTheFile") }}</p>
          <SituateDialogActions>
            <SituateButton
              variant="secondary"
              size="small"
              type="button"
              :disabled="busy"
              @click="conflictOpen = false"
            >
              {{ t("files.decideLater") }}</SituateButton
            ><SituateButton
              variant="primary"
              size="small"
              type="submit"
              :disabled="busy || !writable || !choice"
            >
              {{ busy ? t("files.saving") : t("files.applySelectedVersion") }}
            </SituateButton>
          </SituateDialogActions>
        </form>
      </template>
    </FileDialog>
  </section>
</template>

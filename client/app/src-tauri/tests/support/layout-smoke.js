window.invokeLayoutSmoke = window.nativeSmokeWait.invoke;

window.waitSmokeFileTarget = (workspaceId, path) => {
  let observed;
  return window.nativeSmokeWait
    .wait(
      async ({ invoke }) => {
        const snapshot = await invoke("layout_load", { workspaceId });
        const layout = snapshot.data?.layout;
        const tab = layout?.tabs.find((item) => item.id === layout.activeTabId);
        const pane = tab?.panes.find((item) => item.id === tab.activePaneId);
        const target = pane?.navigation.entries[pane.navigation.cursor]?.target;
        observed = {
          hasLayout: !!layout,
          targetKind: target?.kind ?? null,
          isFiles: target?.viewId === "files",
          contentMatches: target?.contentId === path,
          hasLayoutNotice: !!document.querySelector(".layout-notice"),
        };
        return (
          target?.kind === "view" &&
          target.viewId === "files" &&
          target.contentId === path
        );
      },
      path
        ? "The file target was not durably selected"
        : "The Files view was not durably selected",
      { timeout: 10000 },
    )
    .catch((error) => {
      const failure = new Error(
        `${String(error)}; layout=${JSON.stringify(observed)}`,
        {
          cause: error,
        },
      );
      failure.name = error?.name ?? failure.name;
      throw failure;
    });
};

window.runLayoutSmoke = async () => {
  const invoke = window.invokeLayoutSmoke;
  const workspaceId = (await invoke("workspace_snapshot")).current.id;
  const phase = await invoke("smoke_phase");
  const canonical = (value) =>
    JSON.stringify(value, (_key, item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item).sort(([a], [b]) => a.localeCompare(b)),
          )
        : item,
    );
  const marker = `native-layout:${workspaceId}`;
  const tabId = "native-layout-tab";
  const title = `Native layout ${workspaceId}`;
  const wait = (probe, message) =>
    window.nativeSmokeWait.wait(probe, message, {
      timeout: 10000,
      interval: 50,
    });
  let record = await wait(async ({ invoke }) => {
    const value = await invoke("layout_load", { workspaceId });
    return value.data && value;
  }, "Initial layout was not persisted through native IPC");
  if (!phase.restart && !sessionStorage.getItem(marker)) {
    let previous = record.revision;
    let stable = 0;
    record = await wait(async ({ invoke }) => {
      const value = await invoke("layout_load", { workspaceId });
      stable = value.revision === previous ? stable + 1 : 0;
      previous = value.revision;
      return stable >= 3 && value;
    }, "Initial layout did not settle before the native storage probe");
    await invoke("smoke_conversation_fixture", {
      scope: workspaceId,
      fixture: "layout",
      references: [],
    });
    const conversation = "native-layout";
    const retained = await invoke("ai_conversation_snapshot", {
      scope: workspaceId,
      conversation,
    });
    const input = {
      text: "Layout retained draft",
      attachments: [],
      references: [],
    };
    await invoke("ai_conversation_action", {
      scope: workspaceId,
      conversation,
      generation: retained.generation,
      actionId: crypto.randomUUID(),
      action: {
        version: 1,
        type: "draft",
        expected: {
          text: retained.record.draft,
          attachments: retained.record.runtime?.draftAttachments ?? [],
          references: retained.record.runtime?.draftReferences ?? [],
        },
        input,
      },
    });
    await invoke("ai_create_conversation", {
      scope: workspaceId,
      id: "native-editor",
      title: "Native editor conversation",
    });
    const data = structuredClone(record.data);
    data.layout.tabs.push({
      id: tabId,
      name: title,
      layout: {
        kind: "split",
        id: "native-layout-split",
        axis: "row",
        ratio: 0.4,
        first: { kind: "pane", id: "native-layout-left" },
        second: { kind: "pane", id: "native-layout-right" },
      },
      panes: ["left", "right"].map((side) => ({
        id: `native-layout-${side}`,
        navigation: {
          entries: [
            {
              id: `native-layout-entry-${side}`,
              target: { kind: "conversation", conversationId: "native-layout" },
              presentation: {
                scrollTop: side === "left" ? 17 : 29,
                selectionStart: 0,
                selectionEnd: 0,
              },
            },
          ],
          cursor: 0,
        },
      })),
      activePaneId: "native-layout-right",
      maximizedPaneId: null,
      conversationIds: ["native-layout"],
    });
    const saved = await invoke("layout_save", {
      workspaceId,
      expectedRevision: record.revision,
      data,
    });
    const reopened = await invoke("layout_load", { workspaceId });
    if (
      !saved.revision ||
      saved.revision === record.revision ||
      JSON.stringify(saved) !== JSON.stringify(reopened) ||
      canonical(saved.data) !== canonical(data)
    )
      throw new Error(
        "Native layout save/readback changed the pane or tab state",
      );
    let conflict;
    try {
      await invoke("layout_save", {
        workspaceId,
        expectedRevision: record.revision,
        data: record.data,
      });
    } catch (error) {
      conflict = String(error);
    }
    if (conflict !== "native.layout.storage.conflict")
      throw new Error("Native layout accepted a stale revision");
    sessionStorage.setItem(marker, "saved");
    await invoke("smoke_progress", { stage: "layout-ipc-saved" });
    location.reload();
    return true;
  }
  await invoke("smoke_progress", { stage: "layout-readback" });
  const tab = record.data.layout.tabs.find((item) => item.id === tabId);
  if (
    !tab ||
    tab.name !== title ||
    tab.panes.length !== 2 ||
    tab.layout.kind !== "split" ||
    tab.layout.ratio !== 0.4 ||
    tab.activePaneId !== "native-layout-right" ||
    tab.panes[0].navigation.entries[0].presentation.scrollTop !== 17 ||
    tab.panes[1].navigation.entries[0].presentation.scrollTop !== 29
  )
    throw new Error(
      "Native layout lost workspace-owned tabs, split panes or presentation state on restoration",
    );
  await wait(
    () => document.querySelector(".topic-window"),
    "Restored layout did not render",
  );
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  if (
    tabs.length &&
    !tabs.some((button) => button.textContent.trim() === title)
  )
    throw new Error("The WebView did not restore the persisted topic tab");
  const target = tabs.find((button) => button.textContent.trim() === title);
  if (target) {
    await invoke("smoke_progress", { stage: "layout-tab-activating" });
    target.click();
    await wait(
      () =>
        ["left", "right"].every((side) => {
          const pane = document.querySelector(
            `[data-pane="native-layout-${side}"]`,
          );
          const scroll = pane?.querySelector(".transcript-scroll");
          const draft = pane?.querySelector("textarea");
          return (
            scroll?.scrollTop === (side === "left" ? 17 : 29) &&
            draft?.value === "Layout retained draft"
          );
        }),
      "Restored split panes did not recover their independent scroll positions and shared draft",
    );
    await invoke("smoke_progress", { stage: "layout-panes-restored" });
    const menuItem = (label) =>
      [
        ...document.querySelectorAll(
          '[popover]:popover-open [role="menuitem"]',
        ),
      ].find((item) => item.textContent.trim() === label);
    const openTabMenu = async () => {
      document.querySelector(".tab-header .tab-actions-trigger").click();
      await wait(() => {
        const item = menuItem("Close all tabs");
        if (!item) return false;
        const box = item.getBoundingClientRect();
        return item.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        );
      }, "The tab menu did not expose a reachable Close all tabs action");
    };
    await openTabMenu();
    await invoke("smoke_progress", { stage: "layout-menu-opened" });
    if (!menuItem("Close other tabs"))
      throw new Error("The tab menu did not expose Close other tabs");
    document.querySelector(".tab-header .tab-actions-trigger").click();
    await invoke("smoke_progress", { stage: "layout-reopen-before" });
    await invoke("workspace_action", {
      action: "open",
      id: workspaceId,
      name: null,
    });
    await invoke("smoke_progress", { stage: "layout-reopen-after" });
    await wait(
      () => document.hasFocus(),
      "The workspace window did not receive focus",
    );
    target.focus();
    const close = target.closest(".topic-tab").querySelector(".tab-close");
    await wait(() => {
      const box = close.getBoundingClientRect();
      return (
        getComputedStyle(close).opacity === "1" &&
        close.contains(
          document.elementFromPoint(
            box.x + box.width / 2,
            box.y + box.height / 2,
          ),
        )
      );
    }, "The focused tab did not expose its close button");
    close.click();
    await wait(async ({ invoke }) => {
      const saved = (await invoke("layout_load", { workspaceId })).data.layout;
      return (
        !saved.tabs.some((item) => item.id === tabId) &&
        saved.closedTabs.some((item) => item.tab.id === tabId) &&
        !document.querySelector('[data-pane="native-layout-left"]')
      );
    }, "Closing the tab did not retain its arrangement for reopening");
    await openTabMenu();
    const reopen = menuItem("Reopen closed tab");
    if (!reopen) throw new Error("The closed tab cannot be reopened");
    reopen.click();
    await wait(async ({ invoke }) => {
      const saved = (await invoke("layout_load", { workspaceId })).data.layout;
      return (
        saved.activeTabId === tabId &&
        saved.tabs.some(
          (item) => item.id === tabId && item.panes.length === 2,
        ) &&
        document.querySelector('[data-pane="native-layout-left"]')
      );
    }, "Reopening the tab did not restore its panes");
    const original = [...document.querySelectorAll('[role="tab"]')].find(
      (button) =>
        button.id.endsWith(`-topic-${record.data.layout.activeTabId}`),
    );
    if (!original)
      throw new Error("The previously active topic tab was not restored");
    original.click();
    await wait(
      async ({ invoke }) =>
        (await invoke("layout_load", { workspaceId })).data.layout
          .activeTabId === record.data.layout.activeTabId &&
        !document.querySelector('[data-pane="native-layout-left"]'),
      "Returning to the restored topic did not persist",
    );
  }
  await invoke("smoke_progress", {
    stage: phase.restart
      ? "layout-process-restored"
      : "layout-webview-restored",
  });
  return false;
};

import { beforeEach, expect, test, vi } from "vitest";
import type { ToolActivity } from "../components/chat/transcript";
import {
  loadRecordedChange,
  recordedAssignmentChanges,
  observedAssignmentHistories,
  loadObservedHistory,
} from "./assignment-history";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const before = "1".repeat(40),
  after = "2".repeat(40);
function call(name: string, details: unknown, id = "call"): ToolActivity {
  return {
    id,
    runId: "run",
    name,
    args: {},
    state: "completed",
    result: { details },
  };
}
beforeEach(() => {
  invoke.mockReset();
});
test("ordinary edits keep their captured bytes even when the same path is changed later", async () => {
  const changes = recordedAssignmentChanges([
    call(
      "write",
      {
        change: {
          path: "projects/plan.md",
          before: "# Before\n",
          after: "# Checked\n",
          beforeRevision: "old-text",
          afterRevision: "checked-text",
        },
      },
      "one",
    ),
    call(
      "edit",
      {
        change: {
          path: "projects/plan.md",
          before: "# Checked\n",
          after: "# Later\n",
          beforeRevision: "checked-text",
          afterRevision: "later-text",
        },
      },
      "two",
    ),
  ]);
  expect(changes).toHaveLength(2);
  expect(changes[0]).toEqual({
    id: "run:one:0",
    operation: "modified",
    attribution: "recorded",
    before: {
      path: "projects/plan.md",
      revision: "old-text",
      status: "available",
      text: "# Before\n",
    },
    after: {
      path: "projects/plan.md",
      revision: "checked-text",
      status: "available",
      text: "# Checked\n",
    },
  });
  expect(await loadRecordedChange("workspace", changes[0]!)).toEqual(
    changes[0],
  );
  expect(invoke).not.toHaveBeenCalled();
});
test.each(["edit_plugin_sources", "inspect_plugin", "write", "edit"])(
  "%s retains plugin paths and independent revisions alongside shell observations",
  async (sourceTool) => {
    const changes = recordedAssignmentChanges([
      call(sourceTool, {
        changes: [
          {
            store: "plugin",
            pluginId: "mail",
            operation: "renamed",
            before: { path: "old.js", revision: before },
            after: { path: "views/main.js", revision: after },
            attribution: "uncertain",
          },
        ],
      }),
      call(
        "shell",
        {
          changes: [
            {
              store: "workspace",
              operation: "deleted",
              before: { path: "old.md", revision: before },
              after: null,
              attribution: "uncertain",
            },
          ],
        },
        "shell",
      ),
    ]);
    expect(
      changes.map((change) => [
        change.operation,
        change.before?.path,
        change.after?.path,
        change.attribution,
      ]),
    ).toEqual([
      [
        "renamed",
        ".situate/plugins/mail/code/old.js",
        ".situate/plugins/mail/code/views/main.js",
        "uncertain",
      ],
      ["deleted", "old.md", undefined, "uncertain"],
    ]);
    invoke
      .mockResolvedValueOnce({ status: "available", text: "old" })
      .mockResolvedValueOnce({ status: "available", text: "new" });
    const loaded = await loadRecordedChange("workspace", changes[0]!);
    expect(invoke.mock.calls).toEqual([
      [
        "change_revision",
        {
          scope: "workspace",
          pluginId: "mail",
          path: "old.js",
          revision: before,
        },
      ],
      [
        "change_revision",
        {
          scope: "workspace",
          pluginId: "mail",
          path: "views/main.js",
          revision: after,
        },
      ],
    ]);
    expect(loaded.before).toMatchObject({ text: "old", status: "available" });
    expect(loaded.after).toMatchObject({ text: "new", status: "available" });
    invoke.mockResolvedValueOnce({ status: "unsupported" });
    expect(
      (await loadRecordedChange("workspace", changes[1]!)).before?.status,
    ).toBe("unsupported");
    expect(invoke).toHaveBeenLastCalledWith("change_revision", {
      scope: "workspace",
      path: "old.md",
      revision: before,
    });
  },
);
test("missing historical bytes never request or substitute current contents", async () => {
  const [change] = recordedAssignmentChanges([
    call("edit_plugin_sources", {
      change: {
        store: "plugin",
        pluginId: "mail",
        operation: "added",
        before: null,
        after: { path: "entry.js", revision: after },
        attribution: "uncertain",
      },
    }),
  ]);
  invoke.mockRejectedValue(new Error("native.content.history.unavailable"));
  expect((await loadRecordedChange("workspace", change!)).after).toEqual({
    path: ".situate/plugins/mail/code/entry.js",
    revision: after,
    status: "unavailable",
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
test("shell observations are discovered from retained Git pairs without rerunning the command", async () => {
  const [history] = observedAssignmentHistories([
    call("shell", {
      beforeHistoryRevision: before,
      afterHistoryRevision: after,
    }),
  ]);
  invoke.mockResolvedValue({
    status: "ready",
    changes: [
      {
        store: "workspace",
        operation: "deleted",
        before: { path: "old.md", revision: before },
        after: null,
        attribution: "uncertain",
      },
    ],
  });
  const observed = await loadObservedHistory("workspace", history!);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("change_list", {
    scope: "workspace",
    before,
    after,
  });
  expect(observed.status).toBe("ready");
  expect(observed.changes[0]).toMatchObject({
    id: "run:call:0",
    operation: "deleted",
    attribution: "uncertain",
    before: { path: "old.md", revision: before, status: "loading" },
    after: null,
  });
  invoke.mockClear();
  expect(
    await loadObservedHistory("workspace", { ...history!, after: before }),
  ).toEqual({ status: "ready", changes: [] });
  expect(invoke).not.toHaveBeenCalled();
  expect(
    await loadObservedHistory("workspace", { ...history!, after: undefined }),
  ).toEqual({ status: "unavailable", changes: [] });
  expect(invoke).not.toHaveBeenCalled();
});

test("unavailable source comparisons survive empty or partial receipts without historical reads", async () => {
  for (const details of [
    {
      pluginId: "mail",
      revision: after,
      changes: [],
      comparisonUnavailable: true,
    },
    {
      outcome: {
        PartialFailure: {
          changed_paths: ["views/old.js"],
          recovery_revision: before,
          error: "failed",
        },
      },
      comparisonUnavailable: true,
    },
    {
      outcome: {
        SavedHistoryFailed: {
          version: { text: "retained edit", revision: "text-hash" },
          error: "failed",
        },
      },
    },
    {
      outcome: {
        PartialFailure: {
          changed_paths: ["views/old.js"],
          recovery_revision: before,
          error: "failed",
        },
      },
    },
  ]) {
    const activity = [call("edit_plugin_sources", details)];
    const histories = observedAssignmentHistories(activity);
    expect(histories).toEqual([
      {
        id: "run:call",
        runId: "run",
        callId: "call",
        comparisonUnavailable: true,
      },
    ]);
    expect(recordedAssignmentChanges(activity)).toEqual([]);
    expect(await loadObservedHistory("workspace", histories[0]!)).toEqual({
      status: "unavailable",
      changes: [],
    });
  }
  expect(invoke).not.toHaveBeenCalled();
  expect(
    observedAssignmentHistories([
      call("edit_plugin_sources", {
        changes: [],
        comparisonUnavailable: false,
      }),
    ]),
  ).toEqual([]);
  expect(
    observedAssignmentHistories([
      call("read", { comparisonUnavailable: true }),
    ]),
  ).toEqual([]);
});

test("unavailable collateral comparison retains known exact source references", async () => {
  const activity = [
    call("edit_plugin_sources", {
      comparisonUnavailable: true,
      changes: [
        {
          store: "plugin",
          pluginId: "mail",
          operation: "renamed",
          before: { path: "old.js", revision: before },
          after: { path: "new.js", revision: after },
          attribution: "uncertain",
        },
      ],
    }),
  ];
  expect(recordedAssignmentChanges(activity)).toMatchObject([
    {
      operation: "renamed",
      attribution: "uncertain",
      before: { path: ".situate/plugins/mail/code/old.js", revision: before },
      after: { path: ".situate/plugins/mail/code/new.js", revision: after },
    },
  ]);
  const [history] = observedAssignmentHistories(activity);
  expect(
    await loadObservedHistory("workspace", { ...history!, before, after }),
  ).toEqual({ status: "unavailable", changes: [] });
  expect(invoke).not.toHaveBeenCalled();
});

test("failed observation reads remain retryable without a partial or current-file substitute", async () => {
  const [history] = observedAssignmentHistories([
    call("shell", {
      beforeHistoryRevision: before,
      afterHistoryRevision: after,
    }),
  ]);
  invoke.mockRejectedValueOnce(new Error("native.content.history.unavailable"));
  expect(await loadObservedHistory("workspace", history!)).toEqual({
    status: "error",
    changes: [],
  });
  invoke.mockResolvedValueOnce({
    status: "ready",
    changes: [{ invalid: true }],
  });
  expect(await loadObservedHistory("workspace", history!)).toEqual({
    status: "error",
    changes: [],
  });
  invoke.mockResolvedValueOnce({ status: "unavailable", changes: [] });
  expect(await loadObservedHistory("workspace", history!)).toEqual({
    status: "unavailable",
    changes: [],
  });
});

test("tool prose, unrelated calls, incomplete receipts and unchanged writes are not recorded edits", () => {
  expect(
    recordedAssignmentChanges([
      call("write", {
        change: { path: "a.md", before: null, after: "x", afterRevision: "" },
      }),
      call("write", {
        change: {
          path: "a.md",
          before: "same",
          after: "same",
          beforeRevision: "old",
          afterRevision: "new",
        },
      }),
      call("read", {
        change: {
          path: "a.md",
          before: null,
          after: "x",
          beforeRevision: null,
          afterRevision: "new",
        },
      }),
      call("edit_plugin_sources", {
        change: {
          store: "plugin",
          pluginId: "../other",
          operation: "added",
          before: null,
          after: { path: "entry.js", revision: after },
        },
      }),
      call("write", { content: [{ type: "text", text: "Changed notes.md" }] }),
    ]),
  ).toEqual([]);
});

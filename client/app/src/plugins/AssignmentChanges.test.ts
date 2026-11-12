import { afterEach, expect, test, vi } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import AssignmentChanges from "./AssignmentChanges.vue";
import {
  createChangesNavigation,
  type AssignmentChange,
  type AssignmentRevision,
} from "./assignment-changes";

enableAutoUnmount(afterEach);
const revision = (
  path: string,
  text: string,
  id = "one",
): AssignmentRevision => ({ path, text, revision: id, status: "available" });
const recorded = (id: string, path = id): AssignmentChange => ({
  id,
  operation: "modified",
  attribution: "recorded",
  before: revision(path, "old\n", "before-" + id),
  after: revision(path, "new\n", "after-" + id),
});
function panel(
  changes: AssignmentChange[] = [
    recorded("source", ".situate/plugins/a/source.ts"),
  ],
) {
  return mount(AssignmentChanges, {
    attachTo: document.body,
    props: {
      state: { status: "ready", changes },
    },
  });
}
async function click(wrapper: ReturnType<typeof panel>, key: string) {
  const button = wrapper
    .findAll("button")
    .find(
      (button) =>
        button.text() === "⟦assignmentChanges." + key + "⟧" ||
        button.attributes("aria-label") === "⟦assignmentChanges." + key + "⟧",
    );
  expect(button).toBeDefined();
  await button!.trigger("click");
}
async function select(wrapper: ReturnType<typeof panel>, id: string) {
  await wrapper.get('[data-change-id="' + id + '"]').trigger("click");
}

test("lists workspace paths and compares inert recorded source without semantic metadata", async () => {
  const change = recorded("source", ".situate/plugins/a/source.md");
  change.after = revision(
    ".situate/plugins/a/source.md",
    "<script>alert(1)</script>\n# Heading\n",
  );
  const wrapper = panel([change]);
  expect(wrapper.findAll(".file-row")).toHaveLength(1);
  expect(
    wrapper.find('[role="tablist"], .change-group, .change-summary').exists(),
  ).toBe(false);
  await select(wrapper, "source");
  expect(wrapper.get("h4").text()).toBe(".situate/plugins/a/source.md");
  expect(document.activeElement).toBe(wrapper.get("h4").element);
  expect(wrapper.get(".diff-line.removed .line-content").text()).toBe("old");
  expect(wrapper.get(".diff-line.added .line-content").text()).toBe(
    "<script>alert(1)</script>",
  );
  expect(
    wrapper.find("script, iframe, textarea, [contenteditable]").exists(),
  ).toBe(false);
  expect(wrapper.emitted("select")).toEqual([["source"]]);
  expect(wrapper.props("state").changes[0]).toEqual(change);
});

test("highlights exact historical code with multiline lexical context and inert source strings", async () => {
  const path = ".situate/plugins/a/code/entry.js";
  const change = recorded("code", path);
  change.before = revision(path, "/* export\nconst */\nconst value = 1;\n");
  change.after = revision(
    path,
    '/* export\nconst */\nconst value = 2;\nconst html = "<img src=x onerror=alert(1)>";\n',
  );
  const wrapper = panel([change]);
  await select(wrapper, "code");
  expect(
    wrapper.findAll(".syntax-keyword").map((token) => token.text()),
  ).toEqual(["const", "const", "const"]);
  expect(
    wrapper.findAll(".syntax-comment").map((token) => token.text()),
  ).toEqual(["/* export", "const */"]);
  expect(
    wrapper.findAll(".syntax-number").map((token) => token.text()),
  ).toEqual(["1", "2"]);
  expect(wrapper.find(".syntax-string").text()).toBe(
    '"<img src=x onerror=alert(1)>"',
  );
  expect(wrapper.find("img,script").exists()).toBe(false);
});

test("handles added/deleted empty files and renames without inventing content", async () => {
  const wrapper = panel([
    {
      id: "add",
      operation: "added",
      attribution: "recorded",
      before: null,
      after: revision("new.ts", ""),
    },
    {
      id: "delete",
      operation: "deleted",
      attribution: "recorded",
      before: revision("gone.ts", ""),
      after: null,
    },
    {
      id: "rename",
      operation: "renamed",
      attribution: "recorded",
      before: revision("old.md", "# Source\n"),
      after: revision("new.md", "# Source\n"),
    },
  ]);
  await select(wrapper, "add");
  expect(wrapper.text()).toContain("⟦assignmentChanges.emptyAdded⟧");
  await select(wrapper, "delete");
  expect(wrapper.text()).toContain("⟦assignmentChanges.emptyDeleted⟧");
  await select(wrapper, "rename");
  expect(wrapper.get(".renamed-path").text()).toBe("old.md → new.md");
  expect(wrapper.text()).toContain("⟦assignmentChanges.noContent⟧");
  expect(wrapper.find(".diff-line").exists()).toBe(false);
});

test("separates independent comparisons for the same path and discloses uncertain attribution", async () => {
  const first = recorded("first", "Notes/a.md");
  const later = recorded("later", "Notes/a.md");
  later.attribution = "uncertain";
  later.before = revision("Notes/a.md", "new\n", "second");
  later.after = revision("Notes/a.md", "external\n", "third");
  const wrapper = panel([first, later]);
  expect(wrapper.findAll(".record-range")).toHaveLength(2);
  await select(wrapper, "first");
  expect(wrapper.get(".diff-lines").text()).not.toContain("external");
  expect(wrapper.find('[role="note"]').exists()).toBe(false);
  await select(wrapper, "later");
  expect(wrapper.get('[role="note"]').text()).toBe(
    "⟦assignmentChanges.uncertain⟧",
  );
  expect(wrapper.get(".diff-lines").text()).toContain("external");
  expect(wrapper.get(".diff-line.removed").text()).toContain("new");
});

test.each(["unavailable", "unsupported", "missing"] as const)(
  "never substitutes text for %s revisions",
  async (status) => {
    const change = recorded("broken");
    change.before =
      status === "missing" ? null : { path: "broken", revision: "r1", status };
    const wrapper = panel([change]);
    await select(wrapper, "broken");
    expect(wrapper.get('[role="status"]').text()).toBe(
      status === "unsupported"
        ? "⟦assignmentChanges.unsupported⟧"
        : "⟦assignmentChanges.unavailable⟧",
    );
    expect(wrapper.find(".diff-lines").exists()).toBe(false);
  },
);

test("preserves search, selection and independent scroll state across return and remount", async () => {
  const changes = [
    recorded("first", "folder/a.ts"),
    recorded("second", "folder/b.ts"),
  ];
  const wrapper = panel(changes);
  await wrapper.get("input").setValue("folder");
  const list = wrapper.get(".inspection-scroll");
  list.element.scrollTop = 137;
  await list.trigger("scroll");
  await select(wrapper, "first");
  wrapper.get(".diff-scroll").element.scrollTop = 71;
  await wrapper.get(".diff-scroll").trigger("scroll");
  await click(wrapper, "back");
  expect(document.activeElement).toBe(
    wrapper.get('[aria-current="true"]').element,
  );
  expect(wrapper.get("input").element.value).toBe("folder");
  expect(list.element.scrollTop).toBe(137);
  await select(wrapper, "first");
  expect(wrapper.get(".diff-scroll").element.scrollTop).toBe(71);
  const navigation = wrapper.emitted("navigate")!.at(-1)![0] as ReturnType<
    typeof createChangesNavigation
  >;
  wrapper.unmount();
  const reopened = mount(AssignmentChanges, {
    props: { state: { status: "ready", changes }, navigation },
  });
  await nextTick();
  expect(reopened.get("input").element.value).toBe("folder");
  expect(reopened.get(".diff-scroll").element.scrollTop).toBe(71);
  await reopened.get("input").setValue("b.ts");
  expect(navigation.query).toBe("folder");
});

test("paginates many files and keeps keyboard focus on the visible list across pages", async () => {
  const wrapper = panel(
    Array.from({ length: 501 }, (_, index) =>
      recorded(String(index), "Notes/note" + index + ".md"),
    ),
  );
  expect(wrapper.findAll(".file-row")).toHaveLength(100);
  await wrapper.get(".file-row").trigger("keydown", { key: "End" });
  expect(wrapper.findAll(".file-row")).toHaveLength(1);
  expect(document.activeElement).toBe(
    wrapper.get('[data-change-id="500"]').element,
  );
  expect(wrapper.get(".inspection-body").classes()).not.toContain(
    "detail-active",
  );
  await wrapper.get(".file-row").trigger("keydown", { key: "ArrowUp" });
  expect(document.activeElement).toBe(
    wrapper.get('[data-change-id="499"]').element,
  );
  await wrapper.get(".file-row").trigger("keydown", { key: "Home" });
  expect(document.activeElement).toBe(
    wrapper.get('[data-change-id="0"]').element,
  );
  await wrapper.get("input").setValue("note450.md");
  expect(wrapper.findAll(".file-row")).toHaveLength(1);
  await select(wrapper, "450");
  expect(wrapper.get("h4").text()).toBe("Notes/note450.md");
  await click(wrapper, "back");
  await wrapper.get("input").setValue("absent");
  expect(wrapper.text()).toContain("⟦assignmentChanges.noMatches⟧");
  await click(wrapper, "clear");
  expect(wrapper.findAll(".file-row")).toHaveLength(100);
});

test("bounds long context and restores its disclosure and scroll state", async () => {
  const before =
    Array.from({ length: 400 }, (_, index) => "line " + index).join("\n") +
    "\n";
  const change = recorded("long");
  change.before = revision("long.ts", before);
  change.after = revision(
    "long.ts",
    before.replace("line 20\n", "changed\n").replace("line 300\n", "updated\n"),
  );
  let wrapper = panel([change]);
  await select(wrapper, "long");
  expect(wrapper.element.querySelectorAll(".diff-line")).toHaveLength(16);
  await wrapper.findAll(".diff-gap button")[1].trigger("click");
  expect(wrapper.element.querySelectorAll(".diff-line")).toHaveLength(216);
  expect(document.activeElement).toBe(wrapper.get(".diff-scroll").element);
  wrapper.get(".diff-scroll").element.scrollTop = 321;
  await wrapper.get(".diff-scroll").trigger("scroll");
  const navigation = wrapper.emitted("navigate")!.at(-1)![0] as ReturnType<
    typeof createChangesNavigation
  >;
  wrapper.unmount();
  wrapper = mount(AssignmentChanges, {
    attachTo: document.body,
    props: {
      state: { status: "ready", changes: [change] },
      navigation,
      onNavigate: (value) => {
        void wrapper.setProps({ navigation: value });
      },
    },
  });
  await nextTick();
  expect(wrapper.element.querySelectorAll(".diff-line")).toHaveLength(216);
  expect(wrapper.get(".diff-scroll").element.scrollTop).toBe(321);
  await wrapper.findAll(".diff-gap button")[1].trigger("click");
  expect(wrapper.element.querySelectorAll(".diff-line").length).toBeGreaterThan(
    216,
  );
});

test("progressively renders every line of a large addition", async () => {
  const addition: AssignmentChange = {
    id: "large",
    operation: "added",
    attribution: "recorded",
    before: null,
    after: revision("large.ts", "new\n".repeat(401)),
  };
  const wrapper = panel([addition]);
  await select(wrapper, "large");
  expect(wrapper.element.querySelectorAll(".diff-line")).toHaveLength(400);
  await click(wrapper, "moreLines");
  expect(wrapper.element.querySelectorAll(".diff-line")).toHaveLength(401);
  expect(wrapper.text()).not.toContain("⟦assignmentChanges.moreLines⟧");
  expect(document.activeElement).toBe(wrapper.get(".diff-scroll").element);
});

test("keeps retrieval status separate from empty results and emits retry without simulating progress", async () => {
  const wrapper = panel([]);
  expect(wrapper.text()).toContain("⟦assignmentChanges.emptyChanges⟧");
  await wrapper.setProps({ state: { status: "loading", changes: [] } });
  expect(wrapper.get('[role="status"]').text()).toBe(
    "⟦assignmentChanges.loading⟧",
  );
  await wrapper.setProps({ state: { status: "error", changes: [] } });
  expect(wrapper.get('[role="alert"]').text()).toBe(
    "⟦assignmentChanges.error⟧",
  );
  await click(wrapper, "retry");
  expect(wrapper.emitted("retry")).toEqual([[]]);
  expect(wrapper.props("state").status).toBe("error");
});

test("responds to its container width and emits expansion requests without owning the host layout", async () => {
  let resize!: ResizeObserverCallback;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  try {
    const wrapper = panel();
    resize(
      [{ contentRect: { width: 900 } }] as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
    await nextTick();
    expect(wrapper.get(".inspection-body").classes()).toContain("split");
    await click(wrapper, "expand");
    expect(wrapper.emitted("expand")).toEqual([[true]]);
    await wrapper.setProps({ expanded: true });
    await click(wrapper, "restore");
    expect(wrapper.emitted("expand")).toEqual([[true], [false]]);
    resize(
      [{ contentRect: { width: 320 } }] as ResizeObserverEntry[],
      {} as ResizeObserver,
    );
    await nextTick();
    expect(wrapper.get(".inspection-body").classes()).not.toContain("split");
    wrapper.unmount();
    expect(disconnect).toHaveBeenCalledOnce();
  } finally {
    vi.unstubAllGlobals();
  }
});

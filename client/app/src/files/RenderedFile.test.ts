import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import RenderedFile from "./RenderedFile.vue";
import { filesRequest } from "./api";
import {
  releaseWorkspace,
  retainedWorkspaces,
  workspaceSession,
} from "./sessions";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  filesRequest: vi.fn(),
}));
const invoke = vi.mocked(filesRequest);
let count = 0;
function render(html: string, text = "# One") {
  return mount(RenderedFile, {
    props: {
      session: workspaceSession(`renderer-${++count}`),
      path: "Notes/One.md",
      text,
      document: {
        path: "Notes/One.md",
        version: { text, revision: "blob" },
        html,
        issues: [],
      },
    },
  });
}
enableAutoUnmount(afterEach);
beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue({ status: "ok" });
});
afterEach(() => {
  retainedWorkspaces().forEach(releaseWorkspace);
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.getSelection()?.removeAllRanges();
});

describe("rendered source navigation", () => {
  it("emits once at the nearest annotated block without modifying source or requesting a write", async () => {
    const text = "# One\n\n> **Two**\n\n```\nThree\n```";
    const wrapper = render(
      '<h1 data-source-offset="0">One</h1><blockquote data-source-offset="7"><p data-source-offset="9"><strong>Two</strong></p></blockquote><pre data-source-offset="18"><code>Three</code></pre>',
      text,
    );
    await wrapper.setProps({ editable: true });
    for (const selector of ["h1", "strong", "code"])
      await wrapper.get(selector).trigger("click");
    expect(wrapper.emitted("editSource")).toEqual([[0], [9], [18]]);
    expect(wrapper.props("text")).toBe(text);
    expect(invoke).not.toHaveBeenCalled();
    expect(wrapper.find('[tabindex], [role="button"]').exists()).toBe(false);
  });

  it("is passive by default and in historical or read-only views", async () => {
    const wrapper = render('<h1 data-source-offset="0">One</h1>');
    await wrapper.get("h1").trigger("click");
    await wrapper.setProps({ editable: true, historical: true });
    await wrapper.get("h1").trigger("click");
    await wrapper.setProps({ editable: false, historical: false });
    await wrapper.get("h1").trigger("click");
    expect(wrapper.emitted("editSource")).toBeUndefined();
  });

  it("does not invent positions for missing, malformed, out-of-range or non-block annotations", async () => {
    const wrapper = render(
      '<blockquote data-source-offset="0"><p>Unknown</p></blockquote>' +
        ["-1", "1.5", "NaN", "9007199254740992", "5", "01", ""]
          .map((offset) => `<p data-source-offset="${offset}">Invalid</p>`)
          .join("") +
        '<span data-source-offset="0">Not a block</span>',
    );
    await wrapper.setProps({ editable: true });
    for (const element of wrapper.findAll("p, span"))
      await element.trigger("click");
    expect(wrapper.emitted("editSource")).toBeUndefined();
    expect(wrapper.findAll("[data-source-offset]")).toHaveLength(1);
  });

  it("accepts UTF-16 positions and rejects positions within a surrogate pair", async () => {
    const wrapper = render(
      '<p data-source-offset="1">Invalid</p><p data-source-offset="4">Again</p>',
      "🦀\n\nAgain",
    );
    await wrapper.setProps({ editable: true });
    for (const paragraph of wrapper.findAll("p"))
      await paragraph.trigger("click");
    expect(wrapper.emitted("editSource")).toEqual([[4]]);
  });

  it("leaves links, images and disabled checkboxes out of source navigation", async () => {
    const wrapper = render(
      '<p data-source-offset="0"><a href="Two.md"><strong>Next</strong></a><img src="https://example.org/a.png"><input type="checkbox"></p>',
    );
    await wrapper.setProps({ editable: true });
    for (const selector of ["strong", "img", "input"])
      await wrapper.get(selector).trigger("click");
    await flushPromises();
    expect(wrapper.emitted("editSource")).toBeUndefined();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ operation: "openExternal", href: "Two.md" }),
    );
  });

  it("ignores modified and middle clicks, selection, and pointer drags", async () => {
    const wrapper = render('<h1 data-source-offset="0">One</h1>');
    await wrapper.setProps({ editable: true });
    const heading = wrapper.get("h1");
    for (const options of [
      { altKey: true },
      { ctrlKey: true },
      { metaKey: true },
      { shiftKey: true },
      { button: 1 },
    ])
      await heading.trigger("click", options);
    await heading.trigger("auxclick", { button: 1 });
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ isCollapsed: false } as Selection);
    await heading.trigger("click");
    selection.mockRestore();
    heading.element.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    heading.element.dispatchEvent(
      new MouseEvent("pointermove", {
        bubbles: true,
        clientX: 30,
        clientY: 10,
      }),
    );
    await heading.trigger("click");
    expect(wrapper.emitted("editSource")).toBeUndefined();
    heading.element.dispatchEvent(
      new MouseEvent("pointerdown", {
        bubbles: true,
        clientX: 10,
        clientY: 10,
      }),
    );
    await heading.trigger("click");
    expect(wrapper.emitted("editSource")).toEqual([[0]]);
  });

  it("uses requested draft positions even when the preview reply carries the disk version", async () => {
    vi.useFakeTimers();
    const wrapper = render('<h1 data-source-offset="0">One</h1>');
    await wrapper.setProps({ editable: true, text: "🦀\n\nDraft" });
    expect(wrapper.find("h1").exists()).toBe(false);
    invoke.mockResolvedValueOnce({
      status: "ok",
      document: {
        path: "Notes/One.md",
        version: { text: "# One", revision: "disk" },
        html: '<p data-source-offset="4">Draft</p>',
        issues: [],
      },
    });
    await vi.advanceTimersByTimeAsync(150);
    await flushPromises();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ operation: "read", text: "🦀\n\nDraft" }),
    );
    await wrapper.get("p").trigger("click");
    expect(wrapper.emitted("editSource")).toEqual([[4]]);
    expect(wrapper.props("text")).toBe("🦀\n\nDraft");
  });

  it("discards an old draft response after source or document identity changes", async () => {
    vi.useFakeTimers();
    const wrapper = render('<h1 data-source-offset="0">One</h1>');
    let resolve!: (value: Awaited<ReturnType<typeof filesRequest>>) => void;
    invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await wrapper.setProps({ editable: true, text: "Old draft" });
    await vi.advanceTimersByTimeAsync(150);
    await wrapper.setProps({ text: "New draft", path: "Notes/Two.md" });
    resolve({
      status: "ok",
      document: {
        path: "Notes/One.md",
        version: { text: "# One", revision: "disk" },
        html: '<p data-source-offset="0">Old draft</p>',
        issues: [],
      },
    });
    await flushPromises();
    expect(wrapper.find("p").exists()).toBe(false);
    expect(wrapper.emitted("editSource")).toBeUndefined();
  });
});

describe("passive Markdown rendering", () => {
  it("never compiles text as Vue or exposes scripts, forms, event handlers, or active embeds", () => {
    const wrapper = render(
      '<h1>{{ globalThis.secret }}</h1><script>steal()</script><form action="https://example.org"><input name="secret"><button>Submit</button></form><iframe src="https://example.org"></iframe><img src="data:text/html,evil" onerror="steal()"><input type="checkbox" checked onclick="steal()">',
    );
    expect(wrapper.get("h1").text()).toBe("{{ globalThis.secret }}");
    expect(
      wrapper
        .find("script, form, button, iframe, [onerror], [onclick]")
        .exists(),
    ).toBe(false);
    expect(wrapper.get("img").attributes("src")).toBeUndefined();
    expect(wrapper.get<HTMLInputElement>("input").element.disabled).toBe(true);
  });

  it("routes external URLs through the host and removes navigable arbitrary hrefs", async () => {
    const wrapper = render(
      '<p><a href="https://example.org/article">Read elsewhere</a><a href="javascript:alert(1)">Unsafe</a></p>',
    );
    expect(wrapper.get("a").attributes("href")).toBe("#");
    await wrapper.get("a").trigger("click");
    await flushPromises();
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      operation: "openExternal",
      destination: "Notes/One.md",
      href: "https://example.org/article",
    });
    invoke.mockRejectedValueOnce(new Error("This link type cannot be opened."));
    await wrapper.findAll("a")[1]!.trigger("click");
    await flushPromises();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(wrapper.emitted("navigate")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "⟦localization.unknownError⟧",
    );
  });

  it("passes raw link spelling and document context to the host without double-decoding", async () => {
    const wrapper = render(
      '<a href="../Images/100%25%20%23%20Map.pdf">Map</a><a href="../../private.md">Outside</a><a href="/Notes/Two.md">Note</a>',
    );
    await wrapper.findAll("a")[0]!.trigger("click");
    await flushPromises();
    expect(invoke.mock.calls[0]?.[0]).toMatchObject({
      operation: "openExternal",
      destination: "Notes/One.md",
      href: "../Images/100%25%20%23%20Map.pdf",
    });
    expect(invoke.mock.calls[0]?.[0].path).toBeUndefined();
    invoke.mockRejectedValueOnce(new Error("This link leaves the workspace."));
    await wrapper.findAll("a")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("navigate")).toBeUndefined();
    expect(wrapper.get('[role="alert"]').text()).toContain(
      "⟦localization.unknownError⟧",
    );
    invoke.mockResolvedValueOnce({
      status: "ok",
      document: {
        path: "Notes/Two.md",
        version: { text: "# Two", revision: "two" },
        html: "",
        issues: [],
      },
    });
    await wrapper.findAll("a")[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.emitted("navigate")).toEqual([["Notes/Two.md"]]);
  });

  it("ignores an old workspace link reply even when the new document has identical content", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof filesRequest>>) => void;
    invoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const wrapper = render('<a href="Two.md">Next</a>');
    await wrapper.get("a").trigger("click");
    await flushPromises();
    await wrapper.setProps({
      session: workspaceSession(`renderer-${++count}`),
    });
    resolve({
      status: "ok",
      document: {
        path: "Wrong-workspace.md",
        version: { text: "# Wrong", revision: "wrong" },
        html: "",
        issues: [],
      },
    });
    await flushPromises();
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });

  it("keeps hash-only links inside historical inspection without requesting a live document", async () => {
    const wrapper = render(
      '<a href="#reading-corner">Reading corner</a><h2 id="reading-corner">Reading corner</h2>',
    );
    await wrapper.setProps({ historical: true });
    const scroll = vi.fn();
    wrapper.get("h2").element.scrollIntoView = scroll;
    expect(wrapper.get("h2").attributes("id")).toBeUndefined();
    await wrapper.get("a").trigger("click");
    await flushPromises();
    expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: "start" });
    expect(invoke).not.toHaveBeenCalled();
    expect(wrapper.emitted("navigate")).toBeUndefined();
  });

  it("keeps automatically loaded HTTPS and embedded local images while checkboxes remain read-only", () => {
    const wrapper = render(
      '<img src="https://example.org/photo.jpg" alt="Photo"><img src="data:image/png;base64,AAAA" alt="Local"><input type="checkbox" checked>',
    );
    expect(
      wrapper.findAll("img").map((image) => image.attributes("src")),
    ).toEqual(["https://example.org/photo.jpg", "data:image/png;base64,AAAA"]);
    expect(wrapper.get<HTMLInputElement>("input").element.checked).toBe(true);
    expect(wrapper.get<HTMLInputElement>("input").element.disabled).toBe(true);
  });
});

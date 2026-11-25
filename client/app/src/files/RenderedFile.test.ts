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
});

describe("draft previews", () => {
  it("renders the requested draft even when the reply carries the disk version", async () => {
    vi.useFakeTimers();
    const wrapper = render('<h1 data-source-offset="0">One</h1>');
    await wrapper.setProps({ text: "🦀\n\nDraft" });
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
    expect(wrapper.get("p").text()).toBe("Draft");
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
    await wrapper.setProps({ text: "Old draft" });
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

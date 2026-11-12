import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile(
  new URL("../app/src-tauri/tests/support/read-menu-trace.js", import.meta.url),
  "utf8",
);

function fixture() {
  const listeners = new Map();
  let time = 0;
  let expanded = "false";
  let visible = false;
  let focused = true;
  class Element {
    constructor(tag, role = null, inside = false) {
      this.tagName = tag;
      this.role = role;
      this.inside = inside;
    }
    getAttribute(name) {
      assert.equal(name, "role");
      return this.role;
    }
    get textContent() {
      throw new Error("Content must not be inspected");
    }
    get innerHTML() {
      throw new Error("HTML must not be inspected");
    }
  }
  const menu = { contains: (target) => target.inside };
  const window = {
    addEventListener(type, listener, capture) {
      assert.equal(capture, true);
      assert.ok(!listeners.has(type));
      listeners.set(type, listener);
    },
    removeEventListener(type, listener, capture) {
      assert.equal(capture, true);
      assert.equal(listeners.get(type), listener);
      listeners.delete(type);
    },
    get __TAURI_INTERNALS__() {
      throw new Error("Event recording must not invoke IPC");
    },
  };
  const document = {
    querySelector(selector) {
      if (selector === ".file-action-menu") return visible ? menu : null;
      assert.equal(selector, 'button[aria-label="File actions"]');
      return {
        getAttribute(name) {
          assert.equal(name, "aria-expanded");
          return expanded;
        },
      };
    },
    hasFocus: () => focused,
  };
  runInNewContext(source, {
    window,
    document,
    Element,
    performance: { now: () => time },
    console: {
      log() {
        throw new Error("Recording must remain passive");
      },
    },
  });
  return {
    window,
    document,
    Element,
    listeners,
    transition(value) {
      expanded = value.expanded;
      visible = value.visible;
      focused = value.focused;
    },
    emit(type, target, relatedTarget = null) {
      time++;
      listeners.get(type)?.({ type, target, relatedTarget });
    },
    run: window.withSmokeReadMenuTrace,
  };
}
const plain = (value) => JSON.parse(JSON.stringify(value));

test("Read-menu recording distinguishes window blur, focus transfers, resize and outside scroll without content", async () => {
  const f = fixture();
  const source = new f.Element("TEXTAREA");
  const item = new f.Element("BUTTON", "menuitemradio", true);
  const outside = new f.Element("DIV", "region");
  const value = await f.run((snapshot) => {
    assert.equal(f.listeners.size, 7);
    f.emit("blur", source);
    f.transition({ expanded: "true", visible: true, focused: true });
    f.emit("focusout", item, source);
    f.emit("focusin", item, source);
    f.emit("scroll", outside);
    f.emit("resize", f.window);
    f.transition({ expanded: "false", visible: false, focused: false });
    f.emit("blur", f.window);
    f.emit("scroll", f.document);
    return plain(snapshot());
  });
  assert.equal(f.listeners.size, 0);
  assert.deepEqual(value.events[0], {
    elapsedMs: 1,
    type: "blur",
    target: { kind: "element", tag: "TEXTAREA", role: null, insideMenu: false },
    relatedTarget: { kind: "none", insideMenu: false },
    expanded: "false",
    menuExists: false,
    focused: true,
  });
  assert.deepEqual(value.events[1].target, {
    kind: "element",
    tag: "BUTTON",
    role: "menuitemradio",
    insideMenu: true,
  });
  assert.deepEqual(value.events[1].relatedTarget, {
    kind: "element",
    tag: "TEXTAREA",
    role: null,
    insideMenu: false,
  });
  assert.equal(value.events[1].expanded, "true");
  assert.equal(value.events[1].menuExists, true);
  assert.equal(value.events[3].target.insideMenu, false);
  assert.equal(value.events[3].target.role, "region");
  assert.equal(value.events[4].target.kind, "window");
  assert.equal(value.events[5].target.kind, "window");
  assert.equal(value.events[5].focused, false);
  assert.equal(value.events[6].target.kind, "document");
  assert.deepEqual(
    { ...value, events: [] },
    {
      events: [],
      expanded: "false",
      menuExists: false,
      focused: false,
    },
  );
});

test("Read-menu recording retains only the latest 32 events and snapshots do not grow", async () => {
  const f = fixture();
  await f.run((snapshot) => {
    for (let i = 0; i < 40; i++) f.emit("resize", f.window);
    const captured = snapshot();
    assert.equal(captured.events.length, 32);
    assert.equal(captured.events[0].elapsedMs, 9);
    assert.equal(captured.events[31].elapsedMs, 40);
    f.emit("resize", f.window);
    assert.equal(captured.events[31].elapsedMs, 40);
    assert.equal(snapshot().events[31].elapsedMs, 41);
  });
  assert.equal(f.listeners.size, 0);
});

test("Read-menu listeners are removed on synchronous failure and asynchronous rejection", async () => {
  const f = fixture();
  const failure = new Error("Read action unavailable");
  for (const run of [
    () => {
      throw failure;
    },
    async () => {
      throw failure;
    },
  ]) {
    await assert.rejects(f.run(run), (error) => error === failure);
    assert.equal(f.listeners.size, 0);
  }
  const marker = {};
  assert.equal(await f.run(() => marker), marker);
  assert.equal(f.listeners.size, 0);
});

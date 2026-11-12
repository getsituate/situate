"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Bend = require("./bend.js");
const source = fs.readFileSync(path.join(__dirname, "performance.js"), "utf8");

// A small attribute/tree fixture keeps lifecycle tests independent of browser packages.
class Element {
  constructor(name, attributes = {}) {
    this.localName = name;
    this.namespaceURI = "http://www.w3.org/2000/svg";
    this.attributes = new Map(Object.entries(attributes));
    this.children = [];
    this.parentNode = null;
    this.style = {};
    Object.defineProperty(this.style, "transform", {
      set: (value) => {
        this.setAttribute(
          "style",
          this.getAttribute("style") + ";transform:" + value,
        );
      },
    });
  }
  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  appendChild(child) {
    child.remove();
    this.children.push(child);
    child.parentNode = this;
    return child;
  }
  remove() {
    if (this.parentNode)
      this.parentNode.children.splice(
        this.parentNode.children.indexOf(this),
        1,
      );
    this.parentNode = null;
  }
  cloneNode() {
    return new Element(this.localName, Object.fromEntries(this.attributes));
  }
  querySelectorAll(selector) {
    const hook = selector.match(/^\[data-bend-part="([^"]+)"\]$/);
    return this.children.flatMap((child) => [
      ...((
        hook
          ? child.getAttribute("data-bend-part") === hook[1]
          : child.localName === selector
      )
        ? [child]
        : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  get outerHTML() {
    return `<${this.localName} ${[...this.attributes].map(([k, v]) => `${k}="${v}"`).join(" ")}>${this.children.map((child) => child.outerHTML).join("")}</${this.localName}>`;
  }
}
function fixture(options = {}) {
  const container = new Element("div"),
    stack = [container];
  for (const token of Bend.render({
    idPrefix: "test",
    pose: "rest",
    expression: "welcome",
    ...options,
  }).match(/<[^>]+>/g)) {
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }
    const element = new Element(
      token.match(/^<([\w]+)/)[1],
      Object.fromEntries(
        [...token.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [
          match[1],
          match[2],
        ]),
      ),
    );
    stack.at(-1).appendChild(element);
    if (!token.endsWith("/>")) stack.push(element);
  }
  return container.children[0];
}
function api() {
  const context = vm.createContext({ window: {} });
  vm.runInContext(source, context);
  return context.window.SituateBendPerformance;
}
const hook = (svg, name) => svg.querySelector(`[data-bend-part="${name}"]`);

test("classic script exposes only a frozen create API and needs no clock or renderer global", () => {
  const performance = api();
  assert.deepEqual(Object.keys(performance), ["create"]);
  assert.ok(Object.isFrozen(performance));
  assert.doesNotMatch(
    source,
    /requestAnimationFrame|setTimeout|setInterval|IntersectionObserver|MutationObserver|\.animate\(|addEventListener/,
  );
  for (const d of Object.values(Bend.geometry))
    assert.ok(
      !source.includes(d),
      "Body paths must come from the supplied SVG",
    );
  const rig = performance.create(fixture());
  assert.deepEqual(Object.keys(rig), ["set", "reset", "destroy"]);
  assert.ok(Object.isFrozen(rig));
});

test("creation validates the pose, expression, hooks and arm geometry", () => {
  const performance = api();
  for (const invalid of [
    null,
    {},
    new Element("div"),
    fixture({ pose: "wave" }),
    fixture({ expression: "pleased" }),
  ]) {
    assert.throws(() => performance.create(invalid), /rest\/welcome/);
  }
  const svg = fixture();
  hook(svg, "front").remove();
  assert.throws(() => performance.create(svg), /Incomplete/);
  const arm = fixture();
  hook(arm, "left-arm")
    .querySelector("path")
    .setAttribute("d", "M1 2A3 4 5 0 0 6 7");
  assert.throws(() => performance.create(arm), /Unsupported/);
});

test("full-state updates are deterministic and zero/reset/destroy restore original nodes and attributes", () => {
  const svg = fixture(),
    baseline = svg.outerHTML,
    face = hook(svg, "face"),
    eyes = face.children[1];
  const rig = api().create(svg);
  assert.equal(svg.outerHTML, baseline);
  const state = {
    stride: 0.8,
    phase: 4.7,
    wave: 0.9,
    wavePhase: 2,
    present: 0.2,
    mouth: 0.8,
    wink: 0.7,
    gazeX: 1,
    gazeY: -1,
    lean: 4,
    bob: -3,
  };
  rig.set(state);
  const posed = svg.outerHTML;
  assert.notEqual(posed, baseline);
  rig.set({ blink: 1 });
  rig.set(state);
  assert.equal(svg.outerHTML, posed);
  rig.set({});
  assert.equal(svg.outerHTML, baseline);
  rig.set({ phase: 9, wavePhase: 8 });
  assert.equal(svg.outerHTML, baseline);
  rig.set(state);
  rig.reset();
  assert.equal(svg.outerHTML, baseline);
  assert.equal(face.children[1], eyes);
  rig.set(state);
  rig.destroy();
  rig.destroy();
  assert.equal(svg.outerHTML, baseline);
  assert.throws(() => rig.set({}), /destroyed/);
  assert.throws(() => rig.reset(), /destroyed/);
});

test("a replacement restores the baseline before taking ownership and invalidates the old rig", () => {
  const svg = fixture(),
    baseline = svg.outerHTML,
    performance = api();
  const first = performance.create(svg);
  first.set({ stride: 1, phase: 3, mouth: 1 });
  const second = performance.create(svg);
  assert.equal(svg.outerHTML, baseline);
  assert.throws(() => first.set({}), /destroyed/);
  second.set({ wave: 1 });
  const posed = svg.outerHTML;
  first.destroy();
  assert.equal(svg.outerHTML, posed);
  second.destroy();
  assert.equal(svg.outerHTML, baseline);
});

test("invalid input is rejected atomically; finite ranges clamp while phases remain periodic", () => {
  const svg = fixture(),
    rig = api().create(svg);
  rig.set({ wave: 0.5 });
  const posed = svg.outerHTML;
  for (const invalid of [
    undefined,
    null,
    [],
    0,
    "wave",
    { wave: NaN },
    { phase: Infinity },
    { bob: -Infinity },
    { wave: "1" },
    { wave: undefined },
    { wave: 1, unknown: 2 },
    { [Symbol("wave")]: 1 },
  ]) {
    assert.throws(() => rig.set(invalid));
    assert.equal(svg.outerHTML, posed);
  }
  rig.set({ wave: 99, stride: -8, gazeX: -5, gazeY: 2, lean: -90, bob: 99 });
  const clamped = svg.outerHTML;
  rig.set({ wave: 1, stride: 0, gazeX: -1, gazeY: 1, lean: -6, bob: 8 });
  assert.equal(svg.outerHTML, clamped);
  rig.set({ stride: 1, phase: 1, wave: 1, wavePhase: 2 });
  const cycle = svg.outerHTML;
  rig.set({
    stride: 1,
    phase: 1 + Math.PI * 2,
    wave: 1,
    wavePhase: 2 + Math.PI * 2,
  });
  assert.equal(svg.outerHTML, cycle);
  rig.set({
    phase: Number.MAX_VALUE,
    wavePhase: -Number.MAX_VALUE,
    stride: 1,
    wave: 1,
  });
  assert.doesNotMatch(svg.outerHTML, /NaN|Infinity/);
});

test("body, eye, mouth and arm channels respond independently", () => {
  const svg = fixture(),
    rig = api().create(svg);
  const front = hook(svg, "front"),
    face = hook(svg, "face"),
    arm = hook(svg, "right-arm").querySelector("path");
  const base = {
    body: front.getAttribute("d"),
    eyes: face.children[1].getAttribute("d"),
    mouth: face.children[2].getAttribute("d"),
    arm: arm.getAttribute("d"),
  };
  rig.set({ mouth: 1 });
  assert.notEqual(face.children[2].getAttribute("d"), base.mouth);
  assert.equal(front.getAttribute("d"), base.body);
  rig.set({ blink: 1 });
  assert.notEqual(face.children[1].getAttribute("d"), base.eyes);
  assert.equal(face.children[2].getAttribute("d"), base.mouth);
  rig.set({ wave: 1 });
  const raised = arm.getAttribute("d");
  assert.notEqual(raised, base.arm);
  rig.set({ wave: 1, wavePhase: 1 });
  assert.notEqual(arm.getAttribute("d"), raised);
  rig.set({ stride: 1, phase: 5 });
  assert.notEqual(front.getAttribute("d"), base.body);
  assert.equal(face.children[1].getAttribute("d"), base.eyes);
  rig.set({ present: 1 });
  assert.notEqual(arm.getAttribute("d"), raised);
  assert.notEqual(arm.getAttribute("d"), base.arm);
});

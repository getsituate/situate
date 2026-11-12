import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  callbackPage,
  callbackText,
} from "../app/tests/browser/auth-callback-fixture.mjs";

function fixture({ reduced = false, accepted = true } = {}) {
  const { body } = callbackPage({ accepted });
  const dom = new JSDOM(body, {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const { window } = dom;
  let now = 0;
  let id = 0;
  let change;
  let intersect;
  let resize;
  const frames = new Map();
  const preference = {
    matches: reduced,
    addEventListener: (_name, cb) => {
      change = cb;
    },
    removeEventListener() {},
  };
  window.matchMedia = () => preference;
  window.requestAnimationFrame = (cb) => {
    frames.set(++id, cb);
    return id;
  };
  window.cancelAnimationFrame = (key) => frames.delete(key);
  let disconnected = 0;
  window.ResizeObserver = class {
    constructor(cb) {
      resize = cb;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  window.IntersectionObserver = class {
    constructor(cb) {
      intersect = cb;
    }
    observe() {}
    disconnect() {
      disconnected++;
    }
  };
  window.eval(window.document.querySelector("script").textContent);
  const viewport = (width, height) =>
    resize?.([{ contentRect: { width, height } }]);
  viewport(1280, 800);
  const advance = (ms) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((cb) => cb(now));
  };
  const motion = (value) => {
    preference.matches = value;
    change?.();
  };
  const surface = window.document.querySelector(".callback-surface");
  const dispose = () => {
    window.dispatchEvent(
      new window.PageTransitionEvent("pagehide", { persisted: false }),
    );
    window.close();
  };
  return {
    dom,
    window,
    surface,
    frames,
    advance,
    viewport,
    motion,
    dispose,
    visible: (isIntersecting) => intersect?.([{ isIntersecting }]),
    disconnected: () => disconnected,
  };
}

test("callback documents resolve both outcomes and locales without request data or external assets", () => {
  for (const language of ["en", "de"])
    for (const accepted of [true, false]) {
      const { status, body, headers } = callbackPage({ language, accepted });
      assert.equal(status, accepted ? 200 : 400);
      assert.equal(Number(headers["Content-Length"]), Buffer.byteLength(body));
      assert.equal(headers["Cache-Control"], "no-store");
      assert.equal(headers["Referrer-Policy"], "no-referrer");
      assert.match(body, new RegExp(`<html lang="${language}">`));
      assert.ok(body.includes(callbackText(language, "accepted.body")));
      assert.ok(!body.includes("{{"));
      assert.ok(!/\b(?:src|href)="https?:/i.test(body));
      assert.ok(!body.includes(' style="'));
      assert.ok(body.length < 100_000);
    }
});

test("native callback animation is finite, deterministic and leaves all text independent of playback", () => {
  const f = fixture();
  try {
    const copy = f.window.document.querySelector(".callback-copy").textContent;
    f.visible(true);
    f.advance(0);
    f.advance(1500);
    assert.equal(f.surface.dataset.animationTime, "1500");
    assert.ok(
      f.window.document.querySelectorAll(".celebration-piece").length > 144,
    );
    assert.equal(
      f.window.document.querySelector(".callback-copy").textContent,
      copy,
    );
    f.viewport(390, 844);
    assert.equal(f.surface.dataset.animationTime, "1500");
    assert.ok(
      f.window.document.querySelectorAll(".celebration-piece").length <= 92,
    );
    f.advance(2900);
    assert.equal(f.surface.dataset.animation, "settled");
    assert.equal(f.surface.dataset.animationTime, "4400");
    assert.equal(
      f.window.document.querySelectorAll(".celebration-piece").length,
      0,
    );
    assert.equal(f.frames.size, 0);
    f.visible(false);
    f.visible(true);
    f.advance(90000);
    assert.equal(f.frames.size, 0);
  } finally {
    f.dispose();
  }
  assert.equal(f.disconnected(), 2);
});

test("sub-millisecond frame-clock differences produce the same particle geometry", () => {
  const drawings = [];
  for (const jitter of [0, 1e-8, -1e-8]) {
    const f = fixture();
    try {
      f.advance(0);
      f.advance(1500 + jitter);
      drawings.push(
        f.window.document.querySelector(".callback-celebration").innerHTML,
      );
    } finally {
      f.dispose();
    }
  }
  assert.equal(drawings[0], drawings[1]);
  assert.equal(drawings[0], drawings[2]);
});

test("visibility and back-forward cache suspension do not advance unseen animation time", () => {
  const f = fixture();
  try {
    f.advance(0);
    f.advance(450);
    f.visible(false);
    f.advance(90000);
    f.visible(true);
    f.advance(0);
    assert.equal(f.surface.dataset.animationTime, "450");
    Object.defineProperty(f.window.document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    f.window.document.dispatchEvent(new f.window.Event("visibilitychange"));
    assert.equal(f.frames.size, 0);
    f.advance(90000);
    Object.defineProperty(f.window.document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    f.window.document.dispatchEvent(new f.window.Event("visibilitychange"));
    f.advance(0);
    assert.equal(f.surface.dataset.animationTime, "450");
    f.window.dispatchEvent(
      new f.window.PageTransitionEvent("pagehide", { persisted: true }),
    );
    assert.equal(f.frames.size, 0);
    f.advance(90000);
    f.window.dispatchEvent(
      new f.window.PageTransitionEvent("pageshow", { persisted: true }),
    );
    f.advance(0);
    assert.equal(f.surface.dataset.animationTime, "450");
    f.advance(100);
    assert.equal(f.surface.dataset.animationTime, "550");
  } finally {
    f.dispose();
  }
});

test("reduced motion, including a live change, removes all particles and does not replay", () => {
  for (const reduced of [true, false]) {
    const f = fixture({ reduced });
    try {
      if (!reduced) {
        f.advance(0);
        f.advance(900);
      }
      f.motion(true);
      assert.equal(f.surface.dataset.animation, "settled");
      assert.equal(f.surface.dataset.animationTime, "4400");
      assert.equal(f.frames.size, 0);
      assert.equal(
        f.window.document.querySelectorAll(".celebration-piece").length,
        0,
      );
      f.motion(false);
      assert.equal(f.frames.size, 0);
    } finally {
      f.dispose();
    }
  }
});

test("rejected responses never start decoration", () => {
  const f = fixture({ accepted: false });
  try {
    assert.equal(f.frames.size, 0);
    assert.equal(f.surface.dataset.animationTime, undefined);
    assert.equal(
      f.window.document.querySelectorAll(".celebration-piece").length,
      0,
    );
  } finally {
    f.dispose();
  }
});

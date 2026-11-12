"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const timeline = require("./timeline.js");

test("the introduction is a finite, deterministic ten-second score", () => {
  assert.equal(timeline.duration, 10000);
  assert.deepEqual(timeline.sample(-1), timeline.sample(0));
  assert.deepEqual(timeline.sample(20000), timeline.sample(10000));
  for (let time = 0; time <= 10000; time += 16) {
    const frame = timeline.sample(time);
    assert.deepEqual(frame, timeline.sample(time));
    for (const value of Object.values(frame.actor))
      assert.ok(Number.isFinite(value));
    for (const key of [
      "hello",
      "together",
      "ending",
      "world",
      "ribbons",
      "actorOpacity",
    ])
      assert.ok(frame[key] >= 0 && frame[key] <= 1);
    frame.objects.forEach((value) => assert.ok(value >= 0 && value <= 1));
  }
  for (const value of [NaN, Infinity, "100", null])
    assert.throws(() => timeline.sample(value), TypeError);
});

test("the score has a rigid rocking arrival, greeting, wink, presentation and a still ending", () => {
  assert.ok(timeline.sample(400).actor.lean > 3);
  assert.ok(timeline.sample(990).actor.lean < -3);
  assert.equal(timeline.sample(2300).actor.wave, 1);
  assert.ok(timeline.sample(2160).actor.mouth > 0.7);
  assert.equal(timeline.sample(3420).actor.wink, 1);
  assert.equal(timeline.sample(3420).actor.blink, 0);
  assert.equal(timeline.sample(5300).actor.present, 1);
  const end = timeline.sample(10000);
  assert.equal(end.ending, 1);
  assert.equal(end.hello, 0);
  assert.equal(end.together, 0);
  assert.deepEqual(end.objects, [1, 1, 1]);
  for (const key of ["stride", "wave", "blink", "wink", "mouth", "bob"])
    assert.equal(Math.abs(end.actor[key]), 0);
  const settled = timeline.sample(9200);
  delete settled.time;
  delete end.time;
  assert.deepEqual(settled, end);
});

test("arrival and isolated rocking preserve the arch and settle without an idle cycle", () => {
  for (let time = 0; time <= 10000; time += 10) {
    const frame = timeline.sample(time);
    assert.equal(frame.actor.stride, 0);
    assert.equal(frame.actor.phase, 0);
    assert.equal(frame.shadow, 1);
    assert.ok(Math.abs(frame.actor.lean) <= 6);
    assert.ok(Math.abs(frame.actor.bob) <= 8);
  }
  const duration = timeline.durations.walk;
  const first = timeline.gesture("walk", duration / 6);
  const second = timeline.gesture("walk", duration / 2);
  const last = timeline.gesture("walk", (duration * 5) / 6);
  assert.ok(first.lean > 0 && second.lean < 0 && last.lean > 0);
  assert.ok(
    Math.abs(first.lean) > Math.abs(second.lean) &&
      Math.abs(second.lean) > Math.abs(last.lean),
  );
  for (let time = 0; time <= duration; time += 10) {
    const state = timeline.gesture("walk", time);
    assert.deepEqual(Object.keys(state).sort(), ["bob", "lean"]);
    assert.ok(state.bob <= 0 && state.bob >= -4.4);
  }
  assert.deepEqual(
    timeline.gesture("walk", duration),
    timeline.gesture("walk", duration + 10000),
  );
});

test("isolated performances begin and finish in a neutral pose", () => {
  for (const [name, duration] of Object.entries(timeline.durations)) {
    for (const time of [0, duration, duration + 1]) {
      const state = timeline.gesture(name, time);
      for (const [key, value] of Object.entries(state)) {
        assert.ok(Number.isFinite(value));
        if (!["phase", "wavePhase"].includes(key))
          assert.equal(Math.abs(value), 0, `${name}/${key}`);
      }
    }
    assert.notDeepEqual(
      timeline.gesture(name, duration * 0.5),
      timeline.gesture(name, 0),
    );
  }
  assert.throws(() => timeline.gesture("unknown", 0), RangeError);
  assert.throws(() => timeline.gesture("wink", Infinity), TypeError);
});

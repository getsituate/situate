import assert from "node:assert/strict";
import test from "node:test";
import { launchBaselineSamples } from "./qualification-launch-check.mjs";

test("baseline samples continue after a blocked sample and expose only fixed outcomes", async () => {
  const statuses = [
    "absent",
    "query_timeout",
    "private window title",
    "unexpected",
  ];
  const observations = [];
  const clear = await launchBaselineSamples({
    samples: statuses.length,
    query: async (mode) => {
      assert.equal(mode, "baseline");
      return statuses.shift();
    },
    output: (line) => observations.push(JSON.parse(line)),
  });
  assert.equal(clear, false);
  assert.deepEqual(
    observations.map(({ sample, status }) => [sample, status]),
    [
      [1, "confirmation_baseline_clear"],
      [2, "confirmation_baseline_timeout"],
      [3, "confirmation_baseline_query_failed"],
      [4, "confirmation_baseline_dialog_present"],
    ],
  );
  assert.ok(
    observations.every(
      ({ elapsedMs }) => Number.isInteger(elapsedMs) && elapsedMs >= 0,
    ),
  );
  assert.doesNotMatch(JSON.stringify(observations), /private window title/);
});

test("all samples must be clear and counts outside the bound do not query", async () => {
  assert.equal(
    await launchBaselineSamples({
      samples: 2,
      query: async () => "absent",
      output: () => {},
    }),
    true,
  );
  for (const samples of [0, 21, 1.5])
    await assert.rejects(
      launchBaselineSamples({
        samples,
        query: () => assert.fail("Unexpected sample"),
      }),
    );
});

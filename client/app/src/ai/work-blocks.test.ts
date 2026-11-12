import { expect, test } from "vitest";
import { workBlocks } from "./work-blocks";

test("reads only recorded work blocks, without deriving time from timestamps", () => {
  expect(
    workBlocks([
      {
        id: "legacy",
        runId: "r",
        sequence: 1,
        type: "message_end",
        data: { durationMs: 50 },
      },
      {
        id: "block",
        runId: "r",
        sequence: 2,
        type: "work_block_end",
        data: { messageCount: 3, durationMs: 84000, outcome: "complete" },
      },
    ]),
  ).toEqual([
    { id: "block", messageCount: 3, durationMs: 84000, outcome: "complete" },
  ]);
});

test("retains explicit start boundaries and distinct periods at the same end boundary", () => {
  expect(
    workBlocks(
      [0, 1].map((index) => ({
        id: `period-${index}`,
        runId: "one-run",
        sequence: index + 1,
        type: "work_block_end",
        data: {
          startMessageCount: index,
          messageCount: 1,
          durationMs: 250,
          outcome: "complete",
        },
      })),
    ),
  ).toEqual([
    {
      id: "period-0",
      startMessageCount: 0,
      messageCount: 1,
      durationMs: 250,
      outcome: "complete",
    },
    {
      id: "period-1",
      startMessageCount: 1,
      messageCount: 1,
      durationMs: 250,
      outcome: "complete",
    },
  ]);
});

test.each([undefined, null, -1, 1.5, 3, "1"])(
  "preserves an end-only duration when the optional start is unusable (%j)",
  (startMessageCount) => {
    expect(
      workBlocks([
        {
          id: "old",
          runId: "r",
          sequence: 1,
          type: "work_block_end",
          data: {
            startMessageCount,
            messageCount: 2,
            durationMs: 100,
            outcome: "cancelled",
          },
        },
      ]),
    ).toEqual([
      { id: "old", messageCount: 2, durationMs: 100, outcome: "cancelled" },
    ]);
  },
);

test("restores an unmatched start with its identity and no inferred duration", () => {
  const events = [
    {
      id: "start-event",
      runId: "run",
      sequence: 1,
      type: "work_block_start",
      data: { workId: "period", startMessageCount: 2 },
    },
  ];
  expect(workBlocks(events, 4)).toEqual([
    {
      id: "period",
      startMessageCount: 2,
      messageCount: 4,
      outcome: "interrupted",
    },
  ]);
  expect(workBlocks(events)).toEqual([]);
  expect(workBlocks(events, 1)).toEqual([]);
});

test("an interrupted period does not absorb a later recorded work period", () => {
  expect(
    workBlocks(
      [
        {
          id: "lost-start",
          runId: "r",
          sequence: 1,
          type: "work_block_start",
          data: { workId: "lost", startMessageCount: 1 },
        },
        {
          id: "next-start",
          runId: "next",
          sequence: 1,
          type: "work_block_start",
          data: { workId: "next", startMessageCount: 3 },
        },
        {
          id: "next-end",
          runId: "next",
          sequence: 2,
          type: "work_block_end",
          data: {
            workId: "next",
            startMessageCount: 3,
            messageCount: 5,
            durationMs: 100,
            outcome: "complete",
          },
        },
      ],
      5,
    ),
  ).toEqual([
    {
      id: "lost",
      startMessageCount: 1,
      messageCount: 3,
      outcome: "interrupted",
    },
    {
      id: "next",
      startMessageCount: 3,
      messageCount: 5,
      durationMs: 100,
      outcome: "complete",
    },
  ]);
});

test("pairs starts and ends by run and work identity in start order, including empty ranges", () => {
  expect(
    workBlocks(
      [
        {
          id: "start-one",
          runId: "r",
          sequence: 1,
          type: "work_block_start",
          data: { workId: "one", startMessageCount: 2 },
        },
        {
          id: "end-one",
          runId: "r",
          sequence: 2,
          type: "work_block_end",
          data: {
            workId: "one",
            startMessageCount: 2,
            messageCount: 2,
            durationMs: 100,
            outcome: "complete",
          },
        },
        {
          id: "start-two",
          runId: "r",
          sequence: 3,
          type: "work_block_start",
          data: { workId: "two", startMessageCount: 2 },
        },
        {
          id: "end-two",
          runId: "r",
          sequence: 4,
          type: "work_block_end",
          data: {
            workId: "two",
            startMessageCount: 2,
            messageCount: 2,
            durationMs: 200,
            outcome: "complete",
          },
        },
        {
          id: "other-run",
          runId: "other",
          sequence: 1,
          type: "work_block_start",
          data: { workId: "one", startMessageCount: 2 },
        },
      ],
      2,
    ),
  ).toEqual([
    {
      id: "one",
      startMessageCount: 2,
      messageCount: 2,
      durationMs: 100,
      outcome: "complete",
    },
    {
      id: "two",
      startMessageCount: 2,
      messageCount: 2,
      durationMs: 200,
      outcome: "complete",
    },
    {
      id: "one",
      startMessageCount: 2,
      messageCount: 2,
      outcome: "interrupted",
    },
  ]);
});

test.each([
  null,
  {},
  { workId: "w", startMessageCount: -1 },
  { workId: "w", startMessageCount: 1.5 },
  { startMessageCount: 1 },
])("ignores malformed starts (%j)", (data) => {
  expect(
    workBlocks(
      [
        {
          id: "bad-start",
          runId: "r",
          sequence: 1,
          type: "work_block_start",
          data,
        },
      ],
      3,
    ),
  ).toEqual([]);
});

test.each([
  null,
  { messageCount: 1, durationMs: -1, outcome: "complete" },
  { messageCount: 1, durationMs: Infinity, outcome: "complete" },
  { messageCount: 1, durationMs: "12", outcome: "complete" },
  { messageCount: -1, durationMs: 12, outcome: "complete" },
  { messageCount: 1.5, durationMs: 12, outcome: "complete" },
  { messageCount: 1, durationMs: 12, outcome: "unknown" },
])("ignores invalid work duration data %j", (data) => {
  expect(
    workBlocks([
      { id: "bad", runId: "r", sequence: 1, type: "work_block_end", data },
    ]),
  ).toEqual([]);
});

import { expect, test } from "vitest";
import { recallInput, type PendingInput } from "./queue-runtime";
test("recall orders steering before follow-up, preserves draft and attachment identities, and excludes consumed input", () => {
  const attachment = {
    id: "image",
    mimeType: "image/png",
    name: "picture.png",
    size: 12,
  };
  const item = (
    id: string,
    kind: PendingInput["kind"],
    state: PendingInput["state"] = "pending",
  ): PendingInput => ({
    id,
    kind,
    state,
    text: id,
    attachments: [attachment],
    timestamp: 1,
  });
  expect(
    recallInput(
      [
        item("later", "followUp"),
        item("delivered", "steering", "consumed"),
        item("guide", "steering"),
        item("more", "steering"),
      ],
      "draft",
      [attachment],
    ),
  ).toEqual({
    draft: "guide\n\nmore\n\nlater\n\ndraft",
    attachments: [attachment],
    references: [],
    pending: [item("delivered", "steering", "consumed")],
  });
  expect(recallInput([], "draft", [attachment])).toEqual({
    draft: "draft",
    attachments: [attachment],
    references: [],
    pending: [],
  });
});

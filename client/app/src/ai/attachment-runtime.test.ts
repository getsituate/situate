import { beforeEach, expect, test, vi } from "vitest";
import {
  attachmentMessage,
  hydrateImages,
  retainImages,
} from "./attachment-runtime";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
beforeEach(() => invoke.mockReset());
test("durable image references contain no binary and hydrate only for the provider", async () => {
  const reference = {
    id: "image-1",
    name: "image.png",
    size: 3,
    mimeType: "image/png",
  };
  invoke
    .mockResolvedValueOnce(reference)
    .mockResolvedValueOnce({ reference, bytes: [97, 98, 99] });
  const retained = await retainImages("scope", [
    {
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: "YWJj" }],
      timestamp: 1,
    },
  ]);
  expect(JSON.stringify(retained)).toContain("attachment:image-1");
  expect(JSON.stringify(retained)).not.toContain("YWJj");
  expect(await hydrateImages("scope", retained)).toEqual([
    {
      role: "user",
      content: [{ type: "image", mimeType: "image/png", data: "YWJj" }],
      timestamp: 1,
    },
  ]);
  expect(invoke).toHaveBeenLastCalledWith("ai_attachment_read", {
    scope: "scope",
    id: "image-1",
  });
});
test("text-only models reject images before accepting queued input", async () => {
  const input = {
    id: "pending",
    kind: "steering" as const,
    state: "pending" as const,
    text: "Keep",
    timestamp: 1,
    attachments: [
      { id: "image", name: "image.png", size: 3, mimeType: "image/png" },
    ],
  };
  await expect(attachmentMessage("scope", input, false)).rejects.toThrow(
    "chat.attachmentModelUnsupported",
  );
  expect(input.state).toBe("pending");
  expect(input.attachments).toHaveLength(1);
  expect(invoke).not.toHaveBeenCalled();
});
test("stored text attachments reach ordinary chat with their names and Unicode content", async () => {
  const reference = {
    id: "source",
    name: "tasks.json",
    size: 17,
    mimeType: "text/plain",
  };
  invoke.mockResolvedValueOnce({
    reference,
    bytes: [...new TextEncoder().encode('{"task":"Café"}\r\n')],
  });
  const message = await attachmentMessage(
    "scope",
    {
      id: "input",
      kind: "steering",
      state: "pending",
      text: "Import these tasks",
      timestamp: 1,
      attachments: [reference],
    },
    false,
  );
  expect(message.content).toEqual([
    { type: "text", text: "Import these tasks" },
    { type: "text", text: 'tasks.json\n{"task":"Café"}\r\n' },
  ]);
});
test("invalid UTF-8 in retained attachments cannot silently become replacement characters", async () => {
  const reference = {
    id: "source",
    name: "notes.md",
    size: 1,
    mimeType: "text/plain",
  };
  invoke.mockResolvedValueOnce({ reference, bytes: [0xc3] });
  await expect(
    attachmentMessage(
      "scope",
      {
        id: "input",
        kind: "steering",
        state: "pending",
        text: "",
        timestamp: 1,
        attachments: [reference],
      },
      false,
    ),
  ).rejects.toThrow("chat.attachmentEncoding");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("ai_attachment_read", {
    scope: "scope",
    id: "source",
  });
});

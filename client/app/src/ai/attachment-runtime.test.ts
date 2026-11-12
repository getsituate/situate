import { beforeEach, expect, test, vi } from "vitest";
import {
  attachmentMessage,
  hydrateImages,
  retainImages,
  importAttachment,
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
function sourceFile(name: string, type: string, bytes: Uint8Array): File {
  const file = new File([new Uint8Array(bytes).buffer], name, { type });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => bytes.slice().buffer,
  });
  return file;
}
test.each([
  ["notes.md", "text/markdown"],
  ["notes.markdown", "text/markdown"],
  ["export.json", "application/json"],
  ["notes.MD", ""],
  ["notes.markdown", "application/octet-stream"],
  ["export.json", ""],
  ["notes.txt", "text/plain"],
])(
  "passes %s bytes and name unchanged using native plain-text storage (%s)",
  async (name, type) => {
    const bytes = new TextEncoder().encode(
      name.endsWith(".json")
        ? '\ufeff{"task":"Café"}\r\n'
        : "\ufeff# Café\r\n- [ ] Read\r\n",
    );
    const file = sourceFile(name, type, bytes);
    const reference = {
      id: "source",
      name,
      size: bytes.length,
      mimeType: "text/plain",
    };
    invoke.mockResolvedValueOnce(reference);
    await expect(importAttachment("scope", file)).resolves.toEqual(reference);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("ai_attachment_put", {
      scope: "scope",
      mimeType: "text/plain",
      name,
      bytes: [...bytes],
    });
    expect([...new Uint8Array(await file.arrayBuffer())]).toEqual([...bytes]);
  },
);
test.each([
  ["notes.md", "text/markdown"],
  ["tasks.json", "application/json"],
  ["notes.txt", "text/plain"],
])(
  "rejects invalid UTF-8 in %s without storing or changing the source",
  async (name, type) => {
    const bytes = new Uint8Array([0x61, 0xc3, 0x28]);
    const file = sourceFile(name, type, bytes);
    await expect(importAttachment("scope", file)).rejects.toThrow(
      "chat.attachmentEncoding",
    );
    expect(invoke).not.toHaveBeenCalled();
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(
      new Uint8Array([0x61, 0xc3, 0x28]),
    );
  },
);
test.each([
  ["archive.bin", "application/octet-stream"],
  ["document.pdf", "application/pdf"],
])("unsupported source %s never reaches storage", async (name, type) => {
  const file = sourceFile(name, type, new Uint8Array([0, 255]));
  await expect(importAttachment("scope", file)).rejects.toThrow(
    "chat.attachmentUnsupported",
  );
  expect(invoke).not.toHaveBeenCalled();
});
test("images retain their MIME and binary bytes without text decoding", async () => {
  const file = sourceFile(
    "image.png",
    "image/png",
    new Uint8Array([255, 0, 129]),
  );
  await importAttachment("scope", file);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("ai_attachment_put", {
    scope: "scope",
    name: "image.png",
    mimeType: "image/png",
    bytes: [255, 0, 129],
  });
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
test("unsupported and oversized files never cross the native boundary", async () => {
  await expect(
    importAttachment("scope", { type: "image/svg+xml", size: 30 } as File),
  ).rejects.toThrow("chat.attachmentUnsupported");
  await expect(
    importAttachment("scope", {
      type: "image/png",
      size: 8 * 1024 * 1024 + 1,
    } as File),
  ).rejects.toThrow("chat.attachmentTooLarge");
  expect(invoke).not.toHaveBeenCalled();
});

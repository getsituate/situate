import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { saveText } from "./save-text";

afterEach(() => clearMocks());

describe("saveText IPC boundary", () => {
  it.each(["  First line\nSecond line\t  ", "", " \n\t ", "Notes — 🌱"])(
    "invokes save_text with the exact string %j",
    async (text) => {
      const ipc = vi.fn(() => undefined);
      mockIPC(ipc);

      const result: Promise<void> = saveText(text);
      await expect(result).resolves.toBeUndefined();
      expect(ipc).toHaveBeenCalledExactlyOnceWith("save_text", { text });
    },
  );

  it("propagates a native failure", async () => {
    mockIPC(() => {
      throw new Error("Write failed");
    });
    await expect(saveText("Retain me")).rejects.toThrow("Write failed");
  });
});

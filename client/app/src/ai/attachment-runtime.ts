import { invoke } from "@tauri-apps/api/core";
import type { AgentMessage } from "./contracts";
import type { AttachmentRef, PendingInput } from "./queue-runtime";
const storedImages = new WeakMap<
  object,
  Promise<{ type: "image"; data: string; mimeType: string }>
>();
const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);
function isTextAttachment(file: File): boolean {
  return (
    ["text/plain", "text/markdown", "application/json"].includes(file.type) ||
    ((!file.type || file.type === "application/octet-stream") &&
      /\.(md|markdown|json)$/i.test(file.name))
  );
}
export function validateAttachment(file: File): void {
  if (!imageTypes.has(file.type) && !isTextAttachment(file))
    throw new Error("chat.attachmentUnsupported");
  if (file.size > 8 * 1024 * 1024) throw new Error("chat.attachmentTooLarge");
}
export async function importAttachment(
  scope: string,
  file: File,
): Promise<AttachmentRef> {
  validateAttachment(file);
  const text = isTextAttachment(file);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (text) decodeText(bytes);
  return invoke("ai_attachment_put", {
    scope,
    mimeType: text ? "text/plain" : file.type,
    name: file.name,
    bytes: [...bytes],
  });
}
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("chat.attachmentEncoding");
  }
}
export async function attachmentMessage(
  scope: string,
  input: PendingInput,
  images: boolean,
): Promise<AgentMessage> {
  const content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[] = [];
  if (input.text) content.push({ type: "text", text: input.text });
  for (const attachment of input.attachments) {
    if (imageTypes.has(attachment.mimeType)) {
      if (!images) throw new Error("chat.attachmentModelUnsupported");
      content.push({
        type: "image",
        data: `attachment:${attachment.id}`,
        mimeType: attachment.mimeType,
      });
    } else if (attachment.mimeType === "text/plain") {
      const result = await invoke<{
        reference: AttachmentRef;
        bytes: number[];
      }>("ai_attachment_read", { scope, id: attachment.id });
      content.push({
        type: "text",
        text: `${attachment.name}\n${decodeText(new Uint8Array(result.bytes))}`,
      });
    } else throw new Error("chat.attachmentUnsupported");
  }
  return {
    role: "user",
    content: input.attachments.length ? content : input.text,
    timestamp: input.timestamp,
  };
}
function base64(bytes: number[]): string {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.slice(i, i + 8192));
  return btoa(value);
}
export async function attachmentImageSource(
  scope: string,
  block: { data: string; mimeType: string },
): Promise<string> {
  if (!imageTypes.has(block.mimeType))
    throw new Error("chat.attachmentUnsupported");
  let data = block.data;
  if (data.startsWith("attachment:")) {
    const stored = await invoke<{ reference: AttachmentRef; bytes: number[] }>(
      "ai_attachment_read",
      { scope, id: data.slice(11) },
    );
    if (stored.reference.mimeType !== block.mimeType)
      throw new Error("chat.attachmentUnsupported");
    data = base64(stored.bytes);
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(data))
    throw new Error("chat.attachmentUnsupported");
  return `data:${block.mimeType};base64,${data}`;
}
export async function hydrateImages(
  scope: string,
  messages: AgentMessage[],
): Promise<AgentMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: await Promise.all(
          message.content.map(async (block) =>
            block.type === "image"
              ? {
                  ...block,
                  data: (await attachmentImageSource(scope, block)).split(
                    ",",
                  )[1]!,
                }
              : block,
          ),
        ),
      } as AgentMessage;
    }),
  );
}
export async function retainImages(
  scope: string,
  messages: AgentMessage[],
): Promise<AgentMessage[]> {
  return Promise.all(
    messages.map(async (message) => {
      if (!Array.isArray(message.content)) return message;
      return {
        ...message,
        content: await Promise.all(
          message.content.map(async (block) => {
            if (block.type !== "image" || block.data.startsWith("attachment:"))
              return block;
            if (!imageTypes.has(block.mimeType))
              throw new Error("chat.attachmentUnsupported");
            let stored = storedImages.get(block);
            if (!stored) {
              stored = invoke<AttachmentRef>("ai_attachment_put", {
                scope,
                name: "image",
                mimeType: block.mimeType,
                bytes: [...atob(block.data)].map((character) =>
                  character.charCodeAt(0),
                ),
              })
                .then((attachment) => ({
                  ...block,
                  data: `attachment:${attachment.id}`,
                }))
                .catch((error) => {
                  storedImages.delete(block);
                  throw error;
                });
              storedImages.set(block, stored);
            }
            return stored;
          }),
        ),
      } as AgentMessage;
    }),
  );
}

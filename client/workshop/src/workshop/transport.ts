import { isTauri } from "@tauri-apps/api/core";
import type { Command, Simulation } from "./simulation";

export type Role = "controls" | "preview";
export interface Viewport {
  width: number;
  height: number;
  scale: number;
  insetWidth?: number;
  insetHeight?: number;
}
export type Message =
  | {
      type: "state";
      state: Simulation;
      revision: number;
      host: string;
      acknowledged: number;
    }
  | {
      type: "command";
      command: Command;
      host: string;
      epoch: number;
      sequence: number;
    }
  | { type: "hello"; viewport: Viewport }
  | { type: "resize"; width: number; height: number };
export interface Transport {
  send(message: Message): Promise<void>;
  close(): void;
}
const eventName = "design-workshop-message";

export function browserSession(): string {
  const url = new URL(window.location.href);
  let session = url.searchParams.get("session");
  if (!session || !/^[a-zA-Z0-9-]{1,64}$/u.test(session)) {
    session = crypto.randomUUID();
    url.searchParams.set("session", session);
    history.replaceState(null, "", url);
  }
  return session;
}
export function previewUrl(): string {
  const session = browserSession();
  const url = new URL(window.location.href);
  url.searchParams.set("workshop", "preview");
  url.searchParams.set("session", session);
  return url.href;
}
export function viewport(): Viewport {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    scale: window.devicePixelRatio,
  };
}

export async function connect(
  role: Role,
  receive: (message: Message) => void,
): Promise<Transport> {
  const peer: Role = role === "controls" ? "preview" : "controls";
  const deliver = (message: Message) => {
    if (!message || typeof message !== "object") return;
    if (
      role === "preview" &&
      (message.type === "state" || message.type === "resize")
    )
      receive(message);
    if (
      role === "controls" &&
      (message.type === "hello" || message.type === "command")
    )
      receive(message);
  };
  if (isTauri()) {
    const { listen, emitTo } = await import("@tauri-apps/api/event");
    const stop = await listen<Message>(eventName, (event) =>
      deliver(event.payload),
    );
    return {
      send: (message) => emitTo(`design-${peer}`, eventName, message),
      close: stop,
    };
  }
  const channel = new BroadcastChannel(`situate-design-${browserSession()}`);
  channel.onmessage = (
    event: MessageEvent<{ role: Role; message: Message }>,
  ) => {
    if (event.data?.role === peer) deliver(event.data.message);
  };
  return {
    async send(message) {
      channel.postMessage({ role, message });
    },
    close() {
      channel.close();
    },
  };
}

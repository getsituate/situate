import {
  listen,
  type EventCallback,
  type UnlistenFn,
} from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

export function listenInWindow<T>(
  event: string,
  handler: EventCallback<T>,
): Promise<UnlistenFn> {
  // Tauri delivers targeted emissions to listeners registered with the default `Any` target too.
  return listen(event, handler, { target: getCurrentWindow().label });
}

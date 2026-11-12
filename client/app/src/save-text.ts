import { invoke } from "@tauri-apps/api/core";

export function saveText(text: string): Promise<void> {
  return invoke<void>("save_text", { text });
}

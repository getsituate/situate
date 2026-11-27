import type { InjectionKey } from "vue";
import type { PluginState } from "../plugins/model";

export const chatModeSessions: InjectionKey<{
  get(id: string): PluginState | undefined;
  set(id: string, state: PluginState): void;
}> = Symbol("chatModeSessions");

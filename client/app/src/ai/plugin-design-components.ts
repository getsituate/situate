import components from "./plugin-design/components.json";

interface ComponentReference {
  purpose: string;
  props: Record<string, string>;
  events: Record<string, string>;
  slots: Record<string, string>;
  usage: string;
}

export const pluginDesignComponents: Record<
  keyof typeof import("../plugins/ui").ui,
  ComponentReference
> = components;

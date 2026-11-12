import { describe, expect, it } from "vitest";
import * as vue from "vue";
import { mount } from "@vue/test-utils";
import * as ui from "@situate/ui";
import { loadHostModules } from "./module";

describe("plugin host modules", () => {
  it("compiles local templates with the application's Vue runtime and shared components", async () => {
    const host = await loadHostModules();
    expect(host.vue.reactive).toBe(vue.reactive);
    expect(host.vue.h).toBe(vue.h);
    expect(host.vue.watch).toBe(vue.watch);
    expect(host.vue.onUnmounted).toBe(vue.onUnmounted);
    const components = Object.entries(ui).filter(([name]) =>
      name.startsWith("Situate"),
    );
    expect(Object.keys(host.ui).sort()).toEqual(
      components.map(([name]) => name).sort(),
    );
    for (const [name, component] of components) {
      expect(host.ui[name as keyof typeof host.ui]).toBe(component);
    }
    const component = host.vue.defineComponent({
      setup() {
        return { count: host.vue.ref(1) };
      },
      render: host.vue.compile('<button @click="count++">{{ count }}</button>'),
    });
    const wrapper = mount(component);
    expect(wrapper.text()).toBe("1");
    await wrapper.trigger("click");
    expect(wrapper.text()).toBe("2");
    wrapper.unmount();
  });
});

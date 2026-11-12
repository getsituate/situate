import { describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import * as vue from "vue";
import { compileTemplate } from "./compiler";
import { loadHostModules } from "./module";

describe("local plugin template compiler", () => {
  it("renders dynamic components and slots using the shared runtime context", () => {
    const key = Symbol("context");
    const child = vue.defineComponent({
      setup: () => ({ value: vue.inject(key) }),
      render: compileTemplate("<span>{{ value }}<slot /></span>"),
    });
    const wrapper = mount(
      vue.defineComponent({
        setup() {
          vue.provide(key, "shared");
          return { child: vue.markRaw(child), items: ["one", "two"] };
        },
        render: compileTemplate(
          '<component :is="child"><b v-for="item in items" :key="item">{{ item }}</b></component><p>fragment</p>',
        ),
      }),
    );
    expect(wrapper.get("span").text()).toBe("sharedonetwo");
    expect(wrapper.findAll("b").map((item) => item.text())).toEqual([
      "one",
      "two",
    ]);
    expect(wrapper.get("p").text()).toBe("fragment");
    wrapper.unmount();
  });

  it("compiles registered component templates with refs, events, conditions, loops and shared components", async () => {
    const host = await loadHostModules();
    const wrapper = mount(
      host.vue.defineComponent({
        components: {
          SituateInput: host.ui.SituateInput,
          SituateButton: host.ui.SituateButton,
        },
        setup() {
          return {
            value: host.vue.ref("first"),
            visible: host.vue.ref(true),
            items: host.vue.ref(["one", "two"]),
          };
        },
        template:
          '<section><SituateInput v-model="value" /><input class="native" v-model="value" /><SituateButton @click="visible = !visible">Toggle</SituateButton><p v-if="visible">{{ value }}</p><ul><li v-for="item in items" :key="item">{{ item }}</li></ul></section>',
      }),
    );
    expect(wrapper.findAll("li").map((item) => item.text())).toEqual([
      "one",
      "two",
    ]);
    await wrapper
      .getComponent(host.ui.SituateInput)
      .get("input")
      .setValue("shared");
    expect(wrapper.get("p").text()).toBe("shared");
    await wrapper.get("input.native").setValue("native");
    expect(wrapper.get("p").text()).toBe("native");
    await wrapper.get("button").trigger("click");
    expect(wrapper.find("p").exists()).toBe(false);
    wrapper.unmount();
  });

  it("compiles native checkbox, radio, select and dynamic input models", async () => {
    const wrapper = mount(
      vue.defineComponent({
        setup: () => ({
          checked: vue.ref(false),
          choice: vue.ref("a"),
          selected: vue.ref("a"),
          text: vue.ref("old"),
          kind: vue.ref("text"),
        }),
        render: compileTemplate(
          '<div><input class="checkbox" type="checkbox" v-model="checked" /><input class="radio" type="radio" value="b" v-model="choice" /><select v-model="selected"><option>a</option><option>b</option></select><input class="dynamic" :type="kind" v-model="text" /><output>{{ checked }}|{{ choice }}|{{ selected }}|{{ text }}</output></div>',
        ),
      }),
    );
    await wrapper.get(".checkbox").setValue(true);
    await wrapper.get(".radio").setValue(true);
    await wrapper.get("select").setValue("b");
    await wrapper.get(".dynamic").setValue("new");
    expect(wrapper.get("output").text()).toBe("true|b|b|new");
    wrapper.unmount();
  });

  it("respects compiler options and event modifiers", async () => {
    const handler = vi.fn();
    const wrapper = mount(
      vue.defineComponent({
        setup: () => ({ value: "custom delimiters", handler }),
        render: compileTemplate(
          '<input @keyup.enter.prevent="handler" /><x-synthetic>[[ value ]]</x-synthetic>',
          {
            delimiters: ["[[", "]]"],
            isCustomElement: (tag) => tag === "x-synthetic",
            prefixIdentifiers: true,
          },
        ),
      }),
    );
    expect(wrapper.get("x-synthetic").text()).toBe("custom delimiters");
    await wrapper.get("input").trigger("keyup", { key: "Escape" });
    expect(handler).not.toHaveBeenCalled();
    await wrapper.get("input").trigger("keyup", { key: "Enter" });
    expect(handler).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("does not log template source when compilation fails or emits warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => compileTemplate("<div>private source</span>")).toThrow(
        "plugins.invalidContributions",
      );
      compileTemplate("<div>private source</div>", {
        nodeTransforms: [
          (_node, context) =>
            context.onWarn({
              name: "SyntaxError",
              message: "private warning",
              code: 0,
            }),
        ],
      });
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("reports invalid templates and options without source, raw errors or causes", () => {
    for (const run of [
      () => compileTemplate("<div>private source</span>"),
      () => compileTemplate("<div />", { mode: "module" }),
      () => compileTemplate("<div />", { ssr: true }),
      () =>
        compileTemplate("<div />", {
          nodeTransforms: [
            () => {
              throw new Error("private transform failure");
            },
          ],
        }),
    ]) {
      expect(run).toThrow("plugins.invalidContributions");
      try {
        run();
      } catch (error) {
        expect(error).not.toHaveProperty("cause");
        expect(String(error)).not.toContain("private");
      }
    }
  });
});

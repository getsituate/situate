import { compile, type CompilerOptions } from "@vue/compiler-dom";
import * as Vue from "vue";
import type { RenderFunction } from "vue";

function compilationError(): Error {
  return new Error("plugins.invalidContributions");
}

export function compileTemplate(
  template: string | HTMLElement,
  options: CompilerOptions = {},
): RenderFunction {
  try {
    let source = typeof template === "string" ? template : template.innerHTML;
    if (source.startsWith("#"))
      source = document.querySelector(source)?.innerHTML ?? "";
    if (
      options.ssr ||
      (options.mode !== undefined && options.mode !== "function")
    )
      throw compilationError();
    const { code } = compile(source, {
      mode: "function",
      hoistStatic: true,
      isCustomElement: (tag) =>
        typeof customElements !== "undefined" && !!customElements.get(tag),
      onWarn: () => undefined,
      ...options,
    });
    const render = new Function("Vue", code)(Vue) as RenderFunction & {
      _rc: boolean;
    };
    render._rc = true;
    return render;
  } catch {
    throw compilationError();
  }
}

Vue.registerRuntimeCompiler(compileTemplate);

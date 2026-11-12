import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import ProviderIcon from "./ProviderIcon.vue";
import { providerLogos } from "./provider-logos";
import { providers } from "./providers";

enableAutoUnmount(afterEach);

const assets = import.meta.glob<string>("./assets/providers/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

describe("provider icons", () => {
  it("maps the provider catalog, with neutral icons only for unverified marks and generic connections", () => {
    expect(
      providers
        .filter((provider) => !providerLogos.has(provider.id))
        .map((provider) => provider.id),
    ).toEqual([
      "example-orbit",
      "radius",
      "typesafe",
      "llama.cpp",
      "compatible",
      "extension",
    ]);
    expect(
      [...providerLogos.keys()].every((id) =>
        providers.some((provider) => provider.id === id),
      ),
    ).toBe(true);
    expect(new Set(providerLogos.values()).size).toBe(
      Object.keys(assets).length,
    );
  });

  it("shares marks across regional and access-plan variants", () => {
    for (const [variant, provider] of [
      ["openai-codex", "openai"],
      ["minimax-cn", "minimax"],
      ["moonshotai-cn", "moonshotai"],
      ["opencode-go", "opencode"],
      ["qwen-token-plan-cn", "qwen-token-plan"],
      ["xiaomi-token-plan-ams", "xiaomi"],
      ["zai-coding-cn", "zai"],
    ])
      expect(providerLogos.get(variant)).toBe(providerLogos.get(provider));
  });

  it("renders local decorative images without duplicating the adjacent provider name", () => {
    for (const provider of providerLogos.keys()) {
      const wrapper = mount(ProviderIcon, { props: { provider } });
      expect(wrapper.attributes("aria-hidden")).toBe("true");
      expect(wrapper.get("img").attributes("alt")).toBe("");
      expect(wrapper.get("img").attributes("src")).toBe(
        providerLogos.get(provider),
      );
      expect(wrapper.get("img").attributes("src")).not.toMatch(
        /^(https?:)?\/\//,
      );
      expect(wrapper.find("svg").exists()).toBe(false);
    }
  });

  it("uses a neutral icon for unknown providers and connections without a verified mark", () => {
    for (const provider of [
      "radius",
      "typesafe",
      "llama.cpp",
      "compatible",
      "extension",
      "unknown",
      "constructor",
    ]) {
      const wrapper = mount(ProviderIcon, { props: { provider } });
      expect(wrapper.find("img").exists()).toBe(false);
      expect(wrapper.find("svg").exists()).toBe(true);
    }
  });

  it("recovers from a missing image and resets the fallback when the provider changes", async () => {
    const wrapper = mount(ProviderIcon, { props: { provider: "openai" } });
    await wrapper.get("img").trigger("error");
    expect(wrapper.find("img").exists()).toBe(false);
    expect(wrapper.find("svg").exists()).toBe(true);
    await wrapper.setProps({ provider: "anthropic" });
    expect(wrapper.get("img").attributes("src")).toBe(
      providerLogos.get("anthropic"),
    );
    expect(wrapper.find("svg").exists()).toBe(false);
  });

  it("retains license notices and uses self-contained SVGs without active content", () => {
    for (const source of Object.values(assets)) {
      expect(source).toContain("Copyright (c) 2023 LobeHub");
      expect(source).toContain("MIT License");
      const document = new DOMParser().parseFromString(source, "image/svg+xml");
      expect(
        document.querySelector(
          "parsererror, script, foreignObject, image, a, style",
        ),
      ).toBeNull();
      expect(document.documentElement.localName).toBe("svg");
      expect(document.documentElement.hasAttribute("viewBox")).toBe(true);
      for (const element of document.querySelectorAll("*")) {
        for (const { name, value } of element.attributes) {
          expect(name).not.toMatch(/^on/i);
          if (name.endsWith("href")) expect(value).toMatch(/^#/);
          for (const match of value.matchAll(/url\(([^)]+)\)/g))
            expect(match[1]).toMatch(/^#/);
        }
      }
    }
  });
});

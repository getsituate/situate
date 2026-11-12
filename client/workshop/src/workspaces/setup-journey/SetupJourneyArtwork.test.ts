import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SetupJourneyArtwork from "./SetupJourneyArtwork.vue";
import JourneyStage from "./JourneyStage.vue";
import { journeyFrame, arrivalFrame } from "./journey";
import { openingFrame } from "./opening";

const props = { step: 0, fromStep: 0, travel: 1, reaction: 0 };

describe("SetupJourneyArtwork", () => {
  it("retains one canonical actor, face and landmark set across all waypoints", async () => {
    const wrapper = mount(SetupJourneyArtwork, { props });
    const actor = wrapper.get(".actor svg").element;
    const face = wrapper.get('[data-bend-part="face"]').element;
    const body = () => wrapper.get('[data-bend-part="body"]').element.outerHTML;
    const canonicalBody = body();
    const papers = wrapper
      .findAll("[data-paper]")
      .map((paper) => paper.element);
    expect(wrapper.attributes("aria-hidden")).toBe("true");
    expect(wrapper.findAll(".setup-illustration")).toHaveLength(1);
    for (let step = 1; step < 5; step++) {
      for (const travel of [0, 0.2, 0.5, 0.8, 1]) {
        await wrapper.setProps({ fromStep: step - 1, step, travel });
        expect(wrapper.get(".actor svg").element).toBe(actor);
        expect(body()).toBe(canonicalBody);
        expect(wrapper.get('[data-bend-part="face"]').element).toBe(face);
        expect(
          wrapper.findAll("[data-paper]").map((paper) => paper.element),
        ).toEqual(papers);
      }
    }
    expect(wrapper.findAll('svg[data-bend-pose="rest"]')).toHaveLength(1);
    wrapper.unmount();
  });

  it("restores byte-identical SVG after backward seeking and station handoff", async () => {
    const wrapper = mount(SetupJourneyArtwork, {
      props: { ...props, step: 1, fromStep: 0, travel: 0.48 },
    });
    const initial = wrapper.element.outerHTML;
    await wrapper.setProps({ travel: 1 });
    const destination = wrapper.element.outerHTML;
    await wrapper.setProps({ step: 2, fromStep: 1, travel: 0 });
    expect(wrapper.element.outerHTML).toBe(destination);
    await wrapper.setProps({ step: 1, fromStep: 0, travel: 0.48 });
    expect(wrapper.element.outerHTML).toBe(initial);
    wrapper.unmount();
  });

  it("keeps one actor and identical anatomy through the confirmed arrival", async () => {
    const wrapper = mount(JourneyStage, {
      props: { frame: journeyFrame({ ...props, step: 4, fromStep: 4 }) },
    });
    const actor = wrapper.get(".actor svg").element;
    const body = wrapper.get('[data-bend-part="body"]').element.outerHTML;
    const origin = wrapper.element.outerHTML;
    await wrapper.setProps({ frame: arrivalFrame(0) });
    expect(wrapper.element.outerHTML).toBe(origin);
    await wrapper.setProps({ frame: arrivalFrame(0.65) });
    const touching = wrapper.element.outerHTML;
    await wrapper.setProps({ frame: arrivalFrame(1) });
    await wrapper.setProps({ frame: arrivalFrame(0.65) });
    expect(wrapper.element.outerHTML).toBe(touching);
    expect(wrapper.get(".actor svg").element).toBe(actor);
    expect(wrapper.get('[data-bend-part="body"]').element.outerHTML).toBe(body);
    const stage = wrapper.element;
    expect(
      stage.querySelector(".workplace")!.compareDocumentPosition(actor) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    wrapper.unmount();
  });

  it("keeps the actor and rigid body through the opening and removes all confetti", async () => {
    const wrapper = mount(JourneyStage, {
      props: { frame: openingFrame(0).art },
    });
    const actor = wrapper.get(".actor svg").element;
    const body = wrapper.get('[data-bend-part="body"]').element.outerHTML;
    const initial = wrapper.element.outerHTML;
    for (const time of [0, 80, 170, 370, 570, 700, 900, 1100]) {
      await wrapper.setProps({ frame: openingFrame(time).art });
      expect(wrapper.get(".actor svg").element).toBe(actor);
      expect(wrapper.get('[data-bend-part="body"]').element.outerHTML).toBe(
        body,
      );
      expect(wrapper.findAll(".opening-paper path")).toHaveLength(
        openingFrame(time).art.paperBits.length,
      );
    }
    expect(wrapper.element.outerHTML).toBe(initial);
    wrapper.unmount();
  });

  it("namespaces inline clip references and destroys the rig on removal", async () => {
    const wrapper = mount({
      components: { SetupJourneyArtwork },
      template:
        '<div><SetupJourneyArtwork :step="1" :from-step="0" :travel="0.5" :reaction="0"/><SetupJourneyArtwork :step="0" :from-step="0" :travel="1" :reaction="0"/></div>',
    });
    const ids = wrapper.findAll("[id]").map((node) => node.attributes("id"));
    expect(new Set(ids).size).toBe(ids.length);
    for (const node of wrapper.findAll("[clip-path]")) {
      expect(ids).toContain(node.attributes("clip-path")?.slice(5, -1));
    }
    const moving = wrapper.findAll(".actor svg")[0].element;
    const initialFront = wrapper
      .findAll('[data-bend-part="front"]')[1]
      .attributes("d");
    wrapper.unmount();
    expect(
      moving.querySelector('[data-bend-part="front"]')?.getAttribute("d"),
    ).toBe(initialFront);
  });
});

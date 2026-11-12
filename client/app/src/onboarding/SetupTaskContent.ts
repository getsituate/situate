import { defineComponent, Fragment, h, type PropType, type VNode } from "vue";
import type { SetupTransitionFrame } from "./setup-transition";

export default defineComponent({
  name: "SetupTaskContent",
  props: {
    transition: Object as PropType<SetupTransitionFrame>,
  },
  setup(props, { slots }) {
    let content: VNode[] = [];
    return () => {
      // Retain the outgoing task until the shared score reaches its handoff.
      if (!props.transition || props.transition.incoming)
        content = slots.default?.() ?? [];
      return h(Fragment, content);
    };
  },
});

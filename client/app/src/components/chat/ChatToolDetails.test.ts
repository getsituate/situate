import { mount } from "@vue/test-utils";
import { expect, it } from "vitest";
import ChatToolDetails from "./ChatToolDetails.vue";

it("localizes the Gmail request failure with its status and reason", () => {
  const wrapper = mount(ChatToolDetails, {
    props: {
      scope: "synthetic",
      call: {
        id: "call",
        key: "call",
        name: "trashMessage",
        state: "failed",
        result: {
          role: "toolResult",
          toolCallId: "call",
          toolName: "trashMessage",
          isError: true,
          timestamp: 0,
          content: [
            {
              type: "text",
              text: '{"key":"native.gmail.apiFailed","params":{"status":403,"reason":"insufficientPermissions"}}',
            },
          ],
        },
      },
    },
  });
  expect(wrapper.get("pre").text()).toBe(
    '⟦native.gmail.apiFailed:{"reason":"insufficientPermissions","status":403}⟧',
  );
  wrapper.unmount();
});

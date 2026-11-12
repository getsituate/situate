import { expect, test } from "vitest";
import { pluginDevelopmentInstructions } from "./plugin-development-instructions";

test.each([
  { version: 2 as const },
  { version: 2 as const, pluginId: "sample" },
])(
  "development completion requires explicit navigation permission (%j)",
  (context) => {
    const prompt = pluginDevelopmentInstructions(context);
    expect(prompt).toContain(
      "Keep the completion report readable in this development conversation",
    );
    expect(prompt).toContain(
      "Successful checks, publication or activation do not authorize navigation",
    );
    expect(prompt).toContain(
      "A request to develop or update a plugin is not permission to open it when finished",
    );
    expect(prompt).toContain(
      "Do not call open_view, reveal_content or open_conversation on completion unless the user explicitly requested that navigation",
    );
    expect(prompt).toContain(
      "Leave the current conversation, pane, tab and focus unchanged",
    );
    expect(prompt).toContain(
      "Report actual outcomes and failures without hiding activation status",
    );
    expect(prompt).toContain(
      "Already-open plugin views may continue updating or reloading without being focused",
    );
    expect(prompt).toContain(
      "must not call navigation.open or navigation.reveal during initialization, activation, background updates or presentation restoration",
    );
    expect(prompt).toContain(
      "reserve navigation for explicit user requests or interactions",
    );
  },
);

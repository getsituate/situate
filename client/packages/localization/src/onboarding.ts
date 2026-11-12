import { registerCatalogs } from "./index";
import en from "./catalogs/en.onboarding.json" with { type: "json" };
import de from "./catalogs/de.onboarding.json" with { type: "json" };

import conversationEn from "./catalogs/en.onboarding-conversation.json" with { type: "json" };
import conversationDe from "./catalogs/de.onboarding-conversation.json" with { type: "json" };
import agentEn from "./catalogs/en.onboarding-agent.json" with { type: "json" };
import agentDe from "./catalogs/de.onboarding-agent.json" with { type: "json" };

registerCatalogs(
  { ...en, ...conversationEn, ...agentEn },
  { ...de, ...conversationDe, ...agentDe },
);

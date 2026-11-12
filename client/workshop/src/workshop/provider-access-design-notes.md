# Provider access warnings and device credentials

These workshop additions extend [the existing AI setup](../../../../docs/development/design-workshop-ai.md) for [REQ-0015](../../../../requirements/data/requirements/REQ-0015-connect-user-provided-models.md). They are interaction proposals, not provider permission, live authentication or secure-store implementations.

MVP adoption is limited to OpenAI API-key/direct ChatGPT access, Codex device authorization, Anthropic/OpenRouter API keys and custom/local endpoints. Ordinary setup uses this inventory. Subscription copy-code, other provider logins, cloud sources and extensions remain behind the controls-only exploration switch or their historical starting states. The [development handoff](../../../../docs/development/design-workshop-ai.md#development-handoff) identifies the reference flows for independent named connections, model refresh and destination-specific HTTP consent; native protocol and catalog qualification remain separate.

## Warnings before affected access

Under **Connect an AI provider**, the `ai-warning` and `ai-warning-device` starting states show a provider/method restriction with an explicit own-risk acknowledgement before handoff. The **Provider rules changed** state in `settings-error` applies a changed restriction to existing access without sending the retained chat draft. Cancelling preserves the connection but does not authorize affected use. Source links name the provider’s terms and report a simulated browser handoff in the separate controls window.

Orbit Example is a fictional provider used to exercise a permitted-but-restricted flow and a method that cannot create independent device sessions. Its policy is synthetic and must not be presented as another provider’s terms. `ai-blocked-subscription` currently represents a hard block for the documented Anthropic subscription restriction. It offers no acknowledgement bypass and therefore differs from the selected REQ-0015 interaction: warn specifically, require explicit risk acknowledgement, then permit technically available access. This subscription method is deferred from the MVP. Correct the fixture if it is later adopted; provider permission is not implied, and API-key access remains a distinct method rather than subscription-parity completion. The ordinary `ai-copy-code` fixture uses OpenRouter’s supported manual-return pattern, while selecting Anthropic’s copy-code method encounters its restriction.

A focused review step makes the provider, authentication method and consequences explicit. A generic disclaimer on the provider list would obscure which methods are affected and could be missed when reconnecting. The warning retains setup’s scrolling content and reachable Cancel action; keyboard acknowledgement works without relying on the checkbox’s color.

## Settings integration

Choose **AI settings → Starting state → Provider needs attention** (`settings-error`) to open the **AI & models** overview. The **Provider state** selector in the separate controls window switches between connected access, expired sign-in, missing or inaccessible sign-in details, changed provider rules and unavailable chat models. These are live conditions of one screen, not separate scenarios. **AI settings** also offers recommended models, manual model selection, no providers, connection details and credential-recovery examples as starting states. Language/formats and keyboard shortcuts remain separate scenarios.

The provider row carries the status and recovery action; the existing Chat notice explains the selected provider’s problem. Storage retries stay in the overview. Reconnection opens the provider’s authentication choices, while changed rules require explicit review. A method known to end another device’s session is blocked before authorization and offers another method, not session takeover. **Manage** on a provider row opens its connection details. Adding, replacing and retrying a connection stay in the same content column; the back link returns to the provider list. Switching settings categories preserves an unfinished form. Forgetting a sign-in and removing a connection use the same confirmation dialog as other Settings actions. Provider and workspace state remain separate, including acknowledgements and local access problems.

The standalone post-creation setup remains in **Connect an AI provider**, under the **AI access** topic. Its welcome, progress and completion presentation are not part of Settings. Browser checks cover 1280px, 780px and 390px layouts, category changes, focus return, preserved fields, and simulated iOS keyboard occlusion.

## Layout and language

The warning has one heading and a compact provider/sign-in label. The restriction and known consequences remain visible before acknowledgement; a named source link opens the provider’s terms. Cancel and Continue share the setup footer. Storage metadata belongs under **About this connection**; **Manage connection** groups local sign-in removal, connection removal and the explanation of provider-side permissions.

Copy follows the [Situate voice](../../../../design/brand/docs/voice.md): name what happened and what the person can do next. Routine messages use “sign-in details” rather than implementation terms such as “credentials” or “OS secure storage.” File, profile and command names remain explicit where the selected method requires them.

Layout and copy review used UI Skills guidance on [simplification](https://www.ui-skills.com/skills/pbakaus/distill), [grouping and adaptive layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout), and [product voice and interface writing](https://www.ui-skills.com/skills/jakubkrehel/better-writing). Local components and brand tokens remain the design baseline; no external code or artwork is included.

## Credential states and scope

Select **AI settings → Provider needs attention** (`settings-error`), then choose a **Provider state**:

- **Local sign-in forgotten**: a connection configured on this device has lost its sign-in; offer reconnection. This differs from a new device, which has no copied provider configuration.
- **Saved sign-in locked**, **Access to saved sign-in denied**, **Saved sign-in unavailable**: retry in the provider row, then complete the simulated recovery in Controls.
- **Sign-in source missing**: an external file/profile/command source is missing; workspace copying does not grant local source access.
- **API key needs reconnecting**, **Browser sign-in expired**, **Provider rejected access**: distinguish renewing access from checking provider permissions.
- **Provider rules changed**: review and acknowledge the changed restriction before using existing access.
- **No chat models** and **Connected**: compare unavailable chat capability with normal access.

Changing **Provider state** replaces the example connections. Changing the viewport or platform preserves the current state; switching Settings categories hides unrelated controls. **Reset scenario** restores the selected starting state and discards pending simulated recovery; for `settings-error`, that is the expired-key example.

Existing `ai-settings`, `ai-restored`, `ai-reconnect`, `ai-locked`, `ai-store-denied`, `ai-store-unavailable`, `ai-source`, `ai-access-denied` and `ai-capability` links open connection details inside **AI settings**. The `ai-warning-changed` state opens restriction review. The legacy `ai-session-replacement` link opens **Sign-in would affect another device**, with no continuation for the affected method. `ai-missing` opens **New device · AI not configured**, an empty provider overview rather than a missing-credential error. Returning to the overview changes the live controls, not the selected starting state. Reset reopens the original review or details.

During a pending save, the controls can supply locked, denied or unavailable storage outcomes. Retrying preserves the previous saved connection until success. Forgetting access removes only this device’s usable credentials while retaining configuration; removing the connection also deletes its configuration on this device. Neither action changes other devices or workspaces. Provider revocation is explained separately, without claiming Situate performed or verified it.

## Independent connection management

**AI settings → Multiple accounts and servers** (`settings-connections`) contains two OpenAI accounts and two compatible servers. **Add connection** permits another record of the same provider. Names, selected chat access, model defaults, discovery results and recovery belong to connection IDs rather than provider names. Rename and disconnect confirmations identify the affected record. Switching connections restores that connection’s defaults; adding or removing another record does not switch access.

In **Advanced settings**, **Refresh models** exposes request-specific outcomes in Controls. Empty, excluded, failed and unavailable discovery preserve saved choices and distinguish model observations from entitlement. Returning an explicit conversation choice to the workspace default rebinds it only after the selection is confirmed. If its old connection has been removed, **Use workspace default** remains available as an explicit recovery; uncertain saves still require readback or retry.

For HTTP, use `ai-endpoint` and enter a server address. Consent identifies the exact normalized destination, and declining preserves the form. A saved local connection retains that acknowledgement; changing the destination requires a new decision. No network requests or changes to native TLS policy occur in this study.

## Device-local access and conversation history

[REQ-0011](../../../../requirements/data/requirements/REQ-0011-work-on-topics-in-parallel.md), [REQ-0015](../../../../requirements/data/requirements/REQ-0015-connect-user-provided-models.md), [REQ-0016](../../../../requirements/data/requirements/REQ-0016-managed-ai-access.md) and [REQ-0038](../../../../requirements/data/requirements/REQ-0038-copy-portable-workspaces.md) distinguish portable content from operational AI settings. Connections, credentials, endpoints, selected access and future model choices belong to the workspace on this device; none travel with workspace copies or synchronization. Own-provider authentication and requests remain direct, without a Situate credential broker.

In **AI settings**, **Local model on this device** (`settings-local`) shows a loopback server. **Situate AI available, local model selected** (`settings-managed`) adds account availability without replacing that choice. The live **Situate account has AI access** control changes availability only. Selecting Situate AI is explicit; losing availability leaves it selected and unavailable rather than falling back. Switching back restores the retained local model preference. Account sign-in, billing and device-session authorization are not simulated here.

**Conversation** owns the shared chat surface and model/access states. Without an override, its model control shows Recommended or Workspace default and resolves a suitable model automatically. The chooser identifies the provider and effective model and allows a return to the workspace default. The legacy `ai-chat-synced` link opens the completed conversation; `ai-chat-unconfigured` opens its missing-access state, preserving draft entry while sending is blocked. **Receive a reply from another device** adds synthetic content without model attribution or changes to the local connection, model preference or draft. Platform controls change presentation, not device identity.

## Review question

Ask a person to choose a desktop-local model, then explain what must be set up on their phone and what happens to existing conversations. Compare new-device setup with a locked sign-in: these should lead to different actions. Have them identify the next message’s model and explain whether receiving a reply changes their local setting. Finally, make Situate AI available and ask whether it is already selected. These are review questions, not usability findings.

Browser tests cover these flows at desktop and constrained phone widths, alongside model/component tests for cancellation, unchanged workspaces, stale outcomes and non-bypassable restrictions. A resized WebView does not establish native authentication, secure-store guarantees, provider authorization or usability findings. Official synchronization, account recovery and sync-device authorization are deferred; they have no workshop scenarios or Settings entry. This is distinct from provider device-code login.

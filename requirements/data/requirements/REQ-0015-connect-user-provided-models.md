---
id: REQ-0015
type: requirement
title: Connect and use user-provided AI model access
status: approved
priority: must
area: AI access
goals: [GOAL-0001]
---

## Description

Users must be able to connect their own access to AI models to Situate and use it to process their user requests. The MVP supports OpenAI through API keys and direct ChatGPT browser login, the distinct OpenAI Codex integration through device authorization, Anthropic/Claude and OpenRouter through API keys, and configurable OpenAI-compatible local or remote servers with optional API keys. These integrations reuse authentication and request mechanisms where possible; a shared key form alone does not establish protocol compatibility. Use must not be tied exclusively to Situate's managed AI offering.

Conversational provider/authentication parity with the integrated Pi version is a long-term goal, not MVP acceptance. Other named providers, cloud-specific integrations, Anthropic subscription/federated access, OpenRouter PKCE, Codex browser/manual login, external credential sources and arbitrary provider extensions are deferred. Classifier models and classifier-only providers are excluded. Partial-support releases are permitted with remaining MVP gaps explicit; they do not establish full MVP coverage. Local support means access to a running compatible server, not embedded model execution or server management. Credential migration and legacy-session compatibility may be omitted only for prototype formats verified never to have shipped publicly. Published device-local connections and settings must survive app upgrades through compatible storage or a tested, recoverable migration; portable conversation data also follows [released-version compatibility](REQ-0069-preserve-workspace-version-compatibility.md).

Mobile must support setting up access on the mobile device itself, with the same functional experience as desktop; owning or first configuring a desktop must not be a prerequisite. Native browser handoff and platform-specific interactions may differ. Unresolved mobile MVP methods and alternatives need explicit feasibility review, not silent exclusions or substitution of subscription access with API-key billing.

This refers to model access, not connecting independent AI assistants. Users select endpoints and credentials independently per workspace and device and can use suitable OpenAI-compatible endpoints, including self-hosted and local models. Compatibility with the wire format alone does not guarantee the model capabilities required for a particular function. Local-only operation is a configuration choice, not an enforced prohibition on networking.

Provider connections, credentials, endpoint addresses, selected access, default models and conversation-specific model selections belong to the combination of workspace and device. They must persist locally across reopening, outside the portable workspace directory and its histories. Neither official nor custom synchronization transfers these settings or credentials, even when a provider technically permits sharing them. Provider secrets remain in device-local OS secure storage; Situate-operated services must not store them or act as a credential or token-renewal broker for user-provided access. Authentication and model requests use the selected provider directly. Connecting, changing, renewing, forgetting or removing a connection must not overwrite another device's local records or another workspace's configuration.

A new device offers local AI setup when access is needed; an unconfigured device is not presented as a broken connection or failed synchronization. Users may configure different providers and models for the same workspace on different devices. A desktop-local server need not exist or be reachable on a phone, and synchronization must not import its address or replace the phone's chosen access. Reading synchronized content and manual local work do not require AI setup. [Managed Situate AI](REQ-0016-managed-ai-access.md) is available through account entitlement without configuring external provider credentials, but availability must not automatically replace the access selected on this device.

Separate device sign-ins must use independent sessions where the provider supports them, not copies of a shared rotating refresh token. A method known to replace another device's session must not be offered as ordinary independent-device setup: explain the limitation before starting authentication rather than offering session takeover as the normal continuation. Device-local storage alone does not establish independent-session support or guarantee that a provider will never revoke access. Multi-device support claims require verification of the provider's actual session behavior.

Within an existing workspace, provider connections are managed through Settings for the current device. Model choice is separate from connection setup: users select and switch between usable models of the configured provider in chat. A model change applies to subsequent messages without reconnecting the provider or discarding the conversation or draft. A conversation without a local override inherits the workspace's model setting on this device. That setting initially uses Recommended, which resolves a suitable model from the ranked catalog in the background; absence of an override is not an unselected-model state. Selecting a model within a conversation saves an override for that conversation on this device without changing the local workspace default, another conversation's override or any other device's selection. Local defaults and overrides are restored when the workspace is reopened on the same device, not transferred with conversation data. A default change affects subsequent requests that inherit it on this device, not explicit local overrides or the model snapshot of an already running request.

Conversation content remains portable and synchronizable. Situate does not retain or display per-message provider/model attribution after a request completes. The model captured for an active request is transient execution state, not conversation history. Continuing a synchronized conversation uses the destination device's local conversation selection, or its local workspace default if no override exists. The access and model that will handle the next request must be identifiable before sending. Missing or unavailable access blocks submission without discarding the conversation or draft; Situate must not silently switch providers or fall back to paid managed access.

Multiple accounts or endpoints of the same provider can coexist within a workspace on one device as independently identifiable connections with separate credentials.

After a new connection is saved, its workspace default is Recommended. Situate resolves the highest-ranked available suitable model from the same ordered catalog used for Recommended without creating an explicit conversation override. The catalog covers available models for supported conversational use and supplies explicit priorities rather than relying on provider enumeration order. Resolution is specific to the selected connection, authentication method and required capabilities. If no suitable model can be established, show the limitation rather than inventing a default. This initial selection is not automatic fallback between providers or models during requests.

Until usable AI access is selected for the current workspace on this device, users must not be able to submit a chat message. [Connection setup after workspace creation](REQ-0045-create-local-workspaces.md) is required before entering guided onboarding, with no initial manual-use bypass. A connection in another workspace or on another device does not satisfy it. In an established workspace, loss of AI access does not remove local reading or manual editing; the [managed AI offering](REQ-0016-managed-ai-access.md) remains an alternative to user-provided access. Retained onboarding progress follows the workspace, but continuing it on a device without usable local AI access requires connection setup there; no live request or access configuration transfers.

Users are responsible for selecting providers connected through their own model access and evaluating those providers' processing terms. The managed service's no-training guarantee does not extend to independently selected providers. Situate remains responsible for its own data transmission and credential handling; see the [data-processing constraints](../foundations.md#hosting-and-data-processing).

When a known provider restriction affects the selected provider and authentication method, Situate must display a specific warning before starting that connection or using affected existing access. It explains the restriction and its consequences, links to the provider's guidance, and explicitly states that users proceed at their own risk. Continuing requires explicit acknowledgement; cancellation leaves existing access unchanged. A generic disclaimer for all providers is not sufficient. A provider's prohibition of third-party subscription use is disclosed through this warning rather than an additional Situate-imposed hard block solely for that policy. After acknowledgement, the user can attempt technically available access at their own risk. Acknowledgement does not grant provider permission, override service-enforced denial, remove a technical restriction or replace Situate's responsibilities. Provider terms and distribution obligations remain separate from the user's risk acceptance.

Users may connect to local servers over a local network, including unencrypted HTTP after a destination-specific warning and explicit acknowledgement. The warning explains that requests, responses and any transmitted credentials are not protected by transport encryption. This permission does not authorize insecure redirects or disable TLS certificate validation for HTTPS connections.

## Rationale

Choosing model access preserves users' ability to shape their personal system. Users should be able to use Situate without having to purchase access to the provider's chosen models and AI capacity offering. Device-local choices accommodate different hardware, server reachability and costs without synchronization unexpectedly changing where requests are sent.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: explicit correction from user-provided assistants to user-provided models, motivated by freedom of choice; subsequent confirmation of both user-provided model access and managed AI access as must-have requirements. Local-model support was left open at that elicitation and resolved by the clarification below.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Provider choice through user-provided model access was assigned to the user, separately from the managed service's no-training obligation.

Private content and workspace architecture clarification, 2026-09-29; not publicly available. Per-workspace endpoint and credential selection, suitable OpenAI-compatible self-hosted and local models, and configuration-based local-only use were confirmed.

Private workspace AI connection clarification; date not recorded, not publicly available. Support for all providers and authentication methods of the integrated Pi version, workspace-local connection persistence, and prevention of chat submission until the workspace has connected AI access were confirmed.

Private provider-access and credential-recovery clarification; date not recorded, not publicly available. Device-local secure storage and provider-specific warnings with explicit acknowledgement of proceeding at the user's own risk were confirmed.

Private provider-support clarification; date not recorded, not publicly available. Mobile setup without a desktop prerequisite, partial-support releases, acknowledgement instead of a policy-only hard block, multiple same-provider accounts, shared ranked automatic/Recommended selection, exclusion of classifiers, and warned LAN HTTP were confirmed.

Private MVP scope clarification; date not recorded, not publicly available. OpenAI API-key/direct ChatGPT access, Codex device authorization, Anthropic and OpenRouter API keys, and custom/local endpoints were selected. Broader conversational Pi parity is a long-term goal rather than MVP acceptance. The original credential-migration and legacy-session exception concerned unpublished prototype formats, not formats shipped in public releases.

Private multi-device AI configuration clarification; date not recorded, not publicly available. Per-workspace, per-device provider configuration and model selection, no provider-dependent synchronization exception, separate device sign-in, portable conversation content and account-based managed AI availability were confirmed.

Private onboarding scope and continuation clarification; date not recorded, transcript not publicly available. Required initial AI access and workspace-owned onboarding progress without credential or live-request transfer were confirmed.

## Acceptance criteria

- Users can connect and use suitable conversational models through OpenAI API keys and direct ChatGPT browser login, OpenAI Codex device authorization, Anthropic API keys, OpenRouter API keys and custom OpenAI-compatible endpoints with optional API keys.
- Deferred provider/method integrations are not required for MVP completion or presented as working merely because they appear in the upstream Pi inventory. Classifiers are excluded.
- Mobile setup for these methods can be completed on the mobile device without requiring a desktop. Unresolved required method/platform combinations remain documented MVP gaps; partial releases do not claim full MVP coverage.
- A known restriction affecting a provider and authentication method produces a warning naming both, explaining the restriction and known consequences, linking to provider guidance, and explicitly stating that the user proceeds at their own risk.
- The warning precedes browser handoff, credential submission or model use through affected access. Declining does not start that operation, replace the connection or affect another workspace.
- Continuing requires explicit acknowledgement of the applicable warning. A changed restriction requires renewed acknowledgement before affected use; unrelated providers or unaffected methods do not receive a blanket warning.
- After explicit acknowledgement, a technically available method can be attempted despite a disclosed provider prohibition; Situate does not impose a hard block solely because of that policy. Service-enforced rejection and technical unavailability remain effective and visible.
- Acknowledgement is not presented as provider authorization or a way to make an unavailable method work; unresolved coverage remains visible.
- User-provided access sends authentication and model requests directly to the configured provider. Situate-operated servers neither store those provider credentials nor renew tokens or proxy requests using them.
- Purchasing AI capacity through Situate is not a prerequisite for using supported user-provided model access.

- Different workspaces can use different providers, model endpoints and credentials without changing one another's settings, including while both workspaces are open.
- Two accounts or endpoints of the same provider can coexist in one workspace, be selected independently and retain separate credentials. Reconnecting or removing one does not silently replace the other's local records.
- Provider connections, endpoint addresses, credentials, selected access, default models and conversation overrides persist per workspace and device outside the portable workspace directory and its histories. Reopening on the same device restores them without borrowing another workspace's settings.
- Official synchronization, custom synchronization and workspace copying transfer none of these operational settings or credentials, including shareable API keys. Synchronizing content does not change the destination's existing AI configuration.
- The same workspace can use a local desktop server and a different provider/model on a phone. Configuring, reconnecting, selecting or removing access on either device leaves the other's local configuration unchanged.
- A fresh device without local access offers AI setup without labelling the workspace or synchronization as broken. Existing content remains readable and manually editable.
- Saving or reopening a connection does not require a separate Situate password or routine biometric confirmation beyond OS secure-store access requirements; unavailable or locked storage is reported without a plaintext fallback.
- Authentication on a new device does not overwrite another device's local credentials or copy a rotating session for concurrent renewal. Independently supported sessions renew without changing the other device's session.
- A method known to displace another device's session is not started as ordinary independent-device setup. The limitation is explained without a routine session-takeover continuation; unverified provider session behavior is not represented as guaranteed multi-device support.
- AI-access setup configures the provider and authentication without requiring a chat model choice.
- Users select and switch between usable models of the configured provider in chat, without reconnecting or changing the provider. Selection applies to subsequent messages, preserves the conversation and draft, and is restored when the workspace is reopened on the same device.
- A conversation without a local override inherits the workspace's default on that device, initially Recommended; it does not ask the user to choose a model before chatting when a suitable default can be resolved. Changing its model saves a device-local override without changing the local default, another conversation or another device.
- Two conversations can retain different local model selections through closing their views, reopening the workspace and receiving synchronized conversation data.
- Changing a device's workspace default affects only subsequent requests inheriting that local default, not explicit overrides, other devices or already running requests.
- Synchronized conversations carry content, not per-message provider/model attribution. The next request uses the destination's local override or local workspace default, initially Recommended. That access and the resolved model are identifiable before sending.
- Missing or unavailable local access blocks submission without losing the draft or conversation, silently switching providers or enabling paid managed access.
- The chat has no separate AI-access or provider-connection action. Connection management is reached through Settings in normal use; initial workspace creation instead requires connection setup before guided onboarding.
- A new connection durably starts with Recommended and resolves the first available suitable model from the ordered recommendation catalog without creating an explicit conversation override. Initial resolution and Recommended use the same ordering and eligibility rules.
- The catalog gives explicit priorities to models within supported conversational scope. Account-specific discovery is used where available; catalog presence alone is not represented as confirmed account entitlement, and no billable request is made merely to choose a default.
- A missing suitable default leaves the connection saved, explains the model-selection limitation and blocks submission until a usable selection is established. Existing explicit selections are not replaced by a catalog update or a request failure.
- Without usable AI access selected for the current workspace on this device, chat message submission and entry into guided onboarding are blocked, including when another workspace or device has a connection.
- After usable AI access is selected for that workspace on this device, the missing-connection restriction no longer blocks chat submission.
- Initial connection setup cannot be skipped into manual use. Losing access after onboarding does not block reading or manually editing local content.
- Continuing retained onboarding on another device uses that device's local AI access and does not restart an interrupted request automatically.
- Users can process suitable user requests through a self-hosted or local OpenAI-compatible endpoint without purchasing managed AI access.
- A LAN HTTP endpoint can be configured after a warning about unencrypted content and credentials and explicit destination-specific acknowledgement. Declining sends no request; changing the approved destination requires renewed acknowledgement.
- An endpoint's protocol compatibility is not presented as proof that its model supports every Situate function; missing required capabilities are made explicit.

## Open questions

- Which representative endpoints and models should verify capabilities for the selected MVP integrations?
- Which provider/authentication methods support independent device sessions, and what evidence qualifies their sign-in, renewal and revocation behavior?
- Which model capabilities are required for which user requests, and how are limitations communicated?

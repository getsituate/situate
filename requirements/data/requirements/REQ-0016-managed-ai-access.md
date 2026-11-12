---
id: REQ-0016
type: requirement
title: Offer managed AI capacity with suitable model selection
status: approved
priority: must
area: AI access
goals: [GOAL-0002]
---

## Description

In addition to user-provided model access, Situate must offer paid managed AI access. Users obtain AI capacity through this service without having to provide model access themselves.

Managed AI availability belongs to the Situate account. After signing in on a new device, a user with the required entitlement can use the service without configuring an external provider, endpoint or provider credential. Each device uses its own Situate session; user-provided provider credentials are neither uploaded nor synchronized to enable managed access. Account entitlement does not bypass workspace access or authorize processing of its content.

Availability and selection are separate. The choice between managed Situate AI and user-provided access belongs to the current workspace and device under [REQ-0015](REQ-0015-connect-user-provided-models.md). Enabling or selecting managed access on one device must not replace another device's local provider or model. An entitlement becoming available, or a local provider failing, must not silently switch requests to managed access or incur managed-service usage.

Processing takes place through a Situate-operated router that selects suitable models. The offering should provide capacity and model quality suitable for the user requests without placing model selection on the user. Specific capacity commitments and verifiable quality standards remain to be defined; unlimited use is not promised.

The router may process content authorized for the relevant AI request in plaintext. Neither Situate nor its managed AI providers may use supplied user content for model training. Providers may process outside the EU only when the applicable legal prerequisites are met; Situate-operated services themselves remain subject to the [EU hosting constraint](../foundations.md#hosting-and-data-processing).

This authorization does not grant blanket access to stored content or allow the [synchronization service](REQ-0013-synchronization-service.md) to decrypt it. Retention periods and the mechanism for authorizing AI context remain to be specified.

## Rationale

Users should be able to obtain AI support through an integrated offering without selecting provider access and suitable models themselves. Managed selection should reliably use models appropriate for Situate's user requests.

## Source

Private requirements elicitation conversation; date not recorded, transcript not included. Topics: a dedicated router and paid, sufficient AI capacity with particularly effective models; confirmation of the managed offering alongside user-provided model access as a must-have requirement.

Private architecture-constraints clarification conversation; date not recorded, transcript not included. Authorized plaintext processing by the router, the prohibition on training with supplied content, and legally compliant processing by AI providers outside the EU were explicitly confirmed.

Private multi-device AI configuration clarification; date not recorded, not publicly available. Managed AI is available through the user's account without repeated external-provider setup. Device-local access choices remain independent of account entitlement, with no automatic replacement of a locally selected provider.

## Acceptance criteria

- Users can obtain AI capacity through Situate and use it to process user requests without providing their own model-provider access.
- A user with managed AI entitlement can sign in on a new device and use the service without entering external provider credentials or endpoint configuration; each device has its own Situate session.
- Account entitlement does not grant access to another workspace or authorize blanket processing of stored content.
- A desktop using a local model retains that selection when the same account uses managed AI on a phone. Account availability and synchronization do not overwrite either device's workspace-specific access choice.
- Managed-service usage starts only through the locally selected managed access, not as an automatic fallback from failed or missing user-provided access.
- The Situate router selects the model used; users do not have to choose a model for each user request themselves.
- The capacity promised by the offering and the suitability of its models can be verified against defined performance and quality criteria. These criteria must still be determined before making corresponding service commitments.
- The managed offering does not replace the ability to use [user-provided model access](REQ-0015-connect-user-provided-models.md).
- The managed service's terms, provider agreements and applicable configuration prohibit use of supplied user content for model training.
- Before using a provider that processes outside the EU, the applicable legal prerequisites and safeguards for that processing are documented and verified.
- Router requests contain only content authorized for the relevant processing; the synchronization service receives neither plaintext nor decryption keys through that flow.

## Open questions

- What usage should an offered quota cover, and what limits apply?
- How is it measured whether a model handles a user request sufficiently well?
- What criteria does the router use to select models, and how are cost and quality balanced?
- How are consumption, reached limits, outages and available alternatives presented?
- What pricing, packages and billing methods are planned?
- How is authorization for AI context expressed and enforced?
- What retention and deletion periods apply to requests, responses and logs at Situate and its AI providers?

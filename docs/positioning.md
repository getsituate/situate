# Situate — Positioning and messaging

## Positioning

Situate is a personal organizational system built around the way you work. It manages tasks, knowledge and documents, connects external email, calendar and other services, and uses AI to carry organizational work forward. Users can describe additional tools and integrations they need in their own words.

Three areas form the product core:

- **Knowledge and document management:** capture, organize, connect, maintain, and reuse personal context and documents.
- **Task management:** organize and follow up on tasks and commitments.
- **Extensibility:** create suitable plugins from user requests.

None of these areas is subordinate to another. The product should support the user's organizational methods rather than require a fixed system. See the [product direction and business model](product-concept.md).

## Audience and benefit

The initial audience is people who actively think about organizing their personal lives and want to reduce the effort of maintaining several disconnected systems. They do not need to be developers. Knowledge workers and independent professionals are examples, not the definition of the audience.

The primary promise is less manual coordination and support that fits the user's way of working. Extensibility explains how the product can address individual needs; it is not a promise that every requested integration can be implemented safely or reliably.

## Message hierarchy

1. **Benefit:** a personal organizational system that takes on routine work in the way you work.
2. **Context:** manage tasks, knowledge and documents together, connected to existing email, calendars and supplementary sources.
3. **Mechanism:** describe what you need; Situate can create suitable tools as plugins.
4. **Choice:** use the free local application with your own AI access, or choose paid synchronization and managed AI services.
5. **Trust:** explain data handling, software availability, limitations, and responsibilities accurately.

A suitable headline is:

> Your personal organization, connected.

A supporting message is:

> Keep tasks, knowledge and documents together. Let AI handle the routine work.

Situate serves one person. It is not a shared workspace; collaboration remains in external services that can be connected through integrations.

## User direction and responsibility

Users choose the sources to connect, tools to create, and work to perform. The assistant should not independently expand its goals or capabilities. Deliberately configured recurring workflows are compatible with user direction; their authorization scope still needs to be clear.

Actions execute within user requests and configured access without per-action approval. Internal organization remains reversible; users can inspect outcomes and stop ongoing work. Describe that as a product requirement until its enforcement is implemented and verified.

Users need understandable information about plugin access, generated-code risks, and AI errors. Their responsibility for choosing tools does not replace the provider's responsibility for its software.

## Trust claims and limits

- Public source code enables inspection; it does not prove that an independent security audit has occurred.
- Original software and documentation use MIT; original artwork uses CC BY 4.0. Describe the [license scope and third-party exceptions](../LICENSING.md) accurately; free reuse does not imply official affiliation.
- Encrypted synchronization does not establish end-to-end encryption or private AI processing. Describe each data flow separately.
- Plugin access and security boundaries remain to be designed and verified. Do not present user-selected sources or product principles as proof of technical isolation.
- Do not promise unlimited AI usage, error-free actions, universal integrations, or automatic resolution of every synchronization conflict.
- Distinguish supported platforms and available features from roadmap targets. Do not imply that a downloadable release exists in this repository.

## Differentiation

The proposed distinction is a combination of personal context, organizational work, and user-requested extensions rather than only predefined assistant features. Users direct the work and retain access to their data; paid services provide convenience and reliable operation.

This is a positioning hypothesis, not proof of a unique market position. Specific competitor comparisons require current evidence.

## Avoid

- “Full control” or “complete security” without precise, verified boundaries.
- “Adapts to you” without explaining whether adaptation follows a user request or occurs automatically.
- “Your data is private” without identifying who can access it during synchronization and AI processing.
- A call to download an Early Alpha or use a platform that is not actually available through the linked destination.
- Messaging that turns a preferred organizational method or technical expertise into a prerequisite.

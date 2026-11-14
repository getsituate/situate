# Situate — Product and business model

Situate is a personal organizational system for one person. It manages tasks, knowledge and documents in its own core and connects them with external email, calendar and other services. AI uses personal context to carry ongoing processes forward and perform routine and preparatory work in accordance with the user's working methods. Users can request additional tools and integrations as plugins.

This document describes the product direction, not shipped functionality. The [requirements catalog](../requirements/README.md) records approved goals, testable requirements, and unresolved details. The repository contains a client implementation, described in the [building block view](architecture/index.adoc#current-client-packages); its existence does not establish complete product delivery, deployed optional services or native platform qualification.

The [Situate — Product Capability Catalog](product-capability-catalog/README.md) complements this direction with capability-level scope and evidence at a recorded source revision.

## Who it is for

The initial audience is people who consciously consider how to organize their personal lives and want less work maintaining connections between their systems. Technical expertise is not a prerequisite. Knowledge workers and independent professionals are possible users, not exclusive target segments.

Tasks and notes managed by Situate are brought into its own core; document management is also a core capability. Email and calendar services remain external. Individually requested integrations can provide supplementary access to document services such as Paperless or shared Google Drive repositories without requiring complete migration of those sources. Situate does not provide jointly managed tasks, knowledge or documents within its own system. It supports the user's organizational method rather than prescribing one such as GTD. See the [foundations](../requirements/data/foundations.md).

## Core value

- **Knowledge maintenance:** capture, connect, retrieve, and reuse personal context without continually maintaining it by hand.
- **Task management:** track commitments and carry organizational work forward using relevant information.
- **Extensibility:** create plugins from user requests instead of relying only on a fixed feature or integration catalog.

Users retain decision authority. Internal and external actions execute within the user's request without per-action approval; internal work remains reversible and users can inspect outcomes and stop work. This is the intended product boundary, not evidence that technical safeguards already enforce it. See [GOAL-0004](../requirements/data/goals/GOAL-0004-decision-authority.md).

## Free application and optional services

The application should remain meaningfully usable for free on one device with user-provided AI access. Users may still incur costs from their chosen model provider. Purchasing a Situate service is not required for this local use.

macOS is the only active MVP target, delivered through the website DMG and direct updater. iOS, Windows, Linux desktop and Android are deferred and are not currently supported; no activation date or platform delivery sequence is committed. Supported macOS versions and additional delivery channels remain open. Plugin availability may differ by platform; those differences must be visible. See [platform availability](../requirements/data/requirements/REQ-0012-platform-availability.md) and [plugin compatibility](../requirements/data/requirements/REQ-0014-plugin-platform-compatibility.md).

Two optional subscription services form the intended business model:

| Service                 | What users pay for                                                                                                                                            | Unresolved details                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Managed synchronization | Keeping tasks, notes, documents, plugins, and chats available across one user's connected devices without operating synchronization infrastructure themselves | Cryptographic and recovery protocols, conflict representation, storage limits, pricing, and service commitments |
| Managed AI access       | Integrated AI capacity without separately setting up provider access, with suitable models selected by a Situate-operated router                              | Model selection and quality criteria, quotas, overages, data processing, pricing, and service commitments       |

Official synchronization must use end-to-end encryption so that Situate as operator cannot decrypt synchronized user content. Device authorization uses an existing authorized device or a user-held account recovery key; the cryptographic protocols remain to be designed. Operational AI settings and credentials remain local to each workspace and device and are never synchronized. Locally stored content must remain readable and manually editable without internet or AI; offline edits are retained for later synchronization. Git merge conflicts pause synchronization for the affected workspace until the user resolves them, without blocking local editing or other workspaces.

Situate-operated services must be hosted in the EU, with Germany preferred. The managed AI router may process content authorized for the relevant user request in plaintext, separately from the synchronization service. Managed AI providers may process outside the EU when legal prerequisites are met, but supplied content must not be used for model training. These managed-service guarantees do not extend to providers users independently connect; Situate remains responsible for its own transmission and credential handling.

Managed AI access remains an alternative to [user-provided models](../requirements/data/requirements/REQ-0015-connect-user-provided-models.md), not a replacement. Unlimited usage is not promised. See the requirements for [synchronization](../requirements/data/requirements/REQ-0013-synchronization-service.md) and [managed AI](../requirements/data/requirements/REQ-0016-managed-ai-access.md).

## Open-source direction

The intended direction is public development of the application, server implementations, and supporting documentation under open-source terms. Openness should support inspection, continuity, and trust rather than serve as a promise of automatic growth or community funding.

Original software and documentation use MIT; original artwork uses CC BY 4.0. The [licensing guide](../LICENSING.md) defines the scope and third-party exceptions. The [trademark policy](../TRADEMARKS.md) distinguishes official offerings from independent ones without restricting code reuse or ordinary artistic reuse. Competing products, proprietary derivatives and independent hosting are permitted under the applicable licenses.

The business should earn revenue from convenient, reliable services rather than making local data inaccessible. The [local availability](../requirements/data/requirements/REQ-0008-local-content-availability.md) and [data reuse](../requirements/data/requirements/REQ-0009-reuse-stored-content.md) requirements apply independently of paid services.

## Questions to validate

These are business risks and research questions, not established demand or pricing evidence:

- Do users gain enough recurring value to keep using Situate?
- How many active users need multiple devices and prefer the official synchronization service to self-managed alternatives?
- How many prefer managed AI access to their own provider setup?
- Can subscriptions cover infrastructure, model usage, payment costs, support, and ongoing development? Heavy AI users may make a flat allowance unprofitable.
- Does openness improve trust and adoption among the intended audience, and does that translate into paid use rather than downloads alone?
- Can onboarding, reliable operation, and support distinguish the official services from competing providers?

Prices, conversion rates, retention targets, and contribution margins need evidence. Competitor prices and broad AI adoption do not establish willingness to pay for Situate.

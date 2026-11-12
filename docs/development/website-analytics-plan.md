# Website analytics plan

Status: browser integration and project basics are configured. Incoming-event validation and conversion views remain pending.

## Goal and scope

Use PostHog to answer three questions about the public website:

- How many measured visitors arrive, which pages do they read, and where do they come from?
- How many click the available macOS download?
- How many open the platform waitlist and receive a successful form response?

This is visitor analytics, not uptime monitoring. It does not add app telemetry, crash reporting, server logs, download-transfer counting or updater tracking.

## Starting point

The [website](../../website/README.md) is static HTML and JavaScript with an optional, locally bundled PostHog SDK. The macOS download uses a validated release descriptor. The optional EmailOctopus waitlist exposes a form-success callback. The [privacy notice](../../website/legal/messages.en.json) describes analytics as conditional on configuration and consent.

The earlier prototype combined consented browser events, custom visitor/session management, campaign attribution, section/FAQ/video tracking, server-side download events and separate app analytics in one PostHog project. Its implementation is historical reference, not a component to copy wholesale; see the [prototype handover](../prototype-handover.md).

Reuse the consent-first approach and explicit interaction events. Do not restore the custom session manager, direct capture transport, server counter or dashboard-management framework.

## Account and old data

Use the fresh PostHog EU account and its single project, **Situate**. The project serves the website now and can accommodate separately scoped product analytics later; this does not enable application telemetry.

The project uses Europe/Berlin time, Monday as the start of the week, IP anonymization and disabled automatic capture, replay, heatmaps, surveys, console, exception and performance collection. The three custom website event names are registered as unverified definitions. Definitions alone do not establish that events have been received or that ingestion works.

Keep the personal API key private in the repository-root `.env`. Only the public project token belongs in website build configuration. An explicitly set environment value takes precedence over `.env`, including an empty value; CI does not read `.env`.

The legacy account is separate. Do not copy its events, profiles, recordings or dashboards into the new project. Its data remains untouched by this setup. Any later legacy-data deletion requires verification of that account and exact project ID, active ingestion sources and the provider's deletion process. Renaming or hiding events is not data erasure.

The project retains analytics events for one year, with expired events deleted at PostHog's next monthly cleanup. The processor agreement incorporates EU Standard Contractual Clauses (Module 2) and permits processing outside the EEA, including in the United States. EU hosting is not an EU-only processing guarantee. Recheck the privacy notice when retention or processor terms change. No paid subscription, extra project or legacy deletion is part of the account setup.

## Initial event set

Track the landing page, product tour and legal pages. Use only these four events:

| Event                      | Trigger                                                                                                             | Additional properties                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `$pageview`                | One view of the current page after analytics consent; subsequent page navigation/restoration follows the same rule. | None beyond the shared properties.       |
| `download_clicked`         | Activation of the enabled, validated macOS artifact link, not navigation to the download section.                   | `platform: macos`, descriptor `version`. |
| `waitlist_form_opened`     | The visitor chooses **Open sign-up form**, once per opening attempt.                                                | None.                                    |
| `waitlist_signup_reported` | The existing handler accepts the matching EmailOctopus form-success callback, once for that submission.             | None.                                    |

Shared properties: canonical page path, `surface: website`, `environment: production`, a random SDK browser identifier, page-scoped SDK session identifier, coarse device category and referring hostname. Campaign attribution may include only explicitly approved `utm_source`, `utm_medium` and `utm_campaign` values; unknown values are omitted. Do not persist a custom campaign journey across pages.

Do not transmit email addresses, form fields, beta preferences, DOM text, arbitrary link destinations, full referrer URLs, URL queries/fragments or application identifiers. Omit IP-derived location and configure IP anonymization; PostHog still receives network connection information when the browser contacts it. Pseudonymous browser identifiers are not anonymous people.

A download click does not prove a completed transfer or installation. A successful form response does not prove email delivery, a new unique subscriber or double-opt-in confirmation. EmailOctopus remains the source for confirmed subscriptions; joining the waitlist never depends on accepting analytics.

## Integration and consent

- Add one small website analytics adapter using the official JavaScript SDK. Pin a reviewed SDK version and serve its browser bundle locally with required license notices. Use SDK identity/session handling rather than implementing it again. Keep SDK state in memory and persist only its generated browser ID: browser-storage modes otherwise retain raw entry/referrer URLs even when attribution is disabled. SDK sessions are page-scoped, so session metrics do not describe cross-page visits. No new service, reverse proxy, database, framework or general event bus.
- Load and initialize the SDK only on the canonical production origin and only after explicit analytics consent. Local development and the public preview send nothing to production PostHog; browser tests intercept requests with synthetic fixtures.
- Disable automatic pageviews and emit the single explicit `$pageview` above. Disable autocapture, page-leave collection, session replay, heatmaps, surveys, feature-flag requests, console collection, exception capture and web-vitals collection. Keep these restrictions in client configuration as well as applicable project settings.
- Present an accessible analytics choice with equally available accept/decline actions and a footer control to change it. No preselection or blocked site functionality. Reuse canonical brand components and keep all visible text in the website localization catalogs.
- Use a new, versioned consent key; do not treat the prototype's stored consent as permission for the replacement. Before consent, store no analytics identifiers and make no PostHog requests. Store only the preference needed to remember a decision.
- On withdrawal, block capture immediately, discard pending events, clear analytics identity/session storage and synchronize the decision across open tabs. Do not send a withdrawal event. Withdrawal does not itself erase events already held by PostHog.
- If consent storage fails, keep analytics off. SDK failures, blocked requests and missing configuration must not affect navigation, form submission or downloads. Never replay actions performed before consent.
- Restrict outgoing events and properties with an allowlist. Prevent automatic SDK attribution from retaining raw URLs; sanitize transmitted URL/referrer fields before dispatch. Verify the actual SDK payload rather than assuming custom properties replace its defaults.
- Include only the public project token and EU ingestion host in browser configuration. Personal API keys never enter website files or build output. Use existing supported environment/build configuration, not automatic secret-manager access.

## Views in PostHog

Start with native Web Analytics for measured visitors, pageviews, top pages and referring sources. Add one small **Website conversions** dashboard containing:

1. Download-click count and a `$pageview` → `download_clicked` funnel.
2. Waitlist-opening count and a `$pageview` → `waitlist_form_opened` → `waitlist_signup_reported` funnel.

Use a rolling 28-day range, Europe/Berlin timezone, production website filters and a same-page SDK session, 30-minute conversion window. Both conversion actions occur on the landing page; do not interpret these page-scoped sessions as cross-page visits. Label counts as events and funnels as distinct browser identifiers, not people. Both numerator and denominator are consented browser activity; never divide by unrelated server totals. Do not claim bounce rate or visit duration without the events those measures require. Missing instrumentation is not a measured zero.

Use native insights, not custom SQL or a dashboard provisioning subsystem. Verify schemas and controlled test events before saving insights. Keep test traffic out of production reports.

## Implementation and release sequence

1. Verify access to the fresh Situate project. Confirm the actual event retention available on the selected plan, consent lifetime, processor agreement and applicable transfer safeguards before publication; do not promise an unconfigured retention period.
2. Implement the adapter and consent controls in `website/`, integrate download and accepted form-success handlers, and include assets in `website/site.mjs`. Keep shared header/footer rendering and legal-page rendering aligned.
3. Update the CSP in `website/site.mjs`, `infrastructure/production/docker/nginx.conf` and `infrastructure/website/docker/nginx.conf` for only the required EU ingestion origin. Local SDK assets should not require a remote script origin. Preserve unrelated form-provider policies. Narrow any blanket no-PostHog assertion to permit website ingestion configuration without permitting server download tracking.
4. Update `website/legal/messages.en.json`, `website/legal/pages.json` as needed, `website/legal/review.md`, and usage documentation made inaccurate by activation. Cover purpose, consent/withdrawal, recipient, actual storage/retention and pseudonymous identifiers. Existing download/updater endpoints remain free of counters and tracking identifiers.
5. Add focused unit and browser tests, then run affected repository checks and a static build. Use synthetic provider responses; do not create real subscribers or analytics traffic during automated tests.
6. With separate approval, activate production configuration and verify a controlled consented visit, download click and approved waitlist test. Create the small dashboard only in the verified Situate project once event schemas and required property values are available. Legacy-account changes remain separate.

Verification must cover no requests/identifiers before consent or after decline, new consent despite legacy storage, blocked storage, withdrawal with a pending SDK load or queued events, cross-tab withdrawal, no pre-consent replay, pageview deduplication, disabled downloads, rejected/unrelated/duplicate form callbacks, URL/property redaction, preview isolation, CSP and blocked-network behavior. Build output must contain no personal API key or private configuration.

For rollback, disable website capture/configuration and redeploy the static website. Keep the consent control available to withdraw and clear stored identifiers. Do not restore the legacy counter or old project token. Delete unintended new data only under a separately verified deletion scope.

## References

- [PostHog project isolation and limits](https://posthog.com/docs/settings/projects)
- [JavaScript SDK configuration](https://posthog.com/docs/libraries/js/config)
- [Collection and consent controls](https://posthog.com/docs/privacy/data-collection)
- [Storage and deletion controls](https://posthog.com/docs/privacy/data-storage#data-deletion)
- [Event retention](https://posthog.com/docs/data/events-retention)

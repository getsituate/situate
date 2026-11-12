# Legal content review

## Scope and operator

The notices cover `getsituate.com`, the preview at `reboot.getsituate.com`, direct macOS delivery and the macOS/iOS client. [messages.en.json](messages.en.json) contains the wording; [pages.json](pages.json) defines sections and links. Source evidence does not establish independent legal review, account-specific agreements or live distribution availability.

Marcus Held remains the operator and contracting party for the existing services. Operator particulars come from the published [legal notice](https://getsituate.com/legal-notice.html); no company entity, register entry or data-protection officer is inferred from the brand. Contact uses the existing Google Workspace mailbox and telephone, without a separate ticketing or support platform.

The new notice does not describe earlier prototype apps. Preserve versioned notices for earlier releases. Do not link to `getsituate.com/privacy.html` as a legacy archive: after cutover it serves the new notice.

## Website and delivery evidence

- Hosting retains the existing Hetzner host in Nuremberg. HCP stores infrastructure state, not visitor or app content.
- Static Nginx access logs and download tracking are disabled. Warning-level errors and connection data may still be processed. Production and shared-edge container logs rotate at three files of 10 MiB; the updater test feed uses two files of 1 MiB. See the [production configuration](../../infrastructure/production/README.md).
- The host's authentication-log configuration uses weekly rotation with four rotations, compression and delayed compression. This is not guaranteed deletion after a fixed number of days. Effective system-journal and provider retention are not established here.
- PostHog Cloud EU analytics is gated by a public project token, the exact production origin and a 180-day consent preference. It measures four explicit browser events, without form contents, session replay or application telemetry. The Situate project uses IP anonymization and one-year event retention; expired events are removed at PostHog's next monthly cleanup. The executed processor agreement incorporates EU Standard Contractual Clauses (Module 2) and permits processing outside the EEA, including in the United States. EU hosting is not an EU-only processing guarantee. Subprocessors and processing locations are listed in [PostHog's public subprocessor list](https://posthog.com/subprocessors). Recheck disclosures when account settings or processor terms change.
- The optional EmailOctopus form loads on request and contacts EmailOctopus and Google, including reCAPTCHA and form fonts. Its availability and subscription consent are independent of analytics. A successful form callback is not double-opt-in confirmation. Existing subscribers do not acquire beta interest by default.
- Website downloads use same-origin metadata. Direct macOS updates contact the configured feed and download signed artifacts; signing does not eliminate connection-data processing. Apple manages iOS installation and updates. Disclosures must match the released channels and actual availability.

## Client processing evidence

- Workspaces, Git history, conversations, checkpoints and drafts can retain content locally. Removing a workspace from the list does not delete its files; there is no secure-erasure or uninstall-cleanup promise.
- AI credentials and operational settings are device-local, separate from workspace synchronization. Provider authentication and operating-system credential storage have their own boundaries.
- Provider requests can include conversation history, files, tool results and activity context, not only the latest message. OpenAI, Anthropic, OpenRouter and compatible endpoints are implemented; Codex uses a separate ChatGPT backend. OpenRouter can route to downstream providers. Custom endpoints can be local/LAN or acknowledged HTTP.
- Remote images and tools can contact other services or access additional files. Do not describe the application as a filesystem or network sandbox.
- Local diagnostics use a 256 MiB logical budget, 4 MiB segments and eviction. Pseudonymous device/workspace/session identifiers are not anonymous. No Situate-operated automatic usage/crash upload was identified; voluntary sharing and OS/store reports are separate.
- Official synchronization, dictation and managed AI are unavailable. Workshop/plugin work does not establish a released marketplace. See [provider qualification](../../docs/development/provider-qualification.md) for source-versus-release evidence limits.

## Publication accuracy

Keep the notices aligned with enabled services, released binaries and actual requests. Preserve purpose-specific legal-basis and retention distinctions. User configuration is not blanket consent; public provider policies do not establish executed contracts, transfer safeguards, EU-only processing, no-training or zero-retention guarantees. Do not invent retention periods or additional recipients. No independent legal review is recorded here.

# Security policy

## Report a vulnerability

Report suspected security vulnerabilities through [GitHub private vulnerability reporting](https://github.com/getsituate/situate/security/advisories/new). Reports are not public. If you cannot use GitHub, email [marcus.held@getsituate.com](mailto:marcus.held@getsituate.com).

Marcus Held handles security reports. Do not disclose vulnerability details in public issues, pull requests or discussions.

Include what you can:

- The affected app version, operating system and distribution channel (macOS release or iOS TestFlight).
- The potential security impact and any prerequisites for exploiting the issue.
- Reproduction steps or a minimal proof of concept, preferably using synthetic data.

Do not include credentials, private workspaces or other personal data. You do not need a complete exploit to report a suspected vulnerability.

Use [GitHub issues](https://github.com/getsituate/situate/issues) for ordinary bugs without a security impact. If you are unsure whether an issue affects security, report it privately first.

## Exposed credentials

If credentials are exposed, revoke or rotate them immediately if you control them. Otherwise, notify their owner through a confidential channel. Report exposures affecting Situate through the private channels above, identifying the location without copying the secret value. Deleting an exposed value from a file does not remove it from Git history or invalidate it.

## Versions receiving security fixes

The macOS app is publicly released. The iOS app is available through TestFlight and is not yet publicly released. We accept security reports for both.

Security fixes are delivered in the latest macOS release or a new iOS TestFlight build. We do not promise backports to older versions. Windows, Linux desktop and Android are deferred product targets, not supported releases.

## Response and disclosure

We do not guarantee response or resolution times. We will coordinate publication of vulnerability details with the reporter, considering the issue's impact and the availability of a fix. Please keep details private while we assess the report and agree on disclosure.

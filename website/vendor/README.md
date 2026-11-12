# PostHog browser SDK

`posthog-1.447.4.min.js` is the unmodified `dist/array.js` from `posthog-js@1.447.4`. It is loaded locally after analytics consent. External extension loading is disabled by the website adapter.

- Package: https://registry.npmjs.org/posthog-js/-/posthog-js-1.447.4.tgz
- Package integrity: `sha512-TZnQXMpBuOOhH1j7F9BcbTJ9HFTE9uStLeahYeR8C2ZhiqzbX15Eaqln16xVbEC+Fa9g+vSXtt+uhS2V/CyfTQ==`
- Bundle SHA-256: `a35c138863f5b54ce2e5fdfcf03800c564014a42d2d4abdee33930d30b1b1fbd`
- License SHA-256: `d3fb92ac01f0bef4078f89aac9f20f76da3383ad45becf6204abdf5495f43f8f`
- Upstream: https://github.com/PostHog/posthog-js

`posthog-LICENSE.txt` preserves the package's complete Apache-2.0 and MIT terms and third-party notices. Both the bundle and license are included in static output. These terms do not license Situate's other code or assets.

For an upgrade, obtain the package with the repository-pinned npm, verify its integrity and licensing, replace the unmodified bundle and license, update the version and hashes here and in the adapter/asset tests, and run website unit/browser checks. The adapter uses in-memory SDK persistence and stores only the SDK-generated browser ID itself: the public attribution controls do not prevent raw entry/referrer URLs from being persisted by the SDK’s browser-storage modes. SDK sessions are therefore page-scoped. The browser checks use this actual bundle, not an SDK mock, and must continue to verify consent, payload redaction, storage and withdrawal.

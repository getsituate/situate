# PostHog browser SDK

`posthog-1.447.4.min.js` is the unmodified `dist/array.js` from `posthog-js@1.447.4`. `posthog-web-vitals-1.447.4.min.js` is the unmodified `dist/web-vitals.js` from the same package. Both scripts load locally after analytics consent. The SDK cannot load external extensions.

- Package: https://registry.npmjs.org/posthog-js/-/posthog-js-1.447.4.tgz
- Package integrity: `sha512-TZnQXMpBuOOhH1j7F9BcbTJ9HFTE9uStLeahYeR8C2ZhiqzbX15Eaqln16xVbEC+Fa9g+vSXtt+uhS2V/CyfTQ==`
- Bundle SHA-256: `a35c138863f5b54ce2e5fdfcf03800c564014a42d2d4abdee33930d30b1b1fbd`
- Web Vitals extension SHA-256: `3c6ab8a4e21f4d7c63d523109e480930845952e816dd27d4a0bbf215865f107e`
- License SHA-256: `d3fb92ac01f0bef4078f89aac9f20f76da3383ad45becf6204abdf5495f43f8f`
- Upstream: https://github.com/PostHog/posthog-js

`posthog-LICENSE.txt` preserves the package's complete Apache-2.0 and MIT terms and third-party notices. `web-vitals-LICENSE.txt` preserves the Apache 2.0 terms from [web-vitals 6.2.1](https://registry.npmjs.org/web-vitals/-/web-vitals-6.2.1.tgz), which is bundled into the performance extension. Its SHA-256 is `bfdeded4040e05da31ca9b6239dc83bd23fa26ac8db87342a7ca4363f68916ff`. The scripts and licenses are included in static output. These terms do not license Situate's other code or assets.

For an upgrade, obtain the package with the repository-pinned npm, verify its integrity and licensing, replace the unmodified scripts and their licenses, update the versions and hashes here and in the adapter and asset tests, and run the website unit and browser checks. The browser checks use these scripts, not an SDK mock.

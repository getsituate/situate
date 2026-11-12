# Situate website

The landing page introduces Situate through personal notes, tasks and documents supporting a project. Its illustrated examples describe product direction, not live application workflows or evidence of feature availability.

## Preview

From the repository root, with Node.js 24 or newer:

```sh
node website/site.mjs
```

Open `http://127.0.0.1:4173/` for the landing page or `http://127.0.0.1:4173/product.html` for the product tour. Legal pages are available at `/legal-notice.html` and `/privacy.html`, linked from every page's footer. The preview redirects the previous `/system/` URL to `/`.

Set `PORT` to use a different local port. The server binds only to `127.0.0.1` and serves the website and approved brand asset paths, not arbitrary repository files. No app account or AI execution is connected. Optional consented PostHog analytics runs only on the exact production origin when configured; loopback and public previews do not send analytics. The optional platform waitlist loads EmailOctopus and Google services only after the visitor chooses **Open sign-up form**; it can submit real subscription requests.

For a freshly built preview, use **Build & open website** (`v`) in `./dev.sh`. This builds `website/dist`, serves those generated files on a free loopback port, and opens the browser after the server is ready. Stop the preview from the console; rerun it to rebuild after changes. No client dependency installation or deployment is involved.

The server-only equivalent is:

```sh
node website/site.mjs --build --serve
```

This prints the local URL and keeps serving until stopped. It chooses an available port independently of `PORT`; it does not open a browser on its own. Root-relative asset and navigation URLs require HTTP serving rather than opening `website/dist/index.html` as a local file.

## Content and assets

`index.html` defines the landing page; `product.html` and `product.css` define the product tour. Both use `styles.css`, `script.js` and the flat `messages.en.json` catalog. Templates use `{{key}}` placeholders, escaped when served or built. Keep visible text and accessible labels in the catalog; dynamic controls read translated labels from data attributes.

`components.mjs` owns the shared header/menu, footer and image viewer, including their link lists and accessible labels. `components.css` owns their desktop, mobile and print styles; shared labels remain in `messages.en.json`. The landing and product templates use `{{site.header}}`, `{{site.footer}}` and `{{site.viewer}}`; legal pages use the same header and footer. The `menuLinks` list contains page destinations; each entry uses a catalog key for its label. Both desktop and mobile navigation render that list and mark the current page. Section links stay within page content, while Download leads to the landing page’s download section. Reading progress appears on the landing and product pages. On small screens, the full-width header keeps Download visible; the labeled Menu disclosure opens a full-width, scrollable list. The menu works without JavaScript; `navigation.js` adds dismissal on link selection, outside clicks, Escape and keyboard focus leaving the header.

`legal/pages.json` defines legal-page structure and anchors, while `legal/messages.en.json` supplies their wording. `legal/render.mjs` and `legal/styles.css` provide the reading layout without loading landing-page scripts. The ordinary preview and static build use the same rendering path. The catalogs, renderer and editorial review are not served or copied into static output. Review [legal publication blockers](legal/review.md) before deployment; including the pages in a build does not approve their content.

The page references the canonical [Situate brand](../design/brand/README.md) tokens, wordmark, Bend SVGs and original illustrations. It uses installed system fonts. The optional analytics SDK is served locally. See [asset provenance and rights](../design/brand/docs/provenance.md). The website does not grant additional license or redistribution rights.

Downloads use platform names without logos. Platform artwork in `media/platforms/` retains its [source and rights records](media/platforms/provenance.json) and [legal attribution](/legal-notice.html#icon-credits).

Hero motion is finite and optional. Both pages support native scrolling, live reduced-motion preferences, an expandable image viewer and readable HTML without JavaScript. The landing page has a replayable opening, scroll-linked screen changes and a continuously scrolling ribbon. The product tour uses finite section entrances and a keyboard-operable gallery; without JavaScript, all three gallery panels remain visible. The ribbon pauses outside the viewport, while the page is hidden and while the image viewer is open. Reduced motion and no-JavaScript views show the ribbon text without movement or clipping. Its screenshots come from the independent Vue design workshop. All example content is synthetic.

### Workshop captures

`media/manifest.json` records each capture’s starting state, viewport, dimensions, hash, provenance and limitations. The images are interface previews, not evidence of shipped features, provider qualification or native-device behavior. The provider icons retain their [MIT notice](media/provider-icons-license.txt), which is included in static output.

To regenerate the set, install the existing client dependencies, Google Chrome and the `cwebp` command, then run:

```sh
node website/capture-workshop.mjs
```

The script opens its own ephemeral-port workshop server, supplies `media/birthday-fixture.json` through the workshop’s simulation, transport and conversation props, and closes the browser and server afterward. It replaces the captures and manifest. It does not use personal workspaces, real AI, DOM text replacements or controls-window overlays. Browser and font differences can change rasterization.

## Downloads

The main hero action leads to the illustrated example at `#story`. The workspace overview and shared navigation link to `/product.html`. Download actions from either page lead to the landing page’s `#download` section.

`download.js` highlights the visitor’s platform using browser-provided system information, including iPadOS desktop browsing. Other platforms remain in a compact list with their download or waitlist action. Unknown systems and visitors without JavaScript see a neutral list of all five platforms. Detection does not fetch additional information, store a preference, start a download or select a waitlist subscription.

The macOS download control starts disabled. `download.js` requests `/releases/current/download.json` without caching, credentials or a referrer and enables the link only after validating the direct-release descriptor. Missing, paused or invalid metadata leaves it unavailable; restoring a page from browser history revalidates it. Without JavaScript, the availability message remains readable and the control stays disabled. Windows, Linux, iOS and Android link to one waitlist; each link adds that platform to the selection without loading third-party services.

The descriptor supplies `version` (SemVer), `url`, `sha256` (64 hexadecimal characters), `size` (positive safe-integer bytes), `minimumSystemVersion`, `architecture` (`universal`, `aarch64` or `x86_64`) and `distribution: "direct"`. Additional fields are ignored. The URL must be an exact HTTPS `<release-origin>/releases/<version>/<artifact>.dmg` URL, without credentials, port, query, fragment or nested paths. The release origin is `https://getsituate.com`, except on `https://reboot.getsituate.com`, which accepts only its own preview-origin artifacts. The page displays the declared version, minimum macOS version and architecture without guessing the visitor’s hardware.

Descriptor validation is not browser verification of the DMG bytes or Apple signatures; the publisher must verify artifacts before activating the coherent website/updater metadata. The download validator retains preview-origin isolation for test fixtures; public preview hosting is retired, and `reboot.getsituate.com` redirects to production. Mutable metadata must use no-store/revalidation; versioned artifact bytes are immutable. Pausing delivery should return an unavailable HTTP response rather than an older release. Artifact requests bypass the legacy download counter and carry no download IDs or analytics. Consented website analytics measures link clicks separately, not transfer completion or installation.

Before publication, verify the advertised capabilities, platforms, service availability, pricing, source release and licensing. The copy does not establish present availability or grant a project license.

## Platform waitlist

`platform-waitlist.js` loads the shared EmailOctopus form after the visitor requests it. The form currently uses field 3 for Windows, Linux, iOS and Android (multiple choice, values 1–4), and field 4 for optional beta interest (single choice, yes=1/no=2). At least one platform must be chosen before submission. No beta choice is selected by the website.

The adapter waits for both choice components and reCAPTCHA, validates the field mapping, and applies pending selections through the provider's controls. Renaming, reordering or changing these fields requires reviewing the adapter and tests. Form-load failures offer a contact fallback; uncertain submission outcomes do not trigger automatic retries. New subscriptions require confirmation in EmailOctopus; browser success is not proof of email delivery or confirmation. Verify the list's double-opt-in, existing-contact update and suppression behavior before publication. This form is also used by the legacy website, so provider-side changes affect both.

Provider scripts, fonts and branding are remote, not redistributed in the build. Preview, built-preview and Nginx policies permit their specific origins without allowing inline scripts or native form navigation. Keep these policies aligned when the embed's dependencies change. The browser suite intercepts provider requests with synthetic fixtures and never adds subscribers; live delivery and unsubscribe checks require a separately approved test address.

## Website analytics

The static build consumes only `WEBSITE_POSTHOG_TOKEN` for analytics. Set it to the **Situate project's public project token**, not a personal API key or the prototype token. Explicit environment values take precedence, including an empty value that disables analytics. Outside CI, an unset variable falls back to the private repository-root `.env`, parsed as data and required to be a regular owner-only file (`0600`). CI uses environment values only. Missing configuration disables analytics; malformed nonempty tokens fail the build without printing their contents. The PostHog CLI credentials in `.env` are not website build inputs and never enter browser configuration.

The build emits `analytics-config.js` containing only that public token. The SDK loads only after explicit consent on `https://getsituate.com`; source preview always emits empty configuration. Preview deployments, loopback servers and other origins never send production analytics. The footer’s **Analytics preferences** control remains available after accepting or declining, including on local previews and when analytics is not configured. Open it locally to test the controls without loading PostHog. Rebuild to change or remove configuration. Do not activate it until the project, retention, processor agreement and applicable transfer safeguards are verified and the privacy notice states them.

`analytics.js` collects only `$pageview`, `download_clicked`, `waitlist_form_opened` and `waitlist_signup_reported`. The latter is a provider-reported form result, not confirmed subscription. Analytics consent is independent of form loading and subscription consent. Preferences expire after 180 days; the footer control permits withdrawal and clears analytics identifiers where storage is accessible. Re-enabling after an initialized SDK was stopped reloads the page. Already dispatched requests cannot be recalled.

Autocapture, page-leave events, replay, heatmaps, exceptions, console logs, flags and web vitals are disabled. The outgoing property allowlist omits raw URLs, query strings, fragments, campaign parameters, email addresses and form contents. Only the SDK-generated browser ID is persisted; SDK state stays in memory to avoid persisting raw attribution URLs. SDK sessions are page-scoped, not cross-page visits. Browser and session IDs remain pseudonymous. Native Web Analytics can show visitors, pages and referring domains; do not interpret unsupported duration/bounce metrics as qualified measurements. See the [conversion definitions and account cutover](../docs/development/website-analytics-plan.md).

The unmodified SDK bundle and its notices are vendored in `vendor/`; [provenance](vendor/README.md) records the pinned package and hashes. Builds require no analytics package installation or remote asset download.

## Deployment

See [production deployment](../infrastructure/production/README.md#production-services-and-traffic-activation) for website publication and SSH configuration. The [former public preview](../infrastructure/website/README.md) is retired and redirects to production.

## Checks and static output

```sh
node --test website/site.test.mjs website/download.test.mjs
node website/browser.test.mjs
node website/site.mjs --build
```

The browser check includes navigation between the landing page, product tour and legal pages, the product gallery and image viewer, narrow-screen reflow, keyboard access, reduced motion and no-JavaScript rendering. Legal-page checks also cover print output. Run `node website/legal/browser.test.mjs` for those checks alone. The browser check requires the client’s installed Playwright package and Google Chrome. `WEBSITE_PLAYWRIGHT_MODULE` can point to another existing Playwright installation; `WEBSITE_BROWSER_CHANNEL` selects an installed browser channel. It does not download browsers. Screenshots go to a temporary directory, or to `WEBSITE_SCREENSHOTS` when set. These are review images, not product visual-regression references or native-device qualification.

The repository test runner includes website contracts in `design-unit` and the browser check in `design-website-browser`.

The build writes the localized landing page and its assets to the ignored `website/dist/` directory. Its `index.html` is the site entry point; `product.html`, `legal-notice.html` and `privacy.html` are standalone pages with the same navigation. Rebuilding removes the former comparison stylesheet and variant directories from reused output folders. Serve that directory at an origin root because asset URLs are root-relative. The page retains `noindex, nofollow`; a build does not publish it or establish that its product claims are ready for publication.

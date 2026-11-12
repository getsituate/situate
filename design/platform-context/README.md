# Platform profiles

App screens are reviewed in the [Vue design workshop](../../docs/development/design-workshop.md). Its separate controls window selects a platform profile, content size and keyboard occlusion. The preview uses independent workshop Vue views and the current host's native window decoration; it does not embed an illustrated titlebar or phone.

- [Profile data and content geometry](../../client/workshop/src/workshop/platform/model.ts)
- [Environment controls](../../client/workshop/src/workshop/platform/EnvironmentControls.vue)
- [Preview environment](../../client/workshop/src/workshop/platform/PreviewEnvironment.vue)
- [Platform guidance](platform-guidance.md): ownership, source references, assumptions and native verification questions

The active MVP review targets are macOS and iOS. Windows, Linux desktop and Android are deferred; their retained profiles do not need routine design or compatibility verification. Profiles still cover macOS, Windows 11, Linux with KDE Plasma 6 / Breeze, iOS and Android. They are selected layout assumptions, not emulators or support commitments. Desktop controls still belong to the OS running the workshop. Mobile profiles reserve content space for safe areas and, during text entry, a keyboard. These changes retain the view and its draft rather than replacing the screen.

Inspect the same scenario at normal and constrained dimensions. Check dialogs, focused fields, scrolling and action reachability under occlusion. Confirm actual platform fonts, native caption behavior, inset delivery, keyboards and assistive technology on the intended device or runtime.

The profile data and Vue components are original project work. They reuse the canonical Situate tokens; no third-party device artwork, screenshots, icons or font binaries are bundled. Existing [brand provenance](../brand/docs/provenance.md) and [repository licensing status](../../README.md#license) remain applicable.

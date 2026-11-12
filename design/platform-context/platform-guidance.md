# Platform context: ownership and evidence

The [Vue design workshop](../../docs/development/design-workshop.md) provides content-size profiles and simulated mobile safe areas and keyboard occlusion. Native window decorations belong to the host. Supported OS versions remain a product decision under [REQ-0012](../../requirements/data/requirements/REQ-0012-platform-availability.md).

## Ownership

- **System/window manager:** caption controls, resize borders, status bars, display cutouts, gesture areas and software keyboards. The workshop does not draw or emulate them.
- **App:** content, navigation, fields, toolbar actions and scroll regions. Essential content and hit targets must stay within the available content rectangle.
- **Workshop:** synthetic data, platform selection, target dimensions and occlusion controls in a separate window. These are not product controls or native platform measurements.

A background may extend beneath system overlays without owning them. Browser CSS dimensions do not prove native display density, safe areas or input behavior.

## Desktop profiles

macOS, Windows 11 and Linux · KDE Plasma 6 / Breeze use a 1040 × 700 CSS-pixel content target. They do not insert a simulated titlebar. Selecting Windows or KDE on macOS does not change the actual native decoration or WebView engine.

- [Apple HIG: Windows](https://developer.apple.com/design/human-interface-guidelines/windows) describes the frame/body boundary and system-provided window controls. [Tauri window customization](https://v2.tauri.app/learn/window-customization/) distinguishes native decoration and custom titlebars. Verify content dimensions, hit testing, traffic-light clearance, double-click preferences and accessibility in the native host.
- [Microsoft: Title bar design](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design) describes identification, dragging, caption controls and scaling. Verify Snap support, system-menu behavior, touch/pen input and high contrast on Windows, rather than inferring them from a resized macOS window.
- [KDE: Window Decorations](https://docs.kde.org/stable_kf6/en/kwin/kcontrol/kwindecoration/index.html) documents configurable decorations and button placement. [KDE HIG](https://develop.kde.org/hig/) is not a universal Linux geometry contract. Verify decoration ownership, scaling and resize behavior under the supported compositor and Wayland/X11 backend.

## Mobile profiles

The following are layout assumptions, not device specifications:

| Profile | Target    | Top clearance | Bottom clearance | Additional keyboard occlusion |
| ------- | --------- | ------------- | ---------------- | ----------------------------- |
| iOS     | 390 × 844 | 59            | 34               | 260                           |
| Android | 412 × 852 | 32            | 24               | 272                           |

All dimensions are CSS pixels. The workshop applies these insets to the actual preview content size, bounds them to the available height and keeps the app mounted during changes. Keyboard controls are available when the current scene contains editable content. Rotation swaps the requested window dimensions; it does not supply device-specific landscape geometry.

### iOS

[Apple HIG: Layout](https://developer.apple.com/design/human-interface-guidelines/layout) calls for adaptation to safe areas, cutouts, text size and device configuration. [UIKeyboardLayoutGuide](https://developer.apple.com/documentation/uikit/uikeyboardlayoutguide) describes native keyboard geometry, not a guarantee of equivalent WebView events.

Verify actual inset delivery, focused-field visibility, scroll reachability, interactive keyboard dismissal, external keyboards, Dynamic Type and VoiceOver. Storage display labels must remain separate from security-scoped handles and actual filesystem paths.

### Android

[Android: Edge-to-edge](https://developer.android.com/develop/ui/views/layout/edge-to-edge) distinguishes system bars, cutout and gesture insets. [Software keyboard guidance](https://developer.android.com/develop/ui/views/layout/sw-keyboard) describes IME visibility and insets.

Verify resize versus overlay behavior, gesture exclusion, Back precedence, TalkBack, large text, alternate IMEs and three-button navigation. Dismissing the keyboard is not workspace closure.

## Source material

The linked platform documentation guides ownership and verification; its code, screenshots, fonts and device assets are not bundled. UI Skills' [mobile-native guidance](https://www.ui-skills.com/skills/emilkowalski/mobile-native/llms.txt) also informs readable inputs and keyboard/safe-area checks. Browser/PWA advice does not replace Tauri integration or real-device testing. See [repository licensing status](../../README.md#license).

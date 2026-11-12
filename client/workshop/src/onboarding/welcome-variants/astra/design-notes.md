# The unfolding place

A finite welcome starts after **Create a workspace** in the normal workspace overview and leads directly to the creation form. It does not depict importing, loading or AI work. Workspace creation follows REQ-0045.

## Score

- **0–1.8 s — Open:** two oversized folded-paper planes open outward, revealing Bend in a close view. The ground reaches every edge of the content viewport.
- **1.8–3.6 s — Hello:** the camera eases back; Bend gives one articulated greeting. The opening planes become the edges of a larger paper world.
- **3.0–5.8 s — Connect:** an illustrated book opens, a task card turns into view and a document follows a broad connecting path. Each object gets its own beat rather than simultaneous confetti.
- **5.8–7.8 s — Make room:** the objects settle into an open composition. Bend presents the collection. A second, foreground fold passes below the character rather than across its face.
- **7.8–9.0 s — Resolve:** the framing folds withdraw and the collection eases lower, leaving the fixed wordmark and a short invitation in clear space.
- **9.0–10.6 s — Hold:** no movement. The paper ground and settled character lead into the quieter workspace explanation.

The remaining design question is whether the unfolding metaphor feels welcoming without delaying entry. Compare the complete sequence and immediate Skip, then ask a viewer what they expect to do next. This is a design hypothesis, not a user-research finding.

## Construction and references

Original vector objects and paper planes live in `WelcomeVariant.vue`. Bend geometry and its articulated rig, the wordmark and palette come only from the workshop-local brand snapshot. There are no downloaded assets, fonts or generated images.

The canonical brand illustration and performance guidance governs character geometry, palette and the quiet ending. UI Skills’ [motion-performance guidance](https://www.ui-skills.com/skills/ibelick/fixing-motion-performance) informed the single finite clock, suspension and avoidance of blur or per-frame layout measurement. [Claude motion design](https://github.com/howseen-ai/claude-motion-design) is a method reference for explicit acts and deterministic seeking, not a source of code or media.

## Integration

`WelcomeVariant.vue` accepts `paused` and optional `timeMs`. It emits `toggle` and emits `finished` once on natural completion, Skip, or reduced-motion bypass. A supplied time renders a deterministic frame without autonomous completion; explicit Skip still works. Reset by remounting with the parent scenario epoch. Parent owns navigation and paused state.

The host supplies a full-size container, without padding or a header. The variant owns its stable playback controls. Select `first-entry` in the workshop controls to review it; the shared frame inspector can hold any point in the score.

## Review

Start the workshop on port 1595, open `http://127.0.0.1:1595/?workshop=controls&scenario=first-entry`, then choose **Open preview**. The review-only hook accepts `astraTime=0` through `astraTime=10600` on the preview URL for held frames. Omit it for normal playback. Reset scenario starts a fresh sequence.

Run `node client/workshop/src/onboarding/welcome-variants/astra/inspect.mjs` against that server. `ASTRA_ORIGIN` can point at test port 1596; `ASTRA_PROOFS` chooses the screenshot directory, defaulting to `/tmp/situate-astra`. The script requires the local intro hook and existing Playwright browser installations. It checks Chromium and WebKit at 1280×900, 1440×900, 390×844 and 320×568, including natural completion into creation. Deterministic captures are separate from full elapsed-time playback.

Unit tests cover act boundaries, backwards seeking, the static final hold, single completion, pause, visibility, offscreen suspension, reduced motion, resize and cleanup. Browser checks cover target bounds, keyboard pause/resume/skip, offscreen suspension, reset, resize, reduced motion and console errors. The full workshop unit suite and design build are the integration checks.

The narrow composition uses smaller side objects rather than cropping the character or controls. A solid ground plane anchors Bend. The opening headline waits until the paper planes have cleared its reading area. The initial mobile wordmark stays in the clear center gutter.

Browser viewport profiles are composition checks, not native OS, safe-area or assistive-technology validation. Smoothness is not established by still screenshots or functional assertions; inspect the complete playback on the intended device. The creation form scrolls on small viewports.

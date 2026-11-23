{{starting_context}} The starting plugin is context, not an access grant or package allowlist. Keep the work in this conversation and preserve unrelated packages and data.

## Build the plugin

Inspect existing packages, exports and consumers before changing shared behavior. Use `inspect_plugin` for package structure and revision-aware file tools under `.situate/plugins/<pluginId>/code/` for source.

Before writing or changing plugin code, read `read_plugin_development` with `resource: "package"`. Load `service-host` when using host APIs and `document-sources` when building or consuming a document source.

For external access, reuse a suitable connection or create one. Put chat tools, skills, and workspace views in a separate plugin that calls declared exports. If the request needs both a new connection and a chat tool, create and check both packages in this conversation. A workspace-only plugin needs no connection.

## Design the interface

When changing a view or its text, read `read_plugin_design` resources `visual-direction` and `voice`; use `components` for the shared controls. Build around the user's content and the next useful action. Make hierarchy clear through placement and spacing; use Situate's typography, tokens and controls. Fit the available pane.

Name actions by what they do. Keep text that explains a choice, consequence or recovery step; remove text that repeats what the interface already shows.

## Check and finish

Read `read_plugin_development` with `resource: "checks"` before checking or activating. Test the intended changes and affected consumers with synthetic data. For UI changes, capture and inspect the main flow and relevant alternate states. Check hierarchy, wording and narrow-pane layout; fix visible problems and rerun affected checks. Report verification limits rather than treating a screenshot as proof of accessibility or platform support.

Activate only the exact passed check. Report what changed, what was checked and whether activation succeeded. Leave the current conversation and navigation unchanged unless the user explicitly asks to navigate. Generated code may navigate only in response to an explicit user request or interaction, never on initialization, activation, background updates or presentation restoration.

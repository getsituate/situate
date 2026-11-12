# Plugin design scenarios

## Review question

Can a person configure an extension, ask for an adaptation, and return to their ordinary work while still recognizing which development is running?

The local management and development scenarios explore REQ-0001, REQ-0032 and REQ-0033. Development carries a workspace-wide assignment; its connections, consumers and ordinary file edits remain in one conversation. All content, accounts, files and outcomes are synthetic. No agent, plugin or external service runs. See the [development review paths](../plugins/README.md).

## Interaction choices

- **Compact cards without individual icons:** name and status lead each card, followed by the description, relationships and actions. White surfaces, rounded edges and spacing separate entries without requiring plugin artwork. Bend and the lilac creation panel provide expression outside the collection. The illustrated comparison remains available through **Card appearance** in the controls. Compare recognition of named plugins and action discovery with the same content; neither layout has been validated with users.
- **Tools and connections on one page:** tools and connections use the same card widths, content order and action layout in separate sections. Section headings distinguish their roles. Bidirectional links show which tools reuse a connection. Account setup stays with the connection; account selection stays with each tool. This avoids treating a connection as either a duplicate tool or an invisible dependency.
- **A chat with a development context:** the shared chat header and composer retain familiar controls. A mode label and light lilac surface distinguish development. Compact headers stay on one row, replacing the visible mode label with its information button beside the title; the label remains available to assistive technology. Outcomes appear as replies, with earlier results retained during follow-up work. Messages, Activity and note-change cards use the normal chat transcript renderer. The Changes sidebar lists workspace-relative file paths and opens unified source diffs. Expanding it keeps the flat file list beside the selected diff. Search, paging and keyboard navigation support large change sets; unchanged context is expandable. It retains its selection, search and scroll position. Workspace browsing remains in the main Files feature; unavailable history never falls back to current contents. Escape closes the sidebar and returns focus to its toggle. Narrow containers show one pane at a time. The conversation list retains activity after the development view closes.
- **Retained development states rather than a close-time decision:** closing a view is navigation, not cancellation. Stopping work and removing pending code is a distinct confirmed action. It does not reverse ordinary workspace edits or active code. Storage information belongs with pending code, not in every conversation row.
- **Settings authored by a plugin, management owned by Situate:** disabling removes access to plugin settings but leaves the built-in status, development entry and instruction inspection available.

These are design proposals, not user-research findings. They do not settle production storage, grouped activation, attribution retention or recovery protocols.

## Plugin disabling dialog

Within **Plugins**, the `plugins-disable-waiting`, `plugins-disable-stopping`, `plugins-disable-error` and `plugins-disable-uncertain` starting states explore REQ-0032 AC-07–AC-10. The existing confirmation dialog stays open after confirmation. Its body changes to a short status message and the names of plugins with remaining work. The collection and its cards keep their existing appearance.

**Cancel disabling**, Escape and the close button cancel the waiting phase without stopping running work. **Abort now** requests a stop; it does not claim that work has already stopped or that external effects have been undone. During stopping or an uncertain outcome, **Close** dismisses only the dialog. The existing **Disable** action reopens it. A known failure allows retry or cancellation; an uncertain save requires **Check status** before restoring access or confirming success. Cancellation must distinguish waiting from a write already in progress; the workshop does not implement the native protocol or terminate plugin JavaScript.

Use the separate **Plugin disabling** controls while the dialog is visible to finish affected actions, fail before saving, lose save confirmation and resolve a status check. Reset discards the operation. Compare the dialog at desktop width and 390 px. Check whether someone can distinguish cancelling disabling from stopping running work without prompting. Browser walkthroughs are not a usability study or native macOS/iOS qualification.

## Walkthrough

1. Open **Plugins → Installed plugins** in the controls. Configure the weekly planning example, then disable its calendar dependency and inspect the affected plugins.
2. Start development of an existing plugin, or open `plugins-create`. Review a change, return to the change list, hide the sidebar, and send a request. Can the person recognize the development context and inspect a file without losing their draft? Close the view and find the working conversation again through navigation.
3. Use the separate controls to exercise checking, waiting for running actions, failure and successful adoption. No adoption button is required in the user interface.
4. Open an interrupted development, enter a continuation request, then inspect retained storage and discard a development. Reset the scenario and confirm that no earlier outcome remains.
5. In `plugins-connections`, follow Inbox to Gmail and then to Mail follow-up. Change one tool’s account choices and verify that the other’s choices remain intact. Add an account, exercise failure and retry, and confirm that neither tool selects the new account automatically.

The controls' actual scenario labels are authoritative. Platform profiles change simulated content geometry, safe areas and keyboard occlusion, not the operating system. Review at desktop width and a narrow phone width, including keyboard-open text entry. Check focus return after dialogs, reflow, status announcements and preservation of drafts during resizing.

## Design references

The illustrated comparison draws on [Bolder](https://www.ui-skills.com/skills/pbakaus/bolder): amplify the existing brand’s objects and type rather than adding effects or a new palette. The [voice guide](../../../../design/brand/docs/voice.md) takes precedence over external writing advice. Descriptions name the work a tool supports; actions stay literal. `PluginArtwork.vue` contains original decorative vector objects in workshop palette tokens. Bend uses the existing local brand snapshot, without animation.

UI Skills guidance used: [distill](https://www.ui-skills.com/skills/pbakaus/distill), [better-layout](https://www.ui-skills.com/skills/jakubkrehel/better-layout), [better-writing](https://www.ui-skills.com/skills/jakubkrehel/better-writing) and [fixing-accessibility](https://www.ui-skills.com/skills/ibelick/fixing-accessibility). These informed grouping, explicit state/action language and keyboard/dialog checks; the local Situate brand and Vue conventions take precedence.

Inspo’s captured [Fly.io](https://fly.io) illustrates the contrast between colorful objects and quiet text areas. Its large ribbon-led marketing composition is not used for this work surface; no external artwork or code is copied. This is a visual reference, not usability evidence.

Inspo's captured [Bolt](https://bolt.new) page was inspected as a reference for a clear development prompt. It is a landing-page reference, not evidence for application navigation or usability. Its dark hero, imagery, code and assets are not reused.

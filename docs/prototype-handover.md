# Product handover: Product and feature analysis of the Situate prototype

> Historical reference, translated from `second-brain/Prototype/PRODUKTUEBERGABE.md` in the source repository identified below. Source paths, line references, implementation findings, and test results describe that prototype investigation, not the current Situate repository. The cited source files are not part of this repository. For current product decisions, see the [product concept](product-concept.md), [positioning](positioning.md), and [requirements catalog](../requirements/README.md).

## 1. Provenance and strength of evidence

### Basis of the investigation

- **Repository:** “The Maybe Company”, a local Git repository in the `repository/` subdirectory.
- **Product:** **Situate**, previously described under the working title “Second Brain”.
- **Application:** `second-brain/Prototype/`.
- **Branch:** `main`.
- **Commit:** `53863aa6be03a1033d8da65801f84399799a5a0c` – `Track consented landing-page video engagement (#200)`.
- **Project configuration:** Version `0.5.0`, build `22`; macOS 14 or later, `arm64` architecture.
- Other existing worktrees were not used as a basis for the investigation.

**Existing local changes:** The embedded program `second-brain/Prototype/Embedded/PiBridge` had already been modified. There were also staged and untracked IDE files under `.idea/`. The Swift and TypeScript source files examined were unchanged relative to the commit. No product code was changed during the investigation.

**All statements below apply exclusively to this prototype.** They do not establish that the same features exist in the current main product.

### Scope of the investigation

The investigation covered repository instructions, product positioning, the older idea profile, application documentation, and central parts of:

- user interface and setup;
- chat, AI processing, and conversation storage;
- knowledge files, import, and file editing;
- plugin creation, activation, interfaces, and integrations;
- Apple integrations, dictation, and knowledge graph;
- tests, test interfaces, and demo data;
- data storage, permissions, and telemetry.

For central features, the path from the interface through the internal bridge to processing or storage was traced.

### Checks actually performed

Three focused Bun test runs were executed:

| Test group                                                 | Files under `second-brain/Prototype/PiBridge/`                                                                                           |    Result |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------: |
| Files, setup, graph, publication, and conversation storage | `brain-files.test.ts`, `onboarding-state.test.ts`, `knowledge-graph.test.ts`, `plugin-publication.test.ts`, `conversation-store.test.ts` | 40 passed |
| Plugin management and Apple adapters                       | `plugin-builder.test.ts`, `bundled-apple-plugins.test.ts`, `apple-notes.test.ts`                                                         | 45 passed |
| Conversation flows through a real bridge process           | `conversations-bridge.test.ts`                                                                                                           |  1 passed |

**Total: 86 tests passed, none failed.**

The strength of this evidence varies:

- File and registry tests used real temporary files.
- The bridge test started the real TypeScript bridge process but used a **local simulated AI service**.
- Graph tests replaced AI classification with controlled responses.
- Apple tests used simulated data and host responses. One test ran the JavaScript adapter through macOS `osascript` but explicitly replaced the connection to Apple Notes.

**Not executed:** the full Xcode test suite, GUI tests, application launch, real AI requests, OAuth sign-ins, web research, or actions in Apple or other user accounts. In particular, no real note, reminder, or calendar entry was changed.

**Important reproducibility limit:** `PiBridge/package.json` requires Pi packages at version `0.85.1`; the locally installed version was `0.84.3`. The successful tests apply to that existing environment. Consistency between the sources, dependencies, and modified embedded program was not checked through a rebuild.

**Path convention:** The abbreviated code paths `Situate/...`, `PiBridge/...`, and `Situate.xcodeproj/...` below always refer to `second-brain/Prototype/`.

---

## 2. The product idea in plain language

### Documented positioning

The authoritative positioning describes Situate as a **personally extensible AI assistant**:

> Users describe the support they need; Situate builds suitable reusable tools as plugins.

The aim is not to impose another fixed organizational system on people. The assistant should fit their existing way of working. Users determine what is built, connected, and executed; the assistant should not assign itself new tasks or capabilities.

**Documented target audiences:** knowledge workers, self-employed people, and technically open-minded people whose professional and personal obligations are spread across several tools.

**Evidence:** `second-brain/positionierung.md:3–47`.

### Problem and intended benefit

The older idea profile describes the starting point in more detail: notes, tasks, appointments, and personal context are scattered. Manually organizing, updating, and finding them creates substantial work in itself.

The intended benefit therefore combines two directions:

1. **Make personal context usable:** capture, find, and summarize information, and turn it into tasks or next steps.
2. **Create suitable tools:** support recurring work with individually created views, actions, and integrations.

The idea profile itself marks many market and benefit assumptions as unconfirmed. It is not evidence of general reliability, willingness to pay, or a fully realized overall scope.

**Evidence:** `second-brain/geschaeftsidee.md:11–25, 37–78`.

### How the documents evolved

The older “Second Brain” vision includes cross-device synchronization, proactive support, and extensive automatic organizational maintenance. The later positioning places greater emphasis on **user-requested extensibility and personal responsibility**.

These documents should not be collapsed into a single feature promise. For example, synchronization is a vision in the idea profile but is explicitly excluded from the import flow examined.

### Interpretation based on the implementation

**Interpretation:** The practical product core of this prototype can be explained as a combination of three components:

- **chat as the entry point for requests;**
- **a local “Brain” as a durable knowledge store;**
- **plugins as individually added actions and interfaces.**

This is a helpful explanation of how the parts relate, not an additional documented product commitment.

### Key terms

| Term                         | Meaning in the prototype examined                                                                                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brain**                    | A local, editable collection of files for personal notes and tasks. After an import, the Brain copy is authoritative.                                                  |
| **`AGENTS.md` in the Brain** | A file containing personal working rules, language preference, and information explicitly requested to be remembered. Not to be confused with repository instructions. |
| **Discovery**                | AI-led investigation of a named source and reconstruction of the existing way of working. Not a fixed, implemented universal importer.                                 |
| **Snapshot import**          | A one-time transfer of a data snapshot. Later changes to the original source are not transferred automatically.                                                        |
| **Plugin**                   | A reusable extension consisting of code and a description; it can add chat tools, actions, views, integrations, or visual styling.                                     |
| **Skill**                    | Instructions for the assistant on when and how to use particular capabilities. Not the executable integration itself.                                                  |
| **Area / plugin view**       | A plugin's own working area or interface within the application.                                                                                                       |
| **Connector**                | Infrastructure for access and authentication to an external service. Service-specific operations must be implemented separately.                                       |
| **Knowledge graph**          | An additional visual representation of notes and their explicit or AI-derived relationships.                                                                           |

---

## 3. Features actually present

### 3.1 AI chat and conversation management

**Status: implemented.**  
**Verification: bridge flows tested in practice with a locally simulated AI service; native interface and real model providers assessed only from code.**

Users can enter messages and receive responses from a selected AI model. The assistant actually has file and command tools; this is not merely an interface with predefined responses.

The traced flow is:

`Send message → AppModel → send_message bridge command → agent session → model/tool processing → events back to the interface`.

Also present:

- new and saved conversations;
- switching, renaming, archiving, and deletion;
- navigation to earlier points in a conversation;
- cancellation and resumption of interrupted work;
- additional messages during an ongoing response, either to steer it or as follow-up requests;
- ongoing conversations that are not automatically cancelled when switching to another conversation.

**Prerequisites:** Configured model access and an available model. Sign-in through OAuth and API keys is implemented. The interface offers ChatGPT and Claude sign-in options, among others; their current external availability was not checked.

**Limits:** A successful local bridge test confirms transport, storage, and lifecycle, not the substantive quality of real AI responses. Availability, costs, and capabilities depend on the provider and model used.

**Evidence:**  
`Situate/AppModel.swift:3961–4130`; `PiBridge/bridge.ts:2254–2304, 3547–3700`; `PiBridge/situate-tools.ts:2`; `PiBridge/conversations-bridge.test.ts`.

---

### 3.2 Setup and transfer of existing information

**Status: technical setup and import application implemented; the complete discovery/conversion process is AI-led rather than implemented as a general-purpose importer.**  
**Verification: state and storage checks tested in practice; no complete import from a real external application performed.**

There are two entry points:

- **Start with existing information:** name a source, have the existing way of working investigated, and transfer a confirmed data snapshot.
- **Start without an import:** create an empty Brain with basic working instructions and a language preference.

The intended import process separates:

1. investigation of the source;
2. reconstruction and confirmation of the way of working;
3. a transfer proposal;
4. generation and validation of a temporary import dataset;
5. preview and final approval;
6. transfer into the Brain.

The final transfer is real program logic: among other things, it checks the import identifier, existing Markdown files, report, and file conflicts. Matching SHA-256 values are required for differing existing files. The code writes an import manifest and working instructions, verifies the transferred files, and attempts to roll back changes on failure.

**Prerequisites:** Accessible source data, macOS permissions where necessary, an AI model, and a one-time importer that works for the particular format.

**Key limits:**

- The agent is expected to create an importer for the specific case. This does not establish ready-made support for every named note-taking system.
- **No automatic synchronization or write-back through the snapshot import.**
- Substantive confirmation of the way of working and import approval are organized largely through agent instructions. The code checks states and revisions but does not independently verify whether natural-language approval was understood correctly.
- “The source remains unchanged” is a process instruction, not a general technical write lock for the entire agent.

**Evidence:**  
`PiBridge/onboarding-guidance.ts`; `PiBridge/bridge.ts:824–854, 1044–1262, 2335–2419`; `PiBridge/onboarding-state.test.ts`.

---

### 3.3 Personal knowledge store, remembering, and tasks

#### Editing through the assistant

**Status: implemented tools with agent-based domain logic.**  
**Verification: storage foundations tested; correct remembering, classification, and retrieval not verified with a real model.**

The assistant can read and modify files in the Brain. For a “Remember this” request, the system instruction requires it to store the information durably in the Brain's `AGENTS.md`, read the existing content first, and verify storage.

For tasks and other types of information, it should first follow the existing way of working. If there is no suitable convention, it may create a minimal convention and save the requested content.

**Product-relevant interpretation:** There is no demonstrated uniform, built-in task database underlying all workflows. Tasks can be part of the individual's file system; the separate Apple Reminders integration is an alternative.

**Limits:** Automatic, correct knowledge maintenance is not a deterministic domain function here. It depends on model behavior, working instructions, and existing files. Source references in responses are also required largely through instructions.

**Evidence:**  
`PiBridge/system-prompt.ts:14–35`; `PiBridge/bridge.ts:871–892, 1360–1385`.

#### Direct editing in “Your Brain”

**Status: implemented.**  
**Verification: file service tested in practice; interface and automatic saving traced in code.**

Users can browse folders and files, create new files and folders, and read and edit supported text files. Changes are saved after a short delay. If files have changed in the meantime, a conflict is shown instead of silently overwriting the newer state.

**Prerequisites:** A local Brain; the “Your Brain” area is enabled by default.

**Limits:**

- Editing is limited to supported UTF-8 text files up to 5 MiB.
- Internal files such as `AGENTS.md`, hidden files, and symbolic links are hidden in the file browser.
- Full file management with all the usual move, rename, and delete actions is not established for this interface.

**Evidence:**  
`PiBridge/brain-files.ts:47–68, 98–346`; `Situate/AppModel.swift:2613–2776`; `Situate/YourBrainView.swift`; `PiBridge/brain-files.test.ts`.

---

### 3.4 Dictation, quick input, and images

**Status: implemented.**  
**Verification: assessed exclusively from code.**

**Dictation:** Microphone recordings are transcribed locally with an embedded speech model. Temporary recordings are deleted after processing or cancellation. In normal chat, the transcript is first inserted into the input field.

**Quick Chat:** A small input window accessible globally allows text or dictation outside the main window. Submitting starts a new conversation and opens the main window.

**Important exception:** In Quick Chat started through the global dictation shortcut, stopping the recording can immediately submit it. The general statement “Dictated text is never sent automatically” would therefore be false.

**Images:** Image attachments can be prepared and sent to image-capable models. This is rejected for unsuitable models.

**Prerequisites:** Microphone permission for dictation, embedded speech model resources, and an AI model for subsequent chat processing; an image-capable model for images.

**Limits:** No verification with a real microphone, image, or model. Dictation is not evidence of a complete meeting recording and transcription service.

**Evidence:**  
`Situate/DictationService.swift:54–203`; `Situate/QuickChat.swift:62–112, 241–319`; `Situate/AppModel.swift:3706–3745, 4037–4075, 4140–4325`.

---

### 3.5 Knowledge graph

**Status: implemented, optional.**  
**Verification: construction, updates, storage, and resumption tested in practice with simulated AI classifications; real classification quality and rendering not tested in practice.**

Users can visually explore relationships between their notes, search for notes, filter categories, and open a corresponding note.

The processing:

- reads Markdown files from the Brain;
- detects direct Markdown links and wikilinks;
- has notes classified by a separately selectable model;
- stores nodes and relationships locally;
- processes changes and removes deleted notes from the graph.

**Prerequisites:** Enabled graph, Brain notes, and a configured analysis model. The graph is not enabled by default.

**Limits:**

- AI relationships are derived assessments, not established factual relationships.
- The actual model call uses at most 12,000 characters of a note and limited candidate excerpts.
- Candidate selection is based on word overlap.
- The graph is implemented as a supplementary view. It is not evidence of a comprehensive semantic search database for all product information.

**Evidence:**  
`Situate/AppModel.swift:45–86`; `PiBridge/knowledge-graph.ts:140–218, 243–510`; `PiBridge/bridge.ts:705–753`; `Situate/KnowledgeGraphView.swift:1–95`.

---

### 3.6 Individual plugins and custom working interfaces

**Status: extension platform implemented; successful creation of a specific new tool remains dependent on the model and integration.**  
**Verification: registry, activation, revisions, and restoration tested in practice; no complete AI-generated extension including a native WebKit interface created.**

Users can request a durable tool in chat. The assistant switches internally to a development context without requiring a new conversation.

Plugins can, among other things:

- provide additional tools in chat;
- offer visible actions;
- add their own working areas and local web interfaces;
- modify parts of the interface and styling;
- use keyboard shortcuts and quick input;
- connect external services.

The technical path exists: plugin files are saved as a draft, checked, recorded as a specific revision, and then transferred into the active extension set. For certain activation failures, the previous version is restored.

A plugin interface can trigger real backend actions: web interface → native host bridge → plugin tool → result back to the interface.

**Prerequisites:** A suitable AI model for creation; working plugin code for the intended benefit, with source data and external access where necessary.

**Important limits:**

- “A plugin was generated” does not automatically mean its domain-specific workflow is reliable.
- The agent-driven publication path requires a successful test report for the specific revision.
- Without custom-defined tests, checks may be limited to preflight checks and generic loading checks.
- Manual activation of existing plugins does not use the same complete test evidence as agent-driven publication.
- Temporary test working directories are **not a security sandbox** for arbitrary plugin code.

**Evidence:**  
`PiBridge/bridge.ts:900–952, 2562–2642, 2767–2991, 3049–3197`; `PiBridge/plugin-development.ts:22–82`; `PiBridge/plugin-testing.ts:94–98`; `Situate/PluginWebHostView.swift:873–901`.

---

### 3.7 “Plugin Marketplace” and management

**Status: local plugin management implemented; a public online marketplace is not implemented in the interface examined.**  
**Verification: file-based lifecycle tested in practice; interface assessed only from code.**

The screen named “Plugin Marketplace” shows:

- included features such as “Your Brain” and “Knowledge Graph”;
- locally available custom or bundled plugins;
- activation, deactivation, and deletion;
- setup instructions, actions, and connections.

Functionally, this is **local extension management**, not an established public catalog for finding, buying, or downloading third-party plugins.

Deletion also initiates removal of stored connection data. This does not undo changes already performed externally.

**Evidence:**  
`Situate/PluginMarketplaceView.swift:1–168`; `Situate/AppModel.swift:3173–3268`; `PiBridge/bridge.ts:3077–3117`; `PiBridge/plugin-builder.test.ts`.

---

### 3.8 Real integrations and external research

#### Bundled Apple integrations

**Status: implemented, disabled when first provisioned.**  
**Verification: packaging, activation, and parts of the adapter logic tested in practice; no real Apple data or macOS permissions tested.**

Three plugins are bundled:

| Integration         | Actually implemented scope                                                                            | Important limits                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Apple Calendar**  | Select calendars; search and read events; create, modify, and delete them; simple recurrence          | No editing of attendees or attachments; limited recurrence options; search period at most 366 days                                                                                             |
| **Apple Reminders** | Select lists; read, create, modify, complete, and delete reminders                                    | No subtasks or tags; restrictions on recurring reminders                                                                                                                                       |
| **Apple Notes**     | Select accounts and folders; search and read; create, update, append to, and delete simple text notes | Shared content is read-only; locked content cannot be read; modifications to notes with complex formatting, checklists, tables, links, or attachments are limited to protect against data loss |

Calendar and Reminders use native EventKit operations. Notes uses macOS automation through a bundled JavaScript adapter. These are real execution paths, not merely buttons.

**Prerequisites:** Plugin activation, appropriate macOS permission, and explicit source selection. Current revision information is checked for changes.

**Important:** These are **live accesses to original sources**, unlike the one-time Brain import. “Disconnect” removes the source selection but does not automatically revoke the macOS permission.

**Evidence:**  
`PiBridge/bundled-apple-plugins.ts:25–51`; `Situate/AppleEventKitService.swift:23–53, 195–360`; `Situate/AppleNotesService.swift:72–118, 123–198`; `PiBridge/ApplePlugins/apple-notes/index.ts`.

#### General service connections

**Status: authentication and connector infrastructure implemented; this alone does not make additional specific services available.**  
**Verification: assessed exclusively from code.**

Present are secret credential input, OAuth with PKCE, multiple accounts, token renewal, and storage of plugin credentials in the macOS Keychain.

This makes integrations easier to build but does not replace their service-specific implementation. No ready-made Gmail, Google Calendar, Notion, or Evernote product integrations were found in the bundled plugin set examined. Demo data and setup instructions for those services must be distinguished from actual integrations.

**Evidence:**  
`Situate/PluginConnectorService.swift:193–362`; `Situate/PluginSecretStore.swift:29–101`; `PiBridge/ApplePlugins/`.

#### Web research

**Status: implemented.**  
**Verification: assessed exclusively from code; no external search requests executed.**

The assistant can search the web and fetch page contents through an embedded Ketch program. Results feed into AI processing; source citations are required by the system instruction.

**Prerequisites and limits:** Internet access and available search services. No guarantee of completeness, correct source assessment, or lasting provider availability.

**Evidence:** `PiBridge/bridge.ts:776–813, 1471–1517`.

---

### 3.9 Briefings, task dashboards, and meeting support

**Status: partly prepared as agent-driven workflows; not established as complete, bundled domain modules.**  
**Verification: assessed from code and demonstration materials.**

The application contains guided entry points that trigger real chat requests:

- explore interesting connections in personal notes;
- follow up with web research;
- create and complete a “Discover Situate” task;
- create a plugin for a daily task overview;
- ask for suitable extension ideas.

In particular, the task dashboard is **requested and created as a plugin**, not simply enabled as a ready-made standard feature.

Morning briefings, scheduling, reply drafts, and meeting preparation and follow-up are plausible, documented use cases. Successful execution nevertheless requires the necessary data, integrations, and a correctly working model.

**Demo boundary:** `second-brain/demo-data/imagine/` explicitly contains semi-synthetic data and expected results. The meeting transcript is prepared for the demonstration and added only after the depicted meeting. This does not establish automatic meeting capture.

**Evidence:**  
`Situate/AppModel.swift:3285–3593`; `second-brain/demo-data/imagine/README.md`; `second-brain/demo-data/imagine/setup/situate.md`.

---

### 3.10 Additional interaction, storage, and operation

**Status: implemented; assessed exclusively from code except where noted above.**

- **Split workspace:** Several areas or conversations can be opened side by side or vertically. They share the same services but retain their own navigation state.  
  Evidence: `Situate/Workspace.swift:74–176`.

- **Keyboard shortcuts:** Configurable; settings are stored locally. Conflicts and reserved combinations are handled.  
  Evidence: `README.md`, “Keyboard shortcuts” section; `Situate/HotkeyManager.swift:314–386, 524–623`.

- **File references:** Local text files can be opened in a preview from chat references; other files can, where appropriate, be opened in their default application.  
  Evidence: `Situate/TextFileViewer.swift:7–103`.

- **Language:** The native interface supports German, English, and the system selection. Conversation language is additionally guided through personal instructions.  
  Evidence: `Situate/Localization.swift:5–22`.

- **Local data storage:** Brain files, conversation files, plugin projects, state, and the graph reside in application-owned directories. The agent starts with its own home directory and configuration, not the normal user configuration. Model credentials are managed through Pi files; plugin secrets are stored separately in the Keychain.  
  Evidence: `Situate/ApplicationPaths.swift`; `Situate/PiBridgeClient.swift:58–120`; `PiBridge/bridge.ts:2139–2248`.

- **Updates:** The application can fetch a release manifest and point to a download. This does not establish automatic installation.  
  Evidence: `Situate/UpdateChecker.swift:254–387`.

- **Telemetry:** Enabled by default, can be disabled in settings. Usage events and crash reports sanitized in production configuration are implemented. The usage events examined contain no message text; this does not imply that the entire application operates without data transmission.  
  Evidence: `Situate/Telemetry.swift:18–110, 191–225, 251–318`.

---

## 4. Central user workflows

### Workflow A: Start without an existing note-taking system

**Starting situation:** New installation, no Brain content yet.

1. The user connects a model provider and selects or accepts a model.
2. Optional microphone and file permissions can be configured or skipped.
3. The user decides against an import.
4. The application creates the empty Brain and basic working instructions with a language preference.
5. The user can then enter information or create files.

**Result:** A usable local starting point, not an automatically populated personal knowledge system.

**Verification status:** Creation of working instructions and protection against unintentionally overwriting them tested; complete visual first launch not performed.

### Workflow B: Transfer existing information

**Starting situation:** The user has notes or tasks in a named source.

1. The user names the source and, for work data, clarifies whether AI processing is permitted.
2. The agent investigates the accessible source and asks about relevant uncertainties.
3. It explains the reconstructed way of working; the user corrects and confirms it.
4. The agent creates a transfer proposal and a temporary import dataset.
5. The user receives a preview and grants import approval.
6. The import function checks conflicts, transfers files, and saves the manifest and working instructions.

**Result:** An independently editable Brain copy.

**This is where the workflow ends:** No automatic connection to the source is created. A later import is a new operation. Whether investigation and conversion succeed for a specific application was not tested in practice.

### Workflow C: Capture, store durably, and reuse

**Starting situation:** Brain exists, model configured.

1. The user writes or dictates a request, for example to remember information or create a task.
2. Dictation is converted to text locally; the message is then sent. Global Quick Chat dictation can submit immediately when stopped.
3. The agent reads existing rules and relevant files.
4. It modifies the relevant Brain files or saves an explicit memory in `AGENTS.md`.
5. The user can inspect and edit normal content files in “Your Brain”.
6. For later questions, the agent should consult relevant files again.

**Result:** Durable files rather than only a chat confirmation.

**Limit:** Choosing the correct storage location and reusing the information later depend on the agent. A chat statement saying “saved” alone would not be sufficient evidence.

### Workflow D: Build and use a custom tool

**Starting situation:** A recurring task cannot be handled appropriately with the existing feature set.

1. The user describes the desired tool in chat.
2. The assistant clarifies key decisions and switches internally to the development context.
3. It creates plugin code, a description, setup instructions, and, where appropriate, an interface and tests.
4. The publication path checks the specific revision and activates it after a successful test run.
5. The tool appears as an action, chat capability, or its own area.
6. A user action is forwarded through the host bridge to real plugin code.
7. The user can later have the plugin modified, deactivate it, or delete it.

**Result:** A locally installed extension, not automatically a publicly released product.

**Limit:** Test scope and actual benefit depend on the generated plugin. External access may require additional setup; there is no security isolation from user files.

### Workflow E: Edit original data through an Apple plugin

**Starting situation:** For example, a reminder in Apple Reminders needs to be changed.

1. The user activates the initially disabled plugin.
2. The user grants the required macOS permission.
3. Relevant lists are explicitly selected.
4. The assistant searches for and reads the specific entry.
5. When making a change, the target and revision state are checked.
6. The native integration saves the change in the original system.

**Result:** An actual change in Apple Reminders, not merely a Brain copy.

**Limit:** This live workflow was not executed against real account data. According to product instructions, connection access alone is not a request for arbitrary changes; however, an additional confirmation before every clearly requested action is not intended.

---

## 5. Limits and open questions

### Explicitly absent within the scope examined

- Automatic synchronization or write-back in the **snapshot import process**.
- A technical capability sandbox that restricts every plugin to selected sources.
- A public online catalog behind the “Marketplace” screen examined.
- The explicitly excluded editing features of the Apple integrations listed above.

### Not found during the investigation

These statements do not claim that something is fundamentally impossible or does not exist in private user plugins:

- ready-made bundled Gmail, Google Calendar, Notion, or Evernote product integrations;
- a general, durable scheduler for recurring user requests;
- guaranteed task execution while the application is closed;
- a cross-device product synchronization or backup service;
- mobile clients, team management, a shared organizational memory, or billing;
- a complete meeting recording process with automatic follow-up;
- a general undo for arbitrary agent and external changes.

The documented possibility of recurring automations must therefore not be equated with a demonstrated, ready-made automation service. Background work in an ongoing conversation is different from reliably scheduled execution.

### Not tested in practice or not verifiable within the investigation scope

- Quality of real AI responses, imports, and generated plugins;
- actual functioning of current provider sign-ins;
- external OAuth connections and token renewal;
- real Apple permissions and changes to original data;
- microphone capture and real transcription quality;
- native GUI and WebKit flows;
- behavior of the modified embedded program and a newly built release package;
- production operation, real reliability, and customer benefit.

### Security and privacy limits

**Local storage is not the same as local processing.** Content can reach configured AI models and, through plugins, external services. Telemetry is also enabled by default.

The application-private agent environment primarily prevents unintended use of normal Pi configurations. It is not a general file-system security boundary.

The project configuration examined sets `ENABLE_APP_SANDBOX = NO`. Wording in the agent prompt, however, still describes the “App Sandbox” as the outer boundary. Product statements must be based on the actual configuration, not that prompt wording.

**Evidence:** `Situate.xcodeproj/project.pbxproj:800–841`; `PiBridge/bridge.ts:827`; `AGENTS.md`, “Embedded Pi and plugin isolation” section.

### Example data and simulated interfaces

`Situate/MarketplaceTestScenario.swift` contains explicitly enabled debug scenarios with plugins such as “Meeting Notes” and “Project Dashboard”. These entries are not evidence of domain features shipped by default.

The expected results under `second-brain/demo-data/imagine/expected-results/` are also evaluation references, not passed end-to-end tests.

### Product questions left open by the repository alone

- Which specific use case provides the greatest lasting benefit?
- Which target audience is actually prioritized now?
- What level of reliability has been achieved for generated tools?
- Who is responsible for checking and maintaining individual integrations?
- Which privacy, operational, support, and pricing commitments are binding?
- Which elements of the older vision were adopted, changed, or discarded?

---

## 6. Notes for the onboarding agent

### Particularly important findings

1. **Situate is not just a notes chat.** The prototype combines personal files with an executing AI and a real extension runtime.
2. **Extensibility is a central product mechanism.** Users should be able to describe the tools they need rather than rely exclusively on a fixed feature catalog.
3. **Chat, Brain, and plugins belong together.** Chat receives requests; files preserve context; plugins add reusable actions and views.
4. **Import and integration are different things.** Import creates an independent copy; a live integration can read and modify original data.
5. **Part of the product behavior resides in agent instructions.** This must be distinguished from technically enforced states, revision checks, and stored results.
6. **Control here means a user request and deliberate setup, not guaranteed confirmation before every action or complete technical isolation.**

### Statements that initially apply only to this prototype

These include, in particular:

- restriction to macOS and Apple Silicon;
- a file-based Brain and `AGENTS.md` as the personal working foundation;
- snapshot import without synchronization;
- specific Apple plugins and their restrictions;
- local Marketplace management;
- the testing and publication mechanism;
- dictation and Quick Chat behavior;
- telemetry enabled by default.

### Specific comparisons to make with the main product

| Area to examine  | Specific question                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------------------- |
| Positioning      | Is “personally extensible assistant” still the leading product idea?                              |
| Memory           | How are knowledge, personal rules, and explicit memories stored and retrieved today?              |
| Sources          | Are there still snapshot imports, is there now synchronization, or are there other source models? |
| Tasks            | Are tasks free-form files, structured objects, external entries, or a combination?                |
| Plugins          | Can users still have tools generated and published through chat?                                  |
| Verification     | Which tests are mandatory, and what do “ready” or “checked” actually mean?                        |
| Integrations     | Which specific services are supported today, including reading, writing, and prerequisites?       |
| Automation       | Is there a durable scheduler, and under which operating conditions does it run?                   |
| Security         | Which access boundaries, confirmations, undo mechanisms, and recovery paths actually exist?       |
| Data flows       | Which content leaves the device, where does it go, and under which settings?                      |
| Interaction      | What roles do chat, custom views, direct editing, dictation, and quick input play today?          |
| Product maturity | Which features are experimental, and which are formally supported?                                |

**Recommendation for final onboarding:** Explain the product idea using the current positioning, but establish the actual feature scope afresh in the main product. Briefings, meeting support, and personal dashboards work well as understandable examples—but they must not be presented as ready-made standard modules without verification.

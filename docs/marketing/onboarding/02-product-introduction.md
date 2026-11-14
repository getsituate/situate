# 2. Situate: a product introduction

## Contents

- [1. Why we are building Situate](#1-why-we-are-building-situate)
- [2. What Situate is](#2-what-situate-is)
- [3. The work between the tools](#3-the-work-between-the-tools)
- [4. Four principles behind the experience](#4-four-principles-behind-the-experience)
  - [4.1 Context makes an instruction useful](#41-context-makes-an-instruction-useful)
  - [4.2 Chat leads to action](#42-chat-leads-to-action)
  - [4.3 The organization fits the person](#43-the-organization-fits-the-person)
  - [4.4 The interface fits the immediate need](#44-the-interface-fits-the-immediate-need)
- [5. Getting started with your own material](#5-getting-started-with-your-own-material)
  - [5.1 Start with how you work](#51-start-with-how-you-work)
  - [5.2 Bring in what you already know](#52-bring-in-what-you-already-know)
  - [5.3 Import, connection and synchronization are different](#53-import-connection-and-synchronization-are-different)
  - [5.4 Agree the setup, then put it to use](#54-agree-the-setup-then-put-it-to-use)
- [6. Five everyday scenarios](#6-five-everyday-scenarios)
  - [6.1 Capture a thought where it belongs](#61-capture-a-thought-where-it-belongs)
  - [6.2 Choose a realistic morning focus](#62-choose-a-realistic-morning-focus)
  - [6.3 Answer an email with the background in view](#63-answer-an-email-with-the-background-in-view)
  - [6.4 Ask for a combined day view](#64-ask-for-a-combined-day-view)
  - [6.5 Leave a useful restart point](#65-leave-a-useful-restart-point)
- [7. Working with assistance, keeping the decisions](#7-working-with-assistance-keeping-the-decisions)
- [8. Current development stage](#8-current-development-stage)
  - [8.1 Main product](#81-main-product)
  - [8.2 Available prototype](#82-available-prototype)

## 1. Why we are building Situate

We are building Situate to give people more freedom over their time and attention. We want AI to take on the work of keeping things organized and carry out tasks, giving people more room for activities they enjoy and for work that draws on their own interests and abilities.

Marcus and Nils share a conviction: the time is right to make powerful personal AI assistance accessible to a much wider group of people. Their experience with personal knowledge systems and agents showed them what becomes possible when AI has both useful context and tools to act. Situate should make those capabilities available through everyday conversation, with the product taking care of the technical complexity.

Your notes and documents are a foundation for this assistance. They contain knowledge, decisions and commitments built up over time. An assistant that can use this context can help move work forward without asking you to reconstruct the background in every new conversation.

Our vision is that you can talk to Situate about what is happening, what you want to achieve and what needs attention. Situate connects that conversation to your existing material, creates and updates the relevant tasks and notes, and carries out work on your behalf. It makes clear where your own contribution, judgement or approval is needed.

The organization itself should feel effortless to maintain. You can bring an established way of working or develop one together with Situate. The system handles the filing and upkeep, while you shape it through conversation. Its tools and views adapt too: a combined view of personal tasks, work commitments and today's calendar can be created when you need it.

## 2. What Situate is

Situate is an application for AI-assisted personal organization. It brings notes, tasks, knowledge, documents, email and calendar context together in one working environment. You describe what you need in everyday language, and Situate helps organize the relevant information and carry the work forward.

A working Situate prototype already exists, and the final application is in development. The prototype already supports most of the functionality described here. This guide presents the product experience in the present tense to make the way of working easy to understand. The final section explains the current development stage and the differences between the two versions.

You capture thoughts, choose a daily focus or prepare replies. Requests lead to usable results: saved notes, updated tasks, drafts or views of your information.

You can extend Situate with tools and views built around your own needs. For example, ask it to create a reading view that groups saved articles by topic and shows your notes alongside them. Or ask for a project overview combining upcoming deadlines, related emails and open tasks.

Describe what you want in chat, then refine the result as you use it: add a filter, change the layout or include another source. The tool remains available for later use. For services such as email or calendars, Situate needs a working connection and your permission to access the relevant information.

## 3. The work between the tools

Much of organizing work happens between tools. When a new email or form arrives, you have to connect it to your own thoughts, notes and plans. What does it relate to? What have you already decided? Does it change what you need to do next? You then update the relevant notes or tasks. Even when the information is stored digitally, making these connections often remains your job.

For example, you receive an email about a house move. The quote is in a document, your open questions are in a note, and the reminder to reply is on another list. To answer, you first have to bring those pieces together and work out what is still unresolved.

Situate helps with this connecting work. It uses the message together with your relevant notes, documents and tasks to prepare the next step—for example, a reply that takes your earlier questions and decisions into account. You review the result with its background in view.

## 4. Four principles behind the experience

### 4.1 Context makes an instruction useful

**Personal context** is the information that gives a request its meaning: relevant notes, documents, commitments, earlier conversations and working preferences. “Prepare my reply” becomes useful when Situate can connect the message with the right background.

For the house move, a spending limit, fragile-item notes and a task to confirm insurance help explain the email. Knowledge includes decisions and details you want to reuse, not just isolated facts.

Situate works with available information, not an all-knowing profile. External sources need suitable access; missing or conflicting details need clarification. Relevant material may reach your chosen AI provider, the service processing an AI request. Local storage does not mean AI processing stays on your device.

### 4.2 Chat leads to action

Chat is a way to initiate work, not merely receive advice. “Put this where it belongs” asks for a change; “How could I organize this?” asks for an explanation.

A **project** groups related work toward an outcome, such as moving home. A **backlog** holds tasks for later, rather than today's commitments. If you use these structures, Situate follows your conventions to place new tasks.

The result is something you can inspect: a task in its list, a note beside related material or a draft with its background in view. You can review and edit the material directly as well as through conversation.

### 4.3 The organization fits the person

Some people keep tasks in project notes; others prefer topic lists or separate entries. Situate follows the method you agree with it, without imposing structures or changing priorities on its own. Examples include Getting Things Done (**GTD**) for managing commitments, **PARA** for grouping material into projects, areas, resources and archives, and the **Eisenhower Matrix** for weighing urgency and importance. You can use these approaches, combine them or follow your own method.

A **view** is a way of seeing and working with information inside the app. In the final application, a small set of ready-to-use views gives you concrete starting points for organizing your material. You can adapt them or ask for new ones. The prototype offers less guidance at this point: you ask Situate to create the individual views you need.

The final experience includes useful task defaults: open and completed work, basic ways to narrow the list, and categories, ordering or rules you can adapt.

### 4.4 The interface fits the immediate need

You might want a reading list today and a combined day overview tomorrow. You describe what belongs together and how you want to use it, rather than designing software yourself.

A **plugin** is a reusable extension that adds a tool, connection or view. It can bring appointments and selected messages alongside tasks. A useful view needs meaningful selection rules and access to the relevant information.

## 5. Getting started with your own material

### 5.1 Start with how you work

The first conversation is about your organization. Where do you keep commitments? How do you distinguish a task from a note? What helps you decide what to do next?

You can retain an existing approach, adapt a suggested one or start simply without old material. Situate helps make these choices concrete. For example, you might keep household tasks in one list but leave learning tasks beside the notes they refer to.

A **workspace** is the home for one separate collection of your content and conversations. A typical distinction is between personal and professional life: you can keep private plans and interests in one workspace and work-related material in another. The final application's starting views help you begin organizing; the prototype's individual views are created on request.

### 5.2 Bring in what you already know

Existing notes and tasks provide context without making you explain everything again. You describe where they live and which parts to bring over. You may already organize notes and tasks in familiar apps such as Obsidian or Notion, or collect everyday thoughts in the Notes app on your iPhone.

You agree how to recognize tasks and which structures to retain. A checkbox in a packing checklist is not necessarily a personal commitment. Import creates copies and leaves the originals unchanged; reorganization applies to the copies.

You can omit or defer sources, start without importing and add material later.

### 5.3 Import, connection and synchronization are different

A **one-time import** copies information at a particular moment. Later changes to the original do not automatically appear in that copy.

A **service connection** accesses information in its original service, within supported operations and permissions. Reading an appointment through a calendar connection is different from reading a copied note about it. Some connections can also change original information when you authorize the work.

**Ongoing synchronization** keeps designated information aligned over time, for example between devices. It has its own scope and rules; neither an import nor a service connection automatically provides it.

### 5.4 Agree the setup, then put it to use

You review a setup plan covering the agreed organization, connections, views and AI work involved. Custom development continues in the normal application, where you can follow and guide it while using material already brought in. You can adapt the arrangement later rather than predict every need at setup.

## 6. Five everyday scenarios

These fictional situations illustrate how context, requests and visible results fit together, not a catalog of ready-made features. The restart note illustrates a possible use of personal material.

### 6.1 Capture a thought where it belongs

While travelling, you remember a question about your move. You do not want to search through folders or create another loose reminder.

> Add “Check whether bicycle transport is included” to my Home move backlog.

Situate uses the project note, task list and your filing conventions to add the task and show where it was saved. If two projects fit, it asks which you mean.

You see the task beside the other unfinished move preparations. Opening it brings you back to the project material, where the quote and your questions already belong. You capture the thought once and can return to it when choosing your next actions, rather than rely on memory or copy it between lists.

### 6.2 Choose a realistic morning focus

Several lists compete for attention. Today, making progress on the move matters more than clearing every small task.

> Make moving home today's focus. Suggest three next actions from my backlogs, leaving space around my 11 a.m. appointment.

Situate uses your existing tasks, your stated priority and the appointment—provided by you or accessible through a working calendar connection. It selects from real commitments rather than inventing a new productivity plan.

Situate proposes a short selection and explains its choices. Here, the list includes checking bicycle transport, comparing the two quotes and collecting documents for the new tenancy. If the notes do not show how long something takes, that remains an estimate or a question.

You see a short day list linked to the original tasks, not a disconnected copy. You can replace or remove items before adopting the plan, without rebuilding every backlog. You initiate this review; it does not imply a scheduled briefing running by itself.

### 6.3 Answer an email with the background in view

A fictional moving company asks whether you accept its revised quote. You remember that some questions remain open, but not which document contains the latest terms.

> Prepare a reply using my move notes, open questions and the latest quote. Do not send it.

Situate needs the message, relevant documents and unresolved tasks. You provide the message through a working email connection or supply it yourself without granting access to the rest of your mailbox.

Situate compares the material and drafts a reply asking whether bicycle transport and insurance are included. Missing or conflicting terms become questions, not assumptions. You see the draft with supporting information, making it easier to check the wording and commitments without searching again.

Preparing the draft does not send it; sending is a separate action requiring your approval.

### 6.4 Ask for a combined day view

You want one place to orient yourself before starting work, rather than moving repeatedly between a calendar, inbox and task list.

> Create a day view with my calendar, my five most important emails and my backlog.

Situate needs working calendar and email connections, your task collection and an agreed meaning of “important”—here, messages needing attention for today's commitments. Missing access is made clear rather than filled with invented information.

Situate creates a reusable in-app view showing appointments, five selected messages and pending work, with context explaining the selection. You can ask to show only the Home move backlog, for example. The result suits your immediate decision without requiring you to build the interface or keep switching between sources.

### 6.5 Leave a useful restart point

You are pausing a personal pottery project for a month. Your notes contain glaze experiments, an unfinished sketch and several possible next steps. You want to return without having to reconstruct your thinking.

> Make a restart note from my pottery notes and unfinished tasks. Include where I stopped and the next small step.

Situate draws on the notes and related task entries you have made available. It brings together the last recorded decision, unfinished work and a small next action. If the notes leave it unclear whether a sample has already been fired, it leaves that as a question rather than reporting a finished result.

You see an editable checkpoint linked to the material: you chose a mug shape, still need to compare two glazes and can restart by checking the sample labels. You correct anything that does not match where you stopped. The note gives you a place to resume without turning a paused interest into an overdue obligation.

## 7. Working with assistance, keeping the decisions

You supply the purpose; Situate helps carry the organizational work forward. When you ask Situate to organize your material, it can make changes you can undo. Before sending a message or making a commitment on your behalf, it needs your approval. Preparing a reply, approving it and confirming it was sent are different things.

Connecting an account does not authorize every possible use. You review the results and decide what to act on.

The central idea is not that Situate takes over your life. It reduces the work of connecting information and commitments while letting the organization remain yours.

## 8. Current development stage

### 8.1 Main product

The final Situate application currently targets macOS only, with foundations for local workspaces, file editing, AI conversations and custom extensions. iOS is deferred.

The complete experience is not yet established as available end to end or equally ready on both platforms. Detailed status changes quickly.

### 8.2 Available prototype

The separate prototype lets you explore AI-assisted organization and custom tools on Apple Silicon Macs with macOS 14 or later.

**Conversations and a personal collection.** With working AI model access, you can start and revisit conversations and ask the assistant to read or change material. The **Brain** is the local store of notes and tasks. In “Your Brain,” you browse folders, create files and edit supported text files directly.

**Starting fresh or importing.** You can begin with an empty Brain or bring in existing notes and tasks. Situate helps you understand how the material is organized and prepares a copy for you to review before adding it to your collection. The originals stay where they are. Later changes in the original app do not automatically appear in Situate, and edits in Situate do not change the originals.

**Custom tools and views.** You can ask through chat for a reusable tool. The prototype has a process to create, check and activate plugins, including their own views and actions, and lets you manage installed extensions. Unlike the final application's starting views, an individual daily task dashboard is requested and developed, not supplied as a finished standard module. It needs working generated code and any required service access. “Plugin Marketplace” manages local extensions, not a public online catalog.

**Apple connections.** Bundled plugins access Apple Calendar, Reminders and Notes. Initially disabled, they require activation, macOS permission and selection of calendars, lists or folders. They read and make supported changes to original entries, rather than work with imported copies. Complex or protected Notes content has reading or editing restrictions. Facilities for connecting accounts do not guarantee support for every service.

**Other ways to explore.** The prototype includes local dictation, a quick-entry window, image attachments for suitable AI models and web search. Dictation requires microphone access and speech-model resources; ending a recording in the global quick-entry mode can send the request immediately. An optional knowledge graph—a visual map of notes and their relationships—uses a separately configured analysis model. AI-inferred relationships are suggestions, not established facts.

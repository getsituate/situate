import type { EditorFile, Version } from "./model";

const outline = `---
id: 4c149f64-ea2d-426c-82a0-b7bedfa56c21
kind: note
---
# Autumn workshop

An afternoon to share ideas, make something small, and leave with a next step.

## What we want to make room for

Bring people together around one question: **what would make our everyday work a little better?** No presentations to prepare. Just a useful conversation and a little time to try things out.

> Leave with one small experiment, not a longer to-do list.

## The shape of the afternoon

1. **Arrive & settle in** — Coffee, introductions and a shared question.
2. **Explore in pairs** — Pick a real friction point and sketch a possible change.
3. **Bring it together** — Share what you tried and choose a next step.

## Before we meet

- Confirm the room and a quiet corner for pair work.
- Bring paper, pens and a few spare notebooks.
- Send the opening question with the invitation.

## A note for the invitation

Keep it informal. People should know that they can contribute without having the answer ready.
`;

function makeFile(
  name: string,
  folder: string,
  content: string,
  previous: Omit<Version, "key">[] = [],
): EditorFile {
  return {
    key: name,
    name,
    folder,
    content,
    draft: content,
    deleted: false,
    saveError: false,
    versions: [
      {
        label: "Today, 10:42",
        author: "You",
        note: previous.length
          ? "Refined the afternoon plan"
          : "Created this file",
        content,
      },
      ...previous,
    ].map((version, index) => ({ ...version, key: name + ":" + index })),
  };
}

export function editorFixtures(): EditorFile[] {
  return [
    makeFile("outline.md", "Projects/Autumn workshop", outline, [
      {
        label: "Yesterday, 16:18",
        author: "Situate",
        note: "Added a closing round",
        content: outline
          .replace(
            "An afternoon to share ideas, make something small, and leave with a next step.",
            "An afternoon to share ideas and explore a few possibilities.",
          )
          .replace(
            "> Leave with one small experiment, not a longer to-do list.\n\n",
            "",
          )
          .replace(
            "**Bring it together** — Share what you tried and choose a next step.",
            "**Bring it together** — Share what you tried.",
          ),
      },
      {
        label: "Monday, 09:12",
        author: "You",
        note: "Created the outline",
        content:
          "---\nid: 4c149f64-ea2d-426c-82a0-b7bedfa56c21\nkind: note\n---\n# Autumn workshop\n\nAn afternoon to share ideas.\n\n## Before we meet\n\n- Find a room.\n- Choose an opening question.\n",
      },
    ]),
    makeFile(
      "preparation.md",
      "Projects/Autumn workshop",
      "---\nid: 209bef27-dd0a-48bf-8413-d605ab13b3d3\n---\n# A few things to prepare\n\nEverything we need for a useful afternoon.\n\n- [ ] Confirm the room <!-- situate-task-id: 93e12765-92d1-4ed8-b889-49b34e8d2397 -->\n- [ ] Bring paper and pens\n- [x] Choose the opening question\n\n## Materials\n\nKeep it simple: notebooks, a timer and a clear wall for our ideas.\n",
    ),
    makeFile(
      "reading-list.md",
      "Resources",
      "---\nid: 8288d9ec-dc08-4331-acf9-ae5b853bdc55\n---\n# Things worth returning to\n\nA small collection of ideas for making space to think.\n\n## On collaboration\n\n- Start with a question, not a presentation.\n- Give people time to write before asking them to speak.\n- Make the next step small enough to try.\n",
    ),
    makeFile(
      "welcome.md",
      "",
      "---\nid: fefc0689-d12b-4b96-9d78-ac5a2d58c1f3\n---\n# A place for your thoughts\n\nNotes, plans and the things you want to keep close.\n\nThere is no right way to arrange them. Start where it makes sense to you.\n",
    ),
  ];
}

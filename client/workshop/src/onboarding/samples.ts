import type { EditorFile } from "../editor/model";
import type { OnboardingState } from "./model";
export function makeSampleFiles(s: OnboardingState): EditorFile[] {
  const project =
    s.methodDraft.information === "existing"
      ? "Reading ideas"
      : "Projects/Reading corner";
  const taskFolder = s.mapping === "inbox" ? "Inbox" : project;
  const rows = [
    {
      key: "import-reading-note",
      name: "Reading corner.md",
      folder: project,
      content: `# Reading corner\n\nA quiet corner for weekend reading. Reuse the small chair and bring a lamp from the study.\n\n## Related tasks\n\nThe task list is in **${taskFolder}/Reading tasks.md**. Keep one copy of each task there.\n\n## Source\n\nNotes export · Reading ideas\n`,
    },
    {
      key: "import-reading-tasks",
      name: "Reading tasks.md",
      folder: taskFolder,
      content: `# Reading corner tasks\n\n${s.mapping === "inbox" ? "Captured for clarification. Project context: Reading corner." : "Next actions for the Reading corner project."}\n\n- [ ] Measure the space by the window\n- [ ] Check the lamp cable\n\n${s.methodDraft.limit ? "Keep at most three tasks active across projects. These tasks have not been started." : "Choose a next action when you are ready."}\n\n## Source\n\nTask list export · Reading corner\n`,
    },
    {
      key: "import-weekend-note",
      name: "Weekend reading.md",
      folder: s.methodDraft.information === "para" ? "Resources" : "Notes",
      content:
        "# Weekend reading\n\nKeep a short list of books to return to. There is no deadline attached to this note.\n\n## Source\n\nNotes export · Loose notes\n",
    },
  ];
  return rows.map((row) => ({
    ...row,
    draft: row.content,
    deleted: false,
    saveError: false,
    versions: [],
  }));
}

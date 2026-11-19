import {
  upgradeNote,
  upgradeNoteAfter,
  upgradeNoteBefore,
  upgradeWorkspaceName,
} from "./upgrade-workspace-fixture.mjs";

export function upgradeWorkspaceJourney({ actions, verify, writable }) {
  const window = `${upgradeWorkspaceName} — Situate`;
  const button = (name) => ({ role: "AXButton", name, window });
  const text = (name) => ({ role: "AXStaticText", name, window });
  const editor = { role: "AXTextArea", name: "Markdown source", window };
  const click = (target) => actions([{ assert: target }, { click: target }]);
  const navigate = (name) =>
    actions([
      { navigation: button(name) },
      { assert: button(name) },
      { click: button(name) },
    ]);
  const expect = (target) => actions([{ assert: target }]);
  const key = (key, modifiers = []) => actions([{ key: { key, modifiers } }]);
  const fill = async (type) => {
    await actions([{ focus: editor }]);
    await key("a", ["command"]);
    const lines = type.split("\n");
    // System Events drops newlines in typed strings; send Return to the editor.
    await actions(
      lines.flatMap((line, index) => [
        ...(index ? [{ key: { key: "return", modifiers: [] } }] : []),
        ...(line ? [{ type: line }] : []),
      ]),
    );
    await expect({ ...editor, value: type });
  };
  const openNote = async () => {
    await navigate("Files");
    await click(button(upgradeNote));
    await click({ role: "AXPopUpButton", name: "File actions", window });
    await click({ role: "AXMenuItem", name: "Edit source", window });
  };
  const updates = async () => {
    await click(button("Update available"));
    await expect(text("The update is verified and ready to install."));
    await click(button("Install and restart"));
    await expect(text("Restart to update Situate?"));
    await click(button("Install and restart"));
  };
  return {
    async open() {
      await click({
        role: "AXButton",
        name: "Open a workspace Choose an existing Situate workspace folder.",
      });
      await key("g", ["command", "shift"]);
      await actions([{ folderField: true }]);
      await actions([
        { type: "{{upgradeWorkspace}}" },
        { folderField: "{{upgradeWorkspace}}" },
      ]);
      await key("return");
      await click({ role: "AXButton", name: "Open" });
      await openNote();
      await expect({ ...editor, value: upgradeNoteBefore });
      await verify(upgradeNoteBefore);
    },
    async author() {
      await fill(upgradeNoteAfter);
      await expect(text("Saved"));
      await verify(upgradeNoteAfter);
    },
    async update() {
      const unsaved = `${upgradeNoteAfter}\nUnsaved cancellation marker\n`;
      await writable(false);
      try {
        await fill(unsaved);
        await expect(text("Not saved"));
        await updates();
        await expect(text("Keep your unsaved changes"));
        await click(button("Cancel"));
        await navigate("Files");
        await expect({ ...editor, value: unsaved });
        await verify(upgradeNoteAfter);
      } finally {
        await writable(true);
      }
      await fill(upgradeNoteAfter);
      await expect(text("Saved"));
      await verify(upgradeNoteAfter);
      await updates();
    },
    async reopen() {
      await navigate("Archive follow-up");
      await expect(text("The field notes are ready to review."));
      await navigate("Plugins");
      await expect(text("Archive index"));
      await expect(button("Disable"));
      await openNote();
      await expect({ ...editor, value: upgradeNoteAfter });
      await verify(upgradeNoteAfter);
    },
  };
}

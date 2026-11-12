import type { EditorFile } from "../editor/model";
import copy from "../localization/en.import-result.json" with { type: "json" };
export type ImportIntent = "initial" | "changes" | "additional";
export const importHandoffDuration = 4600;
export function importHandoffFrame(timeMs: number) {
  const t = Number.isFinite(timeMs)
    ? Math.max(0, Math.min(importHandoffDuration, timeMs))
    : 0;
  const settle = (start: number, duration: number) =>
    1 - Math.pow(1 - Math.max(0, Math.min(1, (t - start) / duration)), 3);
  return {
    chatOpacity: 1 - settle(0, 550),
    chatScale: 1 - 0.025 * settle(0, 550),
    reveal: settle(400, 700),
    lift: 16 * (1 - settle(400, 700)),
  };
}
export function additionalImportFile(): EditorFile {
  return {
    key: "import-travel-note",
    name: "Travel notes.md",
    folder: "Travel",
    content: copy.additionalContent,
    draft: copy.additionalContent,
    deleted: false,
    saveError: false,
    versions: [],
  };
}
export function importedResult(
  intent: ImportIntent,
  files: EditorFile[],
  initial: EditorFile[],
): EditorFile[] {
  if (!files.length) return initial;
  const result = structuredClone(files);
  if (intent === "initial")
    result.push(
      ...initial.filter(
        (file) => !result.some((existing) => existing.key === file.key),
      ),
    );
  if (
    intent === "additional" &&
    !result.some((file) => file.key === "import-travel-note")
  )
    result.push(additionalImportFile());
  if (intent === "changes") {
    const file = result.find((file) => file.key === "import-reading-note");
    if (file) {
      const content = file.content.replace(
        "Reuse the small chair and bring a lamp from the study.",
        copy.revisionContent,
      );
      if (content !== file.content) {
        file.versions.unshift({
          key: `import-revision-${file.versions.length + 1}`,
          label: copy.history,
          author: "Situate",
          note: copy.history,
          content: file.content,
        });
        file.content = content;
        file.draft = content;
      }
    }
  }
  return result;
}

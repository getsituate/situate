import copy from "../localization/en.support-suggestions.json" with { type: "json" };
import type { OnboardingState, ToolId } from "./model";
import type { EditorFile } from "../editor/model";

export type SupportChoice = "develop" | "save" | "discard";
export interface SupportSuggestion {
  id: ToolId;
  title: string;
  detail: string;
  reason: string;
  request: string;
}
export interface SupportState {
  phase: "idle" | "working" | "ready" | "error";
  outcome: "success" | "failure" | "wait";
  example: "standard" | "fewer" | "none";
  attempt: number;
  requestExample: "standard" | "fewer" | "none";
  saveOutcome: "success" | "failure";
  inputs: {
    organization: string;
    limit: boolean;
    review: boolean;
    paths: Record<ToolId, string[]>;
  } | null;
  proposals: SupportSuggestion[];
  choices: Partial<Record<ToolId, SupportChoice>>;
  confirmError: "offline" | "save" | null;
  savedNotes: Array<{ key: string; title: string }>;
}
export const newSupport = (): SupportState => ({
  phase: "idle",
  outcome: "success",
  example: "standard",
  requestExample: "standard",
  saveOutcome: "success",
  inputs: null,
  attempt: 0,
  proposals: [],
  choices: {},
  confirmError: null,
  savedNotes: [],
});
export function supportInputs(
  s: OnboardingState,
): NonNullable<SupportState["inputs"]> {
  const paths = s.imported
    .filter((file) => !file.deleted)
    .map((file) => [file.folder, file.name].filter(Boolean).join("/"));
  const relevant = (pattern: RegExp) =>
    paths.filter((path) => pattern.test(path)).slice(0, 6);
  return {
    organization: s.organization,
    limit: s.methodDraft.limit,
    review: s.methodDraft.review !== "none",
    paths: {
      board: relevant(/task|inbox/i),
      review: relevant(/project|task|inbox/i),
      documents: paths.slice(0, 6),
    },
  };
}
export function supportSuggestions(s: OnboardingState): SupportSuggestion[] {
  const inputs = s.support.inputs;
  if (s.support.requestExample === "none" || !inputs) return [];
  const ids: ToolId[] = [];
  if (inputs.limit) ids.push("board");
  if (inputs.review) ids.push("review");
  if (inputs.paths.documents.length) ids.push("documents");
  return ids
    .slice(0, s.support.requestExample === "fewer" ? 1 : 3)
    .map((id) => ({ id, ...copy[id] }));
}
export function supportRequest(
  s: OnboardingState,
  suggestion: SupportSuggestion,
): string {
  const inputs = s.support.inputs;
  const paths = inputs?.paths[suggestion.id] ?? [];
  return [
    suggestion.request,
    copy.methodHeading + ":\n" + (inputs?.organization ?? s.organization),
    paths.length
      ? copy.filesHeading + ":\n" + paths.join("\n")
      : copy.cleanContext,
  ].join("\n\n");
}
export function supportNote(
  s: OnboardingState,
  suggestion: SupportSuggestion,
  files: EditorFile[],
): EditorFile {
  let suffix = 1;
  let name = suggestion.title + ".md";
  while (
    files.some(
      (file) =>
        file.folder === "" && file.name.toLowerCase() === name.toLowerCase(),
    )
  )
    name = `${suggestion.title} (${++suffix}).md`;
  let key = `support-${suggestion.id}`;
  let index = 1;
  while (files.some((file) => file.key === key))
    key = `support-${suggestion.id}-${++index}`;
  const content =
    [
      `# ${suggestion.title}`,
      copy.notePurpose,
      suggestion.detail,
      suggestion.reason,
      `## ${copy.requestHeading}`,
      supportRequest(s, suggestion),
    ].join("\n\n") + "\n";
  return {
    key,
    name,
    folder: "",
    content,
    draft: content,
    versions: [],
    deleted: false,
    saveError: false,
  };
}

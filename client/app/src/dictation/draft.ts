import { startDictation, type Notice } from "./runtime";

export interface DictationDraft {
  draft: string;
  draftSelection: {
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
  } | null;
  dictationNotice: Notice | null;
  dictationInserted: number;
  unsaved: boolean;
}

export async function dictateDraft(
  scope: string,
  conversation: string,
  state: DictationDraft,
  live: () => boolean,
  save: () => Promise<void>,
): Promise<void> {
  state.dictationNotice = null;
  await startDictation(
    scope,
    conversation,
    (text, notice) => {
      if (!live()) return;
      state.dictationNotice = notice ?? null;
      if (!text) return;
      const draft = state.draft;
      const selection = state.draftSelection;
      const start = Math.min(
        draft.length,
        Math.max(0, selection?.start ?? draft.length),
      );
      const end = Math.min(
        draft.length,
        Math.max(start, selection?.end ?? start),
      );
      state.draftSelection = {
        start: start + text.length,
        end: start + text.length,
        direction: "none",
      };
      state.draft = draft.slice(0, start) + text + draft.slice(end);
      state.dictationInserted++;
      void save().catch(() => {
        state.unsaved = true;
      });
    },
    live,
  );
}

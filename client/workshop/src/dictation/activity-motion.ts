import type { DictationState } from "./model";

type Speech = DictationState["speech"];

export const phraseDuration = 4800;

// Phrase pauses distinguish silence from ongoing transcription activity.
const phrase = [
  0, 0.2, 0.65, 1, 0.45, 0.8, 0.3, 0, 0, 0.15, 0.75, 0.5, 1, 0.6, 0.25, 0, 0,
  0.4, 0.9, 0.55, 0.8, 0.35, 0, 0, 0,
];

function frame(energy: number) {
  return { transform: `scaleY(${0.125 + energy * 0.8})` };
}

export function restingFrame(speech: Speech, index: number) {
  const volume = speech === "silence" ? 0 : speech === "quiet" ? 0.22 : 0.65;
  return frame(volume * (0.4 + 0.5 * Math.abs(Math.sin(index * 1.7))));
}

export function recordingFrames(speech: Speech, index: number): Keyframe[] {
  const volume = speech === "silence" ? 0 : speech === "quiet" ? 0.3 : 1;
  return phrase.map((level, beat) =>
    frame(
      volume *
        level *
        (0.35 + 0.65 * Math.abs(Math.sin(index * 1.7 + beat * 1.1))),
    ),
  );
}

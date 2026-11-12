import {
  validReference,
  validReferencePath,
  type ContentReference,
} from "../ai/content-references";

export interface SupportIdea {
  id: string;
  title: string;
  detail: string;
  reason: string;
  assignment: string;
  choice: null | "develop" | "save" | "discard";
  developmentId: string;
  pluginId: string;
  notePath: string | null;
}

export interface OnboardingRecord {
  schemaVersion: 1;
  step:
    | "access"
    | "method"
    | "proposal"
    | "sources"
    | "review"
    | "support"
    | "complete";
  conversationId?: string | null;
  fresh?: boolean;
  intent?: "keep" | "change" | "help";
  entered?: boolean;
  description: string;
  approaches: string[];
  feedback: string;
  proposal: string;
  openPoints?: string[];
  instructionBase: { text: string; revision: string } | null;
  instructionRevision: string | null;
  methodConversationId: string | null;
  sourceDescription: string;
  sourceConversationId: string | null;
  supportConversationId: string | null;
  imported: ContentReference[];
  ideas: SupportIdea[];
  paused: boolean;
}

export interface OnboardingSnapshot {
  record: OnboardingRecord | null;
  revision: string | null;
  writable: boolean;
}

export function newOnboardingRecord(): OnboardingRecord {
  return {
    schemaVersion: 1,
    step: "access",
    conversationId: null,
    fresh: false,
    intent: "help",
    entered: false,
    description: "",
    approaches: [],
    feedback: "",
    proposal: "",
    instructionBase: null,
    instructionRevision: null,
    methodConversationId: null,
    sourceDescription: "",
    sourceConversationId: null,
    supportConversationId: null,
    imported: [],
    ideas: [],
    paused: false,
  };
}

const encoder = new TextEncoder();
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max = 65_536): value is string =>
  typeof value === "string" && encoder.encode(value).length <= max;
const revision = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length === 40 &&
  /^[a-f0-9]{40}$/.test(value);
const id = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 64 &&
  !/[^a-z0-9_-]/.test(value);
const nullable = (value: unknown, valid: (v: unknown) => boolean): boolean =>
  value === null || valid(value);
const keys = (value: Record<string, unknown>, names: string[]): boolean =>
  Object.keys(value).length === names.length &&
  names.every((key) => key in value);

function validIdea(value: unknown): value is SupportIdea {
  return (
    object(value) &&
    keys(value, [
      "id",
      "title",
      "detail",
      "reason",
      "assignment",
      "choice",
      "developmentId",
      "pluginId",
      "notePath",
    ]) &&
    id(value.id) &&
    text(value.title, 512) &&
    value.title.trim().length > 0 &&
    text(value.detail) &&
    text(value.reason) &&
    text(value.assignment, 16_384) &&
    (value.choice === null ||
      ["develop", "save", "discard"].includes(value.choice as string)) &&
    (value.choice !== "develop" || value.assignment.trim().length > 0) &&
    typeof value.developmentId === "string" &&
    value.developmentId.length === 36 &&
    /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value.developmentId) &&
    typeof value.pluginId === "string" &&
    !/[^a-z0-9-]/.test(value.pluginId) &&
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value.pluginId) &&
    ![".", "..", "con", "prn", "aux", "nul"].includes(value.pluginId) &&
    !/^(?:com|lpt)[1-9]$/.test(value.pluginId) &&
    nullable(
      value.notePath,
      (path) =>
        validReferencePath(path) &&
        path
          .split("/")
          .every(
            (part) =>
              !/[. ]$/.test(part) &&
              ![".situate", ".git"].includes(part.toLowerCase()) &&
              !part.toLowerCase().startsWith(".situate-write-"),
          ),
    )
  );
}

function validRecord(value: unknown): value is OnboardingRecord {
  if (
    !object(value) ||
    !keys(value, [
      ...Object.keys(newOnboardingRecord()).filter(
        (key) =>
          !["conversationId", "fresh", "intent", "entered"].includes(key) ||
          key in value,
      ),
      ...("openPoints" in value ? ["openPoints"] : []),
    ])
  )
    return false;
  return (
    value.schemaVersion === 1 &&
    [
      "access",
      "method",
      "proposal",
      "sources",
      "review",
      "support",
      "complete",
    ].includes(value.step as string) &&
    (!("conversationId" in value) || nullable(value.conversationId, id)) &&
    (!("fresh" in value) || typeof value.fresh === "boolean") &&
    (!("intent" in value) ||
      ["keep", "change", "help"].includes(value.intent as string)) &&
    (!("entered" in value) || typeof value.entered === "boolean") &&
    (value.entered !== true ||
      (revision(value.instructionRevision) &&
        ["proposal", "sources", "review", "support", "complete"].includes(
          value.step as string,
        ))) &&
    text(value.description) &&
    text(value.feedback) &&
    text(value.proposal) &&
    (!("openPoints" in value) ||
      (Array.isArray(value.openPoints) &&
        value.openPoints.length <= 8 &&
        value.openPoints.every(
          (point) => text(point, 2048) && point.trim().length > 0,
        ))) &&
    text(value.sourceDescription) &&
    Array.isArray(value.approaches) &&
    value.approaches.length <= 32 &&
    value.approaches.every((v) => text(v, 256)) &&
    nullable(
      value.instructionBase,
      (v) =>
        object(v) &&
        keys(v, ["text", "revision"]) &&
        text(v.text) &&
        revision(v.revision),
    ) &&
    nullable(value.instructionRevision, revision) &&
    nullable(value.methodConversationId, id) &&
    nullable(value.sourceConversationId, id) &&
    nullable(value.supportConversationId, id) &&
    Array.isArray(value.imported) &&
    value.imported.length <= 10_000 &&
    value.imported.every(validReference) &&
    Array.isArray(value.ideas) &&
    value.ideas.length <= 32 &&
    value.ideas.every(validIdea) &&
    new Set(value.ideas.map((idea) => idea.id)).size === value.ideas.length &&
    new Set(value.ideas.map((idea) => idea.developmentId)).size ===
      value.ideas.length &&
    typeof value.paused === "boolean"
  );
}

export function isOnboardingSnapshot(
  value: unknown,
): value is OnboardingSnapshot {
  return (
    object(value) &&
    keys(value, ["record", "revision", "writable"]) &&
    typeof value.writable === "boolean" &&
    (value.record === null
      ? value.revision === null
      : validRecord(value.record) && revision(value.revision))
  );
}

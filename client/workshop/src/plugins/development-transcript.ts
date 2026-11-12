import type { Event } from "../chat/model";
import type { Development } from "./model";
import { c } from "./content";
import copy from "../localization/en.assignment-files.json";
import { changePath } from "./assignment-files";

export function developmentTranscript(d: Development): Event[] {
  return d.messages.flatMap((message, index): Event[] => {
    const latest = index === d.messages.length - 1;
    const records = d.inspection.recordedChanges.filter(
      (change) =>
        change.provenance.attribution === "recorded" &&
        (change.provenance.conversationId === d.id ||
          change.provenance.conversationId === "assignment-notes") &&
        (change.provenance.runId?.endsWith(`-run-${index + 1}`) ||
          (index === 0 && change.provenance.runId === "run-1")),
    );
    const calls: Event[] = records.map((change) => ({
      kind: "call",
      id: `call-${change.id}`,
      tool:
        change.provenance.source === "write"
          ? {
              modified: "edit",
              added: "write",
              deleted: "remove",
              renamed: "move",
            }[change.operation]
          : change.provenance.source,
      label:
        change.group === "workspace"
          ? copy.operations[change.operation]
          : copy.changeLabel
              .replace("{action}", copy.operations[change.operation])
              .replace("{name}", change.packageName || changePath(change)),
      input: JSON.stringify(
        {
          path: changePath(change),
          before:
            change.before?.status === "available"
              ? change.before.text
              : undefined,
          after:
            change.after?.status === "available"
              ? change.after.text
              : undefined,
        },
        null,
        2,
      ),
      result: [change.before, change.after].some(
        (r) => r?.status === "unavailable",
      )
        ? copy.unavailable
        : copy.recorded,
      visible:
        change.group === "workspace" &&
        change.provenance.source === "write" &&
        ["added", "modified"].includes(change.operation),
      contentNotice: [change.before, change.after].some(
        (r) => r?.status === "unavailable",
      )
        ? copy.unavailable
        : [change.before, change.after].some((r) => r?.status === "unsupported")
          ? copy.unsupported
          : undefined,
      file: changePath(change),
      before:
        change.before?.status === "available" ? change.before.text : undefined,
      after:
        change.after?.status === "available" ? change.after.text : undefined,
    }));
    const exceptional =
      latest &&
      ["failed", "uncertain", "notification-failed"].includes(d.activation);
    const response = exceptional
      ? c.assignment.activationDetails[d.activation]
      : c.phaseDetails[d.responses[index]];
    return [
      {
        kind: "message",
        speaker: "user",
        id: `request-${index}`,
        text: message,
      },
      ...calls,
      {
        kind: "message",
        speaker: "assistant",
        id: `response-${index}`,
        text: [response, latest ? d.check.detail : ""]
          .filter(Boolean)
          .join("\n\n"),
      },
    ];
  });
}

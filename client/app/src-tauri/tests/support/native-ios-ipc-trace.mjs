const operations = new Map([
  ["plugin_executor", "stop"],
  ["plugin_process_abort", "abort"],
  ["ai_conversations_abort", "abort"],
  ["ai_conversation_action", "draft"],
  ["workspace_action", "close"],
]);
const statuses = new Set(["pending", "completed", "rejected"]);
const codes = new Set([
  "native.plugins.unavailable",
  "native.plugins.hostCancelled",
  "native.plugins.stateSaveFailed",
  "native.plugins.actionSaveFailed",
  "native.plugins.stateOutcomeUnknown",
  "native.ai.request.failed",
  "native.ai.turn.inactive",
  "native.ai.conversation.unsaved",
]);
const limit = 32;

export function sanitizeIpcTrace(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).flatMap((row) => {
    if (
      !row ||
      !operations.has(row.command) ||
      operations.get(row.command) !== row.operation ||
      !statuses.has(row.status)
    )
      return [];
    return [
      {
        command: row.command,
        operation: row.operation,
        status: row.status,
        code:
          row.status === "rejected"
            ? codes.has(row.code)
              ? row.code
              : "unclassified"
            : null,
      },
    ];
  });
}

export function createIpcTrace(original) {
  const rows = [];
  let active = false;
  return {
    start() {
      rows.length = 0;
      active = true;
    },
    stop() {
      active = false;
    },
    snapshot() {
      return sanitizeIpcTrace(rows);
    },
    recordFailure(command, operation, error) {
      if (
        active &&
        rows.length < limit &&
        operations.has(command) &&
        operations.get(command) === operation
      )
        rows.push({
          command,
          operation,
          status: "rejected",
          code: codes.has(error) ? error : "unclassified",
        });
    },
    invoke(...args) {
      const [command, parameters] = args;
      let operation;
      try {
        if (active && rows.length < limit && operations.has(command)) {
          if (command === "plugin_executor")
            operation = parameters?.request?.operation;
          else if (command === "ai_conversation_action")
            operation = parameters?.action?.type;
          else if (command === "workspace_action")
            operation = parameters?.action;
          else operation = "abort";
        }
      } catch {
        // Observation must not prevent the original transport call.
      }
      const row =
        operation && operations.get(command) === operation
          ? { command, operation, status: "pending", code: null }
          : null;
      if (row) rows.push(row);
      const rejected = (error) => {
        if (row) {
          row.status = "rejected";
          row.code = codes.has(error) ? error : "unclassified";
        }
      };
      let result;
      try {
        result = original(...args);
      } catch (error) {
        rejected(error);
        throw error;
      }
      if (row)
        Promise.resolve(result).then(() => {
          row.status = "completed";
        }, rejected);
      return result;
    },
  };
}

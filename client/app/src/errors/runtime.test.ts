import { afterEach, expect, test } from "vitest";
import {
  captureIncident,
  dismissIncident,
  openIncident,
  recoveryState,
  resetIncidents,
  resolveIncident,
  retainIncidentScopes,
  safeFailureCode,
} from "./runtime";
import { incidentDetails, problemReport } from "./report";
afterEach(resetIncidents);
test("repeated background delivery retains one dismissed incident and its description", () => {
  const first = captureIncident(
    "view",
    new Error("private exception"),
    "scope",
  );
  first.description = "Opening the list";
  dismissIncident();
  expect(
    captureIncident("view", new Error("another private message"), "scope"),
  ).toBe(first);
  expect(recoveryState.page).toBeNull();
  expect(recoveryState.incidents).toHaveLength(1);
  expect(first.description).toBe("Opening the list");
  openIncident(first, "report");
  expect(recoveryState.page).toBe("report");
  resolveIncident(first);
  expect(captureIncident("view", undefined, "scope")).not.toBe(first);
});
test("known codes are retained without invoking untrusted getters or serializing causes", () => {
  const hostile = Object.defineProperty({}, "message", {
    get() {
      throw new Error("must not read");
    },
  });
  expect(safeFailureCode(hostile)).toBe("unknown");
  expect(safeFailureCode(new Error("native.plugins.unavailable"))).toBe(
    "native.plugins.unavailable",
  );
  expect(
    safeFailureCode(
      new Proxy(
        {},
        {
          getOwnPropertyDescriptor() {
            throw new Error("private");
          },
        },
      ),
    ),
  ).toBe("unknown");
  expect(safeFailureCode("/private/path credential")).toBe("unknown");
});
test("bounded incidents keep an active dialog and discard closed workspace context", () => {
  const active = captureIncident("view", undefined, "active");
  for (let i = 0; i < 20; i++)
    captureIncident("files", undefined, "scope-" + i);
  expect(recoveryState.incidents).toHaveLength(8);
  expect(recoveryState.incidents).toContain(active);
  retainIncidentScopes([]);
  expect(recoveryState.incidents).toHaveLength(0);
  expect(recoveryState.page).toBeNull();
});
test("different incidents remain discoverable without stacking dialogs", () => {
  const active = captureIncident("view", undefined, "one");
  const next = captureIncident("files", undefined, "two");
  expect(recoveryState.active).toBe(active);
  expect(recoveryState.incidents).toContain(next);
  dismissIncident();
  openIncident(next);
  expect(recoveryState.active).toBe(next);
});
test("reports include bounded technical evidence but no workspace path or exception", () => {
  const incident = captureIncident(
    "promise",
    new Error("TOKEN PRIVATE_ERROR"),
    "/private/workspace",
  );
  incident.description = "x".repeat(3000);
  const details = incidentDetails(incident, "0.1.4");
  const report = problemReport(incident, details);
  expect(report).toContain(incident.id);
  expect(report).toContain("0.1.4");
  expect(report).not.toContain("PRIVATE_ERROR");
  expect(report).not.toContain("/private/workspace");
  expect(report).not.toContain("TOKEN");
  expect(report).not.toContain("x".repeat(2001));
});

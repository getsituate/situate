import { describe, expect, it } from "vitest";
import { welcomeStudy } from "./welcome-studies";

describe("fullscreen welcome studies", () => {
  it.each(["opus", "astra"] as const)(
    "loads the %s view and its score",
    (study) => {
      const entry = welcomeStudy(study);
      expect(entry?.component).toBeDefined();
      expect(Number.isFinite(entry?.durationMs)).toBe(true);
      expect(entry!.durationMs).toBeGreaterThan(0);
    },
  );
  it("keeps the original welcome separate", () => {
    expect(welcomeStudy("original")).toBeNull();
  });
});

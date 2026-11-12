export const implementationStates = ["open", "in-progress", "implemented"];

export function implementationSummary(criteria = []) {
  const total = criteria.length;
  const implemented = criteria.filter(
    (criterion) => criterion.status === "implemented",
  ).length;
  const status = !total
    ? "untracked"
    : implemented === total
      ? "implemented"
      : implemented
        ? "partial"
        : criteria.some((criterion) => criterion.status === "in-progress")
          ? "in-progress"
          : "open";
  return { total, implemented, status };
}

export function milestoneNames(entries) {
  return [
    ...new Set(
      entries.flatMap((entry) =>
        (entry.acceptanceCriteria || []).flatMap((criterion) =>
          criterion.milestone ? [criterion.milestone] : [],
        ),
      ),
    ),
  ].sort((a, b) => a.localeCompare(b, "en"));
}

export function milestoneScope(entries, milestone) {
  return entries.flatMap((entry) => {
    const criteria = (entry.acceptanceCriteria || []).filter(
      (criterion) => (criterion.milestone || "") === milestone,
    );
    return criteria.length ? [{ entry, criteria }] : [];
  });
}

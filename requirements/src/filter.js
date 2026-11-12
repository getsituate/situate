export function filterEntries(entries, filters) {
  const terms = (filters.q || "")
    .toLocaleLowerCase("en")
    .split(/\s+/)
    .filter(Boolean);
  return entries.filter((entry) => {
    const text = [
      entry.id,
      entry.title,
      entry.area,
      entry.body,
      ...(entry.goals || []),
      ...(entry.acceptanceCriteria || []).flatMap((criterion) => [
        criterion.id,
        criterion.text,
        criterion.milestone || "",
        criterion.status,
      ]),
    ]
      .join(" ")
      .toLocaleLowerCase("en");
    return (
      terms.every((term) => text.includes(term)) &&
      ["type", "area", "status", "priority"].every(
        (key) => !filters[key] || entry[key] === filters[key],
      )
    );
  });
}

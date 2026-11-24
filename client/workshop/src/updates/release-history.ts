import copy from "../localization/en.updates.json" with { type: "json" };

export type Release = {
  version: string;
  date: string;
  entries: readonly { title: string; text: string }[];
};

const releaseCatalog: readonly Release[] = [
  { version: "0.8.2", date: "2026-10-29", entries: [] },
  { version: "0.8.1", date: "2026-10-28", entries: copy.changes["0.8.1"] },
  { version: "0.8.0", date: "2026-10-20", entries: copy.changes["0.8.0"] },
  { version: "0.7.2", date: "2026-10-12", entries: copy.changes["0.7.2"] },
  { version: "0.7.1", date: "2026-10-06", entries: copy.changes["0.7.1"] },
  { version: "0.7.0", date: "2026-10-01", entries: copy.changes["0.7.0"] },
  { version: "0.6.0", date: "2026-09-30", entries: [] },
];

export function installedReleaseCatalog(installed: string) {
  if (!/^\d+\.\d+\.\d+$/.test(installed)) return [];
  const ceiling = installed.split(".").map(Number);
  return releaseCatalog.filter((release) => {
    if (!release.entries.length) return false;
    const parts = release.version.split(".").map(Number);
    for (let index = 0; index < 3; index++) {
      if (parts[index] !== ceiling[index])
        return parts[index]! < ceiling[index]!;
    }
    return true;
  });
}

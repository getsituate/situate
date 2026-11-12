export const releaseCatalog = [
  { version: "0.8.1", date: "2026-10-28", content: "latest" },
  { version: "0.8.0", date: "2026-10-20", content: "0.8.0" },
  { version: "0.7.2", date: "2026-10-12", content: "0.7.2" },
  { version: "0.7.1", date: "2026-10-06", content: "0.7.1" },
  { version: "0.7.0", date: "2026-10-01", content: "0.7.0" },
] as const;
export type ReleaseContent = (typeof releaseCatalog)[number]["content"];

export function installedReleaseCatalog(installed: string) {
  if (!/^\d+\.\d+\.\d+$/.test(installed)) return [];
  const ceiling = installed.split(".").map(Number);
  return releaseCatalog.filter((release) => {
    const parts = release.version.split(".").map(Number);
    for (let index = 0; index < 3; index++) {
      if (parts[index] !== ceiling[index])
        return parts[index]! < ceiling[index]!;
    }
    return true;
  });
}

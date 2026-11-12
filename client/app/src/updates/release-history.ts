import { getVersion } from "@tauri-apps/api/app";
import { shallowRef } from "vue";

export interface ReleaseText {
  title: string;
  entries: {
    id: string;
    type: "new" | "changed" | "fixed" | "important";
    platforms: ("macos" | "ios")[];
    title: string;
    paragraphs: string[];
  }[];
}
export interface ReleaseCatalog {
  schemaVersion: 1;
  installedVersion: string;
  releases: {
    version: string;
    date?: string;
    locales: { en: ReleaseText; de?: ReleaseText };
  }[];
}
declare global {
  const __SITUATE_RELEASE_HISTORY__: ReleaseCatalog;
}

function version(value: unknown): number[] | null {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
  )
    return null;
  const parts = value.split(".").map(Number);
  return parts.every(Number.isSafeInteger) ? parts : null;
}
function compare(a: string, b: string): number {
  const left = version(a)!;
  const right = version(b)!;
  return left[0]! - right[0]! || left[1]! - right[1]! || left[2]! - right[2]!;
}
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is ReleaseText {
  return (
    record(value) &&
    typeof value.title === "string" &&
    !!value.title.trim() &&
    Array.isArray(value.entries) &&
    value.entries.every(
      (entry: unknown) =>
        record(entry) &&
        typeof entry.id === "string" &&
        !!entry.id &&
        ["new", "changed", "fixed", "important"].includes(String(entry.type)) &&
        Array.isArray(entry.platforms) &&
        entry.platforms.length > 0 &&
        entry.platforms.every((p: unknown) => p === "macos" || p === "ios") &&
        typeof entry.title === "string" &&
        !!entry.title.trim() &&
        Array.isArray(entry.paragraphs) &&
        entry.paragraphs.every((p: unknown) => typeof p === "string"),
    )
  );
}

export function readReleaseCatalog(
  value: unknown,
  installed?: string,
): ReleaseCatalog {
  const identity =
    installed ??
    (record(value) && typeof value.installedVersion === "string"
      ? value.installedVersion
      : "");
  const empty: ReleaseCatalog = {
    schemaVersion: 1,
    installedVersion: version(identity) ? identity : "",
    releases: [],
  };
  if (
    !empty.installedVersion ||
    !record(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.releases)
  )
    return empty;
  const seen = new Set<string>();
  for (const release of value.releases) {
    if (
      !record(release) ||
      typeof release.version !== "string" ||
      !version(release.version) ||
      compare(release.version, identity) > 0 ||
      seen.has(release.version) ||
      !record(release.locales) ||
      !text(release.locales.en)
    )
      continue;
    if (
      release.date !== undefined &&
      (typeof release.date !== "string" ||
        !/^\d{4}-\d{2}-\d{2}$/.test(release.date) ||
        !Number.isFinite(Date.parse(release.date)) ||
        new Date(release.date).toISOString().slice(0, 10) !== release.date)
    )
      continue;
    seen.add(release.version);
    empty.releases.push({
      version: release.version,
      ...(typeof release.date === "string" ? { date: release.date } : {}),
      locales: {
        en: release.locales.en,
        ...(text(release.locales.de) ? { de: release.locales.de } : {}),
      },
    });
  }
  empty.releases.sort((a, b) => compare(b.version, a.version));
  return empty;
}
const bundled: unknown =
  typeof __SITUATE_RELEASE_HISTORY__ === "undefined"
    ? undefined
    : __SITUATE_RELEASE_HISTORY__;
const input: unknown =
  (import.meta.env.DEV &&
    typeof window !== "undefined" &&
    Reflect.get(window, "__releaseHistoryFixture")) ||
  bundled;
export const releaseCatalog = readReleaseCatalog(input);
export const installedVersion = shallowRef(releaseCatalog.installedVersion);
let identityRequest: Promise<void> | undefined;
export function loadInstalledVersion(): Promise<void> {
  return (identityRequest ??= getVersion()
    .then((value) => {
      if (version(value)) installedVersion.value = value;
    })
    .catch(() => {
      /* Bundled identity remains available when the native bridge is unavailable. */
    }));
}
export function installedReleases(): ReleaseCatalog {
  return readReleaseCatalog(input, installedVersion.value);
}

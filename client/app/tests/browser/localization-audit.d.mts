export interface LocalizationViolation {
  url: string;
  element: string;
  kind: string;
  value: string;
}
export function installLocalizationAudit(options: {
  catalog: Record<string, string>;
  mode?: "keys" | "real";
}): void;
declare global {
  var __SITUATE_LOCALIZATION_KEYS__: boolean;
  var __situateReportLocalization: (
    violation: LocalizationViolation,
  ) => Promise<void>;
  var __situateFlushLocalization: (() => Promise<void>) | undefined;
}

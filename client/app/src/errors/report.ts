import { t } from "@situate/localization";
import type { Incident } from "./runtime";
export function incidentDetails(incident: Incident, version: string): string {
  return t("errorRecovery.technical", {
    id: incident.id,
    boundary: incident.boundary,
    code: incident.code,
    version: /^[0-9A-Za-z.+-]{1,64}$/.test(version) ? version : "unknown",
  });
}
export function problemReport(incident: Incident, details: string): string {
  return [
    t("errorRecovery.summary"),
    incident.description.slice(0, 2000),
    details,
  ]
    .filter(Boolean)
    .join("\n\n");
}

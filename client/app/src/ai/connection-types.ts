export interface Config {
  provider: string;
  endpoint: string | null;
  auth?: "api_key" | "oauth";
  connectionId?: string;
  label?: string;
  httpAcknowledgement?: string;
}
export interface ModelCatalog {
  source: "account" | "provider" | "static" | "unknown";
  models: string[];
}

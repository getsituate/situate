export interface Config {
  provider: string;
  endpoint: string | null;
  auth?: "api_key" | "oauth";
  connectionId?: string;
  label?: string;
  httpAcknowledgement?: string;
}
export interface DiscoveredModel {
  id: string;
  contextWindow: number;
  maxTokens: number;
  imageInput?: boolean;
}
export interface ModelCatalog {
  source: "account" | "provider" | "static" | "unknown";
  models: string[];
  selectable?: DiscoveredModel[];
}

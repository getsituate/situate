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
  name?: string;
  thinkingLevels?: ("minimal" | "low" | "medium" | "high" | "xhigh" | "max")[];
  reasoningNone?: boolean;
  contextWindow: number;
  maxTokens: number;
  imageInput?: boolean;
  thinking?: { levels: string[]; default: string };
}
export interface ModelCatalog {
  source: "account" | "provider" | "static" | "manual" | "unknown";
  models: string[];
  selectable?: DiscoveredModel[];
}

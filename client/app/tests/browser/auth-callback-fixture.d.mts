export function callbackText(language: "en" | "de", key: string): string;
export function callbackPage(options?: {
  language?: "en" | "de";
  accepted?: boolean;
}): {
  status: number;
  body: string;
  headers: Record<string, string>;
};

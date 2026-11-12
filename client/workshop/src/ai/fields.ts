import type { AiState } from "./model";
import { normalizeDestination } from "./transport";
import { transportCopy } from "./content";
export interface AuthField {
  id: string;
  label: string;
  placeholder: string;
  type: string;
  hint: string;
  required: boolean;
  options?: { id: string; label: string }[];
  group?: string;
}
const field = (
  id: string,
  label: string,
  placeholder = "",
  type = "text",
  hint = "",
  required = true,
): AuthField => ({ id, label, placeholder, type, hint, required });
const secret = (id = "credential", label = "API key or token") =>
  field(
    id,
    label,
    "example-key-not-valid",
    "password",
    "Used only for this workspace’s connection.",
  );
const select = (
  id: string,
  label: string,
  options: [string, string][],
): AuthField => ({
  ...field(id, label),
  options: options.map(([id, label]) => ({ id, label })),
});
function providerFields(provider: string): AuthField[] {
  if (provider.startsWith("cloudflare"))
    return [
      field("account", "Cloudflare account ID", "example-account"),
      ...(provider === "cloudflare-ai-gateway"
        ? [field("gateway", "Gateway ID", "example-gateway")]
        : []),
    ];
  if (provider === "azure")
    return [
      field(
        "endpoint",
        "Resource URL or resource name",
        "https://example-resource.ai.azure.com",
      ),
    ];
  if (["compatible", "llama.cpp"].includes(provider))
    return [field("endpoint", "Base URL", "http://localhost:8080", "url")];
  return [];
}
export function authFields(state: AiState): AuthField[] {
  const { provider, method, screen } = state;
  if (screen === "key")
    return [
      secret(
        "credential",
        method === "bearer" ? "Bearer token" : "API key or token",
      ),
      ...providerFields(provider),
      ...(state.explorationMode
        ? [
            field(
              "base-override",
              "Base URL override",
              "https://example-provider.invalid/v1",
              "url",
              "",
              false,
            ),
            field(
              "headers-override",
              "Additional headers",
              "X-Example: example-value",
              "password",
              "Use only configuration supported by this endpoint.",
              false,
            ),
          ].map((item) => ({ ...item, group: "Endpoint and header overrides" }))
        : []),
    ];
  if (screen === "browser" || screen === "copy-code")
    return provider === "radius" ||
      (!state.explorationMode && screen === "browser")
      ? []
      : [
          field(
            "code",
            screen === "copy-code"
              ? "Authorization code"
              : provider === "openai"
                ? "Final redirect URL"
                : "Authorization code or redirect URL",
            "example-return-value",
            "password",
            screen === "copy-code"
              ? "Paste only the code from this sign-in attempt."
              : "Use this if the browser did not return automatically. Keep the full return value private.",
          ),
        ];
  if (screen === "device")
    return provider === "github-copilot" && !state.deviceIssued
      ? [
          field(
            "domain",
            "GitHub Enterprise URL or domain",
            "Leave blank for github.com",
            "text",
            "",
            false,
          ),
        ]
      : [];
  if (screen === "cloud") {
    if (method === "profile")
      return [
        field("profile", "AWS profile name", "example-profile"),
        field(
          "region",
          "Region",
          "eu-central-1",
          "text",
          "Optional when supplied by the profile.",
          false,
        ),
      ];
    if (method === "chain") {
      const fields = [
        select("aws-source", "Credential source", [
          ["existing", "Existing device credentials"],
          ["iam", "IAM access keys"],
          ["ecs", "ECS task credentials"],
          ["web", "Web identity (IRSA)"],
        ]),
      ];
      const source = state.values["aws-source"] || "existing";
      if (source === "iam")
        fields.push(
          field("access-id", "AWS access key ID", "example-access-id"),
          secret("credential", "AWS secret access key"),
          field(
            "session-token",
            "Session token",
            "example-session-token",
            "password",
            "Required for temporary credentials.",
            false,
          ),
        );
      if (source === "ecs")
        fields.push(
          field(
            "container-uri",
            "Container credentials URI",
            "/example/credentials",
            "text",
            "Relative or full URI supplied by the container runtime.",
          ),
          field(
            "authorization-token",
            "Container authorization token",
            "",
            "password",
            "",
            false,
          ),
        );
      if (source === "web")
        fields.push(
          field("file", "Web identity token file", "example-identity-token"),
          field("role", "Role ARN", "arn:aws:iam::000000000000:role/example"),
          field("session-name", "Role session name", "", "text", "", false),
        );
      fields.push(
        field(
          "region",
          "Region",
          "eu-central-1",
          "text",
          "Optional when supplied by the AWS configuration.",
          false,
        ),
      );
      return fields;
    }
    if (["adc", "service"].includes(method))
      return [
        field("project", "Google Cloud project ID", "example-project"),
        field("location", "Google Cloud location", "europe-west1"),
        ...(method === "service"
          ? [
              field(
                "file",
                "Credentials file",
                "example-service-account.json",
                "text",
                "The file must be accessible on this device.",
              ),
            ]
          : []),
      ];
    if (method === "federation")
      return [
        field("rule", "Federation rule ID", "example-rule"),
        field("organization", "Organization ID", "example-organization"),
        field("file", "Identity-token file", "example-identity-token"),
        field("service", "Service account ID", "", "text", "", false),
        field(
          "anthropic-workspace",
          "Anthropic workspace ID",
          "",
          "text",
          "",
          false,
        ),
      ];
  }
  if (screen === "endpoint")
    return [
      field(
        "endpoint",
        provider === "llama.cpp" ? "Router URL" : "Base URL",
        provider === "llama.cpp"
          ? "http://127.0.0.1:8080"
          : "http://localhost:11434/v1",
        "url",
      ),
      ...(provider === "llama.cpp" || !state.explorationMode
        ? []
        : [
            select(
              "protocol",
              "API format",
              [
                "OpenAI Chat Completions",
                "OpenAI Responses",
                "Anthropic Messages",
                "Google Generative AI",
              ].map((name) => [name, name]),
            ),
          ]),
      ...(method === "none"
        ? []
        : method === "headers"
          ? [
              field("header-name", "Header name", "Authorization"),
              secret("credential", "Header value"),
            ]
          : [{ ...secret(), required: false }]),
      ...(state.explorationMode
        ? [
            field(
              "extra-headers",
              "Additional headers",
              "X-Example: example-value",
              "password",
              "Values can use environment references or credential commands.",
              false,
            ),
            field(
              "compatibility",
              "Compatibility settings",
              "{}",
              "text",
              "Only configure differences verified for this endpoint.",
              false,
            ),
          ].map((item) => ({ ...item, group: "Additional configuration" }))
        : []),
    ];
  if (screen === "advanced")
    return [
      ...(method === "extension"
        ? [
            select("extension-choice", "Sign-in method", [
              ["organization", "Organization access"],
              ["personal", "Personal access"],
            ]),
            field(
              "extension-input",
              "Provider-requested value",
              "example-organization",
            ),
            secret("credential", "Provider-requested secret"),
          ]
        : method === "command"
          ? [
              field(
                "command",
                "Credential command",
                "example-secret-helper read",
                "text",
                "Runs code with the app’s permissions. Do not use a command you do not trust.",
              ),
            ]
          : [
              field(
                "variable",
                "Environment variable name",
                "EXAMPLE_API_KEY",
                "text",
                "The source must be available to this workspace on this device.",
              ),
            ]),
      ...providerFields(provider),
    ];
  return [];
}
export function validateAuth(state: AiState): boolean {
  const invalid = authFields(state).find((item) => {
    const value = (state.values[item.id] || item.options?.[0]?.id || "").trim();
    return (
      (item.required && !value) ||
      (!!value && item.type === "url" && !normalizeDestination(value))
    );
  });
  state.invalidField = invalid?.id || "";
  state.fieldError = invalid
    ? invalid.type === "url" && state.values[invalid.id]
      ? transportCopy.invalid
      : "Enter the required value before continuing."
    : "";
  return !invalid;
}

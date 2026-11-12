export interface Provider {
  id: string;
  name: string;
  methods: string[];
}
const inventory: [string, string, string[]?][] = [
  ["example-orbit", "Orbit Example", ["browser", "device", "key"]],
  ["amazon-bedrock", "Amazon Bedrock", ["bearer", "profile", "chain"]],
  ["ant-ling", "Ant Ling"],
  [
    "anthropic",
    "Anthropic",
    ["browser", "copy", "key", "bearer", "federation"],
  ],
  ["azure", "Azure OpenAI"],
  ["baseten", "Baseten"],
  ["cerebras", "Cerebras"],
  ["cloudflare-ai-gateway", "Cloudflare AI Gateway"],
  ["cloudflare-workers-ai", "Cloudflare Workers AI"],
  ["deepseek", "DeepSeek"],
  ["fireworks", "Fireworks"],
  ["github-copilot", "GitHub Copilot", ["device", "key"]],
  ["google", "Google Gemini"],
  ["google-vertex", "Google Vertex AI", ["key", "adc", "service"]],
  ["groq", "Groq"],
  ["huggingface", "Hugging Face"],
  ["kimi-coding", "Kimi For Coding", ["device", "key"]],
  ["meta", "Meta", ["device", "key"]],
  ["minimax", "MiniMax"],
  ["minimax-cn", "MiniMax CN"],
  ["mistral", "Mistral"],
  ["moonshotai", "Moonshot AI"],
  ["moonshotai-cn", "Moonshot AI CN"],
  ["nvidia", "NVIDIA"],
  ["openai", "OpenAI", ["browser", "key"]],
  ["openai-codex", "OpenAI Codex", ["browser", "device"]],
  ["opencode", "OpenCode Zen"],
  ["opencode-go", "OpenCode Go"],
  ["openrouter", "OpenRouter", ["browser", "key"]],
  ["qwen-token-plan", "Qwen Token Plan"],
  ["qwen-token-plan-cn", "Qwen Token Plan CN"],
  ["qwen-token-plan-individual", "Qwen Token Plan Individual"],
  ["radius", "Radius", ["browser", "device", "key"]],
  ["together", "Together AI"],
  ["typesafe", "TypeSafe"],
  ["vercel-ai-gateway", "Vercel AI Gateway"],
  ["xai", "xAI", ["device", "key"]],
  ["xiaomi", "Xiaomi MiMo"],
  ["xiaomi-token-plan-ams", "Xiaomi Token Plan AMS"],
  ["xiaomi-token-plan-cn", "Xiaomi Token Plan CN"],
  ["xiaomi-token-plan-sgp", "Xiaomi Token Plan SGP"],
  ["zai", "Z.AI"],
  ["zai-coding-cn", "Z.AI Coding CN"],
  ["llama.cpp", "llama.cpp router", ["none", "key"]],
  ["compatible", "Compatible endpoint", ["none", "key", "headers"]],
  ["extension", "Installed provider extension", ["extension"]],
];
export const providers: Provider[] = inventory.map(
  ([id, name, methods = ["key"]]) => ({ id, name, methods }),
);
const mvpMethods: Record<string, string[]> = {
  openai: ["browser", "key"],
  "openai-codex": ["device"],
  anthropic: ["key"],
  openrouter: ["key"],
  compatible: ["none", "key"],
  "llama.cpp": ["none", "key"],
};
export function availableProviders(explorationMode = false): Provider[] {
  return explorationMode
    ? providers
    : providers
        .filter((provider) => mvpMethods[provider.id])
        .map((provider) => ({
          ...provider,
          methods: mvpMethods[provider.id],
        }));
}
export function availableMethods(
  provider: string,
  explorationMode = false,
): string[] {
  const item = availableProviders(explorationMode).find(
    (item) => item.id === provider,
  );
  if (!item) return [];
  return [
    ...item.methods,
    ...(explorationMode &&
    (item.methods.includes("key") || provider === "amazon-bedrock")
      ? ["environment", "command"]
      : []),
  ];
}
export const methods: Record<string, [string, string]> = {
  browser: [
    "Sign in with browser",
    "Continue at the provider, then return to Situate.",
  ],
  copy: ["Sign in and copy a code", "Paste the code shown by Anthropic."],
  device: ["Sign in with device code", "Approve a short code at the provider."],
  key: ["API key or token", "Use access supplied by this provider."],
  bearer: ["Bearer token", "Provide a token for this connection."],
  profile: ["AWS profile", "Use a named profile available on this device."],
  chain: [
    "Existing AWS credential chain",
    "IAM keys, ECS task credentials or web identity.",
  ],
  adc: [
    "Application Default Credentials",
    "Use Google Cloud credentials configured on this device.",
  ],
  service: [
    "Service account credentials file",
    "Select credentials and specify a project and location.",
  ],
  federation: [
    "Workload identity federation",
    "Use an identity-token file and federation configuration.",
  ],
  none: [
    "No authentication",
    "For an endpoint that does not require credentials.",
  ],
  headers: [
    "Custom headers",
    "Configure authentication headers for this endpoint.",
  ],
  extension: ["Provider sign-in", "Follow the installed provider’s prompts."],
  environment: [
    "Environment variable",
    "Resolve a named credential source on this device.",
  ],
  command: [
    "Credential command",
    "Run a command to obtain a key. Only use commands you trust.",
  ],
};

import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonempty = (value) => typeof value === "string" && value.length > 0;
const rates = (value) =>
  record(value) &&
  ["input", "output", "cacheRead", "cacheWrite"].every(
    // Negative upstream sentinels denote unknown routed prices, not a quote.
    (key) => Number.isFinite(value[key]),
  );

export function validateCatalog(inventory, provenance, bytes) {
  if (
    !record(inventory) ||
    !nonempty(inventory.version) ||
    !Array.isArray(inventory.providers) ||
    !inventory.providers.length
  )
    throw new Error("Invalid model catalog.");
  const providers = new Set();
  for (const provider of inventory.providers) {
    if (
      !record(provider) ||
      !nonempty(provider.id) ||
      providers.has(provider.id) ||
      !nonempty(provider.name) ||
      !Array.isArray(provider.methods) ||
      !provider.methods.length ||
      !Array.isArray(provider.models)
    )
      throw new Error("Invalid or duplicate catalog provider.");
    providers.add(provider.id);
    const methods = new Set();
    for (const method of provider.methods) {
      if (
        !record(method) ||
        !["api_key", "oauth"].includes(method.id) ||
        methods.has(method.id) ||
        !nonempty(method.name)
      )
        throw new Error(`Invalid catalog method: ${provider.id}`);
      methods.add(method.id);
    }
    const models = new Set();
    for (const model of provider.models) {
      if (
        !record(model) ||
        !nonempty(model.id) ||
        models.has(model.id) ||
        model.provider !== provider.id ||
        !nonempty(model.name) ||
        !nonempty(model.api) ||
        typeof model.baseUrl !== "string" ||
        model.type !== "chat" ||
        typeof model.reasoning !== "boolean" ||
        !Array.isArray(model.input) ||
        !model.input.length ||
        new Set(model.input).size !== model.input.length ||
        !model.input.every((kind) => ["text", "image"].includes(kind)) ||
        !Number.isSafeInteger(model.contextWindow) ||
        model.contextWindow <= 0 ||
        !Number.isSafeInteger(model.maxTokens) ||
        model.maxTokens <= 0 ||
        !rates(model.cost) ||
        (model.compat !== undefined && !record(model.compat))
      )
        throw new Error(`Invalid catalog model: ${provider.id}/${model.id}`);
      models.add(model.id);
      if (model.cost.tiers !== undefined) {
        let previous = -1;
        if (!Array.isArray(model.cost.tiers))
          throw new Error(
            `Invalid catalog price tiers: ${provider.id}/${model.id}`,
          );
        for (const tier of model.cost.tiers) {
          if (
            !rates(tier) ||
            !Number.isSafeInteger(tier.inputTokensAbove) ||
            tier.inputTokensAbove <= previous
          )
            throw new Error(
              `Invalid catalog price tiers: ${provider.id}/${model.id}`,
            );
          previous = tier.inputTokensAbove;
        }
      }
    }
  }
  if (
    provenance?.schemaVersion !== 1 ||
    provenance.catalog?.file !== "catalog.generated.json" ||
    provenance.catalog.version !== inventory.version ||
    provenance.catalog.sha256 !==
      createHash("sha256").update(bytes).digest("hex") ||
    !nonempty(provenance.origin?.package) ||
    !nonempty(provenance.origin.version) ||
    !/^https:\/\/registry\.npmjs\.org\//u.test(
      provenance.origin.tarball ?? "",
    ) ||
    !/^sha512-[A-Za-z0-9+/]{86}==$/u.test(provenance.origin.integrity ?? "") ||
    !/^[a-f0-9]{40}$/u.test(provenance.origin.commit ?? "") ||
    provenance.license?.spdx !== "MIT" ||
    provenance.license.file !== "../../public/licenses/ai-catalog.txt" ||
    !/^[a-f0-9]{64}$/u.test(provenance.license.sha256 ?? "")
  )
    throw new Error("Invalid catalog provenance or snapshot digest.");
}

export function validateProviderPolicy(inventory, policy) {
  if (
    policy.version !== 1 ||
    !policy.providers ||
    Array.isArray(policy.providers)
  )
    throw new Error("Invalid provider policy version or providers.");
  for (const [id, entry] of Object.entries(policy.providers)) {
    const provider = inventory.providers.find((provider) => provider.id === id);
    if (
      (!provider && id !== "custom") ||
      entry?.endpoint !== (id === "custom" ? "required" : "none") ||
      !entry.methods ||
      Array.isArray(entry.methods) ||
      !Object.keys(entry.methods).length
    )
      throw new Error(`Invalid provider policy: ${id}`);
    for (const [method, access] of Object.entries(entry.methods)) {
      if (
        !["api_key", "oauth"].includes(method) ||
        (id === "custom"
          ? method !== "api_key"
          : !provider.methods.some((candidate) => candidate.id === method)) ||
        !["implemented", "planned"].includes(access?.status) ||
        (method === "api_key"
          ? access.flow !== "api_key" ||
            access.key !== (id === "custom" ? "optional" : "required")
          : !["browser", "device"].includes(access.flow) ||
            access.key !== undefined)
      )
        throw new Error(`Invalid provider policy method: ${id}/${method}`);
    }
  }
}

export function validateRecommendations(
  inventory,
  recommendations,
  transports,
  policy = JSON.parse(
    readFileSync(
      new URL("../app/src/ai/provider-policy.json", import.meta.url),
      "utf8",
    ),
  ),
) {
  if (
    recommendations.schemaVersion !== 2 ||
    !recommendations.revision ||
    !Array.isArray(recommendations.rankedCandidates)
  )
    throw new Error("Invalid ranked recommendation catalog.");
  if (inventory.version !== recommendations.catalogVersion)
    throw new Error("Review recommendations for the current catalog version.");
  const identities = new Set();
  for (const provider of recommendations.providers) {
    if (identities.has(provider.provider))
      throw new Error(
        `Duplicate recommendation provider: ${provider.provider}`,
      );
    identities.add(provider.provider);
    if (!provider.status || !provider.rationale || !provider.sources?.length)
      throw new Error(`Incomplete recommendation: ${provider.provider}`);
  }
  for (const provider of inventory.providers) {
    const entry = recommendations.providers.find(
      (entry) => entry.provider === provider.id,
    );
    for (const method of provider.methods) {
      if (!entry?.access?.[method.id])
        throw new Error(
          `Missing recommendation coverage: ${provider.id}/${method.id}`,
        );
    }
  }
  const projected = new Set();
  for (const model of recommendations.staticModels ?? []) {
    const identity = `${model.provider}/${model.id}`;
    const canonical = inventory.providers
      .find((provider) => provider.id === model.provider)
      ?.models.find((entry) => entry.id === model.id);
    const fields = [
      "id",
      "provider",
      "api",
      "baseUrl",
      "reasoning",
      "input",
      "type",
      "headers",
    ];
    if (
      projected.has(identity) ||
      !canonical ||
      Object.keys(model).some((key) => !fields.includes(key)) ||
      fields.some(
        (key) => JSON.stringify(model[key]) !== JSON.stringify(canonical[key]),
      )
    )
      throw new Error(`Invalid static recommendation model: ${identity}`);
    projected.add(identity);
  }
  const priorities = new Set();
  const candidates = new Set();
  for (const entry of recommendations.rankedCandidates) {
    const identity = `${entry.provider}/${entry.access}/${entry.modelId}`;
    if (candidates.has(identity))
      throw new Error(`Duplicate ranked candidate: ${identity}`);
    candidates.add(identity);
    if (!projected.has(`${entry.provider}/${entry.modelId}`))
      throw new Error(`Missing static recommendation model: ${identity}`);
    if (
      !entry.rationale ||
      !entry.sources?.length ||
      !["supported", "pending-validation", "planned"].includes(
        entry.eligibility,
      )
    )
      throw new Error(`Incomplete ranked candidate: ${identity}`);
    for (const kind of ["chat", "comment"]) {
      const priority = entry.priority?.[kind];
      const key = `${entry.provider}/${entry.access}/${kind}/${priority}`;
      if (
        !Number.isSafeInteger(priority) ||
        priority < 1 ||
        priorities.has(key)
      )
        throw new Error(`Invalid or duplicate recommendation priority: ${key}`);
      priorities.add(key);
    }
    const method = policy.providers[entry.provider]?.methods[entry.access];
    const provider = inventory.providers.find(
      (provider) => provider.id === entry.provider,
    );
    const model = provider?.models.find(
      (model) => model.id === entry.modelId && model.api === entry.api,
    );
    if (
      !provider?.methods.some((method) => method.id === entry.access) ||
      !method ||
      !["implemented", "planned"].includes(method.status) ||
      !["oauth", "api_key"].includes(entry.access)
    )
      throw new Error(
        `Unsupported recommendation authentication: ${entry.provider}/${entry.access}`,
      );
    if (
      !model ||
      (entry.eligibility === "supported" && !transports.apis[model.api]) ||
      (model.type !== undefined && model.type !== "chat") ||
      !model.input.includes("text") ||
      !model.baseUrl.startsWith("https://") ||
      /[{}]/u.test(model.baseUrl) ||
      Object.keys(model.headers ?? {}).some(
        (name) => !transports.modelHeaders.includes(name.toLowerCase()),
      )
    )
      throw new Error(
        `Ineligible recommendation model: ${entry.provider}/${entry.modelId}`,
      );
    const thinking = recommendations.verifiedThinking.find(
      (capability) =>
        capability.provider === entry.provider &&
        capability.modelId === entry.modelId &&
        capability.api === entry.api,
    );
    if (
      entry.eligibility === "supported" &&
      ((entry.thinking !== "off" &&
        !thinking?.levels.includes(entry.thinking)) ||
        (model.reasoning && !thinking) ||
        (thinking && !thinking.levels.includes(entry.thinking)))
    )
      throw new Error(
        `Unverified thinking default: ${entry.provider}/${entry.modelId}`,
      );
  }
  for (const [provider, definition] of Object.entries(policy.providers)) {
    if (provider === "custom") continue;
    for (const access of Object.keys(definition.methods)) {
      if (
        !recommendations.rankedCandidates.some(
          (entry) => entry.provider === provider && entry.access === access,
        )
      )
        throw new Error(
          `Missing ranked method coverage: ${provider}/${access}`,
        );
    }
  }
  const thinkingIdentities = new Set();
  for (const entry of recommendations.verifiedThinking) {
    const identity = `${entry.provider}/${entry.modelId}/${entry.api}`;
    if (thinkingIdentities.has(identity))
      throw new Error(`Duplicate thinking capabilities: ${identity}`);
    thinkingIdentities.add(identity);
    const model = inventory.providers
      .find((provider) => provider.id === entry.provider)
      ?.models.find(
        (model) => model.id === entry.modelId && model.api === entry.api,
      );
    if (
      !model ||
      !entry.levels.length ||
      new Set(entry.levels).size !== entry.levels.length ||
      !entry.levels.every((level) =>
        ["off", "minimal", "low", "medium", "high", "xhigh"].includes(level),
      ) ||
      !entry.levels.includes(entry.default) ||
      !entry.sources.length
    )
      throw new Error(
        `Invalid thinking capabilities: ${entry.provider}/${entry.modelId}`,
      );
  }
}
export function validateBundledCatalog() {
  const catalog = new URL(
    "../app/src/ai/catalog.generated.json",
    import.meta.url,
  );
  const bytes = readFileSync(catalog);
  const inventory = JSON.parse(bytes);
  const provenance = JSON.parse(
    readFileSync(
      new URL("../app/src/ai/catalog.provenance.json", import.meta.url),
      "utf8",
    ),
  );
  validateCatalog(inventory, provenance, bytes);
  const notice = readFileSync(
    new URL("../app/public/licenses/ai-catalog.txt", import.meta.url),
    "utf8",
  );
  if (
    createHash("sha256").update(notice).digest("hex") !==
    provenance.license.sha256
  )
    throw new Error("Missing catalog redistribution notice.");
  const recommendations = JSON.parse(
    readFileSync(
      new URL("../app/src/ai/model-recommendations.json", import.meta.url),
      "utf8",
    ),
  );
  const transports = JSON.parse(
    readFileSync(
      new URL("../app/src/ai/transport-contract.json", import.meta.url),
      "utf8",
    ),
  );
  const policy = JSON.parse(
    readFileSync(
      new URL("../app/src/ai/provider-policy.json", import.meta.url),
      "utf8",
    ),
  );
  validateProviderPolicy(inventory, policy);
  validateRecommendations(inventory, recommendations, transports, policy);
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
)
  validateBundledCatalog();

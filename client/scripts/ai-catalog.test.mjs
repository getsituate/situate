import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  validateCatalog,
  validateBundledCatalog,
  validateProviderPolicy,
  validateRecommendations,
} from "./ai-catalog.mjs";
const read = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../app/src/ai/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const inventory = read("catalog.generated");
const recommendations = read("model-recommendations");
const transports = read("transport-contract");
const policy = read("provider-policy");
const provenance = read("catalog.provenance");
const catalogBytes = readFileSync(
  new URL("../app/src/ai/catalog.generated.json", import.meta.url),
);

test("the application catalog retains pinned capabilities, prices and redistribution provenance", () => {
  validateCatalog(inventory, provenance, catalogBytes);
  validateBundledCatalog();
  assert.equal(provenance.origin.package, "@earendil-works/pi-ai");
  assert.equal(provenance.origin.version, "1.1.0");
  assert.equal(
    provenance.origin.commit,
    "abe508e1b89912adde45528136c3221eb69acdd7",
  );
  assert.equal(provenance.license.spdx, "MIT");
  const models = inventory.providers.find(({ id }) => id === "openai").models;
  const mini = models.find(({ id }) => id === "gpt-4.1-mini");
  assert.deepEqual(mini.cost, {
    input: 0.4,
    output: 1.6,
    cacheRead: 0.1,
    cacheWrite: 0,
  });
  assert.deepEqual(mini.input, ["text", "image"]);
  assert.equal(mini.api, "openai-responses");
  assert.equal(mini.contextWindow, 1047576);
  assert.equal(mini.maxTokens, 32768);
  assert.equal(
    models.find(({ id }) => id === "gpt-6.1-sol").compat.supportsToolSearch,
    true,
  );
  assert.equal(
    models.find(({ id }) => id === "gpt-5.5").cost.tiers[0].inputTokensAbove,
    272000,
  );
});

test("catalog validation rejects changed prices, duplicate identities and invalid model capabilities", () => {
  for (const change of [
    (value) => {
      value.providers.push(value.providers[0]);
    },
    (value) => {
      value.providers[0].methods.push(value.providers[0].methods[0]);
    },
    (value) => {
      value.providers[0].models.push(value.providers[0].models[0]);
    },
    (value) => {
      value.providers[0].models[0].provider = "other";
    },
    (value) => {
      value.providers[0].models[0].cost.input = NaN;
    },
    (value) => {
      value.providers[0].models[0].input = ["unknown"];
    },
    (value) => {
      value.providers[0].models[0].contextWindow = 0;
    },
    (value) => {
      value.providers[0].models[0].maxTokens = 1.5;
    },
    (value) => {
      value.providers[0].models[0].compat = [];
    },
    (value) => {
      value.providers[0].models[0].cost.tiers = [
        {
          inputTokensAbove: 1,
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
        },
        {
          inputTokensAbove: 1,
          input: 2,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
        },
      ];
    },
  ]) {
    const invalid = structuredClone(inventory);
    change(invalid);
    assert.throws(
      () => validateCatalog(invalid, provenance, catalogBytes),
      /catalog/iu,
    );
  }
  for (const patch of [
    { schemaVersion: 2 },
    { catalog: { ...provenance.catalog, sha256: "0".repeat(64) } },
    { origin: { ...provenance.origin, integrity: "unpinned" } },
    { license: { spdx: "MIT", file: "missing" } },
  ]) {
    assert.throws(
      () =>
        validateCatalog(inventory, { ...provenance, ...patch }, catalogBytes),
      /provenance/iu,
    );
  }
  assert.throws(
    () =>
      validateCatalog(
        inventory,
        provenance,
        Buffer.concat([catalogBytes, Buffer.from("\n")]),
      ),
    /digest/iu,
  );
  const repriced = structuredClone(inventory);
  repriced.providers[0].models[0].cost.input = 1;
  assert.throws(
    () => validateCatalog(repriced, provenance, JSON.stringify(repriced)),
    /digest/iu,
  );
  const changed = structuredClone(recommendations);
  changed.catalogVersion = "different";
  assert.throws(
    () => validateRecommendations(inventory, changed, transports),
    /catalog version/iu,
  );
});

test("catalog validation runs without upstream packages and never rewrites source files", (t) => {
  const root = mkdtempSync(join(tmpdir(), "situate-catalog-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const scripts = join(root, "scripts");
  const data = join(root, "app/src/ai");
  mkdirSync(scripts, { recursive: true });
  mkdirSync(data, { recursive: true });
  copyFileSync(
    new URL("./ai-catalog.mjs", import.meta.url),
    join(scripts, "ai-catalog.mjs"),
  );
  const files = [
    "catalog.generated.json",
    "catalog.provenance.json",
    "../../public/licenses/ai-catalog.txt",
    "model-recommendations.json",
    "provider-policy.json",
    "transport-contract.json",
  ];
  mkdirSync(join(root, "app/public/licenses"), { recursive: true });
  for (const file of files) {
    copyFileSync(
      new URL(`../app/src/ai/${file}`, import.meta.url),
      join(data, file),
    );
    utimesSync(join(data, file), 1, 1);
  }
  const before = files.map((file) => ({
    bytes: readFileSync(join(data, file)),
    mtime: statSync(join(data, file)).mtimeMs,
  }));
  const run = () =>
    spawnSync(process.execPath, [join(scripts, "ai-catalog.mjs")], {
      cwd: root,
      env: {},
      encoding: "utf8",
    });
  assert.equal(existsSync(join(root, "node_modules")), false);
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
  assert.equal(valid.stdout, "");
  for (const [index, file] of files.entries()) {
    assert.deepEqual(readFileSync(join(data, file)), before[index].bytes);
    assert.equal(statSync(join(data, file)).mtimeMs, before[index].mtime);
  }
  writeFileSync(
    join(root, "app/public/licenses/ai-catalog.txt"),
    "MIT License\nCopyright (c) 2025 Mario Zechner\nPermission is hereby granted\n",
  );
  const missingNotice = run();
  assert.notEqual(missingNotice.status, 0);
  assert.match(missingNotice.stderr, /redistribution notice/u);
  assert.deepEqual(
    readFileSync(join(data, "catalog.generated.json")),
    before[0].bytes,
  );
});
test("provider policy admits implemented methods without pruning the upstream inventory", () => {
  validateProviderPolicy(inventory, policy);
  assert.deepEqual(Object.keys(policy.providers).sort(), [
    "anthropic",
    "custom",
    "openai",
    "openai-codex",
    "openrouter",
  ]);
  assert.deepEqual(policy.providers["openai-codex"].methods, {
    oauth: { status: "implemented", flow: "device" },
  });
  assert.deepEqual(
    Object.entries(policy.providers)
      .flatMap(([id, provider]) =>
        Object.entries(provider.methods)
          .filter(([, method]) => method.status === "implemented")
          .map(([method]) => `${id}/${method}`),
      )
      .sort(),
    [
      "anthropic/api_key",
      "custom/api_key",
      "openai-codex/oauth",
      "openai/api_key",
      "openai/oauth",
      "openrouter/api_key",
    ],
  );
  assert.equal(policy.providers.custom.methods.api_key.key, "optional");
  assert.equal(inventory.providers.length, 42);
  assert.ok(inventory.providers.some(({ id }) => id === "typesafe"));
  assert.ok(
    inventory.providers
      .find(({ id }) => id === "anthropic")
      .methods.some(({ id }) => id === "oauth"),
  );
});
test("invalid policy entries cannot silently expand access", () => {
  for (const change of [
    (value) => {
      value.version = 2;
    },
    (value) => {
      value.providers.unknown = value.providers.openai;
    },
    (value) => {
      value.providers.openai.endpoint = "required";
    },
    (value) => {
      value.providers.openai.methods.api_key.status = "enabled";
    },
    (value) => {
      value.providers.openai.methods.api_key.key = "optional";
    },
    (value) => {
      value.providers.openai.methods.oauth.flow = "automatic";
    },
    (value) => {
      value.providers.custom.methods.oauth =
        value.providers.openai.methods.oauth;
    },
    (value) => {
      value.providers["openai-codex"].methods.api_key =
        value.providers.openai.methods.api_key;
    },
  ]) {
    const invalid = structuredClone(policy);
    change(invalid);
    assert.throws(
      () => validateProviderPolicy(inventory, invalid),
      /Invalid provider policy/u,
    );
  }
});
test("bundled recommendations cover the pinned inventory without activating research", () => {
  validateRecommendations(inventory, recommendations, transports);
  assert.equal(recommendations.providers.length, 42);
  assert.deepEqual(
    recommendations.rankedCandidates.map(
      (entry) => `${entry.provider}/${entry.access}`,
    ),
    [
      "openai/api_key",
      "openai/oauth",
      "anthropic/api_key",
      "openrouter/api_key",
      "openai/api_key",
      "openrouter/api_key",
      "openai-codex/oauth",
    ],
  );
});
test("missing methods, fabricated ids and unsupported access cannot activate", () => {
  const missing = structuredClone(recommendations);
  delete missing.providers.find((entry) => entry.provider === "openai").access
    .oauth;
  assert.throws(
    () => validateRecommendations(inventory, missing, transports),
    /Missing recommendation coverage/u,
  );
  for (const patch of [
    { modelId: "invented" },
    { access: "legacy" },
    { thinking: "xhigh" },
  ]) {
    const invalid = structuredClone(recommendations);
    Object.assign(invalid.rankedCandidates[0], patch);
    assert.throws(() =>
      validateRecommendations(inventory, invalid, transports),
    );
  }
});
test("ranking priorities are positive, unique per function and independent of file order", () => {
  for (const priority of [0, -1, 1.5, null, "10"]) {
    const invalid = structuredClone(recommendations);
    invalid.rankedCandidates[0].priority.chat = priority;
    assert.throws(
      () => validateRecommendations(inventory, invalid, transports),
      /priority/u,
    );
  }
  const duplicate = structuredClone(recommendations);
  const mini = duplicate.rankedCandidates.find(
    (entry) => entry.provider === "openai" && entry.modelId === "gpt-4o-mini",
  );
  mini.priority.chat = 10;
  assert.throws(
    () => validateRecommendations(inventory, duplicate, transports),
    /duplicate recommendation priority/u,
  );
  mini.priority = { chat: 20, comment: 5 };
  validateRecommendations(inventory, duplicate, transports);
  duplicate.rankedCandidates.reverse();
  validateRecommendations(inventory, duplicate, transports);
});
test("compact static models must exactly match canonical eligibility metadata", () => {
  for (const patch of [
    { reasoning: false },
    { input: [] },
    { baseUrl: "https://other.invalid" },
    { type: "classifier" },
    { headers: { authorization: "synthetic" } },
  ]) {
    const invalid = structuredClone(recommendations);
    Object.assign(invalid.staticModels[0], patch);
    assert.throws(
      () => validateRecommendations(inventory, invalid, transports),
      /Invalid static recommendation model/u,
    );
  }
  const missing = structuredClone(recommendations);
  missing.staticModels = [];
  assert.throws(
    () => validateRecommendations(inventory, missing, transports),
    /Missing static recommendation model/u,
  );
});
test("missing transport and unverified thinking cannot qualify static defaults", () => {
  const missingTransport = structuredClone(transports);
  delete missingTransport.apis["openai-codex-responses"];
  assert.throws(
    () => validateRecommendations(inventory, recommendations, missingTransport),
    /Ineligible recommendation model/u,
  );
  for (const provider of ["anthropic", "openrouter", "openai-codex"]) {
    const invalid = structuredClone(recommendations);
    invalid.verifiedThinking = invalid.verifiedThinking.filter(
      (entry) => entry.provider !== provider,
    );
    assert.throws(() =>
      validateRecommendations(inventory, invalid, transports),
    );
  }
  const missing = structuredClone(recommendations);
  missing.rankedCandidates = missing.rankedCandidates.filter(
    (entry) => entry.provider !== "openai-codex",
  );
  assert.throws(
    () => validateRecommendations(inventory, missing, transports),
    /Missing ranked method coverage/u,
  );
  const duplicate = structuredClone(recommendations);
  duplicate.rankedCandidates.push(duplicate.rankedCandidates[0]);
  assert.throws(
    () => validateRecommendations(inventory, duplicate, transports),
    /Duplicate ranked candidate/u,
  );
});

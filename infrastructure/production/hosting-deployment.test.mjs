import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  HostingProducerFailed,
  main as waitForHosting,
} from "../../tools/wait-for-hosting.mjs";
import { probeReleaseHost } from "../releases/hosting-readiness.mjs";
import {
  deploymentGate,
  hostingReadiness,
  HostingReadUnavailable,
  observeHostingProducer,
} from "./hosting-deployment.mjs";
import { hostingDigest } from "./hosting-inputs.mjs";

const revision = "a".repeat(40);
const environment = "hosting-production-operation";
const creator = { login: "github-actions[bot]" };
const verified = { id: 21, sha: revision, environment, creator };

function fixture(previousState = null) {
  const calls = [];
  let created = previousState !== null;
  let state = previousState;
  const make = () =>
    deploymentGate({
      token: "fixture",
      revision,
      runId: "123",
      digest: () => "same",
      fetchImpl: async (url, options) => {
        assert.equal(url.origin, "https://api.github.com");
        assert.equal(options.redirect, "error");
        assert.equal(options.headers.Authorization, "Bearer fixture");
        const path = url.pathname;
        assert.match(
          path,
          /^\/repos\/getsituate\/situate\/deployments(?:\/21\/statuses)?$/,
        );
        const body = options.body && JSON.parse(options.body);
        if (options.method === "GET") {
          assert.equal(url.searchParams.get("per_page"), "1");
          assert.equal(
            url.searchParams.get("environment"),
            path.endsWith("/statuses") ? null : environment,
          );
        }
        calls.push([options.method, path, body?.state]);
        if (options.method === "GET") {
          if (path.endsWith("/statuses"))
            return Response.json(
              state === "" ? [] : [{ state, creator, environment }],
            );
          return Response.json(created ? [verified] : []);
        }
        if (path.endsWith("/statuses")) {
          assert.equal(
            body.log_url,
            "https://github.com/getsituate/situate/actions/runs/123",
          );
          assert.equal(body.auto_inactive, false);
          state = body.state;
          return Response.json({ state });
        }
        created = true;
        assert.equal(body.auto_merge, false);
        assert.deepEqual(body.required_contexts, []);
        return Response.json({ id: 21, sha: revision, environment });
      },
    });
  return { calls, make };
}

test("an open GitHub deployment blocks a later run without replaying the failed job", async () => {
  const { make, calls } = fixture();
  await make().begin();
  await assert.rejects(make().begin(), /Deployment 21 is unresolved/);
  assert.equal(calls.filter(([method]) => method === "POST").length, 2);
});

test("only success or manual inactivation clears the gate", async () => {
  for (const status of ["", "error", "pending", "in_progress", "failure"]) {
    const { make } = fixture(status);
    await assert.rejects(make().check(), /unresolved/);
  }
  for (const status of ["success", "inactive"])
    await fixture(status).make().check();
  const { make } = fixture();
  const gate = make();
  await gate.begin();
  await gate.succeed();
  assert.equal((await make().check()).ready, true);
});

function observe({
  applied = verified,
  states = ["success"],
  digest = () => "same",
  author = creator,
} = {}) {
  const requests = [];
  return {
    requests,
    read: () =>
      hostingReadiness({
        token: "fixture",
        revision: "b".repeat(40),
        digest,
        fetchImpl: async (url, options) => {
          const { pathname } = new URL(url);
          assert.equal(options.method, "GET");
          assert.match(pathname, /^\/repos\/getsituate\/situate\/deployments/);
          requests.push(pathname);
          if (!pathname.endsWith("/statuses"))
            return Response.json(applied ? [applied] : []);
          const state = states.length > 1 ? states.shift() : states[0];
          return Response.json(
            state ? [{ state, creator: author, environment }] : [],
          );
        },
      }),
  };
}

test("the input digest tracks installed files and ignores rollout scripts", () => {
  const tree = (runtime, runner) => () =>
    [
      "100644 blob pinned\tinfrastructure/production/immutable/bake.sh",
      `100644 blob ${runner}\tinfrastructure/production/immutable/continuous-deploy.mjs`,
      `100644 blob ${runtime}\tinfrastructure/production/immutable/qualification-nginx.conf`,
    ].join("\n");
  const a = hostingDigest(revision, tree("old", "old"));
  assert.equal(a, hostingDigest(revision, tree("old", "new")));
  assert.notEqual(a, hostingDigest(revision, tree("new", "new")));
});

test("the macOS probe requires baked provenance and private HTTPS on the verified SSH host", () => {
  const env = {
    WEBSITE_DEPLOY_HOST: "deploy@getsituate.com",
    SITUATE_RELEASE_SSH_PRIVATE_KEY: "synthetic identity",
    SITUATE_RELEASE_SSH_KNOWN_HOSTS: "synthetic known hosts",
  };
  const execute = (command, args, options) => {
    assert.equal(command, "ssh");
    assert.ok(args.includes("StrictHostKeyChecking=yes"));
    assert.match(args.at(-1), new RegExp(`source_revision=${revision}`));
    assert.match(args.at(-1), /127\.0\.0\.1:24443/);
    assert.equal(options.env.SITUATE_RELEASE_SSH_PRIVATE_KEY, undefined);
    return "204";
  };
  probeReleaseHost(revision, env, execute);
  assert.throws(
    () => probeReleaseHost(revision, env, () => "200"),
    /private HTTPS probe/,
  );
  assert.throws(
    () =>
      probeReleaseHost(revision, env, () => {
        throw new Error("private stderr");
      }),
    {
      message:
        "The verified release host did not pass the SSH provenance and private HTTPS probe.",
    },
  );
});

test("an app-only main revision can use the previously verified host with no HCP calls", async () => {
  const { read, requests } = observe();
  assert.deepEqual(await read(), {
    ready: true,
    deploymentId: verified.id,
    revision,
  });
  assert.equal(requests.length, 4);
});

test("an undeployed hosting change cannot use a healthy predecessor", async () => {
  assert.deepEqual(await observe({ digest: (sha) => sha }).read(), {
    ready: false,
    reason: "The verified host has different hosting inputs.",
  });
});

test("missing, inactive or unresolved deployments do not authorize publication", async () => {
  for (const state of ["inactive", "in_progress", "failure", undefined])
    assert.equal((await observe({ states: [state] }).read()).ready, false);
  assert.equal((await observe({ applied: null }).read()).ready, false);
  assert.equal(
    (await observe({ states: ["success", "in_progress"] }).read()).ready,
    false,
  );
  await assert.rejects(
    observe({ author: { login: "untrusted" } }).read(),
    /no trusted success/,
  );
});

test("retries a transient GitHub read failure but never retries a write", async () => {
  const methods = [];
  const gate = deploymentGate({
    token: "fixture",
    revision,
    runId: "123",
    fetchImpl: async (_url, { method }) => {
      methods.push(method);
      return methods.length === 2
        ? Response.json([])
        : new Response(null, { status: 503 });
    },
  });
  await assert.rejects(gate.begin(), /request failed \(503\)/);
  assert.deepEqual(methods, ["GET", "GET", "POST"]);
});

test("readiness distinguishes transient deployment reads from permission errors", async () => {
  const read = (status) =>
    hostingReadiness({
      token: "fixture",
      revision,
      fetchImpl: async () => new Response(null, { status }),
    });
  await assert.rejects(read(503), HostingReadUnavailable);
  await assert.rejects(
    read(403),
    (error) =>
      !(error instanceof HostingReadUnavailable) &&
      error.message.includes("(403)"),
  );
});

test("rejects invalid workflow run and deployment identities before using them", async () => {
  const fetchImpl = () => assert.fail("Unexpected API request");
  for (const runId of [0, "0", "001", "not-a-run", "9007199254740992"]) {
    assert.throws(
      () => deploymentGate({ token: "fixture", revision, runId, fetchImpl }),
      /Missing GitHub deployment identity/,
    );
  }
  const gate = deploymentGate({
    token: "fixture",
    revision,
    runId: "123",
    fetchImpl: async (url) => {
      assert.equal(url.pathname, "/repos/getsituate/situate/deployments");
      return Response.json([{ id: "21", environment }]);
    },
  });
  await assert.rejects(gate.check(), /Unexpected GitHub deployment identity/);
});

const failedRun = {
  id: 12345,
  run_number: 50,
  run_attempt: 1,
  status: "completed",
  conclusion: "failure",
  head_sha: revision,
  head_branch: "main",
  head_repository: { full_name: "getsituate/situate" },
  event: "push",
};
const newerRun = {
  ...failedRun,
  id: failedRun.id + 1,
  run_number: 51,
  event: "workflow_dispatch",
};
const inventory = (...runs) =>
  Response.json({ total_count: runs.length, workflow_runs: runs });

function producerResponse(response, input = { token: "fixture", revision }) {
  return observeHostingProducer({
    ...input,
    fetchImpl: async (url, options) => {
      assert.equal(
        url.origin + url.pathname,
        "https://api.github.com/repos/getsituate/situate/actions/workflows/deploy-hosting.yml/runs",
      );
      assert.equal(url.searchParams.get("head_sha"), revision);
      assert.equal(url.searchParams.get("branch"), "main");
      assert.equal(options.method, "GET");
      assert.equal(options.headers.Authorization, "Bearer fixture");
      assert.equal(options.redirect, "error");
      return response;
    },
  });
}

test("only the latest trusted completed unsuccessful producer is terminal evidence", async () => {
  assert.deepEqual(await producerResponse(inventory(failedRun)), {
    kind: "failed",
    runId: failedRun.id,
    attempt: 1,
    conclusion: "failure",
  });
  assert.deepEqual(
    await producerResponse(
      inventory({ ...newerRun, run_attempt: 2 }, failedRun),
    ),
    {
      kind: "failed",
      runId: newerRun.id,
      attempt: 2,
      conclusion: "failure",
    },
  );
  for (const [response, kind] of [
    [inventory(), "absent"],
    [
      inventory(failedRun, { ...newerRun, status: "queued", conclusion: null }),
      "pending",
    ],
    [
      inventory(newerRun, {
        ...failedRun,
        run_attempt: 2,
        status: "in_progress",
        conclusion: null,
      }),
      "pending",
    ],
    [
      inventory(failedRun, { ...newerRun, conclusion: "success" }),
      "unconfirmed",
    ],
    [inventory({ ...failedRun, head_sha: "b".repeat(40) }), "unavailable"],
    [
      inventory({
        ...failedRun,
        head_repository: { full_name: "fork/situate" },
      }),
      "unavailable",
    ],
    [
      Response.json({ total_count: 2, workflow_runs: [failedRun] }),
      "unavailable",
    ],
    [new Response(null, { status: 503 }), "unavailable"],
    [new Response(null, { status: 403 }), "unavailable"],
  ]) {
    assert.equal((await producerResponse(response)).kind, kind);
  }
});

function consumer({
  observe,
  producer,
  mainRevision = () => revision,
  mode,
} = {}) {
  const waits = [];
  let producerReads = 0;
  let mainReads = 0;
  const run = waitForHosting(
    {
      GITHUB_REPOSITORY: "getsituate/situate",
      GITHUB_REF: "refs/heads/main",
      GITHUB_SHA: revision,
      GH_TOKEN: "fixture",
    },
    [mode],
    {
      observe,
      producer: (input) => {
        producerReads += 1;
        return producer
          ? producer(input, producerReads)
          : producerResponse(inventory(failedRun), input);
      },
      wait: async (ms) => {
        waits.push(ms);
        assert.ok(waits.length <= 5, "The waiter never settled");
      },
      execute: (_command, args) =>
        args[0] === "rev-parse"
          ? revision
          : `${mainRevision(++mainReads)}\trefs/heads/main`,
    },
  );
  return { run, waits, producerReads: () => producerReads };
}

test("delivery fails promptly when hosting fails before creating a deployment", async () => {
  const { run, waits, producerReads } = consumer({
    observe: observe({ applied: null }).read,
  });
  await assert.rejects(
    run,
    (error) =>
      error instanceof HostingProducerFailed &&
      error.message.includes(
        `run ${failedRun.id} (attempt 1) concluded failure`,
      ),
  );
  assert.deepEqual(waits, [20_000]);
  assert.equal(producerReads(), 2);
});

test("a verified matching host wins even if producer failure is visible", async () => {
  const verifiedHost = observe().read;
  const immediate = consumer({ observe: verifiedHost });
  await immediate.run;
  assert.equal(immediate.producerReads(), 0);

  let reads = 0;
  const absent = observe({ applied: null }).read;
  const duringConfirmation = consumer({
    observe: () => (++reads === 3 ? verifiedHost() : absent()),
  });
  await duringConfirmation.run;
  assert.deepEqual(duringConfirmation.waits, [20_000]);
});

test("delivery waits through missing runs, read errors and a newer hosting attempt", async () => {
  const absent = observe({ applied: null }).read;
  const verifiedHost = observe().read;
  let reads = 0;
  const responses = [
    inventory(),
    inventory(failedRun),
    new Response(null, { status: 503 }),
    inventory(failedRun, {
      ...newerRun,
      status: "in_progress",
      conclusion: null,
    }),
  ];
  const { run, waits, producerReads } = consumer({
    observe: () => {
      reads += 1;
      if (reads === 3)
        throw new HostingReadUnavailable("Deployment read timed out.");
      return reads === 6 ? verifiedHost() : absent();
    },
    producer: (input) => producerResponse(responses.shift(), input),
  });
  await run;
  assert.equal(waits.length, 5);
  assert.equal(producerReads(), 4);
});

test("a change to protected main takes precedence over a terminal producer observation", async () => {
  const { run, waits } = consumer({
    observe: observe({ applied: null }).read,
    mainRevision: (read) => (read === 1 ? revision : "c".repeat(40)),
  });
  await assert.rejects(run, {
    message: "A newer main revision owns this publication.",
  });
  assert.deepEqual(waits, [20_000]);
});

test("one-shot check and probe do not consult producer runs", async () => {
  for (const mode of ["--check", "--probe"]) {
    const { run, waits, producerReads } = consumer({
      mode,
      observe: observe({ applied: null }).read,
    });
    await assert.rejects(run, {
      message: "No verified active hosting deployment.",
    });
    assert.deepEqual(waits, []);
    assert.equal(producerReads(), 0);
  }
});

test("deployment CLI reports a fixed diagnostic when authorization is absent", () => {
  const script = fileURLToPath(
    new URL("immutable/continuous-deploy.mjs", import.meta.url),
  );
  const result = spawnSync(process.execPath, [script], {
    env: {},
    encoding: "utf8",
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(
    result.stderr,
    "Production deployment stopped. Inspect the GitHub deployment gate, Terraform, Hetzner and DNS before retrying or clearing the gate.\n",
  );
});

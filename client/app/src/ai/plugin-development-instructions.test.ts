import { expect, test } from "vitest";
import { pluginDevelopmentInstructions } from "./plugin-development-instructions";
import template from "./plugin-development-instructions.md?raw";

test("the shared prompt has one starting-context substitution", () => {
  expect(template.match(/\{\{starting_context\}\}/g)).toHaveLength(1);
  const unselected = pluginDevelopmentInstructions({ version: 2 });
  const selected = pluginDevelopmentInstructions({
    version: 2,
    pluginId: "sample",
  });
  expect(unselected).toContain("No starting plugin is selected.");
  expect(unselected).not.toContain("Starting context:");
  expect(selected).toContain("Starting context: sample.");
  expect(selected).not.toContain("No starting plugin is selected.");
  expect(selected).not.toContain("{{starting_context}}");
});

test("authoring keeps effects within the assignment without per-action approval", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain("Keep effects within the user's assignment.");
  expect(prompt).not.toContain("approval");
});

test("host and tool-result contracts use invocation-bound services", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain(
    'Tools return {content:[{type:"text",text:string}|{type:"image",data:string,mimeType:string}],details?,structuredContent?,isError?}',
  );
  expect(prompt).toContain("context.files.list(query?)");
  expect(prompt).toContain(
    "context.network.request({url,method?,headers?,body?})",
  );
  expect(prompt).toContain(
    "context.process.run({executable,args?,timeoutMs?})",
  );
  expect(prompt).not.toContain("list(query?,signal?)");
  expect(prompt).not.toContain(",context.signal)");
});

const assignments = [
  { version: 2 as const },
  { version: 2 as const, pluginId: "sample" },
];

test.each(assignments)(
  "authoring uses separate service and UI entries (%j)",
  (assignment) => {
    const prompt = pluginDevelopmentInstructions(assignment);
    expect(prompt).toContain("schemaVersion:2");
    expect(prompt).toContain(
      "serviceEntry default-exports async function defineService({pluginId})",
    );
    expect(prompt).toContain("execute(args,context)");
    expect(prompt).toContain("uiEntry default-exports function defineUI");
    expect(prompt).toContain("Initialization must have no effects");
    expect(prompt).toContain(
      "Each invocation receives its own immutable context",
    );
    expect(prompt).toContain("dependencies.component(pluginId,name)");
    expect(prompt).toContain(
      "manifest exports and components lists are separate",
    );
    expect(prompt).not.toContain("schemaVersion:1");
    expect(prompt).not.toContain(
      "synchronous JavaScript hangs cannot be stopped",
    );
    expect(prompt).not.toContain("check.assert");
    expect(prompt).not.toContain("check.tool");
    expect(prompt).not.toContain("host.files.watch(");
  },
);

test.each(assignments)(
  "checks use supervised invocation-bound script locals (%j)",
  (assignment) => {
    const prompt = pluginDevelopmentInstructions(assignment);
    expect(prompt).toContain(
      "plugin={tools,skills,skill(path),invokeTool(name,args),invokeExport(name,args)}",
    );
    expect(prompt).toContain("preview={open,step,close}");
    expect(prompt).toContain("assert={ok,equal}");
    expect(prompt).toContain(
      "Skills-only checks assert actual captured text through plugin.skill",
    );
    expect(prompt).toContain('preview.open({viewId:"sample:main"})');
    expect(prompt).toContain('preview.step({action:"read"})');
    expect(prompt).toContain('preview.step({action:"capture"})');
    expect(prompt).toContain(
      "a failed assertion fails the entire check even if caught",
    );
    expect(prompt).toContain(
      "Vue preview rendering retains its hang/restart limitation",
    );
    expect(prompt).toContain("unmatched processes never spawn");
    expect(prompt).toContain("unmatched requests fail without real network");
    expect(prompt).toContain(
      "Fixtures/scripts are temporary and never activated",
    );
  },
);

test("grouped development retains shared dependency and activation boundaries", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain('kind:"connection"');
  expect(prompt).toContain('kind:"tool"');
  expect(prompt).toContain("check_plugin_changes({changes:");
  expect(prompt).toContain("activate_plugin_changes({checkId})");
  expect(prompt).toContain("Check targets and affected existing consumers");
  expect(prompt).toContain(
    "select an older revision only after an explicit restore request",
  );
  expect(prompt).toContain("never silently rolling back dependencies");
});

test("document-source authoring discovers optional exports and conformance helpers", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain(
    'read_plugin_development({resource:"document-sources"})',
  );
  expect(prompt).toContain('resource:"document-source-contract"');
  expect(prompt).toContain("without a separate consumer");
  expect(prompt).toContain("source-qualified references and provenance");
  expect(prompt).toContain("unsupported, empty, partial and unavailable");
  expect(prompt).toContain(
    "workspace file queries do not grant arbitrary filesystem access",
  );
  expect(prompt).toContain(
    "synthetic checks are not live-access or LLM-authoring evidence",
  );
});

test("captures stay native and scripts receive only acknowledgement receipts", () => {
  const prompt = pluginDevelopmentInstructions({ version: 2 });
  expect(prompt).toContain('{captured:true,mimeType:"image/png"} receipt');
  expect(prompt).toContain("image bytes are not returned to the script");
  expect(prompt).toContain(
    "activated:true with followUpError means activation already happened",
  );
  expect(prompt).toContain(
    "An unknown outcome is not proof that nothing happened",
  );
});

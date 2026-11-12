import type { CodeFile } from "./code-browser";
export type PluginKind = "tool" | "connector" | "source";
export interface ConnectionAccount {
  id: string;
  name: string;
  status: "connected" | "expired";
}
export const connectionAccounts: Record<string, ConnectionAccount[]> = {
  calendar: [
    { id: "calendar-personal", name: "Personal calendar", status: "connected" },
    { id: "calendar-courses", name: "Courses", status: "connected" },
  ],
  gmail: [
    { id: "gmail-personal", name: "Personal mail", status: "connected" },
    { id: "gmail-project", name: "Garden project", status: "connected" },
  ],
};
export const pluginFixtures = [
  {
    id: "calendar",
    kind: "connector" as PluginKind,
    name: "Calendar connection",
    description: "Bring upcoming events into your plans.",
    dependencies: [] as string[],
    enabled: true,
    blocked: false,
    running: 1,
    version: 1,
    settings: true,
    day: "monday",
  },
  {
    id: "weekly",
    kind: "tool" as PluginKind,
    name: "Weekly planning",
    description: "Bring your tasks and calendar into a plan for the week.",
    dependencies: ["calendar"],
    enabled: true,
    blocked: false,
    running: 1,
    version: 2,
    settings: true,
    day: "monday",
  },
  {
    id: "morning",
    kind: "tool" as PluginKind,
    name: "Morning brief",
    description: "Start with today’s tasks and calendar events in one place.",
    dependencies: ["weekly", "calendar"],
    enabled: true,
    blocked: false,
    running: 0,
    version: 1,
    settings: false,
    day: "monday",
  },
];
export const mailPluginFixtures = [
  {
    ...pluginFixtures[0],
    id: "gmail",
    name: "Gmail",
    description: "Use your mail accounts across tools and conversations.",
    running: 0,
  },
  {
    ...pluginFixtures[1],
    id: "inbox",
    name: "Inbox",
    description: "Read the mail you choose, in one place.",
    dependencies: ["gmail"],
    version: 1,
    running: 0,
  },
  {
    ...pluginFixtures[1],
    id: "follow-up",
    name: "Mail follow-up",
    description: "Keep messages you want to come back to close at hand.",
    dependencies: ["gmail"],
    version: 1,
    running: 0,
  },
];
export const preparedExisting =
  "Help me adapt Weekly planning so it groups unfinished tasks by project and leaves room for a quiet morning.";
export const preparedNew =
  "Help me create a plugin. Ask what I want to connect, see or change in Situate.";
export const newPluginFixture = {
  id: "reading",
  kind: "tool" as PluginKind,
  name: "Reading companion",
  description: "Return to ideas worth keeping.",
  dependencies: [] as string[],
  enabled: true,
  blocked: false,
  running: 0,
  version: 0,
  settings: false,
  day: "monday",
};
export const newConnectorFixture = {
  ...newPluginFixture,
  kind: "connector" as PluginKind,
  name: "Notes connection",
  description: "Use an external note collection across your tools.",
  settings: true,
};
export const newSourceFixture = {
  ...newPluginFixture,
  kind: "source" as PluginKind,
  name: "Archive documents",
  description: "Find receipts and records from your archive in Documents.",
  settings: true,
};
export const documentPluginFixtures = [
  {
    ...newConnectorFixture,
    id: "cloud-connection",
    name: "Cloud connection",
    description: "Reuse access to your cloud account across this workspace.",
    version: 1,
  },
  ...[
    ["paperless", "Paperless", "Find documents from your personal archive."],
    [
      "drive",
      "Cloud drive",
      "Bring finance and household documents into your collection.",
    ],
    [
      "computer",
      "Home computer",
      "Find records kept in a folder on your computer.",
    ],
  ].map(([id, name, description]) => ({
    ...newSourceFixture,
    id,
    name,
    description,
    version: 1,
    dependencies: id === "drive" ? ["cloud-connection"] : [],
  })),
];
export const codeFolderPaths = [
  "assets",
  "docs",
  "skills",
  "skills/prepare",
  "src",
  "tests",
];
export const filesFor = (
  name: string,
  kind: PluginKind = "tool",
  development = false,
): CodeFile[] => [
  {
    kind: "markdown",
    path: "AGENTS.md",
    text: `# ${name}\n\n${kind === "source" ? "Make the agreed document collection available to Documents. Reuse an existing connection when suitable. Keep original files and source metadata unchanged unless explicitly requested." : kind === "connector" ? "Provide reusable external-service access. Keep account setup here and let each consuming tool choose its accounts. Expose declared interfaces without adding a task workflow or inbox view." : "Help the user organize their work using their own notes and tasks. Reuse declared connections instead of duplicating service access. Respect their chosen working method."}\n\nExplain proposed changes. Ask before actions with external consequences. Do not send messages or modify connected services during development trials.\n\nAutomated tests use synthetic notes, tasks and separate dependency configurations. Never embed personal content or credentials in code or fixtures.`,
  },
  {
    kind: "markdown",
    path: "skills/prepare/SKILL.md",
    text: `---\nname: prepare\ndescription: Prepare a proposal using selected sources.\n---\n\n# Prepare with ${name}\n\n${kind === "connector" ? "Use only the accounts selected for the current request. Return source references through the declared interface. Do not choose accounts for consuming tools." : "Read the relevant local notes and outstanding tasks. Group related items without changing their meaning."}\n\nPrepare a short proposal with links to its sources. Leave uncertain priorities for the user to decide. Do not create external events without approval.`,
  },
  {
    kind: "markdown",
    path: "README.md",
    text: `# ${name}\n\n${development ? "Group related sources into a short proposal before presenting next steps." : "Prepare a short proposal from the selected sources."}\n\n## Files\n\n- AGENTS.md contains the agent instructions.\n- skills/prepare/SKILL.md describes preparation.\n- src/index.ts contains the entry point.\n\n## Accounts\n\nAccount selection belongs in workspace settings, not in this code folder.`,
  },
  { kind: "text", path: ".gitignore", text: "node_modules/\ndist/\n" },
  {
    kind: "text",
    path: "src/index.ts",
    text: `export function prepare(titles: string[]): string[] {\n  return titles.filter((title) => title.trim().length > 0);\n}\n`,
  },
  {
    kind: "text",
    path: "tests/prepare.test.ts",
    text: `import { expect, it } from "vitest";\nimport { prepare } from "../src/index";\n\nit("omits empty titles", () => {\n  expect(prepare(["Read a chapter", ""])).toEqual(["Read a chapter"]);\n});\n`,
  },
  {
    kind: "image",
    path: "assets/icon.svg",
    text: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="28" fill="#eee7f9"/><path d="M32 40h64v48H32zM48 32v16M80 32v16" fill="none" stroke="#6232bc" stroke-width="6" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  },
  { kind: "binary", path: "assets/index.bin" },
];

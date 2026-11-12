import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import {
  CONFIG_DIR_NAME,
  type ExtensionAPI,
  type ExtensionContext,
  type McpServerConfig,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

type RoleConfig = {
  name: string;
  label: string;
  icon?: string;
  summary?: string;
  useWhen?: string[];
  avoidWhen?: string[];
  skills?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  builtin?: boolean;
};

type RoleCommand = {
  name: string;
  roleName: string;
  path: string;
  description: string;
  argumentHint?: string;
  prompt: string;
};

const OFF_ROLE: RoleConfig = {
  name: "off",
  label: "Off",
  icon: "○",
  summary: "No role-specific system prompt or skills are active.",
  useWhen: ["You want plain Pi behavior without project role guidance."],
  builtin: true,
};

type RoleSwitcherState = {
  activeRole?: string;
  pendingRole?: string;
};

const ROLE_CHANGE_ENTRY_TYPE = "role-switcher:change";
const ROLE_SECTION = "active_role";

function roleModeRoot(cwd: string): string {
  return join(cwd, CONFIG_DIR_NAME, "role-mode");
}

function rolesRoot(cwd: string): string {
  return join(roleModeRoot(cwd), "roles");
}

function skillLibraryRoot(cwd: string): string {
  return join(roleModeRoot(cwd), "skill-library");
}

function roleDir(cwd: string, roleName: string): string {
  return join(rolesRoot(cwd), roleName);
}

function roleCommandsDir(cwd: string, roleName: string): string {
  return join(roleDir(cwd, roleName), "commands");
}

function humanizeRoleName(name: string): string {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function readRoleConfig(cwd: string, dirName: string): RoleConfig | undefined {
  const dir = roleDir(cwd, dirName);
  const configPath = join(dir, "role.json");
  if (!existsSync(configPath)) {
    return {
      name: dirName,
      label: humanizeRoleName(dirName),
    };
  }

  try {
    const parsed = JSON.parse(
      readFileSync(configPath, "utf8"),
    ) as Partial<RoleConfig>;
    const name = parsed.name?.trim() || dirName;
    if (
      parsed.mcpServers !== undefined &&
      (parsed.mcpServers === null ||
        typeof parsed.mcpServers !== "object" ||
        Array.isArray(parsed.mcpServers))
    ) {
      throw new Error("mcpServers must be an object keyed by server name");
    }
    return {
      name,
      label: parsed.label?.trim() || humanizeRoleName(name),
      icon: parsed.icon,
      summary: parsed.summary,
      useWhen: parsed.useWhen,
      avoidWhen: parsed.avoidWhen,
      skills: parsed.skills,
      mcpServers: parsed.mcpServers,
    };
  } catch (error) {
    console.error(`Failed to read role config ${configPath}: ${String(error)}`);
    return undefined;
  }
}

function loadProjectRoles(cwd: string): RoleConfig[] {
  const root = rolesRoot(cwd);
  if (!existsSync(root)) return [];

  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readRoleConfig(cwd, entry.name))
    .filter((role): role is RoleConfig => role !== undefined)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function loadRoles(cwd: string): RoleConfig[] {
  return [OFF_ROLE, ...loadProjectRoles(cwd)];
}

function parseCommandFile(
  path: string,
  roleName: string,
): RoleCommand | undefined {
  const fileName = basename(path, extname(path));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(fileName)) return undefined;

  const raw = readFileSync(path, "utf8");
  let body = raw;
  const frontmatter: Record<string, string> = {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (match) {
    body = raw.slice(match[0].length);
    for (const line of match[1].split(/\r?\n/)) {
      const property = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!property) continue;
      frontmatter[property[1]] = property[2]
        .replace(/^[ '"]|[ '"]$/g, "")
        .trim();
    }
  }

  const prompt = body.trim();
  if (!prompt) return undefined;

  return {
    name: fileName,
    roleName,
    path,
    description:
      frontmatter.description ||
      prompt
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0)
        ?.trim() ||
      fileName,
    argumentHint: frontmatter["argument-hint"],
    prompt,
  };
}

function loadRoleCommands(cwd: string): RoleCommand[] {
  return loadProjectRoles(cwd).flatMap((role) => {
    const dir = roleCommandsDir(cwd, role.name);
    if (!existsSync(dir)) return [];

    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => parseCommandFile(join(dir, entry.name), role.name))
      .filter((command): command is RoleCommand => command !== undefined);
  });
}

function groupRoleCommandsByName(
  commands: RoleCommand[],
): Map<string, RoleCommand[]> {
  const byName = new Map<string, RoleCommand[]>();
  for (const command of commands) {
    const existing = byName.get(command.name) ?? [];
    existing.push(command);
    byName.set(command.name, existing);
  }
  return byName;
}

function findRole(cwd: string, name: string): RoleConfig | undefined {
  return loadRoles(cwd).find(
    (role) =>
      role.name === name ||
      (!role.builtin && basename(roleDir(cwd, role.name)) === name),
  );
}

export default function roleSwitcherExtension(pi: ExtensionAPI): void {
  const state: RoleSwitcherState = {};
  let startupError: string | undefined;
  let startupRoleApplied = false;
  pi.registerFlag("role", {
    description: "Initial project role (overrides the saved role at startup)",
    type: "string",
  });
  const registeredMcpServers = new Map<string, string>();

  function syncRoleMcpServers(ctx: ExtensionContext, role: RoleConfig): void {
    const desired = new Map(
      Object.entries(role.mcpServers ?? {}).filter(
        ([, config]) => config?.enabled !== false,
      ),
    );
    for (const [name, signature] of registeredMcpServers) {
      if (signature === JSON.stringify(desired.get(name))) continue;
      pi.unregisterMcpServer(name);
      registeredMcpServers.delete(name);
    }
    for (const [name, config] of desired) {
      if (registeredMcpServers.has(name)) continue;
      try {
        pi.registerMcpServer(name, config);
        registeredMcpServers.set(name, JSON.stringify(config));
      } catch (error) {
        ctx.ui.notify(
          `Could not register MCP server "${name}" for ${role.label}: ${String(error)}`,
          "error",
        );
      }
    }
  }

  function clearRoleMcpServers(): void {
    for (const name of registeredMcpServers.keys())
      pi.unregisterMcpServer(name);
    registeredMcpServers.clear();
  }

  let deferredReload: ReturnType<typeof setTimeout> | undefined;
  let reloadGeneration = 0;

  function cancelDeferredReload(): void {
    reloadGeneration++;
    if (deferredReload !== undefined) clearTimeout(deferredReload);
    deferredReload = undefined;
  }

  function deferRoleReload(ctx: ExtensionContext): void {
    cancelDeferredReload();
    const generation = reloadGeneration;
    const dispatch = () => {
      if (generation !== reloadGeneration) return;
      deferredReload = undefined;
      // Tree navigation remains busy until all session_tree handlers return.
      if (!ctx.isIdle()) {
        deferredReload = setTimeout(dispatch, 10);
        deferredReload.unref?.();
        return;
      }
      pi.sendUserMessage(`/role ${state.activeRole}`, {
        deliverAs: "followUp",
        expandPromptTemplates: true,
      });
    };
    deferredReload = setTimeout(dispatch, 0);
    deferredReload.unref?.();
  }

  function getState(): RoleSwitcherState {
    return state;
  }

  function restoreRole(ctx: ExtensionContext): void {
    state.activeRole = OFF_ROLE.name;
    for (const entry of ctx.sessionManager.getBranch()) {
      if (
        entry.type !== "custom" ||
        entry.customType !== ROLE_CHANGE_ENTRY_TYPE
      )
        continue;
      const data = entry.data as { role?: string; text?: string } | undefined;
      const role =
        data?.role ??
        loadRoles(ctx.cwd).find(
          (role) => data?.text === `Role switched to ${formatRole(role)}`,
        )?.name;
      if (role) state.activeRole = role;
    }
    syncRoleMcpServers(ctx, ensureActiveRole(ctx.cwd));
  }

  function ensureActiveRole(cwd: string): RoleConfig {
    const roles = loadRoles(cwd);
    const existing = state.activeRole
      ? roles.find((role) => role.name === state.activeRole)
      : undefined;
    if (existing) return existing;
    state.activeRole = OFF_ROLE.name;
    return OFF_ROLE;
  }

  function formatRole(role: RoleConfig | undefined): string {
    if (!role) return "no role";
    return `${role.icon ? `${role.icon} ` : ""}${role.label}`;
  }

  function formatRoleAutocompleteDescription(role: RoleConfig): string {
    const summary = role.summary?.trim();
    if (summary) return `${formatRole(role)} — ${summary}`;
    const firstUseWhen = role.useWhen
      ?.find((item) => item.trim().length > 0)
      ?.trim();
    if (firstUseWhen) return `${formatRole(role)} — ${firstUseWhen}`;
    return formatRole(role);
  }

  function formatRoleHelp(role: RoleConfig): string {
    const lines = [`Switched to ${formatRole(role)}`];
    if (role.summary) lines.push("", role.summary);
    if (role.useWhen?.length) {
      lines.push("", "Use when:", ...role.useWhen.map((item) => `- ${item}`));
    }
    if (role.avoidWhen?.length) {
      lines.push(
        "",
        "Avoid when:",
        ...role.avoidWhen.map((item) => `- ${item}`),
      );
    }
    return lines.join("\n");
  }

  function updateStatus(ctx: ExtensionContext): void {
    const active = ensureActiveRole(ctx.cwd);
    const pending = state.pendingRole
      ? findRole(ctx.cwd, state.pendingRole)
      : undefined;
    const activeText = formatRole(active);
    const status = pending
      ? `role: ${activeText} → ${formatRole(pending)} pending`
      : `role: ${activeText}`;

    // A custom footer may ignore extension statuses entirely. A keyed widget below
    // the editor composes with custom footers, editors, and widgets without taking
    // ownership of any shared TUI component.
    ctx.ui.setWidget("role-switcher", [status], { placement: "belowEditor" });
  }

  async function reloadIfAvailable(ctx: ExtensionContext): Promise<boolean> {
    const maybeReload = (
      ctx as ExtensionContext & { reload?: () => Promise<void> }
    ).reload;
    if (!maybeReload) return false;
    await maybeReload.call(ctx);
    return true;
  }

  function expandCommandPrompt(
    command: RoleCommand,
    args: string | undefined,
  ): string {
    const argumentsText = args?.trim() ?? "";
    return command.prompt.replace(/\$ARGUMENTS|\$@/g, argumentsText);
  }

  async function activateRole(
    role: RoleConfig,
    ctx: ExtensionContext,
    pi: ExtensionAPI,
    options: { reload: boolean },
  ): Promise<void> {
    const roleChanged = state.activeRole !== role.name;
    state.activeRole = role.name;
    state.pendingRole = undefined;
    updateStatus(ctx);
    if (roleChanged) {
      pi.appendEntry(ROLE_CHANGE_ENTRY_TYPE, {
        role: role.name,
        text: `Role switched to ${formatRole(role)}`,
      });
    }
    syncRoleMcpServers(ctx, role);
    ctx.ui.notify(formatRoleHelp(role), "info");
    if (options.reload) {
      const reloaded = await reloadIfAvailable(ctx);
      if (!reloaded) {
        ctx.ui.notify(
          "Role switched. Please run /reload so role-specific resources are reloaded.",
          "warning",
        );
      }
    }
  }

  function activeSkillPaths(cwd: string, role: RoleConfig): string[] {
    if (role.builtin || !role.skills?.length) return [];
    const root = skillLibraryRoot(cwd);
    return role.skills
      .map((skill) => join(root, skill))
      .filter((path) => existsSync(join(path, "SKILL.md")));
  }

  pi.registerEntryRenderer(ROLE_CHANGE_ENTRY_TYPE, (entry, _options, theme) => {
    const data = entry.data as { text?: unknown };
    const text = typeof data.text === "string" ? data.text : "Role changed";
    return new Text(theme.fg("accent", text), 1, 0);
  });

  const registeredCommandNames = new Set<string>();
  for (const [commandName, commands] of groupRoleCommandsByName(
    loadRoleCommands(process.cwd()),
  )) {
    if (commandName === "role") continue;
    if (registeredCommandNames.has(commandName)) continue;
    registeredCommandNames.add(commandName);

    pi.registerCommand(commandName, {
      description: commands[0].argumentHint
        ? `${commands[0].argumentHint} — ${commands[0].description}`
        : commands[0].description,
      handler: async (args, ctx) => {
        const currentCommands =
          groupRoleCommandsByName(loadRoleCommands(ctx.cwd)).get(commandName) ??
          [];
        const active = ensureActiveRole(ctx.cwd);
        const command = currentCommands.find(
          (candidate) => candidate.roleName === active.name,
        );

        if (!command) {
          const availableRoles = currentCommands
            .map((candidate) => candidate.roleName)
            .join(", ");
          ctx.ui.notify(
            `Command /${commandName} is not available in the active role ${formatRole(active)}.` +
              (availableRoles
                ? ` Available in: ${availableRoles}. For example, switch with /role ${currentCommands[0].roleName}.`
                : ""),
            "warning",
          );
          return;
        }

        const prompt = expandCommandPrompt(command, args);
        if (ctx.isIdle()) {
          pi.sendUserMessage(prompt);
          return;
        }

        pi.sendUserMessage(prompt, { deliverAs: "followUp" });
      },
    });
  }

  pi.registerCommand("role", {
    description: "Show or switch Pi work roles",
    getArgumentCompletions: (prefix: string) => {
      const roles = loadRoles(process.cwd());
      const items = roles.map((role) => ({
        value: role.name,
        label: role.name,
        description: formatRoleAutocompleteDescription(role),
      }));
      const filtered = items.filter((item) => item.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : null;
    },
    handler: async (args, ctx) => {
      const roles = loadRoles(ctx.cwd);
      const trimmed = args?.trim();
      if (!trimmed) {
        const active = ensureActiveRole(ctx.cwd);
        const available = roles.map(formatRole).join(", ");
        ctx.ui.notify(
          `${formatRoleHelp(active)}\n\nAvailable roles: ${available}`,
          "info",
        );
        updateStatus(ctx);
        return;
      }

      const target = findRole(ctx.cwd, trimmed);
      if (!target) {
        ctx.ui.notify(
          `Unknown role "${trimmed}". Available: ${roles.map((role) => role.name).join(", ")}`,
          "error",
        );
        return;
      }

      cancelDeferredReload();
      if (!ctx.isIdle()) {
        getState().pendingRole = target.name;
        updateStatus(ctx);
        ctx.ui.notify(
          `Role switch to ${formatRole(target)} will run after the current run finishes.`,
          "info",
        );
        return;
      }

      await activateRole(target, ctx, pi, { reload: true });
    },
  });

  pi.on("session_start", async (event, ctx) => {
    cancelDeferredReload();
    state.pendingRole = undefined;
    const flag = pi.getFlag("role");
    if (
      event.reason === "startup" &&
      !startupRoleApplied &&
      flag !== undefined
    ) {
      startupRoleApplied = true;
      const role =
        typeof flag === "string" ? findRole(ctx.cwd, flag.trim()) : undefined;
      if (!role) {
        startupError = `Unknown startup role ${JSON.stringify(flag)}. Available: ${loadRoles(
          ctx.cwd,
        )
          .map((role) => role.name)
          .join(", ")}. Restart with a valid --role.`;
        ctx.ui.notify(startupError, "error");
        process.exitCode = 2;
        // Pi's interactive shutdown calls process.exit(0) after terminal cleanup.
        process.once("exit", () => {
          process.exitCode = 2;
        });
        ctx.shutdown();
        return;
      }
      // Startup resource discovery follows session_start; no reload is needed.
      await activateRole(role, ctx, pi, { reload: false });
      return;
    }
    restoreRole(ctx);
    updateStatus(ctx);
  });

  pi.on("input", async (_event, ctx) => {
    // Shutdown is host-controlled and may not stop already submitted input.
    if (startupError) {
      ctx.ui.notify(startupError, "error");
      return { action: "handled" };
    }
    return { action: "continue" };
  });

  pi.on("session_tree", async (_event, ctx) => {
    state.pendingRole = undefined;
    restoreRole(ctx);
    updateStatus(ctx);
    deferRoleReload(ctx);
  });

  pi.on("session_shutdown", () => {
    cancelDeferredReload();
    state.pendingRole = undefined;
    clearRoleMcpServers();
  });

  pi.on("resources_discover", async (_event, ctx) => {
    if (startupError) return { skillPaths: [] };
    restoreRole(ctx);
    const active = ensureActiveRole(ctx.cwd);
    return { skillPaths: activeSkillPaths(ctx.cwd, active) };
  });

  pi.on("before_agent_start", async (event, ctx) => {
    delete event.systemPromptOptions.sections[ROLE_SECTION];
    const active = ensureActiveRole(ctx.cwd);
    if (active.builtin) return;

    const promptPath = join(roleDir(ctx.cwd, active.name), "SYSTEM.md");
    if (!existsSync(promptPath)) return;

    const rolePrompt = readFileSync(promptPath, "utf8").trim();
    if (!rolePrompt) return;

    event.systemPromptOptions.sections[ROLE_SECTION] =
      `# Active Pi Role: ${formatRole(active)}\n\n${rolePrompt}`;
  });

  pi.on("agent_settled", async (_event, ctx) => {
    const pendingRole = getState().pendingRole;
    if (!pendingRole) return;

    const target = findRole(ctx.cwd, pendingRole);
    if (!target) {
      getState().pendingRole = undefined;
      updateStatus(ctx);
      return;
    }

    // Pi defers commands sent during settlement until notification dispatch ends.
    getState().pendingRole = undefined;
    pi.sendUserMessage(`/role ${target.name}`, {
      deliverAs: "followUp",
      expandPromptTemplates: true,
    });
  });
}

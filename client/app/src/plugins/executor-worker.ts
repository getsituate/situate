import { createPluginModule } from "./module-source";
import { createInvocationContext } from "./host";
import { validateToolDescriptors } from "./contributions";
import { runCheckScript } from "./executor-check-script";
import type { ExecutorCommand, ExecutorEvent } from "./executor-protocol";
import type { PluginServiceContributions, PluginToolDescriptor } from "./types";

export function startExecutorWorker(port: {
  send(event: ExecutorEvent): void;
  receive(handler: (command: ExecutorCommand) => void): void;
}): void {
  let generation: number | undefined;
  let definitions: PluginServiceContributions | undefined;
  let sequence = 0;
  let skills: readonly Readonly<{ path: string; text: string }>[] = [];
  const invocations = new Set<string>();
  const replies = new Map<
    string,
    {
      invocationId: string;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  const send = (event: ExecutorEvent) => port.send(event);
  const error = (value: unknown) =>
    value instanceof Error ? value.message : String(value);
  function descriptors(): PluginToolDescriptor[] {
    return (definitions?.tools ?? []).map(
      ({ name, description, parameters }) => ({
        name,
        description,
        parameters,
      }),
    );
  }
  async function invoke(command: Extract<ExecutorCommand, { type: "invoke" }>) {
    const { invocationId } = command;
    if (!definitions || invocations.has(invocationId)) return;
    invocations.add(invocationId);
    const controller = new AbortController();
    const context = createInvocationContext(
      invocationId,
      controller.signal,
      (request) => {
        if (!invocations.has(invocationId))
          return Promise.reject(new Error("native.plugins.unavailable"));
        const requestId = String(++sequence);
        return new Promise((resolve, reject) => {
          replies.set(requestId, { invocationId, resolve, reject });
          send({
            type: "host",
            generation: command.generation,
            invocationId,
            requestId,
            request,
          });
        });
      },
      (value) => {
        if (invocations.has(invocationId))
          send({
            type: "progress",
            generation: command.generation,
            invocationId,
            value,
          });
      },
    );
    const invokeTool = async (name: string, args: unknown) => {
      const tool = definitions!.tools?.find((tool) => tool.name === name);
      if (!tool) throw new Error("plugins.invalidContributions");
      return tool.execute(args, context);
    };
    const invokeExport = async (name: string, args: unknown) => {
      if (!Object.hasOwn(definitions!.exports ?? {}, name))
        throw new Error("plugins.invalidContributions");
      return definitions!.exports![name](args, context);
    };
    try {
      const result =
        command.kind === "check"
          ? await runCheckScript(command.script ?? "", {
              plugin: Object.freeze({
                tools: descriptors(),
                skills,
                skill(path: string) {
                  const found = skills.find((skill) => skill.path === path);
                  if (!found) throw new Error("plugins.moduleNotFound");
                  return found.text;
                },
                invokeTool,
                invokeExport,
              }),
              host: context,
              preview: context.preview,
            })
          : command.kind === "tool"
            ? await invokeTool(command.name, command.args)
            : await invokeExport(command.name, command.args);
      send({
        type: "result",
        generation: command.generation,
        invocationId,
        result,
      });
    } catch (cause) {
      send({
        type: "error",
        generation: command.generation,
        invocationId,
        error: error(cause),
      });
    } finally {
      invocations.delete(invocationId);
      controller.abort();
      for (const [id, pending] of replies) {
        if (pending.invocationId !== invocationId) continue;
        replies.delete(id);
        pending.reject(new Error("native.plugins.unavailable"));
      }
    }
  }
  port.receive((command) => {
    if (command.type === "load") {
      if (generation !== undefined) return;
      generation = command.generation;
      skills = Object.freeze(
        command.source.skills.map((skill) =>
          Object.freeze({ path: skill.path, text: skill.text }),
        ),
      );
      void (async () => {
        try {
          if (command.source.serviceEntry === null) definitions = {};
          else {
            const graph = createPluginModule(command.source, "service");
            const module = await import(/* @vite-ignore */ graph.url);
            if (typeof module.default !== "function")
              throw new Error("plugins.invalidContributions");
            definitions = await module.default(
              Object.freeze({ pluginId: command.pluginId }),
            );
          }
          validateService(definitions);
          send({
            type: "ready",
            generation: command.generation,
            tools: descriptors(),
            exports: Object.keys(definitions!.exports ?? {}),
          });
        } catch (cause) {
          send({
            type: "error",
            generation: command.generation,
            error: error(cause),
          });
        }
      })();
      return;
    }
    if (command.generation !== generation) return;
    if (command.type === "invoke") void invoke(command);
    if (command.type === "hostReply") {
      const pending = replies.get(command.requestId);
      if (!pending || pending.invocationId !== command.invocationId) return;
      replies.delete(command.requestId);
      if (command.error !== undefined) pending.reject(new Error(command.error));
      else pending.resolve(command.result);
    }
  });
}

function validateService(
  value: unknown,
): asserts value is PluginServiceContributions {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("plugins.invalidContributions");
  const service = value as PluginServiceContributions;
  if (Object.keys(value).some((key) => !["tools", "exports"].includes(key)))
    throw new Error("plugins.invalidContributions");
  const names = new Set<string>();
  if (service.tools !== undefined && !Array.isArray(service.tools))
    throw new Error("plugins.invalidContributions");
  for (const tool of service.tools ?? []) {
    if (
      !tool ||
      typeof tool.name !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(tool.name) ||
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      typeof tool.execute !== "function" ||
      !tool.parameters ||
      typeof tool.parameters !== "object" ||
      Array.isArray(tool.parameters) ||
      tool.parameters.type !== "object"
    )
      throw new Error("plugins.invalidContributions");
    names.add(tool.name);
  }
  if (
    service.exports !== undefined &&
    (!service.exports ||
      typeof service.exports !== "object" ||
      Array.isArray(service.exports) ||
      Object.values(service.exports).some((fn) => typeof fn !== "function"))
  )
    throw new Error("plugins.invalidContributions");
  validateToolDescriptors(
    (service.tools ?? []).map(({ name, description, parameters }) => ({
      name,
      description,
      parameters,
    })),
    new Set(),
  );
}

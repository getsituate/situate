export default () => {
  const request = JSON.parse("PROCESS_REQUEST");
  return {
    exports: {
      async hold(_args, host) {
        return {
          reply: await host.process.run(JSON.parse("PROCESS_HOLD_REQUEST")),
        };
      },
      async read(_args, host) {
        const capability = await host.process.capability();
        if (!capability.available) throw new Error("process-unavailable");
        const reply = await host.process.run(request);
        if (reply.isError || !reply.commandResult.Ok)
          throw new Error("process-failed");
        const result = reply.commandResult.Ok;
        if (result.outcome !== "exited" || result.exitCode !== 0)
          throw new Error("process-incomplete");
        return { capability, reply, value: JSON.parse(result.stdout.text) };
      },
    },
  };
};

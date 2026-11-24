import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function sonarPreflight(pi: ExtensionAPI) {
  for (const mode of ["check", "open"] as const) {
    const publish = mode === "open";
    pi.registerCommand(`pr-${mode}`, {
      description: publish
        ? "Run SonarCloud preflight, then push and open a PR against main"
        : "Check this branch against main in SonarCloud without pushing",
      handler: async (args, ctx) => {
        if (args.trim()) {
          ctx.ui.notify(`Usage: /pr-${mode}`, "warning");
          return;
        }
        if (
          !ctx.hasUI ||
          !(await ctx.ui.confirm(
            publish
              ? "Check and open pull request?"
              : "Run SonarCloud analysis?",
            publish
              ? "Send the committed source to public SonarCloud. If the gate passes, push this branch to getsituate/situate and open a PR against main."
              : "Send the committed source to public SonarCloud. Nothing will be pushed to GitHub.",
          ))
        )
          return;

        ctx.ui.setStatus("sonar-preflight", "Running SonarCloud preflight…");
        try {
          const result = await pi.exec(
            "volta",
            ["run", "node", "tools/sonar-preflight.mjs", mode],
            { cwd: ctx.cwd },
          );
          if (result.code === 0) {
            const url = publish
              ? result.stdout.trim().split("\n").at(-1)
              : undefined;
            ctx.ui.notify(
              url ? `Pull request: ${url}` : "SonarCloud quality gate passed.",
              "info",
            );
          } else {
            const details = `${result.stdout}\n${result.stderr}`
              .trim()
              .split("\n")
              .slice(-20)
              .join("\n");
            ctx.ui.notify(
              `Preflight did not complete successfully.\n${details}`,
              "error",
            );
          }
        } finally {
          ctx.ui.setStatus("sonar-preflight", undefined);
        }
      },
    });
  }
}

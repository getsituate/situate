import { basename } from "node:path";
import { run } from "./ios-xcode.mjs";
import { qualificationProgressReporter } from "../../tools/qualification-progress.mjs";
import { observeLaunchDialog } from "./qualification-launch-observation.mjs";
import { queryLaunchConsent } from "./qualification-launch-confirmation.mjs";

export const qualificationCommandTimeouts = Object.freeze({
  accessibility: 30_000,
  process: 10_000,
  route: 10_000,
  mount: 120_000,
  detach: 30_000,
  gatekeeper: 120_000,
  stapler: 120_000,
  codesign: 120_000,
  copy: 120_000,
  archive: 120_000,
  identity: 10_000,
  architecture: 10_000,
  quarantine: 10_000,
  launch: 10_000,
  terminate: 10_000,
});

function category(command, args) {
  switch (basename(command)) {
    case "osascript":
      return "accessibility";
    case "ps":
      return "process";
    case "scutil":
    case "route":
    case "dscacheutil":
      return "route";
    case "hdiutil":
      if (args[0] === "attach") return "mount";
      if (args[0] === "detach") return "detach";
      break;
    case "spctl":
      return "gatekeeper";
    case "xcrun":
      if (args[0] === "stapler") return "stapler";
      break;
    case "codesign":
      return "codesign";
    case "ditto":
      return "copy";
    case "python3":
      return "archive";
    case "plutil":
      return "identity";
    case "lipo":
      return "architecture";
    case "xattr":
      return "quarantine";
    case "open":
      return "launch";
    case "kill":
      return "terminate";
  }
  throw new Error("Unsupported qualification native command");
}

export function createQualificationProcess({
  execute = run,
  progress = () => {},
  getPhase = () => "prepare",
  deadline = (ms) => AbortSignal.timeout(ms),
  observeLaunch = observeLaunchDialog,
  launchConsent = queryLaunchConsent,
} = {}) {
  const reporter = qualificationProgressReporter(progress);
  // Telemetry must not prevent later termination or detach commands.
  const executeCommand = async (command, args, options = {}) => {
    const code = category(command, args);
    const phase = getPhase();
    const started = performance.now();
    const timeout = deadline(qualificationCommandTimeouts[code]);
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout;
    reporter.emit(phase, "started", code, 0);
    const confirm = code === "launch" && options.confirmFirstLaunch === true;
    let stopObservation, cancelUnstarted, confirmation;
    const reportLaunch = (status) =>
      reporter.emit(
        phase,
        status,
        code,
        Math.round(performance.now() - started),
      );
    try {
      if (confirm) {
        if (
          basename(args.at(-1)) !== "Situate.app" ||
          args.length !== 2 ||
          args[0] !== "-n" ||
          (await launchConsent("baseline", {
            environment: options.env,
            signal,
          })) !== "absent"
        ) {
          reportLaunch("confirmation_baseline_blocked");
          throw new Error(
            "First launch requires a clear macOS confirmation baseline",
          );
        }
        signal.throwIfAborted();
      }
      if (code === "launch") {
        const observationSignal = new AbortController();
        let observation;
        const timer = setTimeout(() => {
          observation = Promise.resolve()
            .then(async () => {
              const observationOptions = {
                environment: options.env,
                signal: AbortSignal.any([signal, observationSignal.signal]),
              };
              if (!confirm)
                return observeLaunch({
                  applicationName: basename(args.at(-1), ".app"),
                  ...observationOptions,
                });
              if (observationOptions.signal.aborted) return;
              const result = await launchConsent("confirm", observationOptions);
              confirmation = [
                "confirmed",
                "absent",
                "unexpected",
                "press-unknown",
              ].includes(result)
                ? result
                : "unavailable";
              reportLaunch(`confirmation_${confirmation.replaceAll("-", "_")}`);
            })
            .then(
              (status) =>
                !confirm &&
                reporter.emit(
                  phase,
                  [
                    "dialog_observed",
                    "associated_dialog_observed",
                    "dialog_not_observed",
                    "query_unavailable",
                    "query_process_unavailable",
                    "query_window_collection_unavailable",
                    "query_window_attributes_unavailable",
                    "query_element_collection_unavailable",
                    "query_element_attributes_unavailable",
                    "query_limit_unavailable",
                    "query_serialization_unavailable",
                    "query_execution_unavailable",
                    "observation_unavailable",
                  ].includes(status)
                    ? status
                    : "observation_unavailable",
                  code,
                  Math.round(performance.now() - started),
                ),
              () => {
                if (confirm) {
                  confirmation = "unavailable";
                  reportLaunch("confirmation_unavailable");
                } else reportLaunch("observation_unavailable");
              },
            );
        }, 4000);
        cancelUnstarted = () => clearTimeout(timer);
        signal.addEventListener("abort", cancelUnstarted, { once: true });
        if (signal.aborted) cancelUnstarted();
        stopObservation = async (drain = false) => {
          clearTimeout(timer);
          signal.removeEventListener("abort", cancelUnstarted);
          if (!drain) observationSignal.abort();
          await observation;
        };
      }
      // LaunchServices can pass these streams to an app that outlives open.
      const commandArgs =
        code === "launch"
          ? ["--stdout", "/dev/null", "--stderr", "/dev/null", ...args]
          : args;
      const result = await execute(command, commandArgs, {
        ...options,
        capture: true,
        signal,
        terminationGraceMs: 2000,
        ...(code === "launch"
          ? {
              onExit: (event) => {
                if (confirm) cancelUnstarted();
                if (!signal.aborted)
                  reporter.emit(
                    phase,
                    event.code === 0 ? "exited_zero" : "exited_nonzero",
                    code,
                    Math.round(performance.now() - started),
                  );
                options.onExit?.(event);
              },
            }
          : {}),
      });
      if (confirm) {
        await stopObservation(true);
        if (
          confirmation &&
          confirmation !== "confirmed" &&
          confirmation !== "absent"
        )
          throw new Error("macOS launch confirmation could not be verified");
      }
      signal.throwIfAborted();
      reporter.emit(
        phase,
        "completed",
        code,
        Math.round(performance.now() - started),
      );
      return result;
    } catch (cause) {
      const status = options.signal?.aborted
        ? "cancelled"
        : timeout.aborted
          ? "timeout"
          : "nonzero";
      reporter.emit(
        phase,
        status,
        code,
        Math.round(performance.now() - started),
      );
      const error = new Error(
        `Qualification native command ${code}: ${status}`,
        { cause },
      );
      error.qualificationCommand = code;
      error.qualificationStatus = status;
      error.uncertain = true;
      throw error;
    } finally {
      await stopObservation?.();
    }
  };
  executeCommand.assertProgress = () => reporter.check();
  return executeCommand;
}

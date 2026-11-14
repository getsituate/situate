import { createApp, type App as VueApp } from "vue";
import { captureIncident, registerStartupRetry } from "./errors/runtime";
import "../../../design/brand/tokens.css";
import "./style.css";
import App from "./App.vue";
import StartupFailure from "./StartupFailure.vue";
import { startDiagnostics, stopDiagnostics } from "./diagnostics";
import {
  installFailureHandlers,
  installWindowFailureHandlers,
} from "./diagnostics/failures";
import { initializeRecovery, retryRecoveryInitialization } from "./recovery";
import { installInputModality } from "./input-modality";

const viewport = document.querySelector<HTMLMetaElement>(
  'meta[name="viewport"]',
);
if (viewport && "virtualKeyboard" in navigator)
  viewport.content += ", interactive-widget=resizes-content";

const removeInputModality = installInputModality(document);
window.addEventListener("pagehide", removeInputModality, { once: true });
if (import.meta.hot) import.meta.hot.dispose(removeInputModality);

document.addEventListener("contextmenu", (event) => event.preventDefault());

if (import.meta.env.VITE_NATIVE_SMOKE === "1") {
  window.nativePluginRuntime = async (scope) =>
    (await import("../tests/support/native-plugin-checks")).nativePluginRuntime(
      scope,
    );
  window.nativePluginChecks = async (options) =>
    (await import("../tests/support/native-plugin-checks")).nativePluginChecks(
      options,
    );
}

startDiagnostics();
let removeFailureHandlers = installWindowFailureHandlers();
let stopPresentation: (() => void) | undefined;
window.addEventListener(
  "pagehide",
  () => {
    stopPresentation?.();
    removeFailureHandlers();
    stopDiagnostics();
  },
  { once: true },
);
let application: VueApp | undefined;
function mount(component: typeof App | typeof StartupFailure) {
  application?.unmount?.();
  const app = createApp(component);
  application = app;
  removeFailureHandlers();
  removeFailureHandlers = installFailureHandlers(app);
  app.mount("#app");
}
let starting: Promise<void> | undefined;
function start(retry = false): Promise<void> {
  starting ??= (async () => {
    try {
      await (retry ? retryRecoveryInitialization() : initializeRecovery());
      const { startNativePresentation } =
        await import("./ai/presentation-client");
      stopPresentation?.();
      stopPresentation = await startNativePresentation();
      mount(App);
    } catch (cause) {
      captureIncident("startup", cause);
      mount(StartupFailure);
      throw cause;
    }
  })().finally(() => {
    starting = undefined;
  });
  return starting;
}
const removeStartupRetry = registerStartupRetry(() => start(true));
window.addEventListener("pagehide", removeStartupRetry, { once: true });
if (import.meta.hot) import.meta.hot.dispose(removeStartupRetry);
void start().catch(() => {});

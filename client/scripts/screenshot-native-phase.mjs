import { captureScreenshot } from "./screenshot-native.mjs";

const controller = new AbortController();
const interrupt = () => controller.abort();
const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
for (const signal of signals) process.on(signal, interrupt);
try {
  await captureScreenshot({
    ...JSON.parse(process.argv[2]),
    signal: controller.signal,
  });
} finally {
  for (const signal of signals) process.off(signal, interrupt);
}

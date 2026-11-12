if (process.argv.length !== 2)
  throw new Error("Usage: node client/scripts/test-native-process.mjs");
if (process.platform !== "darwin")
  throw new Error("Offline process qualification requires macOS.");
process.env.SITUATE_PROCESS_CONNECTION_ONLY = "1";
const { main } = await import("./test-native.mjs");
process.exitCode = await main([]);

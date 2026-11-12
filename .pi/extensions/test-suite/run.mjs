import { delimiter } from "node:path";
import { pathToFileURL } from "node:url";

const [, , toolPath, runner, ...args] = process.argv;
process.env.PATH = [toolPath, process.env.PATH].filter(Boolean).join(delimiter);
process.argv = [process.execPath, runner, ...args];
// Keep the runner in the directly signalled process so it can clean up its suites.
await import(pathToFileURL(runner).href);

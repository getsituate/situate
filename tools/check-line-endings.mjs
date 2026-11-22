import { execFileSync } from "node:child_process";

const entries = execFileSync("/usr/bin/git", ["ls-files", "--eol", "-z"], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
});
const paths = entries
  .split("\0")
  .filter((entry) => /^i\/(?:crlf|mixed)\s/.test(entry))
  .map((entry) => entry.slice(entry.indexOf("\t") + 1));

if (paths.length) {
  console.error("Use LF line endings in the following tracked files:");
  for (const path of paths) console.error(JSON.stringify(path));
  process.exitCode = 1;
}

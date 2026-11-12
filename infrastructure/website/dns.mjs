#!/usr/bin/env node
const message =
  "Preview DNS is managed by infrastructure/production/terraform.mjs. This DNS entry point is retired.";
if (process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])) {
  console.log(message);
} else {
  console.error(message);
  process.exitCode = 1;
}

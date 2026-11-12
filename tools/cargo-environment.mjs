import { lstatSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export function cargoEnvironment(directory, environment = process.env) {
  const env = { ...environment };
  if (
    env.SITUATE_ISOLATE_CARGO !== "1" ||
    Object.hasOwn(environment, "CARGO_HOME")
  )
    return env;

  let cargoHome = realpathSync(directory);
  for (const component of ["client", "target", "cargo-home"]) {
    cargoHome = join(cargoHome, component);
    if (lstatSync(cargoHome, { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error(
        `Cannot isolate Cargo home: ${component} is a symbolic link.`,
      );
  }
  env.CARGO_HOME = cargoHome;
  // Cargo subcommands still need the existing rustup proxies, not a copied bin directory.
  const proxyBin = join(env.HOME ?? homedir(), ".cargo/bin");
  const paths = env.PATH?.split(delimiter) ?? [];
  if (!paths.includes(proxyBin))
    env.PATH = [...paths, proxyBin].join(delimiter);
  env.RUSTUP_AUTO_INSTALL = "0";
  return env;
}

export const versionPaths = [
  "client/package.json",
  "client/app/package.json",
  "client/package-lock.json",
  "client/app/src-tauri/tauri.conf.json",
  "client/Cargo.toml",
  "client/Cargo.lock",
];

// Mask only product pins; compare JSON structurally and Cargo files byte-for-byte.
export function withoutProductVersion(file, bytes, memberNames) {
  if (file.endsWith(".json")) {
    const value = JSON.parse(bytes);
    const paths = [["version"]];
    if (file.endsWith("package-lock.json"))
      paths.push(["packages", "", "version"], ["packages", "app", "version"]);
    for (const keys of paths) {
      let object = value;
      for (const key of keys.slice(0, -1)) object = object?.[key];
      if (typeof object?.version !== "string")
        throw new Error("Missing version pin");
      object.version = "PRODUCT_VERSION";
    }
    return JSON.stringify(value);
  }
  if (file.endsWith("Cargo.toml"))
    return bytes.replace(
      /^version = "[^"]+"$/mu,
      'version = "PRODUCT_VERSION"',
    );
  for (const name of memberNames)
    bytes = bytes.replace(
      new RegExp(
        `(\\[\\[package\\]\\]\\nname = "${name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}"\\nversion = ")[^"]+(")`,
        "u",
      ),
      "$1PRODUCT_VERSION$2",
    );
  return bytes;
}

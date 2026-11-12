import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { readAppleEnv } from "./apple-credentials.mjs";

export const updaterEndpoint =
  "https://getsituate.com/releases/current/update.json";
const names = [
  "SITUATE_UPDATER_PUBLIC_KEY",
  "SITUATE_UPDATER_ENDPOINT",
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
];

export function updaterSigningConfiguration(root, environment = process.env) {
  const local =
    environment.CI || names.every((name) => Object.hasOwn(environment, name))
      ? {}
      : readAppleEnv(root, names);
  const values = Object.fromEntries(
    names.map((name) => [
      name,
      Object.hasOwn(environment, name) ? environment[name] : local[name],
    ]),
  );
  if (
    !values.SITUATE_UPDATER_PUBLIC_KEY?.trim() ||
    !values.TAURI_SIGNING_PRIVATE_KEY?.trim()
  )
    throw new Error(
      "Direct releases require SITUATE_UPDATER_PUBLIC_KEY and TAURI_SIGNING_PRIVATE_KEY in the root .env or environment.",
    );
  const endpoint = values.SITUATE_UPDATER_ENDPOINT ?? updaterEndpoint;
  const url = new URL(endpoint);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      "Direct release updater endpoints must use HTTPS without credentials, query or fragment.",
    );
  return {
    public: {
      distribution: "direct",
      publicKey: values.SITUATE_UPDATER_PUBLIC_KEY,
      endpoint,
    },
    signer: Object.fromEntries(
      names
        .filter(
          (name) => name.startsWith("TAURI_") && values[name] !== undefined,
        )
        .map((name) => [name, values[name]]),
    ),
  };
}

function base64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.trim()))
    throw new Error("Invalid updater signature encoding.");
  return Buffer.from(value.trim(), "base64");
}

// Minisign authenticates the BLAKE2b payload digest and, separately, the trusted comment.
export function verifyUpdaterSignature(path, signature, publicKey, version) {
  const keyLines = base64(publicKey).toString("utf8").trim().split(/\r?\n/);
  const key = base64(keyLines.at(-1));
  const lines = base64(signature).toString("utf8").trim().split(/\r?\n/);
  if (
    key.length !== 42 ||
    key.subarray(0, 2).toString() !== "Ed" ||
    lines.length !== 4 ||
    !lines[2].startsWith("trusted comment: ")
  )
    throw new Error("Invalid updater signature format.");
  const sig = base64(lines[1]);
  const comment = lines[2].slice("trusted comment: ".length);
  if (
    sig.length !== 74 ||
    sig.subarray(0, 2).toString() !== "ED" ||
    !sig.subarray(2, 10).equals(key.subarray(2, 10)) ||
    !/^timestamp:[0-9]+\tfile:[^\t\r\n]+\tversion:[^\t\r\n]+$/.test(comment) ||
    comment.split("\t").at(-1) !== `version:${version}`
  )
    throw new Error(
      "Updater signature is not bound to the requested version and key.",
    );
  const ed25519 = createPublicKey({
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
    format: "der",
    type: "spki",
  });
  const detached = sig.subarray(10);
  const digest = createHash("blake2b512").update(readFileSync(path)).digest();
  if (
    !verify(null, digest, ed25519, detached) ||
    !verify(
      null,
      Buffer.concat([detached, Buffer.from(comment)]),
      ed25519,
      base64(lines[3]),
    )
  )
    throw new Error("Updater signature verification failed.");
}

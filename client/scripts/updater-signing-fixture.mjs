import { createHash, generateKeyPairSync, sign } from "node:crypto";

// Disposable in-memory keys are never written to disk or accepted as release credentials.
export function createUpdaterSignerFixture() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = Buffer.from("0102030405060708", "hex");
  const publicBytes = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  const box = `untrusted comment: synthetic test key\n${Buffer.concat([Buffer.from("Ed"), id, publicBytes]).toString("base64")}\n`;
  return {
    publicKey: Buffer.from(box).toString("base64"),
    sign(bytes, version = "1.2.3") {
      const comment = `timestamp:1\tfile:synthetic.app.tar.gz\tversion:${version}`;
      const signature = sign(
        null,
        createHash("blake2b512").update(bytes).digest(),
        privateKey,
      );
      const signatureBox = `untrusted comment: synthetic test signature\n${Buffer.concat([Buffer.from("ED"), id, signature]).toString("base64")}\ntrusted comment: ${comment}\n${sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey).toString("base64")}\n`;
      return Buffer.from(signatureBox).toString("base64");
    },
  };
}

export function updaterSignatureFixture(bytes, version = "1.2.3") {
  const signer = createUpdaterSignerFixture();
  return {
    publicKey: signer.publicKey,
    signature: signer.sign(bytes, version),
  };
}

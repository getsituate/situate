import { createHmac, timingSafeEqual } from "node:crypto";

export function verifiedHostKey(claim, serverId, token) {
  if (
    claim?.serverId !== serverId ||
    !/^[1-9][0-9]{0,14}$/.test(serverId) ||
    !/^ssh-ed25519 [a-zA-Z0-9+/]{68}$/.test(claim?.key ?? "") ||
    !/^[a-f0-9]{64}$/.test(claim?.proof ?? "") ||
    !/^[a-f0-9]{64}$/.test(token)
  )
    throw new Error("Invalid SSH host enrollment proof.");
  const expected = createHmac("sha256", Buffer.from(token, "hex"))
    .update(`${serverId}\n${claim.key}\n`)
    .digest();
  if (!timingSafeEqual(expected, Buffer.from(claim.proof, "hex")))
    throw new Error(
      "SSH host enrollment proof does not match the provisioned server.",
    );
  return claim.key;
}

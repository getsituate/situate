import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { revisionPattern } from "../production/hosting-inputs.mjs";
import { sshArguments } from "./transport.mjs";

export function probeReleaseHost(revision, env, execute = execFileSync) {
  if (!revisionPattern.test(revision ?? ""))
    throw new Error("Expected a verified hosting revision.");
  if (
    !env.SITUATE_RELEASE_SSH_PRIVATE_KEY?.trim() ||
    !env.SITUATE_RELEASE_SSH_KNOWN_HOSTS?.trim()
  )
    throw new Error(
      "Configure the release SSH identity and verified host keys.",
    );
  const root = mkdtempSync(join(tmpdir(), "situate-host-probe-"));
  try {
    const key = join(root, "key");
    const hosts = join(root, "known_hosts");
    writeFileSync(key, env.SITUATE_RELEASE_SSH_PRIVATE_KEY.trim() + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    writeFileSync(hosts, env.SITUATE_RELEASE_SSH_KNOWN_HOSTS.trim() + "\n", {
      mode: 0o600,
      flag: "wx",
    });
    const args = sshArguments({
      WEBSITE_DEPLOY_HOST: env.WEBSITE_DEPLOY_HOST,
      WEBSITE_SSH_IDENTITY: key,
      WEBSITE_SSH_KNOWN_HOSTS: hosts,
    });
    const command = `grep -Fxq 'source_revision=${revision}' /usr/local/lib/situate/image-provenance && curl -qfsS --noproxy '*' --max-time 10 --connect-to getsituate.com:443:127.0.0.1:24443 -o /dev/null -w '%{http_code}' https://getsituate.com/healthz`;
    const status = execute(
      "ssh",
      [
        "-F",
        "/dev/null",
        "-T",
        "-o",
        "GlobalKnownHostsFile=/dev/null",
        ...args,
        command,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { PATH: env.PATH, HOME: env.HOME },
        maxBuffer: 16_384,
        timeout: 30_000,
      },
    );
    if (status.trim() !== "204") throw new Error();
  } catch {
    throw new Error(
      "The verified release host did not pass the SSH provenance and private HTTPS probe.",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

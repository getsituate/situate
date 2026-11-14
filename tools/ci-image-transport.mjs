import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { archiveDigest, context, validateProvenance } from "./ci-publish.mjs";

export const namespace = "/opt/situate/ci-image-transfers";
const canonical = (value) =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(value).sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
export function transferIdentity(provenance) {
  const fingerprint = createHash("sha256")
    .update(canonical(provenance))
    .digest("hex");
  return `getsituate-situate-${provenance.runId}-${provenance.attempt}-${provenance.revision}-${fingerprint}`;
}
export function validateHost(value) {
  if (
    !/^[a-z_][a-z0-9_-]*@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(value ?? "") ||
    /^(?:root|website|situate-release|release|publisher)@/.test(value)
  )
    throw new Error(
      "Configure an isolated CI image transfer account and host.",
    );
  return value;
}
function privateFile(path) {
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error(
      "CI image SSH credentials must be owned private regular files.",
    );
  return resolve(path);
}
export function transportConfiguration(env) {
  const host = validateHost(env.CI_IMAGE_TRANSFER_HOST);
  if (!env.CI_IMAGE_TRANSFER_SSH_IDENTITY || !env.CI_IMAGE_TRANSFER_KNOWN_HOSTS)
    throw new Error(
      "Configure the CI image transfer identity and pinned known-host file.",
    );
  return {
    host,
    identity: privateFile(env.CI_IMAGE_TRANSFER_SSH_IDENTITY),
    knownHosts: privateFile(env.CI_IMAGE_TRANSFER_KNOWN_HOSTS),
  };
}
export const receiverSource = String.raw`
import fcntl, hashlib, json, os, pathlib, re, shutil, stat, sys, tempfile
MAX = 8 * 1024 ** 3
FIELDS = {'version','repository','repositoryId','runId','attempt','workflowSha','localTag','publishTag','revision','inputsSha256','imageId','configDigest','bytes','archiveSha256'}
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',',':')).encode()
def identity(value):
    if set(value) != FIELDS or type(value['version']) is not int or value['version'] != 1 or value['repository'] != 'getsituate/situate':
        raise ValueError('Invalid transfer provenance')
    for key in ['repositoryId','runId','attempt']:
        if not isinstance(value[key], str) or not re.fullmatch(r'[1-9][0-9]{0,19}', value[key]):
            raise ValueError('Invalid transfer identity')
    for key in ['workflowSha','revision']:
        if not isinstance(value[key], str) or not re.fullmatch(r'[a-f0-9]{40}', value[key]):
            raise ValueError('Invalid transfer revision')
    for key in ['inputsSha256','archiveSha256']:
        if not isinstance(value[key], str) or not re.fullmatch(r'[a-f0-9]{64}', value[key]):
            raise ValueError('Invalid transfer digest')
    for key in ['imageId','configDigest']:
        if not isinstance(value[key], str) or not re.fullmatch(r'sha256:[a-f0-9]{64}', value[key]):
            raise ValueError('Invalid image digest')
    if type(value['bytes']) is not int or not 0 < value['bytes'] <= MAX:
        raise ValueError('Invalid archive size')
    if value['localTag'] != 'situate-ci-build:' + value['runId'] + '-' + value['attempt'] or value['publishTag'] != 'ghcr.io/getsituate/situate-ci-linux:build-' + value['runId'] + '-' + value['attempt']:
        raise ValueError('Invalid image tag')
    return 'getsituate-situate-' + value['runId'] + '-' + value['attempt'] + '-' + value['revision'] + '-' + hashlib.sha256(canonical(value)).hexdigest()
def regular(path, limit):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= limit:
        os.close(descriptor)
        raise ValueError('Expected bounded regular transfer file')
    return os.fdopen(descriptor, 'rb')
def read_pair(path, expected):
    if path.is_symlink() or not path.is_dir() or sorted(p.name for p in path.iterdir()) != ['image.tar','provenance.json']:
        raise ValueError('Invalid transfer directory')
    with regular(path/'provenance.json', 8192) as metadata:
        raw = metadata.read(8193)
    if len(raw) > 8192: raise ValueError('Oversized provenance')
    value = json.loads(raw)
    if identity(value) != expected: raise ValueError('Transfer identity differs')
    checksum = hashlib.sha256()
    total = 0
    with regular(path/'image.tar', MAX) as archive:
        for chunk in iter(lambda: archive.read(1024*1024), b''):
            total += len(chunk)
            if total > value['bytes']: raise ValueError('Archive size differs')
            checksum.update(chunk)
    if total != value['bytes'] or checksum.hexdigest() != value['archiveSha256']:
        raise ValueError('Archive checksum differs')
    return value
def sync_dir(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)
def receive(base, args):
    if len(args) != 2 or args[0] not in ['upload','download'] or not re.fullmatch(r'getsituate-situate-[1-9][0-9]{0,19}-[1-9][0-9]{0,19}-[a-f0-9]{40}-[a-f0-9]{64}', args[1]):
        raise ValueError('Invalid transfer request')
    if base.is_symlink() or not base.is_dir() or base.resolve() != base or base.stat().st_mode & 0o002:
        raise ValueError('Provision the isolated CI image storage namespace')
    mode, expected = args
    target = base/expected
    if mode == 'download':
        value = read_pair(target, expected)
        sys.stdout.buffer.write(canonical(value) + b'\n')
        with regular(target/'image.tar', MAX) as archive:
            remaining = value['bytes']
            while remaining:
                chunk = archive.read(min(1024*1024, remaining))
                if not chunk: raise ValueError('Truncated stored archive')
                sys.stdout.buffer.write(chunk); remaining -= len(chunk)
            if archive.read(1): raise ValueError('Stored archive size changed')
        sys.stdout.buffer.flush()
        return
    header = sys.stdin.buffer.readline(8193)
    if len(header) > 8192 or not header.endswith(b'\n'):
        raise ValueError('Invalid provenance frame')
    value = json.loads(header)
    if identity(value) != expected:
        raise ValueError('Upload identity differs')
    staging = pathlib.Path(tempfile.mkdtemp(prefix='.incoming-', dir=base))
    try:
        checksum = hashlib.sha256()
        remaining = value['bytes']
        with open(staging/'image.tar','xb') as archive:
            os.fchmod(archive.fileno(), 0o640)
            while remaining:
                chunk = sys.stdin.buffer.read(min(1024*1024, remaining))
                if not chunk: raise ValueError('Truncated image upload')
                archive.write(chunk); checksum.update(chunk); remaining -= len(chunk)
            if sys.stdin.buffer.read(1) or checksum.hexdigest() != value['archiveSha256']:
                raise ValueError('Image upload checksum or length differs')
            archive.flush(); os.fsync(archive.fileno())
        with open(staging/'provenance.json','xb') as metadata:
            os.fchmod(metadata.fileno(), 0o640)
            metadata.write(canonical(value)); metadata.flush(); os.fsync(metadata.fileno())
        os.chmod(staging, 0o750)
        sync_dir(staging)
        lock = os.open(base/'.transfer.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            if not stat.S_ISREG(os.fstat(lock).st_mode): raise ValueError('Invalid transfer lock')
            fcntl.flock(lock, fcntl.LOCK_EX)
            if target.exists() or target.is_symlink():
                if canonical(read_pair(target, expected)) != canonical(value): raise ValueError('Immutable transfer differs')
            else:
                os.rename(staging, target); sync_dir(base)
        finally: os.close(lock)
        sys.stdout.write(json.dumps({'status':'stored','transfer':expected}) + '\n')
    finally:
        if staging.exists(): shutil.rmtree(staging)
`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
export function openRemote(configuration, mode, identity) {
  const program = `${receiverSource}\nreceive(pathlib.Path(${JSON.stringify(namespace)}), sys.argv[1:])`;
  return spawn(
    "ssh",
    [
      "-F",
      "/dev/null",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentityAgent=none",
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "ConnectTimeout=30",
      "-o",
      `UserKnownHostsFile=${configuration.knownHosts}`,
      "-i",
      configuration.identity,
      configuration.host,
      `python3 -c ${quote(program)} ${quote(mode)} ${quote(identity)}`,
    ],
    {
      stdio: ["pipe", "pipe", "pipe"],
      env: Object.fromEntries(
        ["PATH", "HOME", "LANG"]
          .filter((key) => process.env[key] !== undefined)
          .map((key) => [key, process.env[key]]),
      ),
    },
  );
}
function completion(child) {
  child.stderr.on("data", () => {});
  return new Promise((resolveExit, reject) => {
    child.once("error", () =>
      reject(new Error("CI image transfer could not start.")),
    );
    child.once("close", (code) =>
      code === 0
        ? resolveExit()
        : reject(
            new Error(
              "CI image transfer failed; inspect the exact transfer before retrying.",
            ),
          ),
    );
  });
}
export function explicitIdentity(values) {
  for (const key of ["repository-id", "run-id", "attempt"])
    if (!/^[1-9][0-9]{0,19}$/.test(values[key] ?? ""))
      throw new Error("Provide exact repository, run and attempt IDs.");
  for (const key of ["workflow-sha", "source"])
    if (!/^[a-f0-9]{40}$/.test(values[key] ?? ""))
      throw new Error("Provide exact workflow and source revisions.");
  return {
    source: values.source,
    context: {
      repository: "getsituate/situate",
      repositoryId: values["repository-id"],
      runId: values["run-id"],
      attempt: values.attempt,
      workflowSha: values["workflow-sha"],
      localTag: `situate-ci-build:${values["run-id"]}-${values.attempt}`,
      publishTag: `ghcr.io/getsituate/situate-ci-linux:build-${values["run-id"]}-${values.attempt}`,
    },
  };
}
function checkedProvenance(value, env, expected) {
  const result = validateProvenance(value, expected?.context ?? context(env));
  if (result.revision !== (expected?.source ?? env.GITHUB_SHA))
    throw new Error("Image source differs from the selected source.");
  return result;
}
export async function transfer(
  mode,
  directory,
  provenance,
  { environment = process.env, remote = openRemote, expected } = {},
) {
  provenance = checkedProvenance(provenance, environment, expected);
  const configuration = transportConfiguration(environment);
  const identity = transferIdentity(provenance);
  if (!["upload", "download"].includes(mode))
    throw new Error("Unknown image transfer operation.");
  if (mode === "upload") {
    const actual = await archiveDigest(directory);
    if (
      actual.bytes !== provenance.bytes ||
      actual.archiveSha256 !== provenance.archiveSha256
    )
      throw new Error("Sealed image archive differs before upload.");
  } else mkdirSync(directory, { recursive: false });
  const child = remote(configuration, mode, identity);
  const exited = completion(child);
  exited.catch(() => {});
  try {
    if (mode === "upload") {
      const receipt = [];
      let receiptBytes = 0;
      child.stdout.on("data", (chunk) => {
        receiptBytes += chunk.length;
        if (receiptBytes > 8192) child.kill();
        else receipt.push(chunk);
      });
      await pipeline(
        Readable.from(
          (async function* () {
            yield `${canonical(provenance)}\n`;
            yield* createReadStream(join(directory, "image.tar"));
          })(),
        ),
        child.stdin,
      );
      await exited;
      const result = JSON.parse(Buffer.concat(receipt).toString("utf8"));
      if (result.status !== "stored" || result.transfer !== identity)
        throw new Error("Remote transfer receipt differs.");
    } else {
      child.stdin.end();
      let header = Buffer.alloc(0);
      let framed = false;
      let bytes = 0;
      const decoded = async function* () {
        for await (const chunk of child.stdout) {
          let payload = chunk;
          if (!framed) {
            const newline = chunk.indexOf(10);
            if (newline === -1) {
              header = Buffer.concat([header, chunk]);
              if (header.length > 8192)
                throw new Error("Oversized image provenance frame.");
              continue;
            }
            header = Buffer.concat([header, chunk.subarray(0, newline)]);
            if (
              header.length > 8192 ||
              canonical(JSON.parse(header)) !== canonical(provenance)
            )
              throw new Error(
                "Downloaded provenance differs from the sealed build.",
              );
            framed = true;
            payload = chunk.subarray(newline + 1);
          }
          bytes += payload.length;
          if (bytes > provenance.bytes)
            throw new Error("Downloaded image exceeds its sealed size.");
          yield payload;
        }
        if (!framed || bytes !== provenance.bytes)
          throw new Error("Truncated image download.");
      };
      await pipeline(
        Readable.from(decoded()),
        createWriteStream(join(directory, "image.tar"), {
          flags: "wx",
          mode: 0o600,
        }),
      );
      await exited;
      const actual = await archiveDigest(directory);
      if (actual.archiveSha256 !== provenance.archiveSha256)
        throw new Error("Downloaded image checksum differs.");
    }
    return { status: "transferred", transfer: identity };
  } catch (error) {
    child.kill();
    await exited.catch(() => {});
    if (mode === "download")
      rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}
export async function main(
  args = process.argv.slice(2),
  environment = process.env,
  { remote = openRemote } = {},
) {
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: Object.fromEntries(
      [
        "provenance",
        "repository-id",
        "run-id",
        "attempt",
        "workflow-sha",
        "source",
        "host",
        "identity",
        "known-hosts",
      ].map((key) => [key, { type: "string" }]),
    ),
  });
  const [mode, directory] = positionals;
  const expected = [
    "repository-id",
    "run-id",
    "attempt",
    "workflow-sha",
    "source",
  ].some((key) => values[key] !== undefined)
    ? explicitIdentity(values)
    : undefined;
  if (!expected) context(environment);
  environment = {
    ...environment,
    ...(values.host ? { CI_IMAGE_TRANSFER_HOST: values.host } : {}),
    ...(values.identity
      ? { CI_IMAGE_TRANSFER_SSH_IDENTITY: values.identity }
      : {}),
    ...(values["known-hosts"]
      ? { CI_IMAGE_TRANSFER_KNOWN_HOSTS: values["known-hosts"] }
      : {}),
  };
  if (mode === "gate")
    return { host: validateHost(environment.CI_IMAGE_TRANSFER_HOST) };
  if (
    !["upload", "download"].includes(mode) ||
    !directory ||
    positionals.length !== 2
  )
    throw new Error("Use gate, upload DIRECTORY or download DIRECTORY.");
  let temporary;
  try {
    let env = environment;
    if (
      environment.CI_IMAGE_TRANSFER_SSH_PRIVATE_KEY ||
      environment.CI_IMAGE_TRANSFER_SSH_KNOWN_HOSTS
    ) {
      const key = environment.CI_IMAGE_TRANSFER_SSH_PRIVATE_KEY;
      const hosts = environment.CI_IMAGE_TRANSFER_SSH_KNOWN_HOSTS;
      if (
        [key, hosts].some(
          (value) =>
            typeof value !== "string" || !value.trim() || value.includes("\0"),
        )
      )
        throw new Error(
          "Provide both isolated transfer key and pinned host data.",
        );
      temporary = mkdtempSync(
        join(environment.RUNNER_TEMP ?? tmpdir(), "situate-ci-image-ssh-"),
      );
      const identity = join(temporary, "identity");
      const knownHosts = join(temporary, "known_hosts");
      writeFileSync(identity, key.endsWith("\n") ? key : `${key}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      writeFileSync(knownHosts, hosts.endsWith("\n") ? hosts : `${hosts}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      env = {
        ...environment,
        CI_IMAGE_TRANSFER_SSH_IDENTITY: identity,
        CI_IMAGE_TRANSFER_KNOWN_HOSTS: knownHosts,
      };
    }
    if (values.provenance && lstatSync(values.provenance).size > 8192)
      throw new Error("Image provenance exceeds the transfer limit.");
    const raw = values.provenance
      ? readFileSync(values.provenance, "utf8")
      : (environment.PROVENANCE ?? "");
    if (Buffer.byteLength(raw) > 8192)
      throw new Error("Image provenance exceeds the transfer limit.");
    return await transfer(mode, resolve(directory), JSON.parse(raw), {
      environment: env,
      remote,
      expected,
    });
  } finally {
    if (temporary) rmSync(temporary, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
  main()
    .then((value) => console.log(JSON.stringify(value)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });

const MAX_ITEMS = 10;
const types = {
  pdf: "application/pdf",
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
};

const scanPosix = `
  [ -d "$1" ] && [ ! -L "$1" ] || exit 1
  for path in "$1"/*; do
    [ -f "$path" ] && [ ! -L "$path" ] || continue
    case "$path" in
      *.[pP][dD][fF]|*.[pP][nN][gG]|*.[jJ][pP][gG]|*.[jJ][pP][eE][gG]) ;;
      *) continue ;;
    esac
    revision=$(/usr/bin/stat -f '%d:%i:%z:%.9Fm:%.9Fc' "$path") || exit 1
    printf '%s\\0%s\\0' "\${path##*/}" "$revision"
  done`;

function encode(bytes) {
  return globalThis.btoa(String.fromCharCode(...bytes));
}

function scanWindows(folder) {
  const shellPath = folder
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\(?=[a-z]:\\)/i, "");
  const argument = encode(new globalThis.TextEncoder().encode(shellPath));
  const script = `
    $ErrorActionPreference = 'Stop'
    [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
    $folder = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${argument}'))
    $root = Get-Item -LiteralPath $folder
    if (!$root.PSIsContainer -or ($root.Attributes -band [IO.FileAttributes]::ReparsePoint)) { exit 1 }
    foreach ($file in Get-ChildItem -LiteralPath $folder -File) {
      if ($file.Extension -notmatch '^\\.(pdf|png|jpe?g)$' -or ($file.Attributes -band [IO.FileAttributes]::ReparsePoint)) { continue }
      [Console]::Write($file.Name + [char]0 + $file.Length + ':' + $file.LastWriteTimeUtc.Ticks + ':' + $file.CreationTimeUtc.Ticks + [char]0)
    }`;
  return encode(
    new Uint8Array(
      Uint16Array.from(script, (letter) => letter.charCodeAt(0)).buffer,
    ),
  );
}

function fileName(value) {
  return (
    typeof value === "string" &&
    value.length <= 255 &&
    !value.startsWith(".") &&
    !/[/\\:]/.test(value) &&
    ![...value].some((character) => character.charCodeAt(0) < 32) &&
    Object.hasOwn(types, value.split(".").at(-1)?.toLowerCase())
  );
}

export default function defineService({ pluginId }) {
  const scope = {
    id: "folder-documents",
    included: [
      "PDF, PNG and JPEG files at the top level of the configured folder",
    ],
    excluded: ["Subfolders, hidden files and symbolic links"],
    constraints: [],
  };

  async function configuration(host) {
    const { text, revision } = await host.config.read("folder.json");
    const { folder } = JSON.parse(text);
    if (
      typeof folder !== "string" ||
      folder.length > 4096 ||
      !/^(\/|[a-z]:\\|\\\\)/i.test(folder)
    )
      throw new Error("Invalid archive folder");
    return { folder, source: { pluginId, instanceId: revision } };
  }

  async function scan(host, folder) {
    const shell = await host.process.capability();
    host.signal.throwIfAborted();
    if (!shell.available) return { error: "unsupported" };
    let args, separator;
    if (shell.interpreterDialect === "posixSh") {
      args = [...shell.interpreterArgs, scanPosix, "garden-archive", folder];
      separator = "/";
    } else if (
      shell.interpreterDialect === "windowsPowerShell" &&
      shell.interpreterArgs.at(-1) === "-Command"
    ) {
      args = [
        ...shell.interpreterArgs.slice(0, -1),
        "-EncodedCommand",
        scanWindows(folder),
      ];
      separator = "\\";
    } else return { error: "unsupported" };
    const reply = await host.process.run({
      executable: shell.interpreter,
      args,
      timeoutMs: 5000,
    });
    host.signal.throwIfAborted();
    const command = reply.commandResult?.Ok;
    if (
      reply.isError ||
      command?.outcome !== "exited" ||
      command.exitCode !== 0 ||
      command.stdout.truncated ||
      command.stdout.incomplete
    )
      return { error: "unavailable" };
    const parts = command.stdout.text.split("\0");
    if (parts.pop() !== "" || parts.length % 2) return { error: "unavailable" };
    const files = new Map();
    for (let i = 0; i < parts.length; i += 2) {
      if (fileName(parts[i]) && /^\d+(?::\d+(?:\.\d+)?)+$/.test(parts[i + 1]))
        files.set(parts[i], parts[i + 1]);
    }
    return { files, separator };
  }

  function failure(base, code) {
    return {
      ...base,
      status: "error",
      error: { code, ...(base.version === 1 ? { outcome: "unknown" } : {}) },
    };
  }

  function descriptor(source, version) {
    return {
      version,
      source,
      label: "Garden archive",
      scope,
      ...(version === 1
        ? {
            capabilities: { list: {} },
            limits: { maxItems: MAX_ITEMS, maxTextChars: 1 },
          }
        : { searchCoverage: ["filename"], limits: { maxItems: MAX_ITEMS } }),
    };
  }

  async function page(args, host, operation, version) {
    const { folder, source } = await configuration(host);
    const base = { version, source, scopeId: scope.id, operation };
    const query = operation === "search" ? args.query : null;
    const { limit, continuation } = args;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_ITEMS ||
      (operation === "search" &&
        (typeof query !== "string" || !query.trim() || query.length > 4096))
    )
      return failure(base, "unsupported");
    const offset = continuation ? Number(continuation.token) : 0;
    if (
      continuation &&
      (continuation.source?.pluginId !== pluginId ||
        continuation.source.instanceId !== source.instanceId ||
        continuation.scopeId !== scope.id ||
        continuation.operation !== operation ||
        continuation.query !== query ||
        !Number.isSafeInteger(offset) ||
        offset < 1 ||
        String(offset) !== continuation.token)
    )
      return failure(base, "permission");
    const listing = await scan(host, folder);
    if (!listing.files) return failure(base, listing.error);
    const names = [...listing.files.keys()]
      .sort((a, b) => {
        if (a === b) return 0;
        return a < b ? -1 : 1;
      })
      .filter(
        (name) => !query || name.toLowerCase().includes(query.toLowerCase()),
      );
    const items = names.slice(offset, offset + limit).map((name) => ({
      ref: {
        source,
        id: name,
        identity: "path",
        revision: listing.files.get(name),
      },
      title: name,
      ...(version === 1
        ? { path: name }
        : { mimeType: types[name.split(".").at(-1).toLowerCase()] }),
    }));
    const truncated = offset + limit < names.length;
    return {
      ...base,
      status: truncated ? "partial" : "ok",
      truncated,
      items,
      ...(version === 1 ? { total: names.length } : {}),
      ...(truncated
        ? {
            reason: "limit",
            next: {
              source,
              scopeId: scope.id,
              operation,
              query,
              token: String(offset + limit),
            },
          }
        : {}),
    };
  }

  async function findDocument(ref, host, operation) {
    const { folder, source } = await configuration(host);
    const base = { version: 2, source, scopeId: scope.id, operation };
    if (
      ref?.source?.pluginId !== source.pluginId ||
      ref.source.instanceId !== source.instanceId ||
      ref.identity !== "path" ||
      !fileName(ref.id)
    )
      return { error: failure(base, "permission") };
    const listing = await scan(host, folder);
    if (!listing.files) return { error: failure(base, listing.error) };
    if (!ref.revision || listing.files.get(ref.id) !== ref.revision)
      return { error: failure(base, "not-found") };
    return { base, folder, separator: listing.separator };
  }

  return {
    exports: {
      documentSourceDescribe: async (_args, host) =>
        descriptor((await configuration(host)).source, 1),
      documentSourceList: (args, host) => page(args, host, "list", 1),
      documentLibraryDescribe: async (_args, host) =>
        descriptor((await configuration(host)).source, 2),
      documentLibraryList: (args, host) => page(args, host, "list", 2),
      documentLibrarySearch: (args, host) => page(args, host, "search", 2),
      async documentLibraryDetails({ ref, locale }, host) {
        const result = await findDocument(ref, host, "details");
        if (result.error) return result.error;
        return {
          ...result.base,
          status: "ok",
          ref,
          fields: [
            {
              id: "filename",
              label:
                locale === "de" ? "Originaldateiname" : "Original filename",
              value: ref.id,
            },
          ],
        };
      },
      async documentLibraryReadOriginal({ ref }, host) {
        const result = await findDocument(ref, host, "readOriginal");
        if (result.error) return result.error;
        const { base, folder, separator } = result;
        const reply = await host.documents.fromFile(
          `${folder}${separator}${ref.id}`,
        );
        if (!reply.original) return failure(base, reply.error ?? "unavailable");
        const after = await scan(host, folder);
        if (after.files?.get(ref.id) !== ref.revision)
          return failure(base, "unavailable");
        return {
          ...base,
          status: "ok",
          original: reply.original,
          document: {
            ref,
            title: ref.id,
            mimeType: types[ref.id.split(".").at(-1).toLowerCase()],
          },
        };
      },
    },
  };
}

# Cross-Platform Compatibility: macOS (BSD) vs. Linux (GNU)

macOS ships BSD coreutils. Linux ships GNU coreutils. Many tools share the same name but
behave differently. This reference covers the most common incompatibilities and portable
workarounds.

## Platform Detection

```bash
detect_platform() {
  case "$(uname -s)" in
    Darwin*) PLATFORM="macos" ;;
    Linux*)  PLATFORM="linux" ;;
    *)       die "Unsupported platform: $(uname -s)" ;;
  esac
}
```

## Pragmatic Fix: Install GNU Coreutils on macOS

```bash
brew install coreutils findutils gnu-sed grep gnu-tar
```

Provides `gsed`, `gfind`, `gdate`, `greadlink`, `gtar`, etc. Use wrapper pattern:

```bash
SED="sed"
command -v gsed >/dev/null 2>&1 && SED="gsed"
```

## sed

### `sed -i` (in-place editing)

GNU sed accepts `sed -i 's/old/new/' file`.
BSD sed requires a backup suffix: `sed -i '' 's/old/new/' file`.
These are mutually incompatible.

**Portable workaround:**

```bash
sed -i.bak 's/old/new/' file && rm -f file.bak
```

Or use `$SED` wrapper (see above) with GNU sed.

### Extended regex (`-E`)

BSD sed does not support `-E` in all versions. Avoid extended regex operators
(`|`, `+`, `?`, `\s`, `\t`) with BSD sed. Instead, chain multiple `-e` expressions:

```bash
# Not portable
sed -E 's/(foo|bar)//g'

# Portable
sed -e 's/foo//g' -e 's/bar//g'
```

## date

GNU and BSD `date` have completely different syntax for relative dates and formatting.

| Operation     | GNU (Linux)           | BSD (macOS)               |
| ------------- | --------------------- | ------------------------- |
| Relative time | `date -d '+12 hours'` | `date -v+12H`             |
| Epoch to date | `date -d @1609459200` | `date -r 1609459200`      |
| Format output | `date '+%Y-%m-%d'`    | `date '+%Y-%m-%d'` (same) |

**Portable workaround:**

```bash
if date --version >/dev/null 2>&1; then
  # GNU
  date -d '+12 hours'
else
  # BSD
  date -v+12H
fi
```

For complex date math, consider `python3 -c "..."` as a truly portable fallback.

## find

### `-printf` — GNU only

```bash
# GNU only
find . -type f -printf '%P\n'

# Portable
find . -type f | sed 's|^\./||'
```

### `-maxdepth` vs. `-depth`

Both GNU and BSD find support `-maxdepth`. Do not confuse with `-d` / `-depth`
which means "depth-first traversal" and is unrelated.

### `-regex` flavor

GNU find defaults to Emacs regex. BSD find defaults to basic regex.
Use `-regextype posix-extended` on GNU or `-E` on BSD for extended regex.

Prefer `-name` with globs over `-regex` for portability.

## readlink

### `readlink -f` — GNU only

BSD readlink (macOS) does not support `-f` (canonicalize).

**Portable workarounds:**

```bash
# Option 1: Python
realpath_portable() {
  python3 -c 'import os, sys; print(os.path.realpath(sys.argv[1]))' "$1"
}

# Option 2: CDPATH trick (works for directories)
realpath_portable() {
  (cd "$(dirname "$1")" && echo "$(pwd)/$(basename "$1")")
}

# Option 3: Use grealpath from coreutils
command -v grealpath >/dev/null 2>&1 && grealpath "$1"
```

## grep

### `-P` (Perl regex) — GNU only

macOS grep does not support `-P`.

```bash
# Not portable
grep -P '\d+' file

# Portable
grep -E '[0-9]+' file
```

### `-r` (recursive) behavior

GNU grep `-r` skips recursively encountered symlinks; `-R` follows them.
Check the host implementation before following links, especially across workspace or sensitive-directory boundaries.

## xargs

### `-r` (no-run-if-empty) — GNU only

GNU xargs: `-r` prevents execution when stdin is empty.
BSD xargs: runs the command even with empty input (no `-r` flag).

**Portable workaround:**

```bash
# Check if xargs supports -r
if echo | xargs -r false 2>/dev/null; then
  XARGS_EMPTY="-r"
else
  XARGS_EMPTY=""
fi
... | xargs $XARGS_EMPTY rm
```

### `-I{}` replacement limit

BSD xargs replaces only the first 5 occurrences of `{}` per invocation.
GNU and Busybox xargs replace all occurrences.

Keep `-I{}` usage to a single replacement per line to avoid surprises.

## mktemp

```bash
# GNU: template optional
mktemp

# BSD: requires -t with prefix
mktemp -t tmp

# Portable (works on both)
mktemp -t tmp.XXXXXX
```

Note: On macOS, `mktemp -t` puts files in `$TMPDIR` (usually `/var/folders/...`).
On Linux, `mktemp -t` puts files in `/tmp`. Both are fine for temp files.

## stat

Completely different syntax between GNU and BSD.

```bash
# File modification time:
# GNU
stat -c '%Y' file

# BSD (macOS)
stat -f '%m' file

# Portable
if stat --version >/dev/null 2>&1; then
  stat -c '%Y' file
else
  stat -f '%m' file
fi
```

## tar

GNU tar auto-detects compression. BSD tar sometimes does not.

```bash
# Portable: always specify compression explicitly
tar -czf archive.tar.gz dir/    # create gzip
tar -xzf archive.tar.gz         # extract gzip
```

## Summary: Safest Portable Patterns

1. Use `#!/usr/bin/env bash` — not `#!/bin/bash`.
2. Prefer built-in Bash features over external commands when possible.
3. For `sed -i`: use `-i.bak` + `rm` workaround.
4. For `date`: branch on `date --version` or use Python.
5. For `readlink -f`: use Python `os.path.realpath` or CDPATH trick.
6. For `grep -P`: use `grep -E` with POSIX character classes.
7. For `find -printf`: pipe through `sed` or `awk`.
8. When all else fails: detect platform with `uname -s` and branch.

---
name: bash-best-practices
description: Robust Bash scripting -- strict mode, quoting, error handling, trap cleanup, exit codes, macOS/Linux compatibility.
---

# Bash Best Practices

Follow repository conventions first. In Situate, shell tooling may run on macOS and shared Linux CI hosts; this does not expand product platform support. Use Volta for Node/npm invocations and coordinated commands for artifact-writing tests and builds. Read `.env` only through the repository's data parser, never `source` or `eval`; do not add secret-manager CLI dependencies or enable command tracing around credentials.

## Script Header — Every Script Starts Here

```bash
#!/usr/bin/env bash
set -euo pipefail
```

- Use `#!/usr/bin/env bash` over `#!/bin/bash` — bash location varies across systems.
- `set -euo pipefail` is mandatory:
  - `-e` — exit on first error
  - `-u` — error on unset variables
  - `-o pipefail` — pipeline fails if any command in it fails

## Quoting

- **Always double-quote variables**: `"$var"`, `"${var}"`, `"$@"`.
- Unquoted variables cause word splitting and globbing. `rm -rf $DIR/*` with `DIR="/important data"` becomes `rm -rf /important data/*` — two separate deletions.
- Single quotes for literals: `grep 'pattern' file`.
- Quotes can be omitted inside `$(( ))` arithmetic and `[[ ]]` tests.

## Variables

| Type                 | Convention                      | Example                       |
| -------------------- | ------------------------------- | ----------------------------- |
| Local (in functions) | `snake_case` + `local`          | `local file_path="/tmp/x"`    |
| Local readonly       | `snake_case` + `local -r`       | `local -r file_path="/tmp/x"` |
| Global               | `snake_case`                    | `config_dir="/etc/app"`       |
| Constants            | `UPPER_SNAKE_CASE` + `readonly` | `readonly MAX_RETRIES=5`      |

**Important:** When using `local -r`, declaration and assignment MUST be on the same line:

```bash
# BAD — fails with "readonly variable" error
local -r filename
filename="$(basename "$1")"

# GOOD — combine on one line
local -r filename="$(basename "$1")"
```

## Functions

Structure scripts with functions. Wrap main logic in a `main()` function called at the end:

```bash
main() {
  parse_args "$@"
  validate_dependencies
  # ... logic
}
main "$@"
```

- Use `local` for all variables inside functions to prevent global leakage.
- Prefer `return` over `exit` in functions (let the caller decide).

## Error Handling

- Check critical commands: `cd /path || die "Failed to cd"`.
- Write errors to stderr: `echo "Error: ..." >&2`.
- Provide a `die()` helper:

```bash
die() { printf '%s\n' "$*" >&2; exit 1; }
```

- Use meaningful exit codes, not just `exit 1` for everything:

```bash
readonly EXIT_OK=0
readonly EXIT_USAGE=64
readonly EXIT_DEPENDENCY=65
readonly EXIT_RUNTIME=66
```

## Cleanup with trap

Register cleanup for EXIT — runs on success, failure, and Ctrl+C:

```bash
work_dir="$(mktemp -d)"
cleanup() {
  [[ -z "$work_dir" ]] || rm -rf -- "$work_dir"
}
trap cleanup EXIT
```

For complex cleanup, use a function. For simple cases, inline:
`trap 'rm -f "$tmpfile"' EXIT`

## Dependency Checks

Fail fast — check required tools at script start:

```bash
require() {
  command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"
}
require curl
require jq
```

## Input Validation and Help

- Always support `--help` flag.
- Validate argument count and types early.
- Use `${1:-}` to safely reference potentially unset positional parameters under `set -u`.

## Tests: Use `[[ ]]` Over `[ ]`

`[[ ]]` is a Bash builtin — no word splitting, supports `&&`, `||`, pattern matching, regex.
`[ ]` is POSIX `test` — fragile with unquoted variables, no pattern matching.

## Loops: Avoid `for f in $(command)`

```bash
# Bad — word splitting on spaces
for f in $(ls *.mp3); do ...

# Good — safe glob
for f in *.mp3; do ...

# Good — line-by-line from command output
while IFS= read -r line; do
  ...
done < <(some_command)
```

## ShellCheck

Run [ShellCheck](https://www.shellcheck.net/) on every script. It catches most common mistakes automatically:

```bash
shellcheck -x script.sh
```

Integrate into CI or pre-commit hooks.

## Anti-Patterns

For a comprehensive list of mistakes to avoid, see [references/anti-patterns.md](references/anti-patterns.md).

## Cross-Platform Compatibility (macOS / Linux)

macOS ships BSD coreutils, Linux uses GNU coreutils. Key tools behave differently:
`sed -i`, `date`, `find`, `readlink`, `grep`, `xargs`, `mktemp`.

For detailed differences and workarounds, see [references/cross-platform.md](references/cross-platform.md).

## Script Template

Use this as a starting point for new scripts:

```bash
#!/usr/bin/env bash
set -euo pipefail

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_NAME="${0##*/}"

log()  { printf '%s [%s] %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" "${*:2}" >&2; }
info() { log "INFO" "$@"; }
warn() { log "WARN" "$@"; }
die()  { log "ERROR" "$@"; exit 1; }

cleanup() { :; }
trap cleanup EXIT

require() {
  command -v "$1" >/dev/null 2>&1 || die "Missing dependency: $1"
}

print_help() {
  cat <<EOF
Usage: ${SCRIPT_NAME} [OPTIONS] <args>

Options:
  --help     Show this help
EOF
}

main() {
  [[ "${1:-}" == "--help" ]] && { print_help; exit 0; }

  # require curl
  # require jq

  info "Starting ${SCRIPT_NAME}..."
}

main "$@"
```

## When NOT to Use Bash

- Script exceeds ~200 lines of logic — use Python, Go, or another language.
- Complex data structures (nested JSON, maps) — `jq` helps only so far.
- Parallel execution with proper error handling.
- Anything requiring `eval` with user input.

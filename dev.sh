#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec node "$root/tools/dev.mjs" "$@"

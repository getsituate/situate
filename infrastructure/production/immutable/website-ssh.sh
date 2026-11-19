#!/usr/bin/env bash
set -euo pipefail

if [[ ${SSH_ORIGINAL_COMMAND:-} != publish-website ]]; then
  printf '%s\n' 'Only website publication is permitted.' >&2
  exit 1
fi
exec /usr/bin/sudo -n /usr/bin/python3 -I /usr/local/lib/situate/website_content.py receive

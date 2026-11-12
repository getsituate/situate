#!/usr/bin/env bash
set -euo pipefail

release=${1:?A release ID is required.}
mode=${2:-deploy}
[[ $release =~ ^[0-9]{14}-[a-f0-9]{12}$ ]] || { echo 'Invalid release ID.' >&2; exit 2; }
[[ $mode == deploy || $mode == rollback ]] || exit 2
base=/opt/situate-reboot
candidate="$base/releases/$release"
[[ -d $candidate && ! -L $candidate ]] || { echo 'Release not found.' >&2; exit 1; }
exec 9>"$base/deploy.lock"
flock -x 9
[[ ! -e $base/current.next && ! -L $base/current.next ]] || {
  echo 'An interrupted activation exists at current.next; inspect it before retrying.' >&2; exit 1;
}

previous=$(readlink -f "$base/current" 2>/dev/null || true)
if [[ -n $previous && $previous != "$base/current" ]]; then
  [[ $previous =~ ^/opt/situate-reboot/releases/[0-9]{14}-[a-f0-9]{12}$ && -d $previous ]] || {
    echo 'Current release is outside the release directory.' >&2; exit 1;
  }
else
  previous=''
fi
cd "$candidate"
docker network inspect getsituate_default >/dev/null
docker compose config --quiet
if [[ $mode == deploy ]]; then docker compose pull; fi
if ! docker compose up -d --no-build --pull never --wait --wait-timeout 90; then
  echo 'Website health check failed; restoring the previous deployment.' >&2
  if [[ -n $previous ]]; then
    if ! (cd "$previous" && docker compose up -d --no-build --pull never --wait --wait-timeout 90); then
      echo 'Rollback failed. Inspect the situate-reboot containers before any retry.' >&2
      exit 1
    fi
  else
    docker compose down
  fi
  exit 1
fi
ln -s "$candidate" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
printf 'Active website release: %s\n' "$release"
docker compose ps

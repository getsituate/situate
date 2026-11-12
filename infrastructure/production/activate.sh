#!/usr/bin/env bash
set -euo pipefail
umask 077
release=${1:?A website release ID is required.}
[[ $release =~ ^[0-9]{14}-[a-f0-9]{12}$ ]] || { echo 'Invalid website release ID.' >&2; exit 2; }
base=/opt/situate-production
candidate="$base/releases/$release"
[[ -d $candidate && ! -L $candidate ]] || { echo 'Website release not found.' >&2; exit 1; }
[[ -d /opt/situate/releases && ! -L /opt/situate ]] || { echo 'Prepare production storage first.' >&2; exit 1; }
[[ ! -L $base/deploy.lock ]] || { echo 'Deployment locks must not be symlinks.' >&2; exit 1; }
exec 9>"$base/deploy.lock"
flock -x 9
for pending in current.next deploy.pending proxy.pending edge.pending retirement.pending; do
  [[ ! -e $base/$pending && ! -L $base/$pending ]] || {
    echo "An interrupted operation exists at $base/$pending; inspect it before continuing." >&2; exit 1;
  }
done
previous=$(readlink -f "$base/current" 2>/dev/null || true)
if [[ -n $previous && $previous != "$base/current" ]]; then
  [[ $previous =~ ^/opt/situate-production/releases/[0-9]{14}-[a-f0-9]{12}$ && -d $previous ]] || {
    echo 'Current website release is outside the release directory.' >&2; exit 1;
  }
else
  previous=''
fi
cd "$candidate"
docker network inspect getsituate_default >/dev/null
docker compose config --quiet
docker compose pull
printf '%s\n%s\n' "$candidate" "$previous" > "$base/deploy.pending"
restore() {
  if [[ -e $base/current.next || -L $base/current.next ]]; then
    [[ -L $base/current.next && $(readlink -f "$base/current.next") == "$candidate" ]] || return 1
    rm "$base/current.next" || return 1
  fi
  if [[ -n $previous ]]; then
    (cd "$previous" && docker compose up -d --no-build --pull never --wait --wait-timeout 90) || return 1
    ln -s "$previous" "$base/current.next" || return 1
    mv -Tf "$base/current.next" "$base/current" || return 1
  else
    docker compose down || return 1
    if [[ -e $base/current || -L $base/current ]]; then
      [[ -L $base/current && $(readlink -f "$base/current") == "$candidate" ]] || return 1
      rm "$base/current" || return 1
    fi
  fi
}
on_error() {
  trap - ERR HUP INT TERM
  echo 'Website activation failed; restoring the previous website service.' >&2
  if restore; then
    rm -f "$base/current.next" "$base/deploy.pending"
  else
    echo 'Website service recovery failed. Retain deploy.pending and inspect containers before retrying.' >&2
  fi
  exit 1
}
trap on_error ERR HUP INT TERM
docker compose up -d --no-build --pull never --wait --wait-timeout 90
ln -s "$candidate" "$base/current.next"
mv -Tf "$base/current.next" "$base/current"
rm "$base/deploy.pending"
trap - ERR HUP INT TERM
printf 'Active production website release: %s\n' "$release"

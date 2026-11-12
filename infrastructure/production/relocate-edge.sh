#!/usr/bin/env bash
set -euo pipefail
umask 077
base=/opt/situate-production
edge="$base/edge"
container=getsituate-caddy-1
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
if [[ $# == 1 && $1 == --help ]]; then
  printf 'Usage: relocate-edge.sh\nRelocate the running Caddy proxy without changing its routes.\n'
  exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: relocate-edge.sh' >&2; exit 2; }
[[ -d $base && ! -L $base && -d $edge && ! -L $edge ]] || {
  echo 'Prepare production storage before relocating the edge proxy.' >&2; exit 1;
}
if [[ -e /opt/getsituate || -L /opt/getsituate ]]; then
  [[ -d /opt/getsituate && ! -L /opt/getsituate && ! -L /opt/getsituate/deploy.lock ]] || exit 1
  exec 7>/opt/getsituate/deploy.lock
  flock -x 7
fi
for path in "$base/edge.lock" "$base/deploy.lock"; do
  [[ ! -L $path && ( ! -e $path || -f $path ) ]] || { echo 'Deployment locks must be regular files.' >&2; exit 1; }
done
exec 8>"$base/edge.lock"
flock -x 8
exec 9>"$base/deploy.lock"
flock -x 9
for pending in current.next deploy.pending proxy.pending edge.pending retirement.pending; do
  [[ ! -e $base/$pending && ! -L $base/$pending ]] || {
    echo 'An interrupted deployment or proxy change exists; inspect its pending marker before continuing.' >&2; exit 1;
  }
done
docker inspect "$container" --format '{{json .}}' | python3 -c '
import json, sys
c = json.load(sys.stdin)
mounts = {m["Destination"]: m for m in c["Mounts"]}
assert c["State"]["Running"], "The edge is not running."
assert c["Config"]["Labels"]["com.docker.compose.project"] == "getsituate", "Unexpected edge project."
assert c["Config"]["Labels"]["com.docker.compose.service"] == "caddy", "Unexpected edge service."
assert mounts["/data"]["Name"] == "getsituate_caddy_data", "Unexpected certificate volume."
assert mounts["/config"]["Name"] == "getsituate_caddy_config", "Unexpected configuration volume."
assert "getsituate_default" in c["NetworkSettings"]["Networks"], "Unexpected edge network."
'
config=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
[[ -f $config && ! -L $config && $(readlink -f "$config") == "$config" ]] || {
  echo 'Unexpected Caddy configuration mount; inspect it before continuing.' >&2; exit 1;
}
case "$config" in
  "$edge/Caddyfile")
    docker exec "$container" caddy validate --config /etc/caddy/Caddyfile
    printf 'The edge proxy already uses %s.\n' "$config"
    exit 0
    ;;
  /opt/getsituate/releases/*/Caddyfile) previous_compose="${config%/*}/compose.yaml" ;;
  "$base"/releases/*/Caddyfile) previous_compose="${config%/*}/edge-compose.yaml" ;;
  *) echo 'Unexpected Caddy configuration mount; inspect it before continuing.' >&2; exit 1 ;;
esac
[[ -f $previous_compose && ! -L $previous_compose && $(readlink -f "$previous_compose") == "$previous_compose" ]] || {
  echo 'The previous proxy Compose file is required for recovery.' >&2; exit 1;
}
for name in Caddyfile compose.yaml; do
  [[ ! -e $edge/$name && ! -L $edge/$name ]] || {
    echo 'Edge files already exist; inspect them before relocating the proxy.' >&2; exit 1;
  }
done
docker compose -p getsituate -f "$previous_compose" config --quiet
docker network inspect getsituate_default >/dev/null
docker volume inspect getsituate_caddy_data >/dev/null
docker volume inspect getsituate_caddy_config >/dev/null
backup=$(mktemp -d "$base/edge-backup.XXXXXXXX")
cp -p "$config" "$backup/Caddyfile"
cp -p "$previous_compose" "$backup/previous-compose.yaml"
printf '%s\n%s\n' "$config" "$previous_compose" > "$backup/previous-paths"
cp "$source_dir/edge-compose.yaml" "$backup/compose.next.yaml"
docker compose -p getsituate -f "$backup/compose.next.yaml" config --quiet
staging=$(docker exec "$container" mktemp -d /config/edge-stage.XXXXXXXX)
[[ $staging =~ ^/config/edge-stage\.[a-zA-Z0-9]+$ ]] || exit 1
cleanup() { docker exec "$container" rm -rf "$staging" >/dev/null || true; }
trap cleanup EXIT
docker cp "$backup/Caddyfile" "$container:$staging/Caddyfile" >/dev/null
docker exec "$container" caddy validate --config "$staging/Caddyfile" --adapter caddyfile
docker cp "$source_dir/edge-snippets.sh" "$container:$staging/edge-snippets.sh" >/dev/null
docker exec "$container" sh "$staging/edge-snippets.sh" backup "$staging/snippets.tar"
docker cp "$container:$staging/snippets.tar" "$backup/snippets.tar" >/dev/null
chmod 0600 "$backup/snippets.tar"
restore() {
  docker compose -p getsituate -f "$previous_compose" up -d --no-deps --no-build --pull never --wait --wait-timeout 90 caddy || return 1
  local mounted
  mounted=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}') || return 1
  [[ $mounted == "$config" ]] || return 1
  docker exec "$container" sh "$staging/edge-snippets.sh" restore "$staging/snippets.tar" || return 1
  docker exec "$container" caddy validate --config /etc/caddy/Caddyfile || return 1
  rm -f "$edge/Caddyfile" "$edge/compose.yaml" || return 1
}
on_error() {
  trap - ERR HUP INT TERM
  echo "Edge relocation failed; restoring the previous proxy from $previous_compose." >&2
  if restore; then
    rm -f "$base/edge.pending" || echo 'Could not clear edge.pending; inspect before retrying.' >&2
  else
    echo 'Edge recovery failed; retain edge.pending and inspect the proxy before retrying.' >&2
  fi
  exit 1
}
trap on_error ERR HUP INT TERM
printf '%s\n' "$backup" > "$base/edge.pending"
cp "$backup/Caddyfile" "$edge/Caddyfile"
# Container root has no DAC override for this deploy-owned bind mount.
chmod 0644 "$edge/Caddyfile"
cp "$backup/compose.next.yaml" "$edge/compose.yaml"
docker exec "$container" sh "$staging/edge-snippets.sh" migrate "$staging/snippets.tar"
docker compose -p getsituate -f "$edge/compose.yaml" up -d --no-deps --no-build --pull never --wait --wait-timeout 90 caddy
mounted=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
[[ $mounted == "$edge/Caddyfile" ]]
docker exec "$container" caddy validate --config /etc/caddy/Caddyfile
rm "$base/edge.pending"
trap - ERR HUP INT TERM
printf 'Edge configuration relocated to %s. Existing routes and volumes retained. Backup: %s\n' "$edge" "$backup"

#!/usr/bin/env bash
set -euo pipefail
umask 077

base=/opt/situate-reboot
container=getsituate-caddy-1
route=/config/sites/reboot.caddy
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
production=/opt/situate-production
if [[ -e /opt/getsituate || -L /opt/getsituate ]]; then
  [[ -d /opt/getsituate && ! -L /opt/getsituate && ! -L /opt/getsituate/deploy.lock ]] || exit 1
  exec 7>/opt/getsituate/deploy.lock
  flock -x 7
fi
for path in "$production/edge.lock" "$base/deploy.lock"; do
  [[ ! -L $path && ( ! -e $path || -f $path ) ]] || { echo 'Deployment locks must be regular files.' >&2; exit 1; }
done
exec 8>"$production/edge.lock"
flock -x 8
exec 9>"$base/deploy.lock"
flock -x 9
[[ ! -e $production/retirement.pending && ! -L $production/retirement.pending ]] || {
  echo 'An interrupted retirement exists; inspect retirement.pending before continuing.' >&2; exit 1;
}
[[ ! -e $production/edge.pending && ! -L $production/edge.pending ]] || {
  echo 'An interrupted edge relocation exists; inspect edge.pending before continuing.' >&2; exit 1;
}
[[ ! -e $base/proxy.pending && ! -L $base/proxy.pending ]] || {
  echo 'An interrupted proxy change exists at proxy.pending; inspect its backup before continuing.' >&2; exit 1;
}

config=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
[[ ( $config == /opt/getsituate/releases/*/Caddyfile || $config == "$production/edge/Caddyfile" || $config == "$production"/releases/*/Caddyfile ) && -f $config && ! -L $config ]] || {
  echo 'Unexpected Caddy configuration mount; inspect it before continuing.' >&2; exit 1;
}
docker exec "$container" wget -q -O /dev/null http://situate-reboot:8080/
backup=$(mktemp -d "$base/proxy-backup.XXXXXXXX")
cp -p "$config" "$backup/Caddyfile"
printf '%s\n' "$config" > "$backup/config-path"
if docker exec "$container" test -f "$route"; then
  docker cp "$container:$route" "$backup/reboot.caddy" >/dev/null
fi

staging=$(docker exec "$container" mktemp -d /config/website-stage.XXXXXXXX)
[[ $staging =~ ^/config/website-stage\.[a-zA-Z0-9]+$ ]] || exit 1
cleanup() { docker exec "$container" rm -rf "$staging" >/dev/null || true; }
trap cleanup EXIT
container_copy() {
  docker exec -i "$container" sh -ec 'umask 077; test ! -e "$1"; test ! -L "$1"; cat > "$1"' sh "$2" < "$1"
}
if [[ -f $backup/reboot.caddy ]]; then
  docker exec "$container" sh -ec 'umask 077; cp "$1" "$2"; chmod "$(stat -c %a "$1")" "$2"; touch -r "$1" "$2"' sh "$route" "$staging/reboot.original"
fi
docker exec "$container" test ! -e "$route.next"
docker exec "$container" test ! -L "$route.next"
docker exec "$container" mkdir -p "$staging/sites"
docker exec "$container" sh -c 'if [ -d /config/sites ]; then cp -a /config/sites/. "$1/sites/"; fi' sh "$staging"
docker exec "$container" rm -f "$staging/sites/reboot.caddy"
container_copy "$source_dir/reboot.caddy" "$staging/sites/reboot.caddy"
cp "$config" "$backup/Caddyfile.candidate"
if ! grep -Fxq 'import /config/sites/*.caddy' "$backup/Caddyfile.candidate"; then
  printf '\nimport /config/sites/*.caddy\n' >> "$backup/Caddyfile.candidate"
fi
awk -v replacement="import $staging/sites/*.caddy" '
  $0 == "import /config/sites/*.caddy" { $0 = replacement }
  { print }
' "$backup/Caddyfile.candidate" > "$backup/Caddyfile.check"
container_copy "$backup/Caddyfile.check" "$staging/Caddyfile"
docker exec "$container" caddy validate --config "$staging/Caddyfile" --adapter caddyfile

restore() {
  cat "$backup/Caddyfile" > "$config" || return 1
  docker exec "$container" rm -f "$route.next" || return 1
  if [[ -f $backup/reboot.caddy ]]; then
    docker exec "$container" cp -p "$staging/reboot.original" "$route.next" || return 1
    docker exec "$container" mv "$route.next" "$route" || return 1
  else
    docker exec "$container" rm -f "$route" || return 1
  fi
  docker exec "$container" caddy validate --config /etc/caddy/Caddyfile || return 1
  docker exec "$container" caddy reload --config /etc/caddy/Caddyfile || return 1
}
on_error() {
  trap - ERR HUP INT TERM
  echo "Proxy configuration failed; restoring backup at $backup." >&2
  if restore; then
    rm -f "$base/proxy.pending" || echo 'Could not clear proxy.pending; inspect before retrying.' >&2
  else
    echo 'Proxy recovery failed; inspect proxy.pending and the running configuration before retrying.' >&2
  fi
  exit 1
}
trap on_error ERR HUP INT TERM
printf '%s\n' "$backup" > "$base/proxy.pending"
docker exec "$container" mkdir -p /config/sites
container_copy "$source_dir/reboot.caddy" "$route.next" || on_error
docker exec "$container" mv "$route.next" "$route"
# The file is bind-mounted, so preserve its inode when installing the validated configuration.
cat "$backup/Caddyfile.candidate" > "$config"
docker exec "$container" caddy validate --config /etc/caddy/Caddyfile
docker exec "$container" caddy reload --config /etc/caddy/Caddyfile
rm "$base/proxy.pending"
trap - ERR HUP INT TERM
printf 'Proxy route installed. Configuration backup: %s\n' "$backup"

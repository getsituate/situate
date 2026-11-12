#!/usr/bin/env bash
set -euo pipefail
umask 077
mode=${1:?Choose feeds or website.}
[[ $mode == feeds || $mode == website ]] || exit 2
base=/opt/situate-production
container=getsituate-caddy-1
source_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
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
    echo "An interrupted operation exists at $base/$pending; inspect it before continuing." >&2; exit 1;
  }
done
config=$(docker inspect "$container" --format '{{range .Mounts}}{{if eq .Destination "/etc/caddy/Caddyfile"}}{{.Source}}{{end}}{{end}}')
[[ ( $config == /opt/getsituate/releases/*/Caddyfile || $config == "$base/edge/Caddyfile" || $config == "$base"/releases/*/Caddyfile ) && -f $config && ! -L $config ]] || {
  echo 'Unexpected Caddy configuration mount; inspect it before continuing.' >&2; exit 1;
}
docker exec "$container" wget -q -O /dev/null http://situate-production:8080/healthz
docker exec "$container" wget -q -O /dev/null http://situate-production:8080/releases/current/download.json
docker exec "$container" wget -q -O /dev/null http://situate-production:8080/releases/current/update.json
backup=$(mktemp -d "$base/proxy-backup.XXXXXXXX")
cp -p "$config" "$backup/Caddyfile"
printf '%s\n' "$config" > "$backup/config-path"
if [[ $mode == website ]]; then
  cp "$source_dir/Caddyfile" "$backup/Caddyfile.candidate"
else
  python3 - "$config" "$backup/Caddyfile.candidate" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
route = "\thandle /releases/* {\n\t\treverse_proxy situate-production:8080\n\t}\n"
lines = source.splitlines(keepends=True)
if lines.count("getsituate.com {\n") != 1:
    raise SystemExit("Cannot identify the apex Caddy site unambiguously.")
if "handle /releases/*" in source:
    if route not in source:
        raise SystemExit("The release namespace already has a different route.")
else:
    source = "".join(line + route if line == "getsituate.com {\n" else line for line in lines)
pathlib.Path(sys.argv[2]).write_text(source)
PY
fi
staging=$(docker exec "$container" mktemp -d /config/production-stage.XXXXXXXX)
[[ $staging =~ ^/config/production-stage\.[a-zA-Z0-9]+$ ]] || exit 1
cleanup() { docker exec "$container" rm -rf "$staging" >/dev/null || true; }
trap cleanup EXIT
# Create the validation file as container root; docker cp can retain the host UID.
docker exec -i "$container" sh -ec 'umask 077; test ! -e "$1"; test ! -L "$1"; cat > "$1"' sh "$staging/Caddyfile" < "$backup/Caddyfile.candidate"
docker exec "$container" caddy validate --config "$staging/Caddyfile" --adapter caddyfile
restore() {
  cat "$backup/Caddyfile" > "$config" || return 1
  docker exec "$container" caddy validate --config /etc/caddy/Caddyfile || return 1
  docker exec "$container" caddy reload --config /etc/caddy/Caddyfile || return 1
}
on_error() {
  trap - ERR HUP INT TERM
  echo "Proxy activation failed; restoring configuration from $backup." >&2
  if restore; then
    rm -f "$base/proxy.pending" || echo 'Could not clear proxy.pending; inspect before retrying.' >&2
  else
    echo 'Proxy recovery failed; retain proxy.pending and inspect before retrying.' >&2
  fi
  exit 1
}
trap on_error ERR HUP INT TERM
printf '%s\n' "$backup" > "$base/proxy.pending"
# Preserve the inode of the file already bind-mounted into the running proxy.
cat "$backup/Caddyfile.candidate" > "$config"
docker exec "$container" caddy validate --config /etc/caddy/Caddyfile
docker exec "$container" caddy reload --config /etc/caddy/Caddyfile
rm "$base/proxy.pending"
trap - ERR HUP INT TERM
printf 'Proxy mode active: %s. Backup: %s\n' "$mode" "$backup"

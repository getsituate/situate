#!/usr/bin/env bash
set -euo pipefail
umask 077
if [[ ${1:-} == --help && $# == 1 ]]; then
  printf 'Usage: prepare-host.sh\nCreate deploy-owned production storage without changing traffic.\n'
  exit 0
fi
[[ $# == 0 ]] || { echo 'Usage: prepare-host.sh' >&2; exit 2; }
[[ $(id -u) == 0 ]] || { echo 'Run host preparation as root.' >&2; exit 1; }
getent passwd deploy >/dev/null
command -v docker >/dev/null
command -v flock >/dev/null
command -v python3 >/dev/null
docker compose version >/dev/null
docker network inspect getsituate_default >/dev/null
docker volume inspect getsituate_caddy_data >/dev/null
docker volume inspect getsituate_caddy_config >/dev/null
for path in /opt/situate /opt/situate/releases /opt/situate-production /opt/situate-production/releases /opt/situate-production/edge; do
  [[ ! -L $path && ( ! -e $path || -d $path ) ]] || { echo 'Deployment roots must be directories, not symlinks.' >&2; exit 1; }
done
install -d -m 0755 -o deploy -g deploy /opt/situate /opt/situate/releases
install -d -m 0750 -o deploy -g deploy /opt/situate-production /opt/situate-production/releases /opt/situate-production/edge
printf 'Production storage prepared.\n'

#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "$*" >&2; exit 1; }

[[ $# == 1 && $1 =~ ^[a-f0-9]{40}$ && $EUID == 0 ]] ||
  fail 'Run as root with the expected full build revision.'
readonly root=/usr/local/lib/situate
readonly expected_revision=$1
status=0
boot=$(cloud-init status --wait --format=json) || status=$?
if [[ $status == 2 ]]; then
  # The Hetzner datasource still emits deprecated config on Ubuntu 24.04.
  python3 -c 'import json, sys
boot = json.load(sys.stdin)
sys.exit(not (boot["status"] == "done" and not boot["errors"]
              and set(boot["recoverable_errors"]) <= {"DEPRECATED"}))' <<< "$boot" ||
    fail 'Cloud-init completed with unexpected recoverable errors.'
elif [[ $status != 0 ]]; then
  fail 'Cloud-init did not complete successfully.'
fi
[[ -s /etc/machine-id && -s /etc/ssh/ssh_host_ed25519_key.pub ]] ||
  fail 'The instance did not establish a machine ID and SSH host key.'
grep -Fxq "source_revision=$expected_revision" "$root/image-provenance" ||
  fail 'The image was not built from the expected revision.'
expected_packages=$(awk -F= '$1 == "installed_packages_sha256" {print $2}' "$root/image-provenance")
actual_packages=$(dpkg-query -W -f='${db:Status-Abbrev}\t${binary:Package}\t${Version}\n' | LC_ALL=C sort | sha256sum | cut -d ' ' -f 1)
[[ $expected_packages =~ ^[a-f0-9]{64}$ && $actual_packages == "$expected_packages" ]] ||
  fail 'The booted package set differs from the image.'
if findmnt -n -M /opt/situate >/dev/null || findmnt -n -M /srv/situate-state >/dev/null; then
  fail 'Run the boot check before attaching publication storage.'
fi
cd -- "$root"
images=$(docker compose config --images)
[[ $(printf '%s\n' "$images" | wc -l) -eq 2 ]] || fail 'Expected two baked images.'
while IFS= read -r image; do
  [[ $image =~ ^(nginx|caddy)@sha256:[a-f0-9]{64}$ ]] || fail 'Unpinned serving image.'
  grep -Fxq "$image" image-provenance || fail 'The serving image does not match provenance.'
  [[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]] ||
    fail 'A pinned image is not available locally on amd64.'
done <<< "$images"
[[ -z $(docker ps -aq --filter label=com.docker.compose.project=situate-immutable) ]] ||
  fail 'The serving stack must not exist without the publication volume.'
if "$root/state.sh" check >/dev/null 2>&1; then
  fail 'The state check accepted a boot without publication storage.'
fi
printf 'Boot and local image checks passed for %s.\n' "$expected_revision"

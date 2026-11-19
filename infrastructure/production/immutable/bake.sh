#!/usr/bin/env bash
set -euo pipefail
umask 022

usage() {
  printf '%s\n' 'Usage: bake.sh INPUT_DIR --confirm-disposable-builder' \
    'Install the reviewed inputs on a disposable Ubuntu 24.04 amd64 builder. This does not create a snapshot.'
}

die() { printf '%s\n' "$*" >&2; exit 1; }

package_hash() {
  dpkg-query -W -f='${db:Status-Abbrev}\t${binary:Package}\t${Version}\n' | LC_ALL=C sort | sha256sum | cut -d ' ' -f 1
}

read_pin() {
  [[ -f $1 && ! -L $1 ]] || die 'Missing input pin.'
  local value
  value=$(<"$1")
  [[ $value =~ $2 ]] || die 'Invalid input pin.'
  printf '%s\n' "$value"
}

main() {
  if [[ $# == 1 && $1 == --help ]]; then usage; return; fi
  [[ $# == 2 && $2 == --confirm-disposable-builder && $EUID == 0 ]] || { usage >&2; exit 2; }
  if [[ $(uname -m) != x86_64 ]] || ! grep -qx 'ID=ubuntu' /etc/os-release ||
    ! grep -qx 'VERSION_ID="24.04"' /etc/os-release; then
    die 'Expected an Ubuntu 24.04 amd64 builder.'
  fi
  local here input install_dir revision base_id base_hash final_hash lock_hash images image file
  here=$(realpath -- "$(dirname -- "${BASH_SOURCE[0]}")")
  input=$(realpath -- "$1")
  install_dir=/usr/local/lib/situate
  for file in "$install_dir" /srv/situate-state /opt/situate /opt/situate-production /opt/getsituate /etc/policy-rc.d /var/lib/docker; do
    [[ ! -e $file && ! -L $file ]] || die "Not a clean builder: $file."
  done
  revision=$(read_pin "$input/revision" '^[a-f0-9]{40}$')
  base_id=$(read_pin "$input/base-image-id" '^[1-9][0-9]{0,14}$')
  base_hash=$(read_pin "$input/base-packages-sha256" '^[a-f0-9]{64}$')
  final_hash=$(read_pin "$input/installed-packages-sha256" '^[a-f0-9]{64}$')
  lock_hash=$(read_pin "$input/packages-lock-sha256" '^[a-f0-9]{64}$')
  [[ $(package_hash) == "$base_hash" ]] || die 'Base package inventory does not match the reviewed base.'

  # Package scripts must not start services midway through the bake.
  systemctl mask --now apt-daily.timer apt-daily-upgrade.timer apt-daily.service apt-daily-upgrade.service unattended-upgrades.service
  local packages=() line name
  [[ -f $input/packages.sha256 && ! -L $input/packages.sha256 ]] || die 'Missing package lock.'
  cd -- "$input"
  [[ $(sha256sum packages.sha256 | cut -d ' ' -f 1) == "$lock_hash" ]] || die 'Package lock digest differs.'
  while IFS= read -r line || [[ -n $line ]]; do
    [[ $line =~ ^[a-f0-9]{64}\ \ ([A-Za-z0-9][A-Za-z0-9.+_~:%-]*\.deb)$ ]] || die 'Invalid package lock entry.'
    name=${BASH_REMATCH[1]}
    [[ -f $name && ! -L $name ]] || die 'Missing pinned package.'
    for file in "${packages[@]}"; do [[ $file != "./$name" ]] || die 'Duplicate package lock entry.'; done
    packages+=("./$name")
  done < packages.sha256
  [[ ${#packages[@]} -gt 0 ]] || die 'Empty package lock.'
  sha256sum --strict --check packages.sha256
  printf '#!/bin/sh\nexit 101\n' >/etc/policy-rc.d
  chmod 0755 /etc/policy-rc.d
  # A failed bake is disposable. Do not clean up and resume a partial install.
  DEBIAN_FRONTEND=noninteractive dpkg --force-confold --unpack "${packages[@]}"
  DEBIAN_FRONTEND=noninteractive dpkg --force-confold --configure -a
  [[ -z $(dpkg --audit) && $(package_hash) == "$final_hash" ]] || die 'Installed package inventory differs.'
  rm -- /etc/policy-rc.d
  for file in docker python3 flock findmnt lsblk mount umount systemctl cloud-init; do
    command -v "$file" >/dev/null || die "Missing runtime command: $file."
  done

  install -d -m 0755 "$install_dir" /etc/docker
  install -d -m 0700 /opt/situate /srv/situate-state
  install -m 0644 "$here/"{compose.yaml,Caddyfile,website.py,verify-state.py,freeze-release.py,host-enrollment.py} "$install_dir/"
  install -m 0644 "$here/../../releases/remote.py" "$install_dir/release_storage.py"
  install -m 0755 "$here/"{state.sh,verify-boot.sh} "$install_dir/"
  install -m 0644 "$here/"{situate-serving.service,situate-enrollment.service,situate-enrollment.path} /etc/systemd/system/
  install -m 0644 "$here/sshd.conf" /etc/ssh/sshd_config.d/00-situate.conf
  install -m 0644 "$here/docker-daemon.json" /etc/docker/daemon.json
  # Only the website document root differs; release routing is shared with the legacy stack.
  awk '{if ($0 == "        root /usr/share/nginx/html;") {hits++; print "        root /srv/website/current;"} else {print}} END {if (hits != 1) exit 1}' \
    "$here/../docker/nginx.conf" > "$install_dir/nginx.conf"
  cd -- "$install_dir"
  systemctl daemon-reload
  systemctl enable situate-enrollment.path
  systemctl enable --now docker.service
  docker compose config --quiet
  images=$(docker compose config --images)
  [[ $(printf '%s\n' "$images" | wc -l) -eq 2 ]] || die 'Expected two pinned container images.'
  while IFS= read -r image; do
    [[ $image =~ ^(nginx|caddy)@sha256:[a-f0-9]{64}$ ]] || die 'Expected a digest-pinned serving image.'
    docker pull --platform linux/amd64 "$image"
    [[ $(docker image inspect "$image" --format '{{.Os}}/{{.Architecture}}') == linux/amd64 ]] || die 'Wrong container architecture.'
  done <<< "$images"
  [[ -z $(docker ps -aq) && -z $(docker volume ls -q) ]] || die 'Builder must not contain containers or volumes.'
  printf 'source_revision=%s\nbase_image_id=%s\nbase_packages_sha256=%s\npackages_lock_sha256=%s\ninstalled_packages_sha256=%s\n%s\n' \
    "$revision" "$base_id" "$base_hash" "$lock_hash" "$final_hash" "$images" > image-provenance
  systemctl stop docker.socket docker.service
  # No build login, host identity or cloud-init seed may survive in the snapshot.
  rm -rf -- /root/.ssh /home/*/.ssh
  rm -f -- /etc/ssh/ssh_host_* /root/.bash_history /home/*/.bash_history /var/lib/systemd/random-seed
  cloud-init clean --logs --machine-id --seed
  sync
  printf '%s\n' 'Bake complete. Power off immediately and review the snapshot boundary before capturing the image.'
}

main "$@"

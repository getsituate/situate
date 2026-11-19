#!/usr/bin/env bash
set -euo pipefail
umask 077

readonly ROOT=/srv/situate-state
readonly DIST=/opt/situate
readonly RUN=/run/situate-state
readonly LEASE=$RUN/volume
readonly RECEIPT=$RUN/serving.receipt
readonly SERVICE=situate-serving.service

die() { printf '%s\n' "$*" >&2; exit 1; }

device_number() {
  local device="/dev/disk/by-id/scsi-0HC_Volume_$1"
  [[ $1 =~ ^[1-9][0-9]{0,14}$ && -b $device ]] || die 'Expected the explicitly attached Hetzner block device.'
  lsblk -dnro MAJ:MIN "$device"
}

mounted() {
  local expected
  [[ -f $LEASE && ! -L $LEASE ]] || die 'No volume mounted by state.sh.'
  expected=$(device_number "$(<"$LEASE")")
  [[ $(findmnt -rn -M "$ROOT" -o MAJ:MIN,FSTYPE,FSROOT) == "$expected ext4 /" ]] ||
    die 'Wrong or missing publication filesystem.'
  [[ $(stat -c '%u:%a' "$ROOT") == 0:700 ]] || die 'Publication filesystem root must be root-owned mode 0700.'
  [[ $(findmnt -Rrn -M "$ROOT" -o TARGET) == "$ROOT" ]] || die 'Unexpected nested mounts.'
}

bound() {
  mounted
  local expected
  expected=$(device_number "$(<"$LEASE")")
  [[ $(findmnt -rn -M "$DIST" -o MAJ:MIN,FSTYPE,FSROOT) == "$expected ext4 /distribution" ]] ||
    die 'Wrong or missing distribution bind mount.'
  [[ $(findmnt -Rrn -M "$DIST" -o TARGET) == "$DIST" ]] || die 'Unexpected nested distribution mounts.'
}

read_only() {
  local flags
  flags=$(findmnt -rn -M "$DIST" -o VFS-OPTIONS)
  [[ ,$flags, == *,ro,* ]] || die 'Freeze the distribution mount before starting service.'
}

observe() {
  python3 /usr/local/lib/situate/verify-state.py
}

expected_state() {
  local actual
  [[ -s $RECEIPT && ! -L $RECEIPT ]] || die 'Missing verified handoff receipt.'
  actual=$(observe) || die 'Publication state could not be verified.'
  [[ $actual == "$(<"$RECEIPT")" ]] ||
    die 'Publication state does not match the independently captured handoff receipt.'
}

empty_mountpoint() {
  [[ -d $1 && ! -L $1 && $(stat -c '%u:%a' "$1") == 0:700 ]] || die 'Invalid root-disk mountpoint.'
  if findmnt -rn -M "$1" >/dev/null; then die 'Mountpoint is already mounted.'; fi
  [[ -z $(ls -A -- "$1") ]] || die 'Unexpected root-disk content under mountpoint.'
}

usage() {
  printf '%s\n' 'Usage: state.sh mount VOLUME_ID | bind SITE_SHA DOWNLOAD_SHA UPDATE_SHA | mounted | receipt | evidence | fenced | check | freeze | enable --confirm-publication | unmount'
}

main() {
  if [[ $# == 1 && $1 == --help ]]; then usage; return; fi
  [[ $EUID == 0 ]] || die 'Run as root.'
  case "${1:-}" in
    mount) [[ $# == 2 ]] || { usage >&2; exit 2; } ;;
    enable) [[ $# == 2 && $2 == --confirm-publication ]] || { usage >&2; exit 2; } ;;
    bind)
      [[ $# == 4 && $2 =~ ^[a-f0-9]{64}$ && $3 =~ ^[a-f0-9]{64}$ && $4 =~ ^[a-f0-9]{64}$ ]] ||
        { usage >&2; exit 2; }
      ;;
    mounted|writable|receipt|evidence|fenced|check|freeze|unmount) [[ $# == 1 ]] || { usage >&2; exit 2; } ;;
    *) usage >&2; exit 2 ;;
  esac

  if [[ $1 != mounted && $1 != check && $1 != writable ]]; then
    install -d -m 0700 "$RUN"
    exec 9>"$RUN/lock"
    flock -n 9 || die 'Another state or website operation is running.'
  fi
  case "$1" in
    mount)
      [[ ! -e $LEASE && ! -L $LEASE ]] || die 'Existing volume record; inspect it before continuing.'
      empty_mountpoint "$ROOT"
      empty_mountpoint "$DIST"
      device_number "$2" >/dev/null
      # Record before mount. A failed/interrupted request must be inspected, not replayed.
      (set -o noclobber; printf '%s\n' "$2" >"$LEASE")
      mount -t ext4 -o rw,nodev,nosuid,noexec "/dev/disk/by-id/scsi-0HC_Volume_$2" "$ROOT"
      mounted
      ;;
    bind)
      mounted
      empty_mountpoint "$DIST"
      local expected="$2 $3 $4" actual
      actual=$(observe) || die 'Publication state could not be verified.'
      [[ $actual == "$expected" ]] || die 'State does not match the handoff hashes.'
      (set -o noclobber; printf '%s\n' "$expected" >"$RECEIPT")
      # The source is root-only before this command. Keep the filesystem itself
      # read-only until the bind's per-mount read-only flag is in effect.
      mount -o remount,ro,nodev,nosuid,noexec "$ROOT"
      mount --bind "$ROOT/distribution" "$DIST"
      mount -o remount,bind,ro,nodev,nosuid,noexec "$DIST"
      bound
      read_only
      mount -o remount,rw,nodev,nosuid,noexec "$ROOT"
      ;;
    mounted) mounted ;;
    fenced)
      local service_state
      service_state=$(systemctl show "$SERVICE" --property=ActiveState --value)
      [[ $service_state == inactive || $service_state == failed ]] || die 'The old serving service is not stopped.'
      [[ ! -e $LEASE && ! -e $RECEIPT ]] || die 'The old mount operation has not settled.'
      empty_mountpoint "$ROOT"
      empty_mountpoint "$DIST"
      [[ -z $(docker ps -aq --filter label=com.docker.compose.project=situate-immutable) ]] ||
        die 'The old serving stack still has containers.'
      ;;
    receipt) bound; read_only; observe ;;
    evidence) bound; read_only; python3 /usr/local/lib/situate/verify-state.py --evidence ;;
    check) bound; read_only; expected_state ;;
    writable)
      bound
      local flags
      flags=$(findmnt -rn -M "$DIST" -o VFS-OPTIONS)
      [[ ,$flags, == *,rw,* ]] || die 'Website publication is frozen.'
      ;;
    freeze)
      bound
      python3 /usr/local/lib/situate/freeze-release.py
      read_only
      ;;
    enable)
      bound
      read_only
      systemctl is-active --quiet "$SERVICE" || die 'Verify a running serving service before enabling publication.'
      expected_state
      mount -o remount,bind,rw,nodev,nosuid,noexec "$DIST"
      ;;
    unmount)
      if systemctl is-active --quiet "$SERVICE"; then die 'Stop the serving service first.'; fi
      mounted
      [[ -z $(docker ps -aq --filter label=com.docker.compose.project=situate-immutable) ]] ||
        die 'Inspect and remove the stopped serving stack before unmounting.'
      if findmnt -rn -M "$DIST" >/dev/null; then
        bound
        read_only
        umount "$DIST"
      fi
      umount "$ROOT"
      empty_mountpoint "$ROOT"
      empty_mountpoint "$DIST"
      rm -f -- "$RECEIPT"
      rm -- "$LEASE"
      ;;
  esac
}

main "$@"

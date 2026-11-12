# Source from Bash before launching tools as a numeric container user.
situate_ci_user_init() {
  local uid gid
  uid=$(id -u) || return
  gid=$(id -g) || return
  if getent passwd "$uid" >/dev/null; then
    return 0
  fi
  : "${HOME:?HOME must name a writable container directory}"
  case "$HOME" in
    *:*|*$'\n'*|*$'\r'*)
      printf '%s\n' 'HOME cannot contain passwd field delimiters.' >&2
      return 1
      ;;
  esac
  mkdir -p -- "$HOME" || return
  export NSS_WRAPPER_PASSWD="$HOME/ci-passwd"
  export NSS_WRAPPER_GROUP="$HOME/ci-group"
  (
    umask 077
    cp --remove-destination -- /etc/passwd "$NSS_WRAPPER_PASSWD" || exit
    cp --remove-destination -- /etc/group "$NSS_WRAPPER_GROUP" || exit
    printf '\nci-%s:x:%s:%s:CI user:%s:/bin/bash\n' "$uid" "$uid" "$gid" "$HOME" >> "$NSS_WRAPPER_PASSWD" || exit
    if ! getent group "$gid" >/dev/null; then
      printf '\nci-%s:x:%s:\n' "$gid" "$gid" >> "$NSS_WRAPPER_GROUP" || exit
    fi
  ) || return
  export LD_PRELOAD=/opt/ci-tools/libnss_wrapper.so
}
situate_ci_user_init

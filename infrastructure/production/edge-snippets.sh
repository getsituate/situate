#!/bin/sh
set -eu
umask 077
operation=${1:?Choose backup, migrate or restore.}
archive=${2:?Provide the private archive path.}
case "$archive" in /config/edge-stage.*/snippets.tar) ;; *) exit 2 ;; esac
case "$operation" in
  backup)
    [ ! -L /config/sites ] || { echo 'Snippet directory must not be a symlink.' >&2; exit 1; }
    set --
    for file in /config/sites/*.caddy; do
      [ -e "$file" ] || [ -L "$file" ] || continue
      [ -f "$file" ] && [ ! -L "$file" ] && [ "$(stat -c %h "$file")" = 1 ] || {
        echo 'Imported snippets must be regular files without links.' >&2; exit 1;
      }
      name=${file##*/}
      case "$name" in *[!A-Za-z0-9._-]*) echo 'Unsupported snippet filename.' >&2; exit 1 ;; esac
      set -- "$@" "config/sites/$name"
    done
    if [ "$#" = 0 ]; then
      : > "$archive"
    else
      tar -cpf "$archive" -C / "$@"
    fi
    ;;
  migrate)
    [ -f "$archive" ] && [ ! -L "$archive" ] || exit 1
    [ -s "$archive" ] || exit 0
    tar -tf "$archive" > "$archive.list"
    while IFS= read -r file; do
      case "$file" in config/sites/*.caddy) ;; *) exit 1 ;; esac
      [ -f "/$file" ] && [ ! -L "/$file" ] && [ "$(stat -c %h "/$file")" = 1 ] || exit 1
      # Keep restrictive modes and timestamps; container root owns the imported snippets.
      chown 0:0 "/$file"
    done < "$archive.list"
    ;;
  restore)
    [ -f "$archive" ] && [ ! -L "$archive" ] || exit 1
    [ -s "$archive" ] || exit 0
    tar -xpf "$archive" -C /
    ;;
  *) exit 2 ;;
esac

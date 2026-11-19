#!/usr/bin/env python3
"""Freeze the distribution bind mount under the publisher's lock."""
import fcntl
import os
import stat
import subprocess


def freeze(root='/opt/situate', *, uid=1100, run=subprocess.run):
    path = f'{root}/release.lock'
    # The publisher creates this file on first use. An active feed without it
    # is unexpected; do not create or replace a publisher-owned lock as root.
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != uid or info.st_nlink != 1:
            raise ValueError('Invalid publisher lock.')
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        current = os.stat(path, follow_symlinks=False)
        if (info.st_dev, info.st_ino) != (current.st_dev, current.st_ino):
            raise ValueError('Publisher lock changed while acquiring it.')
        run(['mount', '-o', 'remount,bind,ro,nodev,nosuid,noexec', root], check=True)
    finally:
        os.close(fd)


if __name__ == '__main__':
    freeze()

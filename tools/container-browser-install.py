"""Serialize browser cache mutation inside the Linux Docker engine."""

import fcntl
import os
from pathlib import Path
import stat
import subprocess
import sys


def main(command):
    root = Path(os.environ['PLAYWRIGHT_BROWSERS_PATH'])
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('Browser cache must be private and owned.')
    fd = os.open(root / '.situate-install.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_nlink != 1 or info.st_mode & 0o077:
            raise ValueError('Browser install lock must be private and owned.')
        fcntl.flock(fd, fcntl.LOCK_EX)
        return subprocess.call(command, env={**os.environ, 'PLAYWRIGHT_SKIP_BROWSER_GC': '1'}, pass_fds=(fd,))
    finally:
        os.close(fd)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

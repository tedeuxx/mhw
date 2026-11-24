"""Run a command on a pseudo-terminal and answer one prompt (#590).

The lifecycle suite's real-terminal arm ran `mhw install` through the vendored node-pty until #590 removed
it with the paste wrapper, its only runtime user. This test helper takes its place with the standard
library's pty module, so no package is needed: CPython on the macOS and Linux runners, never shipped.

    python3 -I -B test/helpers/pty-run.py KEY_HEX TIMEOUT_SECONDS -- command [args...]

It starts the command on a new terminal (120 x 40), waits for 'any other key to abort:' in its output,
writes the key (its bytes in hex), reads to the end and prints one JSON line: the exit code and the
output as UTF-8 (replacement for invalid bytes). A timeout prints code null with the output so far.
"""
import json
import os
import pty
import select
import signal
import struct
import sys
import time

try:
    import fcntl
    import termios
except ImportError:  # not POSIX
    sys.exit(2)


def main(argv):
    if len(argv) < 4 or argv[2] != '--':
        print('usage: pty-run.py KEY_HEX TIMEOUT_SECONDS -- command [args...]', file=sys.stderr)
        return 2
    key = bytes.fromhex(argv[0])
    deadline = time.monotonic() + float(argv[1])
    cmd = argv[3:]
    pid, fd = pty.fork()
    if pid == 0:
        try:
            os.execv(cmd[0], cmd)
        finally:
            os._exit(127)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    out = b''
    sent = False
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
            print(json.dumps({'code': None, 'text': out.decode('utf-8', 'replace')}))
            return 0
        ready, _, _ = select.select([fd], [], [], min(left, 0.5))
        if not ready:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:  # EIO on Linux once the child closed the terminal
            chunk = b''
        if not chunk:
            break
        out += chunk
        if not sent and b'any other key to abort:' in out:
            sent = True
            os.write(fd, key)
    _, status = os.waitpid(pid, 0)
    code = os.waitstatus_to_exitcode(status)
    print(json.dumps({'code': code, 'text': out.decode('utf-8', 'replace')}))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))

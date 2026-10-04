#!/usr/bin/env python3
"""Breaking-glass switches: one expiring, root-owned switch per hook protection layer (ADR-0024).

A switch is a file the owner writes with sudo. Hooks read it on every invocation, so a switch takes
effect and expires without a restart. Any doubt about a switch (wrong owner, writable by others, a
symbolic link, malformed, expired) leaves the layer ACTIVE. A switch records only the layer and its
expiry, never a reason or any session content. Python 3.9+, no dependencies.
"""
import argparse
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import time

NAME = "personal-multi-harness-workstation-configuration"
LAYERS = ("paste-filter", "restart-guard", "hitl-guard")
DEFAULT_MINUTES = 60
MAX_MINUTES = 240
if sys.platform == "darwin":
    BASE = Path("/Library/Application Support") / NAME
else:
    BASE = Path("/etc") / NAME
SWITCH_DIR = BASE / "breaking-glass"
HELPER = BASE / "bin" / "breaking_glass.py"
OWNER_UID = 0


def _root_safe(path, owner_uid):
    """True when path is no symlink, owned by owner_uid, and not writable by group or others."""
    try:
        st = os.lstat(path)
    except OSError:
        return False
    if stat.S_ISLNK(st.st_mode) or st.st_uid != owner_uid:
        return False
    return not (st.st_mode & (stat.S_IWGRP | stat.S_IWOTH))


def disabled_until(layer, switch_dir=None, now=None, owner_uid=None):
    """Return the expiry epoch while the layer is switched off, else None (layer active)."""
    if layer not in LAYERS:
        return None
    now = time.time() if now is None else now
    owner_uid = OWNER_UID if owner_uid is None else owner_uid
    switch_dir = Path(SWITCH_DIR if switch_dir is None else switch_dir)
    path = switch_dir / (layer + ".json")
    if not all(_root_safe(p, owner_uid) for p in (switch_dir.parent, switch_dir, path)):
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        created = os.lstat(path).st_mtime
    except (OSError, ValueError):
        return None
    if not isinstance(data, dict) or data.get("layer") != layer:
        return None
    expires = data.get("expires_at")
    if not isinstance(expires, (int, float)) or isinstance(expires, bool):
        return None
    expires = min(float(expires), created + MAX_MINUTES * 60)
    return expires if now < expires else None


def notice(switch_dir=None, now=None, owner_uid=None):
    """One line naming the layers switched off and their expiry; empty when none."""
    off = []
    for layer in LAYERS:
        until = disabled_until(layer, switch_dir, now, owner_uid)
        if until is not None:
            off.append("%s até %s" % (layer, time.strftime("%H:%M", time.localtime(until))))
    if not off:
        return ""
    return "Breaking glass: camada desligada: " + ", ".join(off) + ". Nenhum conteúdo foi registrado."


def layer_state(layer):
    """For hooks: (switched_off, notice). Never raises; any failure leaves the layer on."""
    try:
        return disabled_until(layer) is not None, notice()
    except Exception:
        return False, ""


def write_switch(layer, minutes, switch_dir=SWITCH_DIR, now=None):
    now = time.time() if now is None else now
    switch_dir = Path(switch_dir)
    switch_dir.mkdir(mode=0o755, parents=True, exist_ok=True)
    os.chmod(switch_dir, 0o755)
    payload = json.dumps({"layer": layer, "expires_at": int(now + minutes * 60)})
    fd, tmp = tempfile.mkstemp(dir=switch_dir, prefix=".tmp-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
        os.chmod(tmp, 0o644)
        os.replace(tmp, switch_dir / (layer + ".json"))
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def remove_switch(layer, switch_dir=SWITCH_DIR):
    try:
        (Path(switch_dir) / (layer + ".json")).unlink()
    except FileNotFoundError:
        pass


def sudo_line(action, layer, minutes, helper=HELPER, owner_uid=0):
    """The exact command for the owner to run, or None when the root-owned helper is not installed."""
    if not (_root_safe(helper.parent, owner_uid) and _root_safe(helper, owner_uid)):
        return None
    cmd = 'sudo /usr/bin/python3 -I -B "%s" %s %s' % (helper, action, layer)
    return cmd + (" --minutes %d" % minutes if action == "disable" else "")


def _minutes(value):
    n = int(value)
    if not 1 <= n <= MAX_MINUTES:
        raise argparse.ArgumentTypeError("minutes must be between 1 and %d" % MAX_MINUTES)
    return n


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("sudo-line", help="print the sudo command for the owner; changes nothing")
    p.add_argument("action", choices=("disable", "enable"))
    p.add_argument("layer", choices=LAYERS)
    p.add_argument("--minutes", type=_minutes, default=DEFAULT_MINUTES)
    for action in ("disable", "enable"):
        p = sub.add_parser(action, help="%s a layer switch (root only)" % action)
        p.add_argument("layer", choices=LAYERS)
        if action == "disable":
            p.add_argument("--minutes", type=_minutes, default=DEFAULT_MINUTES)
    sub.add_parser("status", help="show which layers are switched off")
    p = sub.add_parser("check", help="exit 0 when the layer is switched off, 1 when active; prints nothing")
    p.add_argument("layer", choices=LAYERS)
    args = parser.parse_args(argv)

    if args.cmd == "sudo-line":
        line = sudo_line(args.action, args.layer, args.minutes)
        if line is None:
            print("Helper root-owned não instalado em %s; nenhum switch disponível." % HELPER, file=sys.stderr)
            return 1
        print(line)
        return 0
    if args.cmd == "check":
        return 0 if layer_state(args.layer)[0] else 1
    if args.cmd == "status":
        print(notice() or "Breaking glass: todas as camadas ativas.")
        return 0
    if os.geteuid() != 0:
        print("Requer privilégio de administrador (sudo).", file=sys.stderr)
        return 1
    if args.cmd == "disable":
        write_switch(args.layer, args.minutes)
    else:
        remove_switch(args.layer)
    print(notice() or "Breaking glass: todas as camadas ativas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

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
import time

NAME = "personal-multi-harness-workstation-configuration"
LAYERS = ("paste-filter", "restart-guard", "hitl-guard")
# Every switch path comes from this fixed table, never from a caller's string.
SWITCH_FILES = {layer: layer + ".json" for layer in LAYERS}
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
    path = switch_dir / SWITCH_FILES[layer]
    if not all(_root_safe(p, owner_uid) for p in (switch_dir.parent, switch_dir, path)):
        return None
    # Hooks run as the owner, not root: a switch they could not read is no switch, whoever reads it.
    try:
        if not (os.stat(switch_dir).st_mode & stat.S_IXOTH and os.stat(path).st_mode & stat.S_IROTH):
            return None
    except OSError:
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


# The status table: what each layer does, and the script whose presence in a hook registration file
# shows where the layer is registered. Reading registrations is best effort and never changes a switch.
DESCRIPTIONS = {
    "paste-filter": "Bloqueia prompt com credencial, dado pessoal ou referência a cliente/empregador",
    "restart-guard": "Nega ferramentas se a configuração mudou desde o início da sessão",
    "hitl-guard": "Recusa pickers fora dos limites do perfil (perguntas, tamanho, opções)",
}
HOOK_SCRIPTS = {
    "paste-filter": "clipboard_guard.py",
    "restart-guard": "restart_guard.py",
    "hitl-guard": "hitl-escalation-guard.sh",
}
MARKER = "managed-by: " + NAME
GREEN, RED, YELLOW, BOLD, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[1m", "\033[0m"


def _read(path):
    try:
        return Path(path).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return ""


def _hook_files(home, root):
    """(where, path) for every file that can register a hook of ours: the admin layer, then the user."""
    codex_home = Path(os.environ.get("CODEX_HOME") or home / ".codex")
    if sys.platform == "darwin":
        dropins = root / "Library/Application Support/ClaudeCode/managed-settings.d"
    else:
        dropins = root / "etc/claude-code/managed-settings.d"
    return (
        ("claude:admin", dropins / ("50-%s.json" % NAME)),
        ("codex:admin", root / "etc/codex/requirements.toml"),
        ("claude:usuário", home / ".claude/settings.json"),
        ("codex:usuário", codex_home / "hooks.json"),
    )


def registrations(home=None, root=None):
    """{layer: [where, ...]} naming each file that registers the layer's hook script."""
    home = Path.home() if home is None else Path(home)
    root = Path("/") if root is None else Path(root)
    texts = [(where, _read(path)) for where, path in _hook_files(home, root)]
    return {layer: [where for where, text in texts if HOOK_SCRIPTS[layer] in text] for layer in LAYERS}


def always_on(home=None):
    """[(control, summary)] for the controls breaking glass never switches off."""
    home = Path.home() if home is None else Path(home)
    codex_home = Path(os.environ.get("CODEX_HOME") or home / ".codex")
    briefs = (("claude", home / ".claude/CLAUDE.md"), ("codex", codex_home / "AGENTS.md"),
              ("kiro", home / ".kiro/steering/workstation-global-brief.md"))
    have = [name for name, path in briefs if MARKER in "\n".join(_read(path).splitlines()[:5])]
    try:
        deny = json.loads(_read(home / ".claude/settings.json") or "{}").get("permissions", {}).get("deny", [])
        claude_rules = len(deny) if isinstance(deny, list) else 0
    except (ValueError, AttributeError):
        claude_rules = 0
    rules = _read(codex_home / "rules/workstation-deny-floor.rules")
    codex_rules = sum(1 for line in rules.splitlines() if line.startswith("prefix_rule("))
    return [
        ("brief global", "instrução ao agente: propriedade de terceiros, sanitização, escalonamento; em "
         + (", ".join(have) if have else "nenhum harness")),
        ("deny floor", "bloqueia comandos destrutivos ou de publicação; claude %d regras deny (todas as origens), "
         "codex %d regras do floor, kiro sem floor" % (claude_rules, codex_rules)),
    ]


def status_rows(switch_dir=None, now=None, owner_uid=None, home=None, root=None):
    """[(layer, state, until, where, description)]; state is "off", "unregistered" or "on"."""
    regs = registrations(home, root)
    rows = []
    for layer in LAYERS:
        until = disabled_until(layer, switch_dir, now, owner_uid)
        state = "off" if until is not None else ("on" if regs[layer] else "unregistered")
        rows.append((layer, state, until, regs[layer], DESCRIPTIONS[layer]))
    return rows


def _state_label(state, until):
    if state == "off":
        return "DESLIGADA até " + time.strftime("%H:%M", time.localtime(until))
    return "ativa" if state == "on" else "sem registro"


FOOTNOTE = ('"ativa" = interruptor ligado e hook registrada; não prova que ela disparou nesta sessão. '
            '"sem registro" = nenhum arquivo de hook a chama.')


def status_report(fmt="text", color=False, **where):
    rows = status_rows(**where)
    extra = always_on(where.get("home"))
    if fmt == "markdown":
        icon = {"on": "🟢", "off": "🔴", "unregistered": "🟡"}
        out = ["| Camada | Estado | Registro | O que faz |", "| --- | --- | --- | --- |"]
        for layer, state, until, regs, desc in rows:
            out.append("| `%s` | %s %s | %s | %s |" % (layer, icon[state], _state_label(state, until),
                                                      ", ".join(regs) or "nenhum", desc))
        out += ["", "**Sempre ligadas (fora do breaking glass):**"]
        out += ["- **%s**: %s" % item for item in extra]
        return "\n".join(out + ["", FOOTNOTE])
    paint = {"on": GREEN, "off": RED, "unregistered": YELLOW}
    labels = [_state_label(state, until) for _, state, until, _, _ in rows]
    places = [" ".join(regs) or "nenhum" for _, _, _, regs, _ in rows]
    w_state = max(len("ESTADO"), *map(len, labels))
    w_place = max(len("REGISTRO"), *map(len, places))
    head = "%-14s %-*s  %-*s  %s" % ("CAMADA", w_state, "ESTADO", w_place, "REGISTRO", "O QUE FAZ")
    out = ["Camadas de proteção (breaking glass, ADR-0024)", "", (BOLD + head + RESET) if color else head]
    for (layer, state, _, _, desc), label, place in zip(rows, labels, places):
        cell = label.ljust(w_state)
        if color:
            cell = paint[state] + cell + RESET
        out.append("%-14s %s  %-*s  %s" % (layer, cell, w_place, place, desc))
    out += ["", "Sempre ligadas (fora do breaking glass):"]
    out += ["  %-13s %s" % item for item in extra]
    return "\n".join(out + ["", FOOTNOTE])


def _use_color(choice):
    if choice != "auto":
        return choice == "always"
    return sys.stdout.isatty() and not os.environ.get("NO_COLOR")


def layer_state(layer):
    """For hooks: (switched_off, notice). Never raises; any failure leaves the layer on."""
    try:
        return disabled_until(layer) is not None, notice()
    except Exception:
        return False, ""


def write_switch(layer, minutes, switch_dir=SWITCH_DIR, now=None):
    """Write atomically with the creating process's default modes (root's umask 022: 0755 directory,
    0644 file), which hooks running as the owner need to read. A stricter umask leaves the switch
    unreadable to them, so the layer stays on: the caller reports it, it never fails open."""
    name = SWITCH_FILES[layer]
    now = time.time() if now is None else now
    switch_dir = Path(switch_dir)
    switch_dir.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"layer": layer, "expires_at": int(now + minutes * 60)})
    tmp = switch_dir / (".tmp-%d-%s" % (os.getpid(), name))
    try:
        with open(tmp, "x", encoding="utf-8") as fh:
            fh.write(payload)
        os.replace(tmp, switch_dir / name)
    except BaseException:
        if tmp.exists():
            tmp.unlink()
        raise
    return all(os.stat(p).st_mode & stat.S_IROTH for p in (switch_dir, switch_dir / name))


def remove_switch(layer, switch_dir=SWITCH_DIR):
    try:
        (Path(switch_dir) / SWITCH_FILES[layer]).unlink()
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
    p = sub.add_parser("status", help="show each layer, its state, where it is registered and what it does")
    p.add_argument("--format", choices=("text", "markdown"), default="text")
    p.add_argument("--color", choices=("auto", "always", "never"), default="auto")
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
        print(status_report(args.format, _use_color(args.color) and args.format == "text"))
        return 0
    if os.geteuid() != 0:
        print("Requer privilégio de administrador (sudo).", file=sys.stderr)
        return 1
    if args.cmd == "disable":
        if not write_switch(args.layer, args.minutes):
            print("Switch gravado, mas ilegível para os hooks (umask restritivo); a camada segue ativa.",
                  file=sys.stderr)
    else:
        remove_switch(args.layer)
    print(notice() or "Breaking glass: todas as camadas ativas.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

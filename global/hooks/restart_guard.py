#!/usr/bin/env python3
"""User-level stale-session guard. Stores opaque fingerprints, never configuration contents.

Native SessionStart(startup) establishes a baseline. PreToolUse denies missing/changed baselines.
Resume, clear and compaction never authorize a new baseline. Python 3.9+, no dependencies.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

MESSAGE = "Reinício necessário: a configuração do harness mudou ou esta sessão não tem uma referência de início válida. Interrompa o trabalho e abra uma nova sessão; não use resume, clear ou compact como substituto. Nenhum conteúdo de configuração foi registrado."
NATIVE = {
    "claude-code": (".claude", ["CLAUDE.md", "settings.json", "settings.local.json", "agents", "commands", "hooks", "skills", "plugins/installed_plugins.json"]),
    "codex": (".codex", ["AGENTS.md", "config.toml", "hooks.json", "rules", "skills"]),
    "kiro-cli": (".kiro", ["settings", "agents", "steering", "prompts", "hooks"]),
}
MANAGED = ["hitl-escalation-guard.sh", "hitl.conf", "clipboard_guard.py", "clipboard.conf", "paste_wrapper.py", "restart_guard.py"]


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def workspace(cwd):
    current = Path(cwd).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def watched(harness, cwd, home, data):
    folder, names = NATIVE[harness]
    user = Path(os.environ.get("CODEX_HOME", str(home / folder))) if harness == "codex" else home / folder
    root = workspace(cwd)
    # Include nested project settings up to the repository root; no file contents are read.
    project_dirs = []
    current = Path(cwd).resolve()
    while True:
        project_dirs.append(current)
        if current == root or current.parent == current:
            break
        current = current.parent
    paths = [user / name for name in names] + [data / name for name in MANAGED]
    for directory in project_dirs:
        paths += [directory / folder / name for name in names]
        paths += [directory / "AGENTS.md", directory / "CLAUDE.md", directory / "workspace/session-policy.json"]
    return paths


def fingerprint(paths):
    records = []
    for path in sorted(set(paths)):
        children = [path]
        if path.is_dir() and not path.is_symlink():
            children += sorted(path.rglob("*"))
        for child in children:
            try:
                info = child.lstat()
                records.append((str(child), info.st_mtime_ns, info.st_size, info.st_ino, info.st_mode))
            except FileNotFoundError:
                records.append((str(child), None))
    return digest(json.dumps(records))


def decide(event, harness, home, data):
    name = event.get("hook_event_name")
    if name not in ("SessionStart", "PreToolUse"):
        return None
    session = event.get("session_id")
    cwd = event.get("cwd")
    if not isinstance(session, str) or not session or not isinstance(cwd, str) or not cwd:
        return False
    state_dir = data / "restart-state"
    if state_dir.is_symlink():
        return False
    state = state_dir / (harness + "-" + digest(session) + ".json")
    if state.is_symlink():
        return False
    current = fingerprint(watched(harness, cwd, home, data))
    if name == "SessionStart" and event.get("source") == "startup" and not state.exists():
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=state_dir, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump({"fingerprint": current}, stream)
            os.replace(temporary, state)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        return True
    if not state.exists():
        return False
    return json.loads(state.read_text(encoding="utf-8")).get("fingerprint") == current


def output(event, allowed):
    if allowed is not False:
        return {}
    if event.get("hook_event_name") == "PreToolUse":
        return {"systemMessage": MESSAGE, "hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": MESSAGE}}
    return {"continue": False, "stopReason": MESSAGE, "systemMessage": MESSAGE}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", required=True, choices=NATIVE)
    args = parser.parse_args()
    event = {}
    try:
        event = json.load(sys.stdin)
        if not isinstance(event, dict):
            event = {}
        home = Path.home()
        data = Path(os.environ.get("XDG_DATA_HOME", str(home / ".local/share"))) / "personal-multi-harness-workstation-configuration"
        allowed = decide(event, args.harness, home, data)
    except (OSError, ValueError, KeyError, RecursionError):
        allowed = False
    result = output(event, allowed)
    if result:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()

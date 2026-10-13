#!/usr/bin/env python3
"""Retire the tadeumendonca-skills plugin from the user-level agent harness configuration once the working
method is installed (Issue #130, ADR-0032; the cutover).

    plugin_retire.py --mode=install|check|dry-run|uninstall [--home=DIR] [--opt-in]

It runs right after global/method/method_render.py, in the same step, and only when the method is installed
(--opt-in, or a rendered method file is already present): a session is never left with neither copy.

What it changes, at user scope only:
    Claude Code  ~/.claude/settings.json: enabledPlugins["tadeumendonca-skills@<marketplace>"] and the
                 extraKnownMarketplaces entry of that marketplace;
                 ~/.claude/plugins/installed_plugins.json: the plugin's scope "user" install records;
                 ~/.claude/plugins/known_marketplaces.json: the marketplace, only once no install record of
                 any scope still uses it.
    Codex        ${CODEX_HOME:-~/.codex}/config.toml: the [plugins."tadeumendonca-skills@<marketplace>"] table
                 and the [marketplaces.<marketplace>] table, and nothing else in the file (verified with
                 tomllib; without it a file naming the plugin is refused, not edited blind).
Project-scope installs (a project's .claude/settings.json, a scope "project" install record) are REPORTED,
never touched: each repository changes its own settings through its own pull request.

Why a JSON and TOML edit rather than `claude plugin uninstall` / `codex plugin remove`: both CLIs also delete
the plugin's cache, which an offline uninstall of this step could not bring back, while the records this
script edits are what those CLIs write (read from the files they leave). The plugin's cache directories stay
on disk, unused; the CLI or a manual removal can clear them.

Every changed file is first copied to <file>.pmhwc-plugin-backup, owner-only (0600) whatever the original's
mode, and each change prints as "<key> <old> -> absent". The edit is atomic and keeps the file's mode; a
symbolic link is written through. A file that is not valid JSON or TOML is REFUSED and left untouched.

Uninstall restores what install removed, from those backups: the removed keys, records and tables that are
absent now are put back, and nothing else is changed. It is idempotent.

Exit codes, as install.sh: 0 ok · 1 the plugin is still present (--check) · 2 usage · 3 a file this script
must not edit (unreadable, malformed, or an edit that would not verify).
"""
import copy
import json
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))  # global/, for private_copy
sys.path.insert(0, str(HERE))
from private_copy import private_copy  # noqa: E402
import method_render  # noqa: E402

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None

PLUGIN = "tadeumendonca-skills"
BACKUP = ".pmhwc-plugin-backup"
HEADER_RE = re.compile(r"\s*\[")


class Refuse(Exception):
    pass


def plugin_key(key):
    return isinstance(key, str) and key.split("@", 1)[0] == PLUGIN and "@" in key


def marketplaces_of(keys):
    return sorted({k.split("@", 1)[1] for k in keys if plugin_key(k)})


def paths():
    h = method_render.homes()
    return {"settings": h["claude"] / "settings.json",
            "installed": h["claude"] / "plugins" / "installed_plugins.json",
            "markets": h["claude"] / "plugins" / "known_marketplaces.json",
            "codex": h["codex"] / "config.toml"}


# --------------------------------------------------------------------------------------------------
# Plans: each returns (new document or text, [change lines]) and never writes.

def read_json(path):
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except (OSError, UnicodeDecodeError) as e:
        raise Refuse("unreadable (%s); left untouched" % e.__class__.__name__)
    try:
        doc = json.loads(text)
    except ValueError as e:
        raise Refuse("not valid JSON (%s); left untouched" % e)
    if not isinstance(doc, dict):
        raise Refuse("not a JSON object; left untouched")
    return doc


def plan_settings(doc):
    new, changes, markets = copy.deepcopy(doc), [], []
    plugins = new.get("enabledPlugins")
    if isinstance(plugins, dict):
        for key in [k for k in plugins if plugin_key(k)]:
            changes.append("enabledPlugins.%s %s -> absent" % (key, json.dumps(plugins[key])))
            markets.append(key.split("@", 1)[1])
            del plugins[key]
    known = new.get("extraKnownMarketplaces")
    if isinstance(known, dict):
        for name in [m for m in sorted(set(markets)) if m in known]:
            changes.append("extraKnownMarketplaces.%s present -> absent" % name)
            del known[name]
    return new, changes, sorted(set(markets))


def plan_installed(doc):
    """-> (new doc, changes, project records left, marketplaces still used by any record)."""
    new, changes, project = copy.deepcopy(doc), [], []
    plugins = new.get("plugins")
    if not isinstance(plugins, dict):
        return new, changes, project, []
    for key in [k for k in plugins if plugin_key(k)]:
        records = plugins[key] if isinstance(plugins[key], list) else []
        keep = [r for r in records if not (isinstance(r, dict) and r.get("scope") == "user")]
        dropped = len(records) - len(keep)
        if dropped:
            changes.append("plugins.%s: %d user-scope install record(s) -> absent" % (key, dropped))
        project += [(key, r.get("projectPath", "?")) for r in keep if isinstance(r, dict)]
        if keep:
            plugins[key] = keep
        else:
            del plugins[key]
    still = marketplaces_of([k for k in plugins if plugins[k]])
    return new, changes, project, still


def plan_markets(doc, names, still_used):
    new, changes, kept = copy.deepcopy(doc), [], []
    for name in names:
        if name not in new:
            continue
        if name in still_used:
            kept.append(name)
            continue
        changes.append("%s present -> absent" % name)
        del new[name]
    return new, changes, kept


def codex_tables(text):
    """-> (lines, line numbers to drop, [table header], marketplaces) for the plugin's and its marketplaces' tables:
    each table runs from its header to the line before the next header."""
    lines = text.splitlines(keepends=True)
    plugin_re = re.compile(r'\s*\[\s*plugins\s*\.\s*"%s@([A-Za-z0-9_.-]+)"\s*\]' % re.escape(PLUGIN))
    markets = sorted({m.group(1) for line in lines for m in [plugin_re.match(line)] if m})
    market_re = [re.compile(r"\s*\[\s*marketplaces\s*\.\s*(?:%s|\"%s\")\s*(?:\]|\.)" % (re.escape(m), re.escape(m)))
                 for m in markets]
    drop, labels = set(), []
    for i, line in enumerate(lines):
        label = None
        if plugin_re.match(line):
            label = line.strip()
        elif any(r.match(line) for r in market_re):
            label = line.strip()
        if label is None:
            continue
        j = i + 1
        while j < len(lines) and not HEADER_RE.match(lines[j]):
            j += 1
        drop.update(range(i, j))
        labels.append(label)
    return lines, drop, labels, markets


def plan_codex(text):
    if PLUGIN not in text:
        return text, []
    if tomllib is None:
        raise Refuse("it names the %s plugin, and removing it needs Python 3.11+ (tomllib) to verify the edit; "
                     "nothing written" % PLUGIN)
    try:
        old = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse("not valid TOML (%s); left untouched" % e)
    lines, drop, labels, markets = codex_tables(text)
    if not labels:
        return text, []
    new_text = "".join(l for i, l in enumerate(lines) if i not in drop)
    try:
        new = tomllib.loads(new_text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse("removing the plugin would leave invalid TOML (%s); nothing written" % e)
    want = copy.deepcopy(old)
    for m in markets:
        want.get("plugins", {}).pop("%s@%s" % (PLUGIN, m), None)
        want.get("marketplaces", {}).pop(m, None)
    for table in ("plugins", "marketplaces"):
        if table in want and want[table] == {} and table not in new:
            del want[table]
    if new != want:
        raise Refuse("removing the plugin would change more than its tables; nothing written")
    return new_text, ["%s present -> absent" % label for label in labels]


# --------------------------------------------------------------------------------------------------
# Writing.

def write(path, text, backup=True):
    """Atomic, keeping the mode; install first copies the file to its backup. A restore does not: the backup
    is what it restores from, and must survive it."""
    target = os.path.realpath(str(path))
    mode = os.stat(target).st_mode & 0o7777
    if backup:
        private_copy(target, str(path) + BACKUP)
    tmp = "%s.new.%d" % (target, os.getpid())
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def dump(doc):
    return json.dumps(doc, indent=2, ensure_ascii=False) + "\n"


def report(mode, path, changes):
    what = "; ".join(changes)
    if mode == "check":
        print("DRIFT   %s: install would change %s (the %s plugin, retired by the method, #130)" % (path, what, PLUGIN))
        return 1
    if mode == "dry-run":
        print("WOULD CHANGE %s: %s (the %s plugin; backup %s%s)" % (path, what, PLUGIN, path.name, BACKUP))
        return 0
    print("CHANGED %s: %s (the %s plugin, retired by the method, #130; previous file kept as %s%s)"
          % (path, what, PLUGIN, path, BACKUP))
    return 0


def retire(mode):
    p = paths()
    status = 0
    markets = []
    # Claude Code settings.
    try:
        doc = read_json(p["settings"])
        if doc is not None:
            new, changes, markets = plan_settings(doc)
            if changes:
                status = max(status, report(mode, p["settings"], changes))
                if mode == "install":
                    write(p["settings"], dump(new))
            else:
                print("OK      %s: the %s plugin is not enabled at user scope" % (p["settings"], PLUGIN))
    except Refuse as e:
        print("REFUSE  %s: %s" % (p["settings"], e))
        status = 3
    # Install records.
    still = []
    try:
        doc = read_json(p["installed"])
        if doc is not None:
            new, changes, project, still = plan_installed(doc)
            markets = sorted(set(markets) | set(marketplaces_of(doc.get("plugins", {}) or {})))
            if changes:
                status = max(status, report(mode, p["installed"], changes))
                if mode == "install":
                    write(p["installed"], dump(new))
            if project:
                shown = ", ".join(path for _, path in project[:5]) + (", ..." if len(project) > 5 else "")
                print("NOTE    %s: %d project-scope install(s) of the %s plugin left untouched; each belongs to "
                      "its repository's own pull request: %s" % (p["installed"], len(project), PLUGIN, shown))
            if not changes and not project:
                print("OK      %s: no install record of the %s plugin" % (p["installed"], PLUGIN))
    except Refuse as e:
        print("REFUSE  %s: %s" % (p["installed"], e))
        status = 3
    # Marketplaces.
    try:
        doc = read_json(p["markets"])
        if doc is not None and markets:
            new, changes, kept = plan_markets(doc, markets, still)
            if changes:
                status = max(status, report(mode, p["markets"], changes))
                if mode == "install":
                    write(p["markets"], dump(new))
            for name in kept:
                print("NOTE    %s: the %s marketplace is kept: a project-scope install still uses it" % (p["markets"], name))
    except Refuse as e:
        print("REFUSE  %s: %s" % (p["markets"], e))
        status = 3
    # Codex.
    try:
        try:
            text = p["codex"].read_text(encoding="utf-8")
        except FileNotFoundError:
            text = None
        except (OSError, UnicodeDecodeError) as e:
            raise Refuse("unreadable (%s); left untouched" % e.__class__.__name__)
        if text is not None:
            new_text, changes = plan_codex(text)
            if changes:
                status = max(status, report(mode, p["codex"], changes))
                if mode == "install":
                    write(p["codex"], new_text)
            else:
                print("OK      %s: the %s plugin is not configured" % (p["codex"], PLUGIN))
    except Refuse as e:
        print("REFUSE  %s: %s" % (p["codex"], e))
        status = 3
    return status


# --------------------------------------------------------------------------------------------------
# Uninstall: put back, from each backup, what install removed and is absent now.

def restore_json(path, merge):
    backup = Path(str(path) + BACKUP)
    if not backup.is_file():
        return 0
    try:
        old = read_json(backup) or {}
        cur = read_json(path)
    except Refuse as e:
        print("REFUSE  %s: %s" % (path, e))
        return 3
    cur = {} if cur is None else cur
    new, restored = merge(old, copy.deepcopy(cur))
    if not restored:
        print("OK      %s: nothing of the %s plugin to restore" % (path, PLUGIN))
        return 0
    if path.exists():
        write(path, dump(new), backup=False)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(dump(new), encoding="utf-8")
    print("RESTORED %s: %s (from %s%s)" % (path, "; ".join(restored), path.name, BACKUP))
    return 0


def merge_settings(old, cur):
    restored = []
    for key, value in (old.get("enabledPlugins") or {}).items():
        if plugin_key(key) and key not in (cur.get("enabledPlugins") or {}):
            cur.setdefault("enabledPlugins", {})[key] = value
            restored.append("enabledPlugins.%s absent -> %s" % (key, json.dumps(value)))
    markets = marketplaces_of((old.get("enabledPlugins") or {}).keys())
    for name in markets:
        value = (old.get("extraKnownMarketplaces") or {}).get(name)
        if value is not None and name not in (cur.get("extraKnownMarketplaces") or {}):
            cur.setdefault("extraKnownMarketplaces", {})[name] = value
            restored.append("extraKnownMarketplaces.%s absent -> present" % name)
    return cur, restored


def merge_installed(old, cur):
    restored = []
    for key, records in (old.get("plugins") or {}).items():
        if not plugin_key(key) or not isinstance(records, list):
            continue
        users = [r for r in records if isinstance(r, dict) and r.get("scope") == "user"]
        have = cur.setdefault("plugins", {}).setdefault(key, [])
        missing = [r for r in users if r not in have]
        if missing:
            have[:0] = missing
            restored.append("plugins.%s: %d user-scope install record(s) absent -> present" % (key, len(missing)))
        if not have:
            del cur["plugins"][key]
    return cur, restored


def plugin_marketplaces_in_backups(p):
    """The plugin's marketplace names, as the settings and install-record backups name them."""
    names = set()
    for key, field in (("settings", "enabledPlugins"), ("installed", "plugins")):
        backup = Path(str(p[key]) + BACKUP)
        if backup.is_file():
            try:
                names |= set(marketplaces_of(((read_json(backup) or {}).get(field) or {}).keys()))
            except Refuse:
                pass
    return names


def merge_markets_for(names):
    def merge(old, cur):
        restored = []
        for name in sorted(names):
            if name in old and name not in cur:
                cur[name] = old[name]
                restored.append("%s absent -> present" % name)
        return cur, restored
    return merge


def restore_codex(path):
    backup = Path(str(path) + BACKUP)
    if not backup.is_file():
        return 0
    old_text = backup.read_text(encoding="utf-8")
    try:
        cur_text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        cur_text = ""
    lines, drop, labels, _ = codex_tables(old_text)
    missing = [l for l in labels if l not in [x.strip() for x in cur_text.splitlines()]]
    if not missing:
        print("OK      %s: nothing of the %s plugin to restore" % (path, PLUGIN))
        return 0
    add = "".join(lines[idx] for idx in sorted(drop))
    sep = "" if not cur_text else ("\n" if cur_text.endswith("\n") else "\n\n")
    new_text = cur_text + sep + add
    if tomllib is not None:
        try:
            tomllib.loads(new_text)
        except tomllib.TOMLDecodeError as e:
            print("REFUSE  %s: restoring the plugin's tables would leave invalid TOML (%s); nothing written" % (path, e))
            return 3
    if path.exists():
        write(path, new_text, backup=False)
    else:
        path.write_text(new_text, encoding="utf-8")
    print("RESTORED %s: %s (from %s%s)" % (path, "; ".join("%s absent -> present" % l for l in missing), path.name, BACKUP))
    return 0


def restore():
    p = paths()
    status = 0
    status = max(status, restore_json(p["settings"], merge_settings))
    status = max(status, restore_json(p["installed"], merge_installed))
    status = max(status, restore_json(p["markets"], merge_markets_for(plugin_marketplaces_in_backups(p))))
    status = max(status, restore_codex(p["codex"]))
    return status


def method_installed(opt_in):
    if opt_in:
        return True
    return any(method_render.ours(path) for path in method_render.candidate_files())


def main(argv):
    mode, opt_in = None, False
    for arg in argv:
        if arg.startswith("--mode="):
            mode = arg[len("--mode="):]
        elif arg.startswith("--home="):
            method_render.HOME_OVERRIDE = arg[len("--home="):]
        elif arg == "--opt-in":
            opt_in = True
        else:
            print("plugin_retire: unknown argument %s" % arg, file=sys.stderr)
            return 2
    if mode not in ("install", "check", "dry-run", "uninstall"):
        print("plugin_retire: --mode must be install, check, dry-run or uninstall", file=sys.stderr)
        return 2
    if mode == "uninstall":
        return restore()
    if not method_installed(opt_in):
        print("PLUGIN  the %s plugin is left as it is: the working method is not installed (opt-in: --method)" % PLUGIN)
        return 0
    return retire(mode)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

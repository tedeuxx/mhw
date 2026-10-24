"""The MCP active set (Issue #219, ADR-0040): the servers of the local MCP definition are the set, and
every other MCP server an agent harness would start is turned off through that harness's own switch.

    mcp_render.py --active --mode=install|check|dry-run|uninstall [--stamp=S] [--source=FILE]

global/install.sh runs it on every mhw install, check and uninstall. Per agent harness:

    Codex        enabled = false on the server's [mcp_servers.<name>] table in config.toml
    Claude Code  a deniedMcpServers entry in ~/.claude/settings.json: serverName for a server in
                 ~/.claude.json and for a claude.ai connector declared "off"; serverUrl (or serverCommand)
                 for a server a plugin provides, read from the plugins' own files
    Kiro         "disabled": true on the server in ~/.kiro/settings/mcp.json
    Claude app   report only: its configuration has no switch for one server

Nothing happens until the definition declares "active_set": with no definition, or one without that key,
nothing is turned off, and what an earlier install turned off is turned back on. Exempt, never touched and
never reported (decision 2): the servers an agent harness app writes for its own built-in browser or
computer use (EXEMPT). Only names and counts are printed, never a command, a URL or any other value.
Each change keeps the previous file as <config>.pmhwc-mcp-active-backup (0600); what was changed is
recorded in the manifest (mcp-managed.json, "active"), so uninstall restores exactly that.
"""
import copy
import glob
import json
import os
import re
import sys

import mcp_render as r

TAG = "(MCP active set)"
# Decision 2 of Issue #219: an agent harness app's own browser or computer-use server. node_repl is the
# one the Codex app writes into config.toml (named in the Issue); claude-in-chrome is Claude Code's
# built-in Chrome server (named in the Claude Code settings reference). Matched by name, so a server of
# the owner's under one of these names is exempt too.
EXEMPT = ("node_repl", "claude-in-chrome")
CONNECTOR = "claude.ai "  # the documented serverName of a claude.ai connector is "claude.ai <Name>"
MARK = "# %s (mcp active set)" % r.MARKER_ID
DISABLE_LINE = "enabled = false  " + MARK + "\n"
BACKUP = ".pmhwc-mcp-active-backup"
HEADER_RE = re.compile(r"""^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*(?:"([^"\\]*)"|'([^']*)'|([A-Za-z0-9_-]+))"""
                       r"""[ \t]*\][ \t]*(?:#.*)?$""")
TABLE_RE = re.compile(r"^[ \t]*\[")
ENABLED_RE = re.compile(r"^[ \t]*enabled[ \t]*=")


class ActiveSet:
    """The declared set, or none: an undeclared set turns nothing off."""

    def __init__(self, doc):
        self.declared = doc is not None and "active_set" in doc
        self.servers = set(doc["servers"]) if self.declared else set()
        connectors = doc["active_set"].get("connectors", {}) if self.declared else {}
        self.on = sorted(n for n, v in connectors.items() if v == "on")
        self.off = sorted(n for n, v in connectors.items() if v == "off")
        policy = r.load_policy()["servers"]
        self.policy = {s: {n for n, v in policy.items() if s in v["surfaces"]} for s in r.SURFACES}

    def outside(self, surface, name):
        """True when a declared set leaves this server out and it is not exempt."""
        return (self.declared and name not in EXEMPT and name not in self.servers
                and name not in self.policy.get(surface, ()))


def names(items):
    items = list(items)
    return "%s (%d)" % (", ".join(items), len(items))


def read_json(path):
    """-> (exists, data). Refuse(3) when the file is not a readable JSON object."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return False, {}
    except (OSError, ValueError) as e:
        raise r.Refuse(3, "not readable JSON (%s); left untouched" % type(e).__name__)
    if not isinstance(data, dict):
        raise r.Refuse(3, "not a JSON object; left untouched")
    return True, data


def quiet_json(path):
    """A plugin's own file: the data, or None when it is absent or unreadable (never a refusal)."""
    try:
        return read_json(path)[1]
    except r.Refuse:
        return None


# ------------------------------------------------------------------------------------------- Codex


def codex_layout(lines):
    """name -> the line numbers of its [mcp_servers.<name>] header, its enabled key and our mark, and
    whether the table sits inside the renderer's managed block (ADR-0017)."""
    tables, current, in_block = {}, None, False
    for i, line in enumerate(lines):
        text = line.rstrip("\r\n")
        if text.startswith(r.BLOCK_BEGIN_PREFIX) or text == r.BLOCK_END:
            in_block, current = text != r.BLOCK_END, None
            continue
        m = HEADER_RE.match(text)
        if m:
            current = next(g for g in m.groups() if g is not None)
            tables.setdefault(current, {"header": i, "block": in_block, "enabled": None, "mark": None})
        elif TABLE_RE.match(text):
            current = None
        elif current is not None and MARK in text:
            tables[current]["mark"] = i
        elif current is not None and ENABLED_RE.match(text):
            tables[current]["enabled"] = i
    return tables


def _restored_enabled(original):
    """The enabled value a recorded original line carried, or None to drop the key."""
    if not original:
        return None
    try:
        return r.tomllib.loads(original).get("enabled")
    except r.tomllib.TOMLDecodeError:
        return None


def plan_codex(text, aset, prior):
    """-> (new text, turned off, turned back on, not editable, new record, servers, layout)."""
    parsed = r.tomllib.loads(text)
    servers = parsed.get("mcp_servers", {})
    servers = servers if isinstance(servers, dict) else {}
    lines = text.splitlines(keepends=True)
    lay = codex_layout(lines)
    off = {n for n, s in servers.items() if isinstance(s, dict) and aset.outside("codex", n)
           and not lay.get(n, {}).get("block")}
    marked = {n for n, t in lay.items() if t["mark"] is not None}
    pending = sorted(n for n in off - marked if servers[n].get("enabled", True) is not False)
    stuck = [n for n in pending if n not in lay]
    add = [n for n in pending if n in lay]
    restore = sorted(marked - off)
    record = {n: prior.get(n) for n in marked & off}
    replace, after = {}, {}
    for n in add:
        t = lay[n]
        if t["enabled"] is not None:
            record[n] = lines[t["enabled"]].rstrip("\r\n")
            replace[t["enabled"]] = DISABLE_LINE
        else:
            record[n] = None
            after[t["header"]] = DISABLE_LINE
    for n in restore:
        original = prior.get(n)
        replace[lay[n]["mark"]] = original + "\n" if original else ""
    out = []
    for i, line in enumerate(lines):
        line = replace.get(i, line)
        if i in after and not line.endswith("\n"):
            line += "\n"
        out.append(line + after.get(i, ""))
    new_text = "".join(out)
    expected = copy.deepcopy(parsed)
    for n in add:
        expected["mcp_servers"][n]["enabled"] = False
    for n in restore:
        value = _restored_enabled(prior.get(n))
        if value is None:
            expected["mcp_servers"][n].pop("enabled", None)
        else:
            expected["mcp_servers"][n]["enabled"] = value
    try:
        same = r.tomllib.loads(new_text) == expected
    except r.tomllib.TOMLDecodeError:
        same = False
    if not same:
        raise r.Refuse(3, "the edited TOML does not parse back to the intended content; nothing written")
    return new_text, add, restore, stuck, record, servers, lay


# -------------------------------------------------------------------------------------------- Kiro


def plan_kiro(data, aset, prior):
    """-> (new mcp.json data, turned off, turned back on, new record). The record keeps, per server mhw
    turned off, the "disabled" value it replaced: [] when there was none."""
    new = copy.deepcopy(data)
    servers = new.get("mcpServers", {})
    record, add, back = {}, [], []
    for n in sorted(n for n, s in servers.items() if isinstance(s, dict) and aset.outside("kiro", n)):
        s = servers[n]
        if s.get("disabled") is True:
            if n in prior:
                record[n] = prior[n]
            continue  # off already: by mhw (kept on record) or by the owner (his own, never recorded)
        record[n] = [s["disabled"]] if "disabled" in s else []
        s["disabled"] = True
        add.append(n)
    for n, was in sorted(prior.items()):
        s = servers.get(n)
        if n in record or not isinstance(s, dict) or s.get("disabled") is not True:
            continue
        if was:
            s["disabled"] = was[0]
        else:
            del s["disabled"]
        back.append(n)
    return new, add, back, record


# ------------------------------------------------------------------------------------- Claude Code


def plugin_roots(h):
    """(plugin, directory) for each installed plugin (installed_plugins.json) and each plugin claude.ai
    synced (plugins/synced/<source>/<plugin>)."""
    base = os.path.join(h, ".claude", "plugins")
    roots = []
    installed = quiet_json(os.path.join(base, "installed_plugins.json")) or {}
    plugins = installed.get("plugins", {})
    for key, installs in (plugins.items() if isinstance(plugins, dict) else ()):
        for inst in installs if isinstance(installs, list) else ():
            path = inst.get("installPath") if isinstance(inst, dict) else None
            if isinstance(path, str) and path:
                roots.append((str(key).split("@")[0], path))
    for d in sorted(glob.glob(os.path.join(glob.escape(base), "synced", "*", "*"))):
        if os.path.isdir(d):
            roots.append((os.path.basename(d), d))
    return roots


def plugin_servers(h):
    """(label, server) for each MCP server a plugin provides, from its .mcp.json and from an inline
    mcpServers object in its .claude-plugin/plugin.json. The label is plugin:<plugin>:<server>."""
    found = []
    for plugin, root in plugin_roots(h):
        for rel, inline in ((".mcp.json", False), (os.path.join(".claude-plugin", "plugin.json"), True)):
            doc = quiet_json(os.path.join(root, rel)) or {}
            servers = doc.get("mcpServers") if inline or "mcpServers" in doc else doc
            for name, s in (servers.items() if isinstance(servers, dict) else ()):
                if isinstance(s, dict):
                    found.append(("plugin:%s:%s" % (plugin, name), s))
    return found


def plugin_entry(server):
    """The documented deniedMcpServers entry matching one plugin server, or None. A URL or command that
    carries a ${VAR}, a wildcard or a credential-looking value is never copied into the settings."""
    url = server.get("url")
    if isinstance(url, str):
        if url and "${" not in url and "*" not in url and not r.looks_like_credential_value(url):
            return {"serverUrl": url}
        return None
    command, args = server.get("command"), server.get("args", [])
    if not (isinstance(command, str) and command and isinstance(args, list)
            and all(isinstance(a, str) for a in args)):
        return None
    parts = [command] + args
    if any("${" in p or r.looks_like_credential_value(p) for p in parts):
        return None
    return {"serverCommand": parts}


def wanted_denies(aset, user_servers, plugins):
    """-> ([(entry, label)], [labels with no documented match])."""
    want, stuck, seen = [], [], set()

    def add(entry, label):
        key = json.dumps(entry, sort_keys=True)
        if key not in seen:
            seen.add(key)
            want.append((entry, label))

    if not aset.declared:
        return want, stuck
    for n in sorted(user_servers):
        if aset.outside("claude-code", n):
            add({"serverName": n}, n)
    for label, server in plugins:
        entry = plugin_entry(server)
        if entry is None:
            stuck.append(label)
        else:
            add(entry, label)
    for c in aset.off:
        add({"serverName": CONNECTOR + c}, CONNECTOR + c)
    return want, stuck


def plan_claude(data, want, prior):
    """-> (new settings, entries to add, records to remove, new record)."""
    denied = data.get("deniedMcpServers", [])
    if not isinstance(denied, list):
        raise r.Refuse(3, "its deniedMcpServers is not a list; left untouched")
    ours = [p["entry"] for p in prior]
    wanted = [e for e, _ in want]
    keep = [e for e in denied if e in wanted or e not in ours]
    add = [(e, label) for e, label in want if e not in denied]
    gone = [p for p in prior if p["entry"] not in wanted and p["entry"] in denied]
    record = [{"entry": e, "label": label} for e, label in want if e in ours or e not in denied]
    new = dict(data)
    entries = keep + [e for e, _ in add]
    if entries or (denied and any(e not in ours for e in denied)):
        new["deniedMcpServers"] = entries
    else:
        new.pop("deniedMcpServers", None)
    return new, add, gone, record


# ------------------------------------------------------------------------------------------- the run


class Run:
    def __init__(self, mode, aset, stamp):
        self.mode, self.aset, self.stamp, self.status = mode, aset, stamp, 0
        self.writing = mode in ("install", "uninstall")

    def say(self, word, surface, text, cfg):
        print("%-7s %s: %s (%s) %s" % (word, surface, text, cfg, TAG))

    def refuse(self, surface, cfg, msg, code=3):
        print("REFUSE  %s: %s (%s) %s" % (surface, msg, cfg, TAG), file=sys.stderr)
        self.status = max(self.status, code)

    def change(self, surface, cfg, new_text, off, back):
        """Report or apply one surface's change. off and back are display names."""
        if self.writing:
            parts = (["turned off " + names(off)] if off else []) + (["turned back on " + names(back)] if back else [])
        else:
            parts = (["on outside the set: %s; install turns them off" % names(off)] if off else []) + (
                ["turned off by mhw and no longer outside the set: %s; install turns them back on" % names(back)]
                if back else [])
        text = "; ".join(parts)
        if self.mode == "check":
            self.say("DRIFT", surface, text, cfg)
            self.status = max(self.status, 1)
        elif self.mode == "dry-run":
            self.say("WOULD", surface, "would change: %s; backup %s%s" % (text, os.path.basename(cfg), BACKUP), cfg)
        else:
            existed = os.path.exists(cfg)
            r.atomic_write(cfg, new_text, backup=True, suffix=BACKUP)
            self.say("CHANGED", surface, text + ("; previous file kept as %s%s" % (cfg, BACKUP) if existed else ""),
                     cfg)

    def absent(self, surface, cfg, missing, off_by_hand):
        if self.mode == "uninstall" or not self.aset.declared:
            return
        parts = (["set member(s) not configured: %s; render them with global/mcp/mcp_render.py" % names(missing)]
                 if missing else []) + (["set member(s) turned off outside mhw: %s" % names(off_by_hand)]
                                        if off_by_hand else [])
        if parts:
            self.say("ABSENT", surface, "; ".join(parts), cfg)

    def installed(self, surface):
        """The surface's config file, or None when the agent harness is not installed here."""
        target = r.surface_target(surface)
        if target is None:
            return None
        cfg, directory = target
        if not os.path.isdir(directory) and not os.path.exists(cfg):
            if self.aset.declared:
                print("SKIP    %s: not installed (%s absent) %s" % (surface, directory, TAG))
            return None
        return cfg

    def ok(self, surface, cfg, count):
        if self.aset.declared or count:
            self.say("OK", surface, "nothing on outside the set (%d turned off by mhw)" % count, cfg)

    # -- Codex
    def codex(self, prior):
        cfg = self.installed("codex")
        if cfg is None:
            return prior
        if r.tomllib is None:
            print("SKIP    codex: needs Python 3.11+ (tomllib) to edit config.toml (%s) %s" % (cfg, TAG))
            return prior
        try:
            with open(cfg, encoding="utf-8") as fh:
                text = fh.read()
        except FileNotFoundError:
            self.absent("codex", cfg, sorted(self.aset.servers), [])
            return {}
        except (OSError, UnicodeDecodeError) as e:
            self.refuse("codex", cfg, "unreadable (%s); left untouched" % type(e).__name__)
            return prior
        try:
            new_text, add, back, stuck, record, servers, lay = plan_codex(text, self.aset, prior)
        except r.tomllib.TOMLDecodeError:
            self.refuse("codex", cfg, "not valid TOML; left untouched")
            return prior
        except r.Refuse as e:
            self.refuse("codex", cfg, str(e), e.code)
            return prior
        if stuck:
            self.refuse("codex", cfg, "server(s) %s are not written as an [mcp_servers.<name>] table, so the switch "
                                      "cannot be added; turn them off by hand" % names(stuck))
        missing = sorted(n for n in self.aset.servers if n not in servers)
        by_hand = sorted(n for n in self.aset.servers if n in servers and isinstance(servers[n], dict)
                         and servers[n].get("enabled", True) is False and lay.get(n, {}).get("mark") is None)
        self.absent("codex", cfg, missing, by_hand)
        if new_text == text:
            self.ok("codex", cfg, len(record))
            return record
        self.change("codex", cfg, new_text, add, back)
        return record if self.writing else prior

    # -- Kiro
    def kiro(self, prior):
        cfg = self.installed("kiro")
        if cfg is None:
            return prior
        try:
            exists, data = read_json(cfg)
        except r.Refuse as e:
            self.refuse("kiro", cfg, str(e), e.code)
            return prior
        servers = data.get("mcpServers", {})
        if not isinstance(servers, dict):
            self.refuse("kiro", cfg, "its mcpServers is not an object; left untouched")
            return prior
        new, add, back, record = plan_kiro(data, self.aset, prior)
        missing = sorted(n for n in self.aset.servers if n not in servers)
        by_hand = sorted(n for n in self.aset.servers if isinstance(servers.get(n), dict)
                         and servers[n].get("disabled") is True and n not in prior)
        self.absent("kiro", cfg, missing, by_hand)
        if not (add or back) or not exists:
            self.ok("kiro", cfg, len(record))
            return record
        self.change("kiro", cfg, json.dumps(new, indent=2, ensure_ascii=False) + "\n", add, back)
        return record if self.writing else prior

    # -- Claude Code
    def claude(self, prior):
        h = r.home()
        user_cfg = self.installed("claude-code")
        if user_cfg is None:
            return prior
        cfg = os.path.join(h, ".claude", "settings.json")
        try:
            _, user = read_json(user_cfg)
        except r.Refuse as e:
            self.refuse("claude-code", user_cfg, str(e), e.code)
            return prior
        try:
            _, data = read_json(cfg)
        except r.Refuse as e:
            self.refuse("claude-code", cfg, str(e), e.code)
            return prior
        user_servers = user.get("mcpServers", {})
        user_servers = user_servers if isinstance(user_servers, dict) else {}
        want, stuck = wanted_denies(self.aset, user_servers, plugin_servers(h))
        try:
            new, add, gone, record = plan_claude(data, want, prior)
        except r.Refuse as e:
            self.refuse("claude-code", cfg, str(e), e.code)
            return prior
        if stuck and self.mode != "uninstall":
            self.say("REPORT", "claude-code", "on outside the set, a plugin server with no documented match (a ${VAR}, a "
                     "wildcard or a credential-looking value in its URL or command), so it is not denied: %s"
                     % names(stuck), cfg)
        self.absent("claude-code", user_cfg, sorted(n for n in self.aset.servers if n not in user_servers), [])
        if self.aset.on and self.mode != "uninstall":
            print("NOTE    claude-code: %d claude.ai connector(s) declared on; connectors are account-level, so "
                  "whether they are connected cannot be read here (%s) %s" % (len(self.aset.on), cfg, TAG))
        if not (add or gone):
            self.ok("claude-code", cfg, len(record))
            return record
        self.change("claude-code", cfg, json.dumps(new, indent=2, ensure_ascii=False) + "\n",
                    [label for _, label in add], [p["label"] for p in gone])
        return record if self.writing else prior

    # -- Claude desktop app
    def desktop(self):
        if self.mode == "uninstall" or not self.aset.declared:
            return
        cfg = self.installed("claude-desktop")
        if cfg is None:
            return
        try:
            _, data = read_json(cfg)
        except r.Refuse as e:
            self.refuse("claude-desktop", cfg, str(e), e.code)
            return
        servers = data.get("mcpServers", {})
        outside = sorted(n for n in (servers if isinstance(servers, dict) else {})
                         if self.aset.outside("claude-desktop", n))
        if outside:
            self.say("REPORT", "claude-desktop", "on outside the set, no native switch for one server (remove it by "
                     "hand): %s" % names(outside), cfg)
        missing = sorted(n for n in self.aset.servers if n not in (servers if isinstance(servers, dict) else {}))
        self.absent("claude-desktop", cfg, missing, [])


def load_set(mode, source):
    if mode == "uninstall":
        return ActiveSet(None)
    path = source or r.default_source()
    if not os.path.lexists(path):
        print("SKIP    MCP active set: no local MCP definition at %s, so nothing is turned off %s" % (path, TAG))
        return ActiveSet(None)
    if r.committable(path):
        raise r.Refuse(2, "%s is inside a git work tree and not ignored, so it could be committed. The definition "
                          "lives only in the untracked local overlay" % path)
    doc = r.load_source(path)
    if "active_set" not in doc:
        print("SKIP    MCP active set: not declared in %s (no \"active_set\"), so nothing is turned off %s"
              % (path, TAG))
    return ActiveSet(doc)


def valid_record(prior):
    if not isinstance(prior, dict):
        return False
    codex, kiro, claude = prior.get("codex", {}), prior.get("kiro", {}), prior.get("claude-code", [])
    return (isinstance(codex, dict) and all(v is None or isinstance(v, str) for v in codex.values())
            and isinstance(kiro, dict) and all(isinstance(v, list) and len(v) <= 1 for v in kiro.values())
            and isinstance(claude, list) and all(isinstance(p, dict) and isinstance(p.get("entry"), dict)
                                                 and isinstance(p.get("label"), str) for p in claude))


def main(mode, stamp=None, source=None):
    """-> exit code, as global/install.sh reads it."""
    if sys.platform == "win32":
        print("SKIP    MCP active set: not applied on Windows %s" % TAG)
        return 0
    mdoc = r.load_manifest_doc()
    prior = mdoc.get("active", {})
    if not valid_record(prior):
        raise r.Refuse(3, "the managed-server manifest %s has an unexpected shape" % r.manifest_path())
    run = Run(mode, load_set(mode, source), stamp or r.provenance())
    record = {"codex": run.codex(prior.get("codex", {})), "kiro": run.kiro(prior.get("kiro", {})),
              "claude-code": run.claude(prior.get("claude-code", []))}
    run.desktop()
    if run.writing:
        record = {k: v for k, v in record.items() if v}
        if record:
            record["stamp"] = run.stamp
        if record != prior:
            if record:
                mdoc["active"] = record
            else:
                mdoc.pop("active", None)
            if any(mdoc.get(k) for k in r.MANIFEST_KEYS):
                r.write_manifest(mdoc)
            elif os.path.exists(r.manifest_path()):
                os.remove(r.manifest_path())
                print("REMOVED %s (it recorded only what the MCP active set turned off)" % r.manifest_path())
    return run.status

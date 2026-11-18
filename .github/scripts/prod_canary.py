#!/usr/bin/env python3
"""The PROD install canary (Issue #452): install the npm package the way the owner does, then check it.

mhw has no STG or PROD environment. Its PROD is the owner running `mhw install` on his workstation, so
this is that install, repeated where nothing of his exists: a throwaway HOME, a throwaway npm prefix and
a throwaway admin root, on a clean container (CI, Linux) or a throwaway HOME (CI, macOS; or by hand).

    prod_canary.py pack --ref REF --out DIR [--name N] git archive REF (of this checkout), then npm pack
    prod_canary.py run  --source DIR --tgz HEAD.tgz [--from-tgz OLD.tgz] --work DIR [--commit SHA]

`pack` builds the package from a source archive, as GitHub serves a tag: `git archive` fills in
.workstation-archive, and npm packs that tree. `run` installs HEAD.tgz with `npm install -g`, then
`mhw install --yes`; with --from-tgz it first installs OLD.tgz the same way, so the head is an upgrade
over it. Then it checks, and every check prints PASS or FAIL:

  1. the deny floor rendered into the three agent harness carriers (Claude Code settings.json, the Codex
     rules file, Kiro permissions.yaml), and into the admin layer under the throwaway root, equals what
     global/deny-floor.conf plus overlay/deny-floor.conf in --source say it must be;
  2. the installed prompt hook, run as the harness runs it with the paste-wrapper marker unset, blocks
     a synthetic credential-shaped prompt and passes a clean one (Claude Code and Codex); Kiro CLI V3's
     user-level hook file (Issue #455) exists in the V3 shape, and its command blocks the same prompt with
     exit 2, the redacted copy on stderr and nothing on stdout, with the marker SET as well;
  3. `mhw status` and `mhw check` exit 0;
  4. `mhw uninstall --yes` restores every file the owner had, removes the admin layer, and leaves no
     floor rule, brief or data directory of mhw behind.

EVIDENCE LEVEL: installed. Nothing here starts an agent harness, so nothing here shows a rule is loaded
or enforced. The admin layer goes into a throwaway root, never /Library or /etc. Payloads are synthetic.
Standard library only; Python 3.9 or later; needs git, node, npm and jq on PATH.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import io

MARKER = "PMHWC_PASTE_WRAPPER"           # global/clipboard/clipboard_guard.py, WRAPPER_MARKER
NAME = "personal-multi-harness-workstation-configuration"
WORD = re.compile(r"^[A-Za-z0-9._/~=:@+*-]+$")
# `pack` reads the checkout this script sits in (.github/scripts/ -> the repository root); `run` needs
# no checkout, so it also works from a copy of this one file, as in the container.
SCRIPT = Path(__file__).resolve()
CLAUDE_SETTINGS = ".claude/settings.json"
FLOOR_FILES = ("global/deny-floor.conf", "overlay/deny-floor.conf")   # install.sh appends the overlay's

failures = []


def check(ok, what, detail=""):
    print(("PASS  " if ok else "FAIL  ") + what + ("" if ok or not detail else "\n      " + detail), flush=True)
    if not ok:
        failures.append(what)
    return ok


def die(msg):
    print("ERROR " + msg, flush=True)
    sys.exit(2)


# --- pack ------------------------------------------------------------------------------------------------

def known_ref(arg):
    """The ref as git itself spells it: HEAD, a tag that exists, or a full commit SHA rebuilt from its
    hexadecimal value. Nothing taken from the command line reaches git's argument list as typed."""
    if arg == "HEAD":
        return "HEAD"
    if re.fullmatch(r"[0-9a-f]{40}", arg):
        return "%040x" % int(arg, 16)
    tags = subprocess.run(["git", "-C", str(SCRIPT.parents[2]), "tag", "--list"], capture_output=True, text=True).stdout.split()
    found = [t for t in tags if t == arg]
    if not found:
        die("refusing ref %r: HEAD, an existing tag or a full commit SHA only" % arg)
    return found[0]


def cmd_pack(a):
    ref = known_ref(a.ref)
    out = Path(a.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    name = a.name or re.sub(r"[^A-Za-z0-9._-]", "_", ref)
    src = out / ("src-" + name)
    if src.exists():
        die("%s exists; pack into a fresh directory" % src)
    src.mkdir()
    raw = subprocess.run(["git", "-C", str(SCRIPT.parents[2]), "archive", "--format=tar", "--end-of-options", ref], capture_output=True)
    if raw.returncode:
        die("git archive %s: %s" % (ref, raw.stderr.decode(errors="replace").strip()))
    with tarfile.open(fileobj=io.BytesIO(raw.stdout)) as t:
        if hasattr(tarfile, "data_filter"):    # Python 3.12+: refuse links and paths out of the tree
            t.extractall(src, filter="data")
        else:
            t.extractall(src)
    p = subprocess.run(["npm", "pack", "--pack-destination", str(out), "--cache", str(out / "npm-cache")],
                       cwd=src, capture_output=True, text=True)
    if p.returncode:
        die("npm pack: " + p.stdout + p.stderr)
    tgz = out / p.stdout.strip().splitlines()[-1]
    named = out / ("mhw-" + name + ".tgz")
    tgz.rename(named)
    print(named)


# --- what the floor must render to (read from the source, independently of the installer) ---------------

def floor_line(rel, raw):
    """One deny-floor line -> (kind, words), or None for a blank or comment line."""
    line = raw.strip()
    if not line or line.startswith("#"):
        return None
    f = line.split()
    if f[0] not in ("cmd", "file", "glob") or len(f) < 2 or not all(WORD.match(w) for w in f[1:]):
        die("unreadable deny-floor entry in %s: %s" % (rel, line))
    return f[0], f[1:]


def floor_entries(source):
    entries = []
    root = os.path.realpath(source)
    for rel in FLOOR_FILES:
        path = Path(os.path.realpath(os.path.join(root, rel)))
        if os.path.commonpath([root, str(path)]) != root:
            die("%s resolves outside the source tree" % rel)
        if path.is_file():
            lines = path.read_text(encoding="utf-8").splitlines()
            entries.extend(e for e in (floor_line(rel, raw) for raw in lines) if e)
    if not entries:
        die("no deny-floor entry under %s" % source)
    return entries


def expected(entries):
    claude, codex, kiro = set(), [], {"shell": set(), "fs_read": set(), "fs_write": set()}
    for kind, words in entries:
        w = " ".join(words)
        if kind == "cmd":
            claude.add("Bash(%s:*)" % w)
            codex.append(list(words))
            kiro["shell"].add(w + " *")
        elif kind == "glob":
            claude.add("Bash(%s)" % w)
            kiro["shell"].add(w)
        else:
            claude.update(("Read(%s)" % w, "Edit(%s)" % w))
            kiro["fs_read"].add(w)
            kiro["fs_write"].add(w)
    return claude, codex, kiro


# --- readers for the installed carriers ------------------------------------------------------------------

def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def codex_rules(path):
    pats = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        m = re.match(r'^prefix_rule\(pattern=(\[.*\]), decision="forbidden"\)$', line.strip())
        if m:
            pats.append(json.loads(m.group(1)))
    return pats


def codex_requirements(path):
    """-> (prefix rule patterns, hook commands) from the admin requirements.toml mhw writes."""
    pats, hooks = [], []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s.startswith("{ pattern = [") and 'decision = "forbidden"' in s:
            pats.append(re.findall(r'\{ token = "([^"]*)" \}', s.split("], decision")[0]))
        m = re.match(r'^command = (".*")$', s)
        if m:
            hooks.append(json.loads(m.group(1)))
    return pats, hooks


def kiro_yaml(path):
    """-> {capability: set(patterns)} over the deny rules of a permissions.yaml in the subset mhw writes."""
    out, cap, effect, in_match = {}, None, None, False
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        m = re.match(r'^- capability: "([^"]*)"$', s)
        if m:
            cap, effect, in_match = m.group(1), None, False
            continue
        m = re.match(r'^effect: "([^"]*)"$', s)
        if m:
            effect = m.group(1)
            continue
        if s in ("match:", "exclude:"):
            in_match = s == "match:"
            continue
        m = re.match(r'^- (".*")$', s)
        if m and in_match and cap and effect == "deny":
            out.setdefault(cap, set()).add(json.loads(m.group(1)))
    return out


def kiro_managed(path):
    out = {}
    for r in read_json(path).get("rules", []):
        if r.get("effect") == "deny":
            out.setdefault(r["capability"], set()).update(r.get("match", []))
    return out


def one(paths, what):
    paths = sorted(paths)
    if len(paths) != 1:
        check(False, what, "expected exactly one file, found %d: %s" % (len(paths), [str(p) for p in paths]))
        return None
    return paths[0]


# --- the throwaway workstation ---------------------------------------------------------------------------

OWNER_DENY = "Bash(owner-canary-tool --only-mine:*)"
OWNER_KIRO = "owner-canary-tool --only-mine *"


def seed(home):
    """What the owner already has before mhw arrives: uninstall must give it back byte for byte."""
    files = {
        CLAUDE_SETTINGS: json.dumps({"theme": "dark", "permissions": {"deny": [OWNER_DENY]},
                                             "model": "owner-chosen-model"}, indent=2) + "\n",
        ".codex/config.toml": 'model = "owner-chosen-model"\n\n[tui]\nnotifications = false\n',
        ".kiro/settings/permissions.yaml": 'rules:\n  - capability: "shell"\n    effect: "deny"\n'
                                          '    match:\n      - "%s"\n' % OWNER_KIRO,
        ".zshrc": "# the owner's own zsh line\nexport OWNER_CANARY=1\n",
        ".bashrc": "# the owner's own bash line\nexport OWNER_CANARY=1\n",
    }
    for rel, text in files.items():
        p = home / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return files


def snapshot(base):
    out = {}
    for p in sorted(Path(base).rglob("*")):
        if p.is_file() and not p.is_symlink():
            out[str(p.relative_to(base))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return out


def tools_dir(work):
    """A PATH holding only what install needs, so no agent harness CLI or gh of the host is found."""
    d = work / "tools"
    d.mkdir()
    for name in ("node", "npm", "npx", "jq", "git"):
        found = shutil.which(name)
        if not found:
            die("%s is not on PATH" % name)
        (d / name).symlink_to(found)
    return d


class Box:
    def __init__(self, work, label):
        self.d = work / label
        for sub in ("home", "root", "tmp", "proj", "prefix", "cache"):
            (self.d / sub).mkdir(parents=True)
        self.home, self.root = self.d / "home", self.d / "root"
        self.env = {
            "PATH": os.pathsep.join([str(self.d / "prefix" / "bin"), str(work / "tools"), "/usr/bin", "/bin"]),
            "HOME": str(self.home), "TMPDIR": str(self.d / "tmp"), "LANG": "C.UTF-8",
            "WORKSTATION_MANAGED_ROOT": str(self.root), "MHW_POSTINSTALL_TTY": "0",
            "npm_config_cache": str(self.d / "cache"), "npm_config_prefix": str(self.d / "prefix"),
            "npm_config_userconfig": str(self.d / "npmrc"), "npm_config_update_notifier": "false",
            "npm_config_audit": "false", "npm_config_fund": "false",
        }
        if os.environ.get("USER"):
            self.env["USER"] = os.environ["USER"]

    def run(self, *args, stdin=None):
        return subprocess.run(list(args), env=self.env, cwd=self.d / "proj", input=stdin,
                              capture_output=True, text=True)

    def install(self, tgz, what):
        p = self.run("npm", "install", "-g", "--offline", "--foreground-scripts", str(tgz))
        if not check(p.returncode == 0, "npm install -g %s" % what, (p.stdout + p.stderr)[-2000:]):
            return False
        p = self.run("mhw", "install", "--yes")
        return check(p.returncode == 0 and "Installation successful!" in p.stdout,
                     "mhw install --yes (%s)" % what, "exit %d\n%s" % (p.returncode, (p.stdout + p.stderr)[-3000:]))


# --- the checks ------------------------------------------------------------------------------------------

def check_floor(box, exp):
    claude, codex, kiro = exp
    s = read_json(box.home / CLAUDE_SETTINGS)
    deny = set(s.get("permissions", {}).get("deny", []))
    owned = set(s.get(NAME + "-owned-deny", []))
    check(claude <= deny, "Claude Code user settings.json carries every floor rule (%d)" % len(claude),
          "missing: %s" % sorted(claude - deny)[:10])
    check(owned == claude, "Claude Code: the rules mhw records as its floor are exactly the floor",
          "missing %s; extra %s" % (sorted(claude - owned)[:10], sorted(owned - claude)[:10]))
    check(OWNER_DENY in deny, "Claude Code: the owner's own deny rule is kept")
    rules = box.home / ".codex/rules/workstation-deny-floor.rules"
    got = codex_rules(rules) if rules.is_file() else []
    check(got == codex, "Codex user rules file equals the floor's %d cmd entries" % len(codex),
          "got %d rules; first missing: %s" % (len(got), [c for c in codex if c not in got][:5]))
    k = kiro_yaml(box.home / ".kiro/settings/permissions.yaml")
    kmine = {c: k.get(c, set()) - {OWNER_KIRO} for c in kiro}
    check(kmine == kiro, "Kiro user permissions.yaml equals the floor (%d shell, %d fs_read, %d fs_write)"
          % (len(kiro["shell"]), len(kiro["fs_read"]), len(kiro["fs_write"])),
          "missing %s" % {c: sorted(kiro[c] - kmine[c])[:5] for c in kiro})
    check(OWNER_KIRO in k.get("shell", set()), "Kiro: the owner's own deny rule is kept")
    # The admin layer, rendered into the throwaway root (never /Library or /etc here).
    drop = one(box.root.rglob("managed-settings.d/50-%s.json" % NAME), "Claude Code admin drop-in")
    if drop:
        md = set(read_json(drop).get("permissions", {}).get("deny", []))
        check(md == claude, "Claude Code admin drop-in (throwaway root) equals the floor",
              "missing %s; extra %s" % (sorted(claude - md)[:10], sorted(md - claude)[:10]))
    req = one(box.root.rglob("codex/requirements.toml"), "Codex admin requirements.toml")
    hooks = {}
    if req:
        pats, hooks["codex"] = codex_requirements(req)
        check(pats == codex, "Codex admin requirements.toml (throwaway root) equals the floor",
              "got %d prefix rules" % len(pats))
    # macOS: <root>/Library/Application Support/Kiro/; Linux: <root>/etc/kiro/.
    km = one([p for p in box.root.rglob("managed-settings.json") if p.parent.name in ("Kiro", "kiro")],
             "Kiro admin managed-settings.json")
    if km:
        got = kiro_managed(km)
        check({c: got.get(c, set()) for c in kiro} == kiro, "Kiro admin managed-settings.json (throwaway root) equals the floor")
    if drop:
        hooks["claude"] = [h["command"] for e in read_json(drop).get("hooks", {}).get("UserPromptSubmit", [])
                           for h in e.get("hooks", []) if h.get("type") == "command"]
    # Kiro CLI V3's hook file (Issue #455): user level, the V3 shape read from the kas 2.35.2 bundle.
    kh = box.home / ".kiro" / "hooks" / (NAME + "-paste-filter.json")
    kdoc = read_json(kh) if kh.is_file() else {}
    kentries = kdoc.get("hooks", []) if isinstance(kdoc.get("hooks"), list) else []
    check(kh.is_file() and kdoc.get("version") == "v1" and len(kentries) == 1
          and "managed-by: " + NAME in str(kentries[0].get("description", ""))
          and kentries[0].get("trigger") == "UserPromptSubmit",
          "Kiro: the user-level hook file is rendered in the V3 shape", str(kh))
    # The command is compared with the one install.sh must render for this HOME, and only that expected
    # string is run: a command read from a file is never executed as given.
    data = box.home / ".local" / "share" / NAME
    want = '/usr/bin/python3 -I -B "%s" prompt-hook --harness kiro --config "%s"' % (
        data / "clipboard_guard.py", data / "clipboard.conf")
    got = [e["action"].get("command") for e in kentries if isinstance(e.get("action"), dict)
           and e["action"].get("type") == "command"]
    check(got == [want], "Kiro: the hook file runs the installed core in kiro mode", "got %r" % got[:2])
    hooks["kiro"] = [want] if got == [want] else []
    return hooks


def check_hook(box, hooks):
    # Built at run time from pieces, so no credential-shaped literal sits in this file: the AWS access
    # key id shape (AKIA + 16 of [0-9A-Z]), synthetic, belonging to no account.
    fake_key = "AK" + "IA" + "QZ7X" * 4
    dirty = "deploy it with key %s please" % fake_key
    clean = "summarise the README in two lines"
    env = {k: v for k, v in box.env.items() if k != MARKER}
    for harness in ("claude", "codex"):
        cmds = hooks.get(harness) or []
        if not check(len(cmds) == 1, "%s: exactly one installed prompt hook" % harness, "found %d" % len(cmds)):
            continue
        cmd = cmds[0]
        check(MARKER not in env, "%s: the paste-wrapper marker is unset for the hook" % harness)

        def fire(prompt, environ):
            payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": prompt})
            return subprocess.run(["/bin/sh", "-c", cmd], input=payload, env=environ, cwd=box.d / "proj",
                                  capture_output=True, text=True, timeout=60)
        p = fire(dirty, env)
        try:
            out = json.loads(p.stdout) if p.stdout.strip() else {}
        except ValueError:
            out = {}
        check(p.returncode == 0 and out.get("decision") == "block" and fake_key not in p.stdout,
              "%s: the installed hook blocks a synthetic credential-shaped prompt" % harness,
              "exit %d, decision %r, stderr %s" % (p.returncode, out.get("decision"), p.stderr[-500:]))
        p = fire(clean, env)
        check(p.returncode == 0 and p.stdout == "", "%s: the installed hook passes a clean prompt" % harness,
              "exit %d, stdout %r" % (p.returncode, p.stdout[:300]))
        # Calibration: the same dirty prompt in a session the paste wrapper started passes silently, so the
        # block above came from the hook judging the prompt, not from something unrelated to the marker.
        p = fire(dirty, dict(env, **{MARKER: "1"}))
        check(p.returncode == 0 and p.stdout == "", "%s: calibration, with the wrapper marker set the hook stays silent" % harness)
    # Kiro's protocol (read from the bundle): exit 2 blocks with stderr as the reason; on exit 0 stdout is
    # appended to the model's prompt. On V3 the wrapper cleans pastes but never checks typed text, so the
    # marker must NOT silence it.
    cmds = hooks.get("kiro") or []
    if check(len(cmds) == 1, "kiro: exactly one installed prompt hook", "found %d" % len(cmds)):
        for label, environ in (("marker unset", env), ("marker set", dict(env, **{MARKER: "1"}))):
            payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": dirty})
            p = subprocess.run(["/bin/sh", "-c", cmds[0]], input=payload, env=environ, cwd=box.d / "proj",
                               capture_output=True, text=True, timeout=60)
            check(p.returncode == 2 and p.stdout == "" and "[REDACTED:credential]" in p.stderr
                  and fake_key not in p.stderr,
                  "kiro (%s): the installed hook blocks with exit 2, a redacted copy on stderr, nothing on stdout" % label,
                  "exit %d, stdout %r" % (p.returncode, p.stdout[:200]))
        payload = json.dumps({"hook_event_name": "UserPromptSubmit", "prompt": clean})
        p = subprocess.run(["/bin/sh", "-c", cmds[0]], input=payload, env=env, cwd=box.d / "proj",
                           capture_output=True, text=True, timeout=60)
        check(p.returncode == 0 and p.stdout == "", "kiro: the installed hook passes a clean prompt",
              "exit %d, stdout %r" % (p.returncode, p.stdout[:300]))


PROBLEM = re.compile(r"^(REFUSE|STALE|DRIFT|MISSING|FAIL)\s")
# The required prerequisites a throwaway workstation cannot have: the agent harness CLIs (a live,
# signed-in harness is outside this canary) and gh. global/prerequisites.json marks them required.
NOT_HERE = {"claude", "codex", "github"}


def check_cli(box):
    p = box.run("mhw", "status", "--project=" + str(box.d / "proj"))
    check(p.returncode == 0, "mhw status exits 0", "exit %d\n%s" % (p.returncode, (p.stdout + p.stderr)[-3000:]))
    print("      " + "\n      ".join(l.strip() for l in p.stdout.splitlines()
                                     if l.strip().startswith(("source ", "evidence "))), flush=True)
    p = box.run("mhw", "check")
    lines = p.stdout.splitlines()
    cut = next((i for i, l in enumerate(lines) if l.startswith("PREREQ ")), len(lines))
    installed, prereq = lines[:cut], lines[cut:]
    bad = [l for l in installed if PROBLEM.match(l)]
    check(not bad and cut < len(lines), "mhw check: the installed-state and admin sections report no problem",
          "\n".join(bad[:20]) or "no PREREQ section found")
    missing = {m.group(1) for l in prereq for m in [re.match(r"^MISSING (\S+) \[required", l)] if m}
    if p.returncode == 0:
        check(True, "mhw check exits 0")
    else:
        # Exit 1 is accepted only when it comes from the prerequisites section alone, and only for the
        # CLIs this throwaway workstation cannot hold. The owner's PROD has them; there, the exit is 0.
        check(p.returncode == 1 and not bad and missing and missing <= NOT_HERE,
              "mhw check exits 0 but for the required CLIs absent by construction here (%s)"
              % ", ".join(sorted(missing)) if missing else "mhw check exits 0",
              "exit %d; required missing: %s\n%s" % (p.returncode, sorted(missing), p.stderr[-1000:]))


def empty_doc(path):
    text = path.read_text(encoding="utf-8", errors="replace").strip()
    if text == "":
        return True
    try:
        doc = json.loads(text)
    except ValueError:
        return False
    return doc in ({}, {"mcpServers": {}})


def check_uninstall(box, before, seeded, exp):
    p = box.run("mhw", "uninstall", "--yes")
    check(p.returncode == 0, "mhw uninstall --yes exits 0", (p.stdout + p.stderr)[-2000:])
    after = snapshot(box.home)

    def same(rel):
        path = box.home / rel
        if not path.is_file():
            return False
        if rel.endswith(".json"):
            # mhw re-serialises a JSON settings file (its indentation): the document is what must return.
            return json.loads(path.read_text(encoding="utf-8")) == json.loads(seeded[rel])
        return after.get(rel) == before.get(rel)
    changed = [r for r in seeded if not same(r)]
    check(not changed, "uninstall restores every file the owner had (%d; JSON as a document, the rest byte "
          "for byte)" % len(seeded), "changed or missing: %s" % changed)
    leftover = [r for r in after if r not in before and ".pmhwc-" not in r and not empty_doc(box.home / r)]
    check(not leftover, "uninstall leaves no file of mhw in HOME (backups and empty documents aside)",
          "left: %s" % leftover)
    check(snapshot(box.root) == {}, "uninstall removes the admin layer from the throwaway root",
          "left: %s" % list(snapshot(box.root))[:10])
    claude = exp[0]
    s = read_json(box.home / CLAUDE_SETTINGS)
    check(not (claude & set(s.get("permissions", {}).get("deny", []))), "no floor rule is left in Claude Code settings")
    p = box.run("npm", "uninstall", "-g", "mhw")
    check(p.returncode == 0, "npm uninstall -g mhw exits 0", (p.stdout + p.stderr)[-1000:])


def cmd_run(a):
    work = Path(a.work).resolve()
    if work.exists() and any(work.iterdir()):
        die("%s is not empty; give a fresh work directory" % work)
    work.mkdir(parents=True, exist_ok=True)
    tools_dir(work)
    exp = expected(floor_entries(a.source))
    label = "upgrade" if a.from_tgz else "fresh"
    print("==> PROD install canary, %s install (evidence level: installed, never enforced)" % label, flush=True)
    box = Box(work, label)
    seeded = seed(box.home)
    before = snapshot(box.home)
    if a.from_tgz and not box.install(Path(a.from_tgz).resolve(), "the latest published tag"):
        return 1
    if not box.install(Path(a.tgz).resolve(), "the head"):
        return 1
    stamp = (box.d / "prefix" / "lib" / "node_modules" / "mhw" / ".workstation-archive")
    if a.commit:
        text = stamp.read_text(encoding="utf-8") if stamp.is_file() else ""
        check("commit: %s" % a.commit in text, "the installed package is the head %s" % a.commit[:12], text.strip())
    check_hook(box, check_floor(box, exp))
    check_cli(box)
    check_uninstall(box, before, seeded, exp)
    print("==> %s: %d failure(s)%s" % (label, len(failures), "" if not failures else ": " + "; ".join(failures)))
    return 1 if failures else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pack")
    p.add_argument("--ref", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--name", help="names the outputs mhw-NAME.tgz and src-NAME/ (default: the ref)")
    r = sub.add_parser("run")
    r.add_argument("--source", required=True, help="the source tree of the head (its deny-floor.conf is the truth)")
    r.add_argument("--tgz", required=True)
    r.add_argument("--from-tgz")
    r.add_argument("--work", required=True)
    r.add_argument("--commit", help="the full commit the installed package must carry")
    a = ap.parse_args()
    if a.cmd == "pack":
        cmd_pack(a)
        return 0
    return cmd_run(a)


if __name__ == "__main__":
    sys.exit(main())

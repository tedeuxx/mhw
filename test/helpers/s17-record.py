#!/usr/bin/env python3
# Plays the S17 parity cases (#488; test/helpers/s17.js) on the Python prompt hook and add-term and prints
# the answers as JSON. Run by test/clipboard/hook-golden.test.js: once to record test/golden/S17/answers.json
# while the original existed, and by the live arm on the base revision's copy. Reads and writes only the
# throwaway directory it is given; every process it starts runs under a throwaway HOME there.
#   s17-record.py <dir holding clipboard_guard.py> <cases.json> <throwaway dir>
import io
import json
import os
import subprocess
import sys

src, cases_file, work = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, src)
import clipboard_guard as g  # noqa: E402

with open(cases_file, encoding="utf-8") as fh:
    cases = json.load(fh)
SALT = cases["salt"]


class Salts:
    def __init__(self, value):
        self.value = value

    def get(self):
        return self.value


def expand(v):
    if v == "CATEGORIES-EXCEPT-phone-health":
        return ",".join(c for c in g.CATEGORY_ORDER if c not in ("phone", "health"))
    return v


def conf_dir(name, over):
    d = os.path.join(work, name.replace("/", "_"))
    os.makedirs(os.path.join(d, "lo"), exist_ok=True)
    lines = ["salt_store=file", "terms_file=%s" % os.path.join(d, "lo", "terms"),
             "salt_file=%s" % os.path.join(d, "lo", "salt"),
             "health_terms_file=%s" % os.path.join(d, "lo", "terms-health"),
             "colleague_terms_file=%s" % os.path.join(d, "lo", "terms-colleague")]
    lines += ["%s=%s" % (k, expand(v)) for k, v in over.items()]
    p = os.path.join(d, "clipboard.conf")
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(lines) + "\n")
    return d, p


def hashes(terms):
    return [g.term_hash(SALT, f) for t in terms for f in g.term_forms(t)]


def decision(c):
    d, p = conf_dir("d-" + c["name"], c.get("conf", {}))
    conf = g.load_config(p)
    lists = c.get("lists", {})
    for key, path in (("employer", conf["terms_file"]), ("health", conf["health_terms_file"]),
                      ("colleague", conf["colleague_terms_file"])):
        if lists.get(key):
            g.add_term_hashes(path, hashes(lists[key]))
    for key, data in c.get("raw", {}).items():
        os.makedirs(os.path.dirname(conf[key]), exist_ok=True)
        with open(conf[key], "ab") as fh:
            fh.write(bytes.fromhex(data))
    env = {} if c.get("marker") is None else {g.WRAPPER_MARKER: c["marker"]}
    out, err = io.StringIO(), io.StringIO()
    salts = None if c.get("fileSalt") else Salts(c.get("salt"))
    rc = g.cmd_prompt_hook(conf, c["harness"], io.BytesIO(bytes.fromhex(c["payload"])), out, salts,
                           environ=env, stderr=err)
    return {"name": c["name"], "stdout": out.getvalue(), "stderr": err.getvalue(), "code": rc}


def proc_env(d):
    home = os.path.join(d, "home")
    os.makedirs(home, exist_ok=True)
    return {"HOME": home, "PATH": "/usr/bin:/bin", "LC_ALL": "C"}


def norm(s):
    return s.replace(work, "<T>")


def cli(c):
    d = os.path.join(work, "c-" + c["name"].replace("/", "_"))
    os.makedirs(os.path.join(d, "lo"), exist_ok=True)
    args = list(c["args"])
    if c.get("configPath") == "dir":
        args += ["--config", d]
    elif c.get("configPath") == "missing":
        args += ["--config", os.path.join(d, "no-such.conf")]
    elif c.get("conf") is not None:
        p = os.path.join(d, "clipboard.conf")
        data = ("\n".join(c["conf"]).replace("DIR", d) + "\n").encode("utf-8").replace(b"BADBYTE", b"\xff")
        with open(p, "wb") as fh:
            fh.write(data)
        args += ["--config", p]
    r = subprocess.run([sys.executable, "-I", "-B", os.path.join(src, "clipboard_guard.py"), "prompt-hook"] + args,
                       input=bytes.fromhex(c["stdin"]), capture_output=True, env=proc_env(d), timeout=60)
    return {"name": c["name"], "stdout": norm(r.stdout.decode("utf-8")), "stderr": norm(r.stderr.decode("utf-8")),
            "code": r.returncode}


def check_config():
    out = []
    d, p = conf_dir("check-config", {"block_categories": "credential,email", "show_cleaned_chars": "77"})
    g.add_term_hashes(g.load_config(p)["terms_file"], hashes(["Zyxw Quillon"]))
    for name, extra in (("file", ["--config", p]), ("missing", ["--config", os.path.join(d, "none.conf")]),
                        ("unknown-flag", ["--config"])):
        r = subprocess.run([sys.executable, "-I", "-B", os.path.join(src, "clipboard_guard.py"), "check-config"] + extra,
                           capture_output=True, env=proc_env(d), stdin=subprocess.DEVNULL, timeout=60)
        out.append({"name": name, "stdout": norm(r.stdout.decode("utf-8")), "stderr": norm(r.stderr.decode("utf-8")),
                    "code": r.returncode})
    return out


def add_term(c, conf):
    """cmd_add_term() after the two reads, as the Python original runs it (its own statements, in order)."""
    first, second, list_name = c["first"], c["second"], c["list"]
    if first != second:
        return {"name": c["name"], "out": "not added: the two entries differ.\n", "code": 1}
    forms = g.term_forms(first)
    if not forms or len(forms[0].split(" ")) > g.MAX_TERM_TOKENS or len(forms[0].replace(" ", "")) < g.MIN_TERM_CHARS:
        return {"name": c["name"], "out": "not added: a term has 1 to %d words and at least %d letters or digits.\n"
                % (g.MAX_TERM_TOKENS, g.MIN_TERM_CHARS), "code": 1}
    salt = g.SaltStore(conf).get_or_create()
    path = conf[g.TERM_LISTS[list_name]] if list_name in g.TERM_LISTS else conf["terms_file"]
    n = g.add_term_hashes(path, [g.term_hash(salt, f) for f in forms])
    return {"name": c["name"], "out": norm("added: %d new hash(es) to %s. The term itself was not stored anywhere.\n" % (n, path)),
            "code": 0}


def add_terms():
    d, p = conf_dir("add-term", {})
    conf = g.load_config(p)
    os.makedirs(os.path.dirname(conf["salt_file"]), exist_ok=True)
    with open(conf["salt_file"], "w", encoding="ascii") as fh:
        fh.write(SALT + "\n")
    answers = [add_term(c, conf) for c in cases["add_term"]]
    files = {}
    for key in ("terms_file", "health_terms_file", "colleague_terms_file"):
        with open(conf[key], encoding="ascii") as fh:
            files[key] = fh.read()
        files[key + "_mode"] = oct(os.stat(conf[key]).st_mode & 0o777)
    files["dir_mode"] = oct(os.stat(os.path.dirname(conf["terms_file"])).st_mode & 0o777)
    return answers, files


answers, files = add_terms()
json.dump({
    "decision": [decision(c) for c in cases["decision"]],
    "cli": [cli(c) for c in cases["cli"]],
    "check_config": check_config(),
    "add_term": answers,
    "add_term_files": files,
    "constants": {"WRAPPER_MARKER": g.WRAPPER_MARKER, "WRAPPER_MARKER_VALUE": g.WRAPPER_MARKER_VALUE,
                  "HARNESSES": list(g.HARNESSES), "KEYCHAIN_READ_SECONDS": g.KEYCHAIN_READ_SECONDS,
                  "AGENT_MARKERS": list(g.AGENT_MARKERS), "KIRO_HOOK_FILE": g.KIRO_HOOK_FILE,
                  "notices": {k: v for k, v in sorted(g.DEFAULTS.items()) if k.startswith("notice_")},
                  "settings": {k: v for k, v in sorted(g.DEFAULTS.items()) if not k.startswith("notice_")}},
}, sys.stdout, indent=1, sort_keys=True)
sys.stdout.write("\n")

#!/usr/bin/env python3
# Plays the S16 parity cases (#487; test/helpers/s16.js) on the Python paste wrapper and prints its
# answers as JSON. Run by test/clipboard/paste-wrapper-golden.test.js: once to record
# test/golden/S16/answers.json while the original existed, and by the live arm on the base revision's
# copy. Reads and writes only the throwaway directory it is given.
#   s16-record.py <dir holding paste_wrapper.py and clipboard_guard.py> <cases.json> <throwaway dir>
import json
import os
import sys

src, cases_file, work = sys.argv[1], sys.argv[2], sys.argv[3]
sys.path.insert(0, src)
import clipboard_guard as g  # noqa: E402
import paste_wrapper as w  # noqa: E402

with open(cases_file, encoding="utf-8") as fh:
    cases = json.load(fh)
SALT = cases["salt"]
TERM = cases["term"]


def conf_file(name, over):
    d = os.path.join(work, name)
    os.makedirs(os.path.join(d, "lo"), exist_ok=True)
    lines = ["salt_store=file", "terms_file=%s" % os.path.join(d, "lo", "terms"),
             "salt_file=%s" % os.path.join(d, "lo", "salt"),
             "health_terms_file=%s" % os.path.join(d, "lo", "terms-health"),
             "colleague_terms_file=%s" % os.path.join(d, "lo", "terms-colleague")]
    for k, v in over.items():
        if v == "CATEGORIES-EXCEPT-phone":
            v = ",".join(c for c in g.CATEGORY_ORDER if c != "phone")
        lines.append("%s=%s" % (k, v))
    p = os.path.join(d, "clipboard.conf")
    with open(p, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(lines) + "\n")
    return p


def boom(_):
    raise ValueError("synthetic")


def filter_case(i, c):
    conf = g.load_config(conf_file("f%d" % i, c.get("conf", {})))
    terms, salt = frozenset(), None
    if c.get("cleaner") == "term":
        terms, salt = frozenset(g.term_hash(SALT, f) for f in g.term_forms(TERM)), SALT
    clean = w.make_cleaner(conf, terms, salt)
    clock = [0.0]
    f = w.PasteFilter(boom if c.get("cleaner") == "boom" else clean, c["max_bytes"],
                      {"too_large": "[TOO LARGE]", "error": "[ERR {error}]"}, clock=lambda: clock[0])
    out = []
    for op in c["ops"]:
        if op[0] == "feed":
            out.append(f.feed(bytes.fromhex(op[1])).hex())
        elif op[0] == "advance":
            clock[0] += op[1]
        else:
            out.append(f.flush().hex())
    return {"name": c["name"], "out": out, "cleaned": f.cleaned, "replaced": f.replaced,
            "categories": [x for x in g.CATEGORY_ORDER if x in f.categories], "in_paste": f.in_paste,
            "reported_pastes": clean.reported_pastes, "reported": sorted(clean.reported)}


def notice_case(i, c):
    conf = g.load_config(conf_file("n%d" % i, c.get("conf", {})))
    return w.notice(conf, c["key"], **c["values"])


def arg_case(i, c):
    conf = g.load_config(conf_file("a%d" % i, {}))
    clean = boom if c.get("boom") else w.make_cleaner(conf, frozenset(), None)
    marked, cats = w.args_allow_marker(clean, [bytes.fromhex(a).decode("utf-8") for a in c["args"]], c["no_salt"])
    return [marked, cats]


answers = {
    "filter": [filter_case(i, c) for i, c in enumerate(cases["filter"])],
    "notice": [notice_case(i, c) for i, c in enumerate(cases["notice"])],
    "args": [arg_case(i, c) for i, c in enumerate(cases["args"])],
    "constants": {"HOLD_SECONDS": w.HOLD_SECONDS, "HOLD_SEQUENCE_SECONDS": w.HOLD_SEQUENCE_SECONDS,
                  "PASTE_IDLE_SECONDS": w.PASTE_IDLE_SECONDS, "GRACE_SECONDS": w.GRACE_SECONDS,
                  "EXIT_DRAIN_SECONDS": w.EXIT_DRAIN_SECONDS, "WRAPPER_MARKER": g.WRAPPER_MARKER,
                  "WRAPPER_MARKER_VALUE": g.WRAPPER_MARKER_VALUE, "KIRO_HOOK_FILE": g.KIRO_HOOK_FILE,
                  "notices": {k: v for k, v in g.DEFAULTS.items()
                              if k.startswith("notice_") and k in cases["wrapper_notice_keys"]}},
}
sys.stdout.write(json.dumps(answers, indent=1, sort_keys=True) + "\n")

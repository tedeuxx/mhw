#!/usr/bin/env python3
# S15 recorder (#486, convention 3 of #470). TEST CODE ONLY. It asks the Python original
# (global/clipboard/clipboard_guard.py, which stays in this slice) the questions src/lib/clean.js must
# answer the same way, and prints the answers as JSON on stdout. It reads no term list, no salt store and
# no configuration: the term lists it hashes come from its input, with the input's own synthetic salt.
#
#   s15-record.py unicode  CLIPBOARD_DIR          the character sets and mappings clean.js pins
#   s15-record.py corpus   CLIPBOARD_DIR < cases  find_spans() and sanitise() per case
#
# CLIPBOARD_DIR is the directory holding clipboard_guard.py. Standard library only.
import hashlib
import json
import re
import sys
import unicodedata

MAX = 0x110000
SURROGATES = range(0xD800, 0xE000)


def ranges(pred):
    """[start, end, start, end, ...] (inclusive) of the code points pred accepts; surrogates excluded."""
    out, start = [], None
    for cp in range(MAX):
        ok = cp not in SURROGATES and pred(chr(cp))
        if ok and start is None:
            start = cp
        elif not ok and start is not None:
            out += [start, cp - 1]
            start = None
    if start is not None:
        out += [start, MAX - 1]
    return out


def unicode_tables():
    word = re.compile(r"\w")
    digit = re.compile(r"\d")
    space = re.compile(r"\s")
    casefold = {}
    nfkd = hashlib.sha256()
    for cp in range(MAX):
        if cp in SURROGATES:
            continue
        ch = chr(cp)
        folded = ch.casefold()
        if folded != ch:
            casefold[cp] = [ord(c) for c in folded]
        if unicodedata.category(ch)[0] in "LNM":       # the only characters tokens() normalises
            nfkd.update(("%x:%s\n" % (cp, unicodedata.normalize("NFKD", ch))).encode("utf-8"))
    # The characters inside the patterns' ignore-case groups: every Latin letter of ASCII and Latin-1.
    letters = [chr(c) for c in list(range(0x41, 0x5B)) + list(range(0x61, 0x7B)) + list(range(0xC0, 0x100))
               if chr(c).isalpha()]
    ignore_case = {}
    for ch in letters:
        rx = re.compile("(?i)" + re.escape(ch))
        ignore_case[ch] = [cp for cp in range(MAX) if cp not in SURROGATES and rx.fullmatch(chr(cp))]
    return {
        "cpython": "%d.%d.%d" % sys.version_info[:3],
        "unidata": unicodedata.unidata_version,
        "word": ranges(lambda c: word.fullmatch(c) is not None),
        "digit": ranges(lambda c: digit.fullmatch(c) is not None),
        "space": ranges(lambda c: space.fullmatch(c) is not None),
        # str.isdigit(), which load_config() uses to accept max_bytes and show_cleaned_chars before int()
        "isdigit": ranges(lambda c: c.isdigit()),
        "letterOrNumber": ranges(lambda c: unicodedata.category(c)[0] in "LN"),
        "mark": ranges(lambda c: unicodedata.category(c)[0] == "M"),
        "casefold": casefold,
        "nfkdWordSha256": nfkd.hexdigest(),
        "ignoreCase": ignore_case,
    }


def corpus(core, cases):
    """Each case: {name, text, salt?, terms?: {employer?, health?, colleague?}}. The answer per case: the
    spans in find_spans' own order as [category, start, length] in code points, and sanitise()'s text."""
    out = []
    for case in cases:
        text, salt = case["text"], case.get("salt")
        terms = case.get("terms") or {}

        def hashes(words):
            return frozenset(core.term_hash(salt, f) for w in words or [] for f in core.term_forms(w))
        employer = hashes(terms.get("employer")) if salt else frozenset()
        lists = {"health": hashes(terms.get("health")), "colleague-name": hashes(terms.get("colleague"))} if salt else {}
        spans = core.find_spans(text, employer, salt, lists)
        out.append({"name": case["name"], "text_sha256": hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest(),
                    "spans": [[c, s, e - s] for s, e, c in spans], "sanitised": core.sanitise(text, spans),
                    "categories": core.categories(spans), "tokens": [[s, e, n] for s, e, n in core.tokens(text)]})
    return out


def main(argv):
    mode, clip = argv[1], argv[2]
    sys.path.insert(0, clip)
    import clipboard_guard as core  # noqa: E402
    if mode == "unicode":
        result = unicode_tables()
    elif mode == "corpus":
        result = {"cpython": "%d.%d.%d" % sys.version_info[:3], "cases": corpus(core, json.load(sys.stdin))}
    else:
        raise SystemExit("unknown mode")
    sys.stdout.write(json.dumps(result, ensure_ascii=True, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

#!/usr/bin/env python3
"""The S23 prose corpus (#494, S23 of #470), answered by a base revision's global/merge_authority.py.

    python3 -I -B test/helpers/s23-prose.py <base global dir> <inputs.json>

inputs.json: {"contract": <text of a merge-authority SKILL.md>, "texts": [<text>, ...]}. Prints one JSON
document on stdout: for each text, the sha256 of live_prose(text) and of flatten(live_prose(text)), the
legacy findings, the declaration blocks (each block's lines, or null), check_declaration on each closed
block, and method_copy_findings with every verdict of the contract. Test tooling only; synthetic texts.
"""
import hashlib
import json
import sys

sys.path.insert(0, sys.argv[1])
import merge_authority as ma  # noqa: E402


def sha(s):
    return hashlib.sha256(s.encode("utf-8", "surrogatepass")).hexdigest()


def answer(text, contract):
    live = ma.live_prose(text)
    blocks = ma.declaration_blocks(text)
    decls = []
    for b in blocks:
        if b is None:
            decls.append(None)
            continue
        findings, unsupported, model, branch = ma.check_declaration(b, contract)
        decls.append({"findings": findings, "unsupported": list(unsupported) if unsupported else None,
                      "model": model, "branch": branch})
    return {"live": sha(live), "flat": sha(ma.flatten(live)), "legacy": ma.legacy_findings(text),
            "blocks": blocks, "declarations": decls,
            "copy": ma.method_copy_findings(text, contract, contract["verdicts"])}


def main():
    with open(sys.argv[2], encoding="utf-8") as fh:
        doc = json.load(fh)
    contract = ma.parse_contract(doc["contract"], "corpus")
    out = {"projection": sha(ma.projection(contract)), "answers": [answer(t, contract) for t in doc["texts"]]}
    sys.stdout.write(json.dumps(out, ensure_ascii=True, sort_keys=True))


if __name__ == "__main__":
    main()

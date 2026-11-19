"""Tests only (#476): what CPython answers for each input of src/lib/py.js's cases, as JSON.

    python3 -B test/helpers/py-probe.py <kind> <in.json> <out.json>

kind: json (json.loads, then the worklog's canonical dumps or the error text), iso (datetime.fromisoformat:
the instant in microseconds from 0001-01-01 and whether it carries an offset, or an error), float (repr of
the double given as its 16 hex digits, in two words of 8), round (round(x, 6) of the same), sum (sum() of a list of floats
and ints given as hex doubles or ints). Reads only its two argument files, writes only the second.
"""

import json
import struct
import sys
from datetime import datetime, timezone

kind, src, dst = sys.argv[1:4]
cases = json.load(open(src, encoding="utf-8"))


def double(h):
    return struct.unpack(">d", bytes.fromhex(h.replace(":", "")))[0]


def answer(case):
    if kind == "json":
        try:
            return ["OK", json.dumps(json.loads(case), sort_keys=True, separators=(",", ":"), ensure_ascii=False)]
        except json.JSONDecodeError as e:
            return ["ERR", str(e)]
        except Exception as e:  # noqa: BLE001 - the class is the answer
            return ["EXC", type(e).__name__]
    if kind == "iso":
        try:
            d = datetime.fromisoformat(case)
        except Exception as e:  # noqa: BLE001
            return ["ERR", type(e).__name__]
        aware = d.tzinfo is not None
        naive = d.astimezone(timezone.utc).replace(tzinfo=None) if aware else d
        delta = naive - datetime(1, 1, 1)
        return ["OK", str((delta.days + 1) * 86400000000 + delta.seconds * 1000000 + delta.microseconds), aware]
    if kind == "float":
        return repr(double(case))
    if kind == "round":
        return repr(round(double(case), 6))
    if kind == "sum":
        return repr(sum(double(v) if isinstance(v, str) else v for v in case))
    raise SystemExit("unknown kind " + kind)


json.dump([answer(c) for c in cases], open(dst, "w", encoding="utf-8"), ensure_ascii=False)

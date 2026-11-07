#!/usr/bin/env python3
"""The fail-closed validator of the project-policy contract (ADR-0015 lock 3 of 5, Issue #245).

    mhw policy check [--project=DIR | --file=PATH]
    python3 -B global/project-policy/project_policy.py check [--project=DIR | --file=PATH]

It reads one project's contract file, `project-policy.json` at the root of DIR (default: the current
directory), or the file PATH names, and checks it against project-policy.schema.json (Issue #244). It
exits 0 only when the file is valid. Every other outcome is non-zero, with one line per reason:

    exit 1  the file is missing, unreadable, not JSON, not an object, declares an unknown or no
            schema_version, or breaks the contract (each finding names the #192 class it falls in)
    exit 2  a usage error, or the validator cannot run (its own schema is unreadable, or carries a
            keyword this evaluator does not implement): it cannot say the file is valid, so it does not

It checks the contract only. It reads no evidence: whether the named controls ran, the MADR is really
accepted or the runbook was really tested is #246's reference CI/CD, which calls this command.
Standard library only, Python 3.9+, any operating system.
"""
import datetime
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
SCHEMA = HERE / "project-policy.schema.json"
FILE_NAME = "project-policy.json"
KNOWN_VERSIONS = (1,)
SEVERITIES = ("low", "medium", "high", "critical")

ANNOTATIONS = {"$schema", "title", "description", "$comment"}
KEYWORDS = ANNOTATIONS | {
    "type", "const", "enum", "required", "properties", "additionalProperties", "items", "minItems",
    "maxItems", "uniqueItems", "contains", "allOf", "if", "then", "minimum", "maximum",
    "exclusiveMinimum", "minLength", "pattern",
}
TYPES = {
    "object": lambda v: isinstance(v, dict),
    "array": lambda v: isinstance(v, list),
    "string": lambda v: isinstance(v, str),
    "boolean": lambda v: isinstance(v, bool),
    "integer": lambda v: isinstance(v, int) and not isinstance(v, bool),
    "number": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
}


class SchemaError(ValueError):
    """The schema uses something this evaluator does not implement: the validator cannot decide."""


def same(a, b):
    """JSON equality: true is not 1."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    return a == b


def evaluate(value, schema, path="$"):
    """Errors, as (path, keyword) pairs, of value against the subset of draft 2020-12 used here."""
    unknown = set(schema) - KEYWORDS
    if unknown:
        raise SchemaError("%s: schema keyword not implemented: %s" % (path, sorted(unknown)))
    errors = []
    kind = schema.get("type")
    if kind is not None and not TYPES[kind](value):
        return [(path, "type")]
    if "const" in schema and not same(value, schema["const"]):
        errors.append((path, "const"))
    if "enum" in schema and not any(same(value, option) for option in schema["enum"]):
        errors.append((path, "enum"))
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for key in schema.get("required", []):
            if key not in value:
                errors.append((path + "." + key, "required"))
        if schema.get("additionalProperties", True) is False:
            for key in value:
                if key not in properties:
                    errors.append((path + "." + key, "additionalProperties"))
        elif "additionalProperties" in schema and schema["additionalProperties"] is not True:
            raise SchemaError("%s: only additionalProperties false is implemented" % path)
        for key, sub in properties.items():
            if key in value:
                errors.extend(evaluate(value[key], sub, path + "." + key))
    if isinstance(value, list):
        if len(value) < schema.get("minItems", 0):
            errors.append((path, "minItems"))
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append((path, "maxItems"))
        if schema.get("uniqueItems") and any(
                any(same(item, earlier) for earlier in value[:i]) for i, item in enumerate(value)):
            errors.append((path, "uniqueItems"))
        if "items" in schema:
            for i, item in enumerate(value):
                errors.extend(evaluate(item, schema["items"], "%s[%d]" % (path, i)))
        if "contains" in schema and not any(not evaluate(item, schema["contains"], path) for item in value):
            errors.append((path, "contains"))
    if TYPES["number"](value):
        if "minimum" in schema and value < schema["minimum"]:
            errors.append((path, "minimum"))
        if "maximum" in schema and value > schema["maximum"]:
            errors.append((path, "maximum"))
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            errors.append((path, "exclusiveMinimum"))
    if "pattern" in schema and not (schema["pattern"].startswith("^") and schema["pattern"].endswith("$")):
        raise SchemaError("%s: only patterns anchored with ^ and $ are implemented" % path)
    if isinstance(value, str):
        if len(value) < schema.get("minLength", 0):
            errors.append((path, "minLength"))
        # fullmatch, never search: under Python re a final $ also matches before a trailing newline,
        # where ECMA-262 (the dialect of JSON Schema) does not. On an anchored pattern, fullmatch
        # gives the ECMA answer.
        if "pattern" in schema and not re.fullmatch(schema["pattern"], value):
            errors.append((path, "pattern"))
    for sub in schema.get("allOf", []):
        errors.extend(evaluate(value, sub, path))
    if "if" in schema:
        if not evaluate(value, schema["if"], path):
            errors.extend(evaluate(value, schema.get("then", {}), path))
    elif "then" in schema:
        raise SchemaError("%s: then without if" % path)
    return errors


# -- reading the file, failing closed ---------------------------------------------------------------

class Refusal(Exception):
    """The file cannot be read as a contract at all."""


def _no_duplicates(pairs):
    keys = [k for k, _ in pairs]
    dup = sorted({k for k in keys if keys.count(k) > 1})
    if dup:
        # Python keeps the last value of a repeated key; a reader in another language may keep the
        # first. One file must not mean two things, so a repeated key is refused.
        raise Refusal("repeated key %s" % ", ".join(json.dumps(k) for k in dup))
    return dict(pairs)


def _no_constant(name):
    # NaN compares false with every bound, so threshold_percent NaN would pass every range check.
    raise Refusal("%s is not JSON" % name)


def read(path):
    """The parsed file, or Refusal with the reason."""
    try:
        raw = Path(path).read_bytes()
    except FileNotFoundError:
        raise Refusal("missing: no file at %s" % path)
    except IsADirectoryError:
        raise Refusal("missing: %s is a directory, not a file" % path)
    except OSError as exc:
        raise Refusal("unreadable: %s" % exc.strerror)
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise Refusal("malformed: not UTF-8")
    try:
        return json.loads(text, object_pairs_hook=_no_duplicates, parse_constant=_no_constant)
    except Refusal as exc:
        raise Refusal("malformed: %s" % exc)
    except (ValueError, RecursionError) as exc:
        raise Refusal("malformed: not JSON (%s)" % getattr(exc, "msg", type(exc).__name__))


# -- the #192 classes ------------------------------------------------------------------------------

def classify(path, keyword, doc):
    """The failure class #192 (and #245) names that an error at path falls in."""
    if path == "$.schema_version":
        return "unknown version"
    if path.startswith("$.risk_classification"):
        return "missing or invalid risk classification"
    if path.startswith("$.approval"):
        return "risk-based approval weakened"
    if path.startswith("$.mandatory_scenarios") or path.startswith("$.coverage"):
        return "missing mandatory evidence"
    if path.startswith("$.madr"):
        return "project MADR not ratified"
    if path == "$.severity.inconclusive":
        return "inconclusive evidence does not block"
    if path.startswith("$.severity.tolerated"):
        value = _at(doc, path)
        if isinstance(value, str) and value in SEVERITIES[1:]:
            return "medium-or-higher findings tolerated"
        if keyword == "maxItems" and isinstance(value, list) and any(
                isinstance(v, str) and v in SEVERITIES[1:] for v in value):
            return "medium-or-higher findings tolerated"
        return "unknown severity"
    if path.startswith("$.severity"):
        return "unknown severity"
    if path.startswith("$.low_findings"):
        return "low finding without a bug Issue"
    if path.startswith("$.recovery"):
        return "recovery not prepared"
    return "contract invalid"


def _at(doc, path):
    """The value at a "$.a.b[0]" path, or None."""
    value = doc
    for name, index in re.findall(r"\.([A-Za-z0-9_$-]+)|\[(\d+)\]", path[1:]):
        try:
            value = value[name] if name else value[int(index)]
        except (KeyError, IndexError, TypeError):
            return None
    return value


def semantic_errors(doc, today):
    """What the schema's pattern cannot say: last_tested is a real date, and not a future one."""
    errors = []
    runbook = doc.get("recovery", {}).get("runbook") if isinstance(doc.get("recovery"), dict) else None
    tested = runbook.get("last_tested") if isinstance(runbook, dict) else None
    if isinstance(tested, str) and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", tested):
        try:
            day = datetime.date.fromisoformat(tested)
        except ValueError:
            errors.append(("$.recovery.runbook.last_tested", "date"))
        else:
            # One day of slack: a runbook tested today in a time zone ahead of this clock.
            if day > today + datetime.timedelta(days=1):
                errors.append(("$.recovery.runbook.last_tested", "future"))
    return errors


def check(path, schema_path=SCHEMA, today=None):
    """(code, lines): 0 and one OK line only when the file is a valid contract."""
    try:
        schema = json.loads(Path(schema_path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        return 2, ["ERROR  cannot read the contract schema: %s" % exc]
    try:
        doc = read(path)
    except Refusal as exc:
        return 1, ["FAIL  %s" % exc]
    if not isinstance(doc, dict):
        return 1, ["FAIL  malformed: the contract is a JSON object, this file is not"]
    version = doc.get("schema_version")
    if "schema_version" not in doc:
        return 1, ["FAIL  unknown version: no schema_version"]
    if isinstance(version, bool) or version not in KNOWN_VERSIONS:
        return 1, ["FAIL  unknown version: schema_version %s; this validator knows %s"
                   % (json.dumps(version), ", ".join(str(v) for v in KNOWN_VERSIONS))]
    try:
        errors = evaluate(doc, schema)
    except SchemaError as exc:
        return 2, ["ERROR  the validator cannot evaluate its schema: %s" % exc]
    errors += semantic_errors(doc, today or datetime.date.today())
    if not errors:
        return 0, ["OK  %s is a valid project-policy contract, schema_version %d" % (path, version)]
    lines = ["FAIL  %s: %s (%s)" % (where, keyword, classify(where, keyword, doc))
             for where, keyword in sorted(set(errors))]
    return 1, lines + ["FAIL  %d finding(s); the contract is not valid" % len(lines)]


def main(argv):
    args = list(argv)
    if args and args[0] == "check":
        args = args[1:]
    project, file_ = None, None
    for arg in args:
        if arg.startswith("--project=") and arg != "--project=":
            project = arg[len("--project="):]
        elif arg.startswith("--file=") and arg != "--file=":
            file_ = arg[len("--file="):]
        else:
            print("mhw policy check: unknown argument %s (--project=DIR or --file=PATH)" % arg,
                  file=sys.stderr)
            return 2
    if project is not None and file_ is not None:
        print("mhw policy check: --project and --file exclude each other", file=sys.stderr)
        return 2
    target = file_ if file_ is not None else str(Path(project or ".") / FILE_NAME)
    code, lines = check(target)
    for line in lines:
        print(line, file=sys.stdout if code == 0 else sys.stderr)
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))

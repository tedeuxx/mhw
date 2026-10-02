#!/usr/bin/env python3
"""Validate a preference profile and compile an overlay. Never install into a harness.

    profile.py validate --source overlay/profile.json
    profile.py plan --source overlay/profile.json
    profile.py render --source overlay/profile.json --output overlay
    profile.py check --source overlay/profile.json --output overlay

Python 3.9+, standard library only. Exit 0: success; 1: generated output drift;
2: invalid input/usage; 3: I/O error or unmanaged/symlink conflict. Errors never echo
profile values or unrecognized keys. This is a closed preference vocabulary, not a
general-purpose JSON Schema validator or a confidential-content classifier.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
MANAGED = "personal-multi-harness-workstation-configuration/profile-v1"
MAX_BYTES = 65536
LANGUAGES = {"en": "English", "pt-BR": "Brazilian Portuguese"}
TONES = {
    "concise": "Keep decision requests concise and state the practical consequence.",
    "executive-concise": "Use an executive, concise tone: decision needed, impact and options, with minimal explanation.",
    "conversational": "Use a natural, approachable tone, with a brief recommendation and the consequence of each option.",
    "didactic": "Give brief explanatory context to make the decision and its consequences understandable.",
}
PRIORITIES = {
    "unselected": "Model and reasoning-effort priority has not been selected.",
    "balanced": "Balance good quality, moderate latency and restrained use of the subscription allowance.",
    "quality": "Prioritize capability and depth, accepting higher latency and subscription usage.",
    "speed": "Prioritize lower latency and subscription usage; reassess when the task requires more depth.",
}


class Refuse(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Parser(argparse.ArgumentParser):
    def error(self, message):
        raise Refuse(2, "invalid arguments; use --help")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate field")
        result[key] = value
    return result


def reject_constant(value):
    raise ValueError("non-JSON number")


def validate(value, schema, location="profile"):
    """The closed schema's types, enums, constants, objects, arrays and integer bounds."""
    types = {"object": dict, "array": list, "string": str, "integer": int}
    kind = schema["type"]
    if type(value) is not types[kind]:
        return [location + ": wrong type"]
    errors = []
    if "const" in schema and value != schema["const"]:
        errors.append(location + ": unsupported version")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(location + ": unsupported choice")
    if kind == "object":
        properties = schema["properties"]
        if set(value) - set(properties):
            errors.append(location + ": unrecognized field (name and value omitted)")
        for key in schema["required"]:
            if key not in value:
                errors.append(location + "." + key + ": required")
        for key, sub_schema in properties.items():
            if key in value:
                errors.extend(validate(value[key], sub_schema, location + "." + key))
    elif kind == "array":
        if len(value) < schema.get("minItems", 0):
            errors.append(location + ": empty selection")
        # No hashing: malformed array items may be objects or arrays.
        if schema.get("uniqueItems") and any(item in value[:i] for i, item in enumerate(value)):
            errors.append(location + ": duplicate selection")
        for i, item in enumerate(value):
            errors.extend(validate(item, schema["items"], location + "[" + str(i) + "]"))
    elif kind == "integer":
        if value < schema.get("minimum", value) or value > schema.get("maximum", value):
            errors.append(location + ": out of range")
    return errors


def load_profile(source):
    try:
        with Path(source).open("rb") as stream:
            raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            raise Refuse(2, "profile exceeds the size limit; contents omitted")
        profile = json.loads(raw.decode("utf-8"), object_pairs_hook=unique_object,
                             parse_constant=reject_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise Refuse(2, "invalid profile JSON; contents omitted") from None
    except OSError:
        raise Refuse(3, "cannot read profile; contents omitted") from None
    schema = json.loads((HERE / "profile.schema.json").read_text(encoding="utf-8"))
    errors = validate(profile, schema)
    if errors:
        raise Refuse(2, "\n".join(errors))
    return profile


def plan(profile):
    routes = {
        "claude-code": "Existing installer: user CLAUDE.md; hooks remain subject to native support.",
        "codex": "Existing installer: user AGENTS.md; hook trust is a separate owner action.",
        "kiro-cli": "Existing installer: global steering; custom-agent resource loading must be verified.",
        "claude-desktop": "Prepared instructions for account settings; no account write or automatic sync.",
    }
    return {
        "managed_by": MANAGED,
        "profile_version": profile["version"],
        "priority": profile["session_start"]["priority"],
        "surfaces": [{"surface": name, "instruction_route": routes[name],
                      "runtime_verification": "not-performed"} for name in profile["surfaces"]],
        "limits": {
            "surface_selection": "describes intended targets; existing installers still target all supported CLIs",
            "native_model_and_effort": "not-written; concrete model/effort mappings remain pending",
            "financial_authorization": "not-granted",
            "mcp_and_pre_authorizations": "not-imported-or-synchronized",
            "slash_commands": "preference-only; native command installation remains pending",
        },
    }


def compile_profile(profile):
    conversation = profile["conversation"]
    interaction = profile["interaction"]
    locale = conversation["language"]
    digest = hashlib.sha256(json.dumps(profile, sort_keys=True).encode()).hexdigest()
    marker = "managed-by: " + MANAGED + "; source-sha256: " + digest + "; generated; do not edit"
    limit = interaction["max_question_chars"]
    length = ("a question stem is at most %d characters." % limit if limit else
              "no numeric question-length limit is configured; keep each interruption concise.")
    command = ("Prefer native slash commands when available; explain the actual invocation on this harness."
               if interaction["command_preference"] == "slash" else
               "Accept ordinary language for directing work; explain command syntax only when useful.")
    body = "\n".join([
        "## Owner overlay (generated personal profile)", "",
        "- **Language:** talk to the owner in " + LANGUAGES[locale] + ". Anything published is in "
        + LANGUAGES[conversation["publication_language"]] + ".",
        "- **Decision tone:** " + TONES[conversation["decision_tone"]],
        "- **Escalation limits:** one ask per activation; " + length,
        "- **Commands:** " + command,
        "- **Session-start preference:** " + PRIORITIES[profile["session_start"]["priority"]],
        "- **Evidence:** this preference does not configure a native model or effort value. Report the effective settings only when verified.",
        "- **Authorization:** this profile grants no new tool permissions, paid API use, purchases or publication rights.",
        "",
    ])
    hitl = "# " + marker + "\nmax_question_chars=" + str(limit) + "\n"
    if locale == "pt-BR":
        hitl += (
            "notice_count=Guarda HITL (ADR-0013) recusou um seletor antes de exibir: {count} perguntas, limite {max} (uma pergunta por ativação). Mitigação: o agente refaz só a primeira pergunta.\n"
            "notice_length=Guarda HITL (ADR-0013) recusou um seletor antes de exibir: uma pergunta de {chars} caracteres, limite {max}. Mitigação: o agente refaz a pergunta mais curta.\n"
        )
        notices = (HERE / "locales" / "pt-BR" / "clipboard.conf").read_text(encoding="utf-8")
    else:
        notices = "# No notice overrides: use the components' built-in English messages.\n"
    # A desktop handoff includes the floor, not merely the personal preferences.
    floor = (ROOT / "global" / "AGENTS.md").read_text(encoding="utf-8")
    return {
        "AGENTS.md": "<!-- " + marker + " -->\n\n" + body,
        "hitl.conf": hitl,
        "clipboard.conf": "# " + marker + "\n" + notices,
        "desktop-instructions.md": "<!-- " + marker + " -->\n\n" + floor.rstrip() + "\n\n" + body,
        "profile-plan.json": json.dumps(plan(profile), ensure_ascii=False, indent=2) + "\n",
    }


def is_managed(name, content):
    if name == "profile-plan.json":
        try:
            parsed = json.loads(content)
        except (ValueError, RecursionError):
            return False
        return isinstance(parsed, dict) and parsed.get("managed_by") == MANAGED
    prefix = "<!-- managed-by: " if name.endswith(".md") else "# managed-by: "
    return content.startswith(prefix + MANAGED + ";")


def write_or_check(output, compiled, check=False):
    output = Path(output)
    if output.is_symlink() or (output.exists() and not output.is_dir()):
        raise Refuse(3, "output must be a real directory, not a symlink or file")
    changed = []
    # Preflight every target before writing any file. Unrelated files are untouched.
    for name, desired in compiled.items():
        path = output / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise Refuse(3, "output contains a symlink or non-file target; nothing written")
        current = path.read_text(encoding="utf-8") if path.exists() else None
        if current is not None and not is_managed(name, current):
            raise Refuse(3, "output contains an unmanaged target; nothing written")
        if current != desired:
            changed.append(name)
    if check:
        return changed
    output.mkdir(parents=True, exist_ok=True)
    for name in changed:
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", newline="\n",
                                             dir=output, delete=False) as stream:
                temp_path = Path(stream.name)
                stream.write(compiled[name])
            os.replace(temp_path, output / name)
        finally:
            if temp_path is not None and temp_path.exists():
                temp_path.unlink()
    return changed


def main(argv=None):
    if sys.version_info < (3, 9):
        print("REFUSE: Python 3.9 or later is required", file=sys.stderr)
        return 2
    parser = Parser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=("validate", "plan", "render", "check"))
    parser.add_argument("--source", required=True)
    parser.add_argument("--output")
    try:
        args = parser.parse_args(argv)
        needs_output = args.command in ("render", "check")
        if needs_output != (args.output is not None):
            raise Refuse(2, "--output is required only for render and check")
        profile = load_profile(args.source)
        if args.command == "validate":
            print("OK: valid preference profile; no installation or permission grant")
        elif args.command == "plan":
            print(json.dumps(plan(profile), ensure_ascii=False, indent=2))
        else:
            changed = write_or_check(args.output, compile_profile(profile), args.command == "check")
            if args.command == "check" and changed:
                print("DRIFT: " + ", ".join(changed))
                return 1
            print("OK: " + ("generated overlay is current" if args.command == "check" else
                            str(len(changed)) + " generated files updated; no harness installation"))
    except Refuse as error:
        print("REFUSE: " + str(error), file=sys.stderr)
        return error.code
    except (OSError, UnicodeError):
        print("REFUSE: cannot read or write profile artifacts; contents omitted", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())

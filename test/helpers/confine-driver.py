"""Tests only (#475): run method/scripts/confine.py's confined() on one path, in the caller's working
directory and environment, and print the outcome as JSON: {"real": ...} or {"refused": message}."""

import json
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, sys.argv[1])
from confine import confined  # noqa: E402

try:
    print(json.dumps({"real": confined(sys.argv[2])}))
except ValueError as error:
    print(json.dumps({"refused": str(error)}))

"""Tests only (#480, S09): run the base revision's global/chrome_debugging.py as the Node command is run
in process, so their transcripts compare on every OS.

    python3 -B test/helpers/chrome-debugging-probe.py <script> <system> <running> main <arg>...
    python3 -B test/helpers/chrome-debugging-probe.py <script> <system> <running> status

<system> replaces platform.system()'s answer (Darwin, Linux, Windows) in this process only; <running> is
1 or 0, the answer of "is Chrome running" (pgrep is not run), or - to run pgrep as the original does. The
home is $HOME, which the caller sets to a throwaway directory. Nothing else is changed.
"""

import importlib.util
import sys

script, system, running, op = sys.argv[1:5]
spec = importlib.util.spec_from_file_location("chrome_debugging", script)
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)
cd.platform.system = lambda: system
if running != "-":
    answer = running == "1"
    cd.chrome_running = lambda _system=None: answer
if op == "status":
    print(cd.status_text())
    sys.exit(0)
sys.exit(cd.main(sys.argv[5:]))

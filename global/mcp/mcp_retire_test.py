#!/usr/bin/env python3
"""Tests for mcp_retire.py: the retired MCP servers leave the Codex user configuration, in throwaway
HOMEs only (Issue #145, ADR-0035 decision 2).

    mcp_retire_test.py [base directory]   (default: a fresh directory under $TMPDIR)
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE / "mcp_retire.py"
BASE = Path(sys.argv.pop(1)) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="mcp-retire-test."))
BEGIN = ("# >>> managed-by: personal-multi-harness-workstation-configuration (mcp servers); generated, do not "
         "edit inside this block: re-run global/mcp/mcp_render.py")
END = "# <<< managed-by: personal-multi-harness-workstation-configuration (mcp servers)"
# A synthetic value that looks like a credential, assembled at run time, to prove nothing is printed.
SECRET = "synthetic-" + "value-" + "4242"
OWNER = ('model = "gpt-5.6-sol"\n'
         '\n'
         '[mcp_servers.keep-me]\n'
         'command = "keep"\n'
         'args = []\n'
         '\n'
         '[mcp_servers.aws-api]\n'
         'command = "uvx"\n'
         'args = ["awslabs.aws-api-mcp-server@latest"]\n'
         '\n'
         '[mcp_servers.aws-api.env]\n'
         'AWS_REGION = "%s"\n'
         '\n'
         '# the profile below is mine\n'
         '[profiles.x]\n'
         'model = "other"\n' % SECRET)
WITHOUT = ('model = "gpt-5.6-sol"\n'
           '\n'
           '[mcp_servers.keep-me]\n'
           'command = "keep"\n'
           'args = []\n'
           '\n'
           '# the profile below is mine\n'
           '[profiles.x]\n'
           'model = "other"\n')


@unittest.skipUnless(sys.version_info >= (3, 11), "the edit is verified with tomllib (Python 3.11+)")
class Retire(unittest.TestCase):
    n = 0

    def setUp(self):
        Retire.n += 1
        self.home = BASE / ("home-%d" % Retire.n)
        (self.home / ".codex").mkdir(parents=True)
        self.path = self.home / ".codex" / "config.toml"

    def run_mode(self, mode):
        # The script reads HOME and CODEX_HOME only (no path argument): HOME is the throwaway one.
        env = {k: v for k, v in os.environ.items() if k != "CODEX_HOME"}
        env["HOME"] = str(self.home)
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=" + mode],
                           capture_output=True, text=True, env=env)
        return p.returncode, p.stdout + p.stderr

    def test_check_dry_run_install_then_settles(self):
        self.path.write_text(OWNER, encoding="utf-8")
        os.chmod(self.path, 0o600)
        code, out = self.run_mode("check")
        self.assertEqual(code, 1, out)
        self.assertIn("DRIFT   %s: install would change mcp_servers.aws-api present -> absent" % self.path, out)
        code, out = self.run_mode("dry-run")
        self.assertEqual(code, 0, out)
        self.assertIn("WOULD CHANGE", out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), OWNER)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("CHANGED %s: mcp_servers.aws-api present -> absent" % self.path, out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), WITHOUT)
        backup = Path(str(self.path) + ".pmhwc-mcp-backup")
        self.assertEqual(backup.read_text(encoding="utf-8"), OWNER)
        self.assertEqual(os.stat(self.path).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(backup).st_mode & 0o777, 0o600)
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertNotIn("CHANGED", out)
        self.assertEqual(self.run_mode("check")[0], 0)
        code, out = self.run_mode("uninstall")
        self.assertEqual(code, 0, out)
        self.assertIn("NOTE    %s: the MCP server(s) mhw removed are in %s" % (self.path, backup), out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), WITHOUT)

    def test_never_prints_the_server_contents(self):
        self.path.write_text(OWNER, encoding="utf-8")
        for mode in ("check", "dry-run", "install", "uninstall"):
            out = self.run_mode(mode)[1]
            for leak in (SECRET, "uvx", "awslabs", "AWS_REGION"):
                self.assertNotIn(leak, out, mode)

    def test_quoted_name_and_a_server_left_alone(self):
        text = '[mcp_servers."aws-api"]\ncommand = "x"\n\n[mcp_servers.aws-api-two]\ncommand = "y"\n'
        self.path.write_text(text, encoding="utf-8")
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), '[mcp_servers.aws-api-two]\ncommand = "y"\n')

    def test_no_retired_server_writes_nothing(self):
        self.path.write_text(WITHOUT, encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertFalse(Path(str(self.path) + ".pmhwc-mcp-backup").exists())
        self.assertEqual(self.path.read_text(encoding="utf-8"), WITHOUT)

    def test_absent_file_is_ok(self):
        code, out = self.run_mode("check")
        self.assertEqual(code, 0, out)
        self.assertFalse(self.path.exists())

    def test_an_inline_table_is_refused_not_guessed(self):
        text = 'mcp_servers = { aws-api = { command = "x" } }\n'
        self.path.write_text(text, encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertIn("REFUSE", out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), text)

    def test_invalid_toml_is_refused(self):
        text = '[mcp_servers.aws-api\ncommand = "x"\n'
        self.path.write_text(text, encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 3, out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), text)

    def test_a_server_in_the_managed_block_is_named_not_edited(self):
        text = 'model = "x"\n\n%s\n[mcp_servers.aws-api]\ncommand = "x"\nargs = []\n%s\n' % (BEGIN, END)
        self.path.write_text(text, encoding="utf-8")
        code, out = self.run_mode("install")
        self.assertEqual(code, 0, out)
        self.assertIn("is in the managed block", out)
        self.assertEqual(self.path.read_text(encoding="utf-8"), text)

    def test_a_hand_table_beside_the_managed_block(self):
        block = '%s\n[mcp_servers.mine]\ncommand = "m"\nargs = []\n%s\n' % (BEGIN, END)
        text = '[mcp_servers.aws-api]\ncommand = "x"\n\n' + block
        self.path.write_text(text, encoding="utf-8")
        self.assertEqual(self.run_mode("install")[0], 0)
        self.assertEqual(self.path.read_text(encoding="utf-8"), block)

    def test_codex_home_is_honoured(self):
        other = self.home / "codex-elsewhere"
        other.mkdir()
        (other / "config.toml").write_text(OWNER, encoding="utf-8")
        env = dict(os.environ, CODEX_HOME=str(other), HOME=str(self.home))
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=install"],
                           capture_output=True, text=True, env=env)
        self.assertEqual(p.returncode, 0, p.stdout + p.stderr)
        self.assertEqual((other / "config.toml").read_text(encoding="utf-8"), WITHOUT)

    def test_a_path_argument_is_refused(self):
        # By construction no argument names a file this script writes (SonarCloud S2083 on PR #146).
        p = subprocess.run([sys.executable, "-B", str(SCRIPT), "--mode=install", "--home=/elsewhere"],
                           capture_output=True, text=True, env=dict(os.environ, HOME=str(self.home)))
        self.assertEqual(p.returncode, 2, p.stdout + p.stderr)

    def test_policy_lists_aws_api(self):
        names = [l.strip() for l in (HERE / "retired-servers.conf").read_text(encoding="utf-8").splitlines()
                 if l.strip() and not l.startswith("#")]
        self.assertEqual(names, ["aws-api"])


class WithoutTomllib(unittest.TestCase):
    """Below Python 3.11 nothing can verify the edit: a file naming no retired server is settled, and one
    that names one is refused, never edited blind."""

    def test_fallback(self):
        sys.path.insert(0, str(HERE))
        try:
            import mcp_retire
        finally:
            sys.path.pop(0)
        saved = mcp_retire.tomllib
        mcp_retire.tomllib = None
        try:
            self.assertEqual(mcp_retire.plan(WITHOUT, ["aws-api"]), (WITHOUT, [], []))
            with self.assertRaises(mcp_retire.Refuse):
                mcp_retire.plan(OWNER, ["aws-api"])
        finally:
            mcp_retire.tomllib = saved


if __name__ == "__main__":
    BASE.mkdir(parents=True, exist_ok=True)
    unittest.main(verbosity=1)

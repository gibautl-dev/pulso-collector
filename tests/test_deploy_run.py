import contextlib
import io
import json
import sys
import unittest
from pulso.deploy_run import run_command

class DeployTests(unittest.TestCase):
    def test_exit_code_propagated(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            code=run_command([sys.executable,'-c','raise SystemExit(7)'],5)
        self.assertEqual(code,7)
        self.assertEqual(json.loads(output.getvalue().splitlines()[-1])['exit_code'],7)
    def test_timeout_terminates_child(self):
        output=io.StringIO()
        with contextlib.redirect_stdout(output):
            code=run_command([sys.executable,'-c','import time; time.sleep(30)'],0.05)
        self.assertEqual(code,124)
        self.assertIn('cron_timeout',output.getvalue())

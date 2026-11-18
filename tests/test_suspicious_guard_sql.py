"""El trigger no debe llamar auth.uid() cuando corre pulso_collector."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
APPLY = ROOT / "deploy" / "suspicious_accounts_guard_collector.sql"
ROLLBACK = ROOT / "deploy" / "suspicious_accounts_guard_collector_rollback.sql"
INSTALL = ROOT / "deploy" / "suspicious_accounts.sql"


def _function_body(sql: str) -> str:
    match = re.search(
        r"create or replace function public\.suspicious_accounts_guard_web_update\(\)(.*?)\$\$;",
        sql,
        re.S | re.I,
    )
    if not match:
        raise AssertionError("no encontré la función suspicious_accounts_guard_web_update")
    return match.group(1)


class GuardCollectorSqlTests(unittest.TestCase):
    def test_apply_short_circuits_collector_before_auth_uid(self):
        body = _function_body(APPLY.read_text())
        collector = body.find("current_user = 'pulso_collector'")
        auth_null = body.find("auth.uid() is null")
        self.assertGreaterEqual(collector, 0)
        self.assertGreater(auth_null, collector)
        self.assertIn("set search_path = public", body)
        self.assertIn("solo se puede actualizar el estado de revisión", body)
        self.assertNotIn("grant usage on schema auth", APPLY.read_text().lower())
        self.assertIn("begin;", APPLY.read_text().lower())
        self.assertIn("commit;", APPLY.read_text().lower())

    def test_rollback_restores_original_auth_uid_first_check(self):
        body = _function_body(ROLLBACK.read_text())
        self.assertNotIn("current_user = 'pulso_collector'", body)
        self.assertIn("if auth.uid() is null then", body)
        self.assertIn("set search_path = public", body)
        self.assertNotIn("grant usage on schema auth", ROLLBACK.read_text().lower())

    def test_install_sql_matches_apply_short_circuit(self):
        install = _function_body(INSTALL.read_text())
        apply = _function_body(APPLY.read_text())
        self.assertIn("current_user = 'pulso_collector'", install)
        self.assertLess(
            install.find("current_user = 'pulso_collector'"),
            install.find("auth.uid() is null"),
        )
        # Mismo contrato de guardia para instalaciones nuevas y el parche.
        self.assertIn("solo se puede actualizar el estado de revisión", install)
        self.assertIn("new.status_updated_by := auth.uid();", apply)
        self.assertIn("new.status_updated_by := auth.uid();", install)


if __name__ == "__main__":
    unittest.main()

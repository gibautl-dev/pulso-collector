"""CLI: `python -m pulso.suspicious --candidate axel-kicillof [--dry-run] [--from-json FILE]`.

En dry-run o con --from-json no escribe en la base. El supervisor del cron no
propaga el código de salida de este proceso.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID

from .detect import SuspiciousAccount, detect, summarize


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def _load_json(path: Path) -> list[dict]:
    payload = json.loads(path.read_text())
    if isinstance(payload, dict):
        rows = payload.get("mentions") or payload.get("rows") or payload.get("data") or []
    else:
        rows = payload
    if not isinstance(rows, list):
        raise ValueError("json_invalido")
    return rows


def _select_mentions(database_url: str, slug: str) -> list[dict]:
    import psycopg
    from psycopg.rows import dict_row

    with psycopg.connect(database_url, autocommit=True, row_factory=dict_row, connect_timeout=15) as conn:
        candidate = conn.execute(
            "select id from public.candidates where slug=%s", (slug,)
        ).fetchone()
        if not candidate:
            raise ValueError("candidato_inexistente")
        rows = conn.execute(
            """select id, candidate_id, source, url, title, content, author,
                      author_handle, published_at, metrics, account_relation
                 from public.mentions
                where candidate_id=%s and source in ('x','youtube')
                order by published_at""",
            (candidate["id"],),
        ).fetchall()
        return [dict(row) for row in rows]


def _save(database_url: str, accounts: list[SuspiciousAccount], detected_at: datetime) -> int:
    import psycopg
    from psycopg.types.json import Jsonb

    upserted = 0
    with psycopg.connect(database_url, autocommit=False, connect_timeout=15) as conn:
        for account in accounts:
            row = conn.execute(
                """insert into public.suspicious_accounts
                    (candidate_id, platform, account_key, handle, display_name, profile_url,
                     score, signals, first_seen_at, last_seen_at, account_created_at,
                     mention_count, status, detected_at, updated_at)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'pending',%s,%s)
                   on conflict (candidate_id, platform, account_key) do update set
                     handle = excluded.handle,
                     display_name = excluded.display_name,
                     profile_url = excluded.profile_url,
                     score = excluded.score,
                     signals = excluded.signals,
                     first_seen_at = excluded.first_seen_at,
                     last_seen_at = excluded.last_seen_at,
                     account_created_at = excluded.account_created_at,
                     mention_count = excluded.mention_count,
                     detected_at = excluded.detected_at,
                     updated_at = excluded.updated_at,
                     status = public.suspicious_accounts.status
                   returning (xmax = 0) as inserted""",
                (
                    UUID(account.candidate_id), account.platform, account.account_key,
                    account.handle, account.display_name, account.profile_url,
                    account.score, Jsonb([
                        {
                            "type": sig.type,
                            "weight": sig.weight,
                            "summary": sig.summary,
                            "evidence": [
                                {
                                    "mention_id": ev.mention_id,
                                    "url": ev.url,
                                    "published_at": ev.published_at,
                                    "excerpt": ev.excerpt,
                                    "fingerprint": ev.fingerprint,
                                }
                                for ev in sig.evidence
                            ],
                        }
                        for sig in account.signals
                    ]),
                    account.first_seen_at, account.last_seen_at,
                    account.account_created_at, account.mention_count,
                    detected_at, detected_at,
                ),
            ).fetchone()
            upserted += 1 if row else 0
        conn.commit()
    return upserted


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", default=os.getenv("PULSO_CANDIDATE"))
    parser.add_argument("--dry-run", action="store_true", help="Detecta sin escribir en la base")
    parser.add_argument("--from-json", type=Path, help="Lee menciones de un JSON local, sin conectar a la base")
    args = parser.parse_args(argv)
    if not args.candidate and not args.from_json:
        parser.error("Indicar --candidate, PULSO_CANDIDATE o --from-json")
    try:
        if args.from_json:
            rows = _load_json(args.from_json)
        else:
            from pulso.config import Settings
            settings = Settings.from_env()
            rows = _select_mentions(settings.database_url, args.candidate)
        accounts = detect(rows)
        summary = summarize(accounts)
        log(event="suspicious_scan", dry_run=bool(args.dry_run or args.from_json),
            input_rows=len(rows), **{k: summary[k] for k in ("accounts_marked", "threshold", "by_signal", "by_platform")})
        if args.dry_run or args.from_json:
            log(event="suspicious_dry_run", accounts=summary["accounts"])
            return 0
        written = _save(Settings.from_env().database_url, accounts, datetime.now(timezone.utc))
        log(event="suspicious_saved", upserted=written)
        return 0
    except ValueError as exc:
        log(event="suspicious_config_error", error=str(exc) or type(exc).__name__)
        return 2
    except Exception as exc:
        # Sin mensajes de librerías: pueden contener DSN o texto de menciones masivo.
        log(event="suspicious_error", error_type=type(exc).__name__)
        return 1


if __name__ == "__main__":
    sys.exit(main())

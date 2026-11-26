"""Persistencia de ai_answers con el rol pulso_classifier.

Solo se usa cuando la corrida no es dry-run. Nunca registra la URL ni la
contraseña. El recolector no ve estas credenciales.
"""
from __future__ import annotations

import os
from datetime import date, datetime
from urllib.parse import urlsplit
from uuid import UUID

from pulso.ai.classifier import FORBIDDEN_DB_USERS
from pulso.ai_visibility.classify_answers import ANALYSIS_PROMPT_VERSION

TZ_NAME = "America/Argentina/Buenos_Aires"


def database_url_from_env() -> tuple[str, str | None]:
    url = os.getenv("CLASSIFIER_DATABASE_URL", "")
    parsed = urlsplit(url)
    if parsed.scheme not in {"postgres", "postgresql"} or not parsed.hostname:
        raise ValueError("Configurar CLASSIFIER_DATABASE_URL")
    if "sslmode=require" not in url and "sslmode=verify" not in url:
        raise ValueError("CLASSIFIER_DATABASE_URL requiere sslmode=require o superior")
    user = (parsed.username or "").split(".")[0]
    if not user or user in FORBIDDEN_DB_USERS:
        raise ValueError("CLASSIFIER_DATABASE_URL debe usar el rol pulso_classifier")
    password = os.getenv("CLASSIFIER_PGPASSWORD") or None
    return url, password


class VisibilityDB:
    def __init__(self, url: str, password: str | None):
        import psycopg
        from psycopg.rows import dict_row
        kwargs = {"autocommit": True, "row_factory": dict_row, "connect_timeout": 15}
        if password:
            kwargs["password"] = password
        self.connection = psycopg.connect(url, **kwargs)

    def close(self):
        self.connection.close()

    def candidate(self, slug: str) -> dict:
        row = self.connection.execute(
            "select id, slug, name, country, collection_paused from public.candidates where slug=%s", (slug,)
        ).fetchone()
        if not row:
            raise ValueError("Candidato inexistente")
        return row

    def already_ran_on(self, candidate_id, asked_on: date, provider: str = "openai") -> bool:
        row = self.connection.execute(
            """select 1 from public.ai_answers
               where candidate_id=%s and provider=%s and asked_on=%s limit 1""",
            (candidate_id, provider, asked_on),
        ).fetchone()
        return row is not None

    def settings(self, candidate_id) -> dict | None:
        return self.connection.execute(
            """select enabled, provider, model, use_web_search, prompts
               from public.ai_visibility_settings where candidate_id=%s""",
            (candidate_id,),
        ).fetchone()

    def budget_state(self, candidate_id) -> dict | None:
        """Tope diario de En la IA de ESTE candidato y lo que gastó hoy (día de Buenos Aires).

        Sin fila para el candidato se usa el default de la tabla (USD 1,00).
        None si la tabla del tope por candidato no existe (migración sin aplicar): sin tope.
        """
        import psycopg
        try:
            row = self.connection.execute(
                """with b as (
                     select coalesce(cb.daily_budget_usd, 1.00) as daily_budget_usd,
                            coalesce(cb.timezone, 'America/Argentina/Buenos_Aires') as timezone
                       from (select %(cid)s::uuid as candidate_id) x
                       left join public.ai_visibility_candidate_budget cb on cb.candidate_id = x.candidate_id
                   )
                   select b.daily_budget_usd, b.timezone,
                          (select coalesce(sum(a.cost), 0) from public.ai_answers a
                            where a.candidate_id = %(cid)s::uuid
                              and a.asked_at >= date_trunc('day', now() at time zone b.timezone) at time zone b.timezone
                              and a.asked_at < (date_trunc('day', now() at time zone b.timezone) + interval '1 day') at time zone b.timezone
                          ) as spent_today,
                          (select max(c) from (select a.cost as c from public.ai_answers a
                                                where a.cost is not null
                                                order by a.asked_at desc limit 50) t) as recent_max,
                          (now() at time zone b.timezone)::date as today
                     from b""",
                {"cid": str(candidate_id)},
            ).fetchone()
        except psycopg.errors.UndefinedTable:
            return None
        if not row:
            return None
        return {
            "daily_budget_usd": float(row["daily_budget_usd"]),
            "spent_today_usd": float(row["spent_today"] or 0),
            "recent_max_usd": float(row["recent_max"]) if row["recent_max"] is not None else None,
            "today": row["today"],
        }

    def mark_budget_reached(self, candidate_id, day) -> None:
        self.connection.execute(
            "update public.ai_visibility_candidate_budget set last_reached_on=%s where candidate_id=%s",
            (day, str(candidate_id)),
        )

    def save_answers(self, rows: list[dict], asked_at: datetime, asked_on: date) -> int:
        saved = 0
        for row in rows:
            candidate_id = row.get("candidate_id")
            if not candidate_id:
                continue
            usage = {
                "ask": row.get("usage") or {},
                "cost": row.get("cost") or {},
            }
            result = self.connection.execute(
                """insert into public.ai_answers (
                     candidate_id, provider, model, prompt_key, prompt, answer, citations,
                     balance, balance_reason, positives, negatives, topics, other_politicians,
                     asked_at, asked_on, cost, usage, classification_model,
                     classification_prompt_version
                   ) values (
                     %s, %s, %s, %s, %s, %s, %s::jsonb,
                     %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                     %s, %s, %s, %s::jsonb, %s, %s
                   )
                   on conflict (candidate_id, provider, prompt_key, asked_on) do nothing
                   returning id""",
                (
                    candidate_id,
                    row.get("provider") or "openai",
                    row["model"],
                    row["key"],
                    row["prompt"],
                    row["answer"],
                    _json(row.get("citations") or []),
                    row.get("balance"),
                    row.get("balance_reason"),
                    _json(row.get("positives") or []),
                    _json(row.get("negatives") or []),
                    _json(row.get("topics") or []),
                    _json(row.get("other_politicians") or []),
                    asked_at,
                    asked_on,
                    (row.get("cost") or {}).get("cost_usd"),
                    _json(usage),
                    row.get("classification_model"),
                    row.get("classification_prompt_version") or ANALYSIS_PROMPT_VERSION,
                ),
            ).fetchone()
            if result:
                saved += 1
        return saved


def _json(value) -> str:
    import json
    return json.dumps(value, ensure_ascii=False)

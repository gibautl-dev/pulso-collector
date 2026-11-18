"""CLI: `python -m pulso.ai_visibility --candidate axel-kicillof [--dry-run|--write]`.

--candidate es el slug, como en el resto del recolector. En dry-run no escribe
en la base. Sin --dry-run guarda en ai_answers con el rol pulso_classifier.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path

from pulso.ai_visibility.db import VisibilityDB, database_url_from_env
from pulso.ai_visibility.prompts import load_prompt_overrides
from pulso.ai_visibility.run import (
    CANDIDATE_ID_KICILLOF,
    DEFAULT_NAME,
    DEFAULT_SLUG,
    TZ,
    run_visibility,
)
from pulso.ai_visibility.settings import VisibilitySettings, api_key_from_env


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resultados en IA (OpenAI)")
    parser.add_argument("--candidate", default=DEFAULT_SLUG,
                        help="Slug del candidato (p. ej. axel-kicillof)")
    parser.add_argument("--name", default=None, help="Nombre, si no se lee de la base")
    parser.add_argument("--candidate-id", default=None)
    parser.add_argument("--prompts", type=Path, default=None,
                        help="JSON opcional con 8 a 12 preguntas {key, text}")
    parser.add_argument("--output", type=Path, default=None,
                        help="Archivo JSON de salida")
    parser.add_argument("--dry-run", action="store_true",
                        help="Pregunta y analiza, no escribe en la base")
    parser.add_argument("--write", action="store_true",
                        help="Guarda en ai_answers (requiere la migración aplicada)")
    parser.add_argument("--force", action="store_true",
                        help="Ignora el horario de las 09:00 y si ya corrió hoy")
    args = parser.parse_args(argv)
    if args.dry_run and args.write:
        log(event="ai_visibility_error", error_type="config",
            detail="Usá --dry-run o --write, no los dos")
        return 2
    dry_override: bool | None
    if args.dry_run:
        dry_override = True
    elif args.write:
        dry_override = False
    else:
        dry_override = None  # lo decide PULSO_AI_VISIBILITY_DRY_RUN (default false)
    database = None
    candidate_id = args.candidate_id
    candidate_name = args.name
    slug = args.candidate
    already = False
    try:
        api_key_from_env()
        settings = VisibilitySettings.from_env(dry_run=dry_override)
        if not settings.dry_run:
            url, password = database_url_from_env()
            database = VisibilityDB(url, password)
            row = database.candidate(slug)
            candidate_id = str(row["id"])
            candidate_name = row["name"]
            already = database.already_ran_on(row["id"], datetime.now(TZ).date())
        else:
            if slug == DEFAULT_SLUG:
                candidate_id = candidate_id or CANDIDATE_ID_KICILLOF
                candidate_name = candidate_name or DEFAULT_NAME
            elif not candidate_name:
                raise ValueError("En dry-run indicá --name si el slug no es el candidato demo")
        prompts = load_prompt_overrides(args.prompts) if args.prompts else None
        payload = run_visibility(
            settings,
            candidate_name,
            candidate_id=candidate_id,
            candidate_slug=slug,
            prompts=prompts,
            database=database,
            force=args.force,
            already=already,
            log=log,
        )
    except ValueError as exc:
        log(event="ai_visibility_error", error_type="config", detail=str(exc))
        return 2
    except Exception as exc:
        log(event="ai_visibility_error", error_type=type(exc).__name__)
        return 1
    finally:
        if database is not None:
            database.close()
    if args.output and not payload.get("skipped"):
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
            encoding="utf-8",
        )
        log(event="ai_visibility_saved", path=str(args.output))
    if payload.get("skipped"):
        return 0
    return 1 if payload.get("errors") and not payload.get("answers") else 0


if __name__ == "__main__":
    sys.exit(main())

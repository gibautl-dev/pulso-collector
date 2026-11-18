"""CLI: `python -m pulso.ai_visibility --candidate "Axel Kicillof" --dry-run --output FILE`.

En dry-run no escribe en la base. La persistencia no está habilitada en este
módulo hasta que se aplique deploy/ai_visibility.sql.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pulso.ai_visibility.prompts import load_prompt_overrides
from pulso.ai_visibility.run import CANDIDATE_ID_KICILLOF, run_visibility
from pulso.ai_visibility.settings import VisibilitySettings, api_key_from_env


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Resultados en IA (OpenAI), dry-run por defecto")
    parser.add_argument("--candidate", default="Axel Kicillof",
                        help="Nombre del candidato a interpolar en las preguntas")
    parser.add_argument("--slug", default="axel-kicillof")
    parser.add_argument("--candidate-id", default=CANDIDATE_ID_KICILLOF)
    parser.add_argument("--prompts", type=Path, default=None,
                        help="JSON opcional con 8 a 12 preguntas {key, text}")
    parser.add_argument("--output", type=Path, default=None,
                        help="Archivo JSON de salida (no se escribe en la base)")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--write", action="store_true",
                        help="No implementado: exigiría la migración aplicada")
    args = parser.parse_args(argv)
    if args.write:
        log(event="ai_visibility_error", error_type="write_disabled",
            detail="La persistencia está deshabilitada hasta aplicar la migración")
        return 2
    try:
        api_key_from_env()
        settings = VisibilitySettings.from_env(dry_run=True)
        prompts = load_prompt_overrides(args.prompts) if args.prompts else None
        payload = run_visibility(
            settings,
            args.candidate,
            candidate_id=args.candidate_id or None,
            candidate_slug=args.slug,
            prompts=prompts,
            log=log,
        )
    except ValueError as exc:
        log(event="ai_visibility_error", error_type="config", detail=str(exc))
        return 2
    except Exception as exc:
        log(event="ai_visibility_error", error_type=type(exc).__name__)
        return 1
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str) + "\n",
                               encoding="utf-8")
        log(event="ai_visibility_saved", path=str(args.output))
    return 1 if payload.get("errors") and not payload.get("answers") else 0


if __name__ == "__main__":
    sys.exit(main())

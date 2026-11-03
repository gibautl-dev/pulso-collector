"""CLI del clasificador: `python -m pulso.ai.classify --candidate axel-kicillof [--dry-run]`.

Sale con 0 si todo OK o no hay pendientes, 1 si alguna tanda falló, 2 si falta configuración.
El supervisor del cron (deploy_run) nunca propaga este código: la recolección no falla por la IA.
"""
import argparse
import json
import os
import sys
from dataclasses import replace

from .classifier import ClassifierSettings, ClassifierDB, LLMClient, run


def log(**values):
    print(json.dumps(values, ensure_ascii=False, default=str), flush=True)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", default=os.getenv("PULSO_CANDIDATE"))
    parser.add_argument("--dry-run", action="store_true", help="Llama al modelo pero no escribe en la base")
    parser.add_argument("--max", type=int, help="Tope de menciones en esta corrida")
    args = parser.parse_args(argv)
    if not args.candidate:
        parser.error("Indicar --candidate o PULSO_CANDIDATE")
    try:
        settings = ClassifierSettings.from_env()
    except ValueError as exc:
        log(event="classifier_config_error", error=str(exc)); return 2
    if args.dry_run:
        settings = replace(settings, dry_run=True)
    if args.max:
        settings = replace(settings, max_per_run=max(1, min(args.max, 500)))
    db = client = None
    try:
        db = ClassifierDB(settings.database_url, settings.database_password)
        client = LLMClient(settings)
        return run(db, client, args.candidate, settings, log)
    except Exception as exc:
        # Sin mensajes de librerías: pueden contener DSN o cuerpos de respuesta.
        log(event="classifier_error", error_type=type(exc).__name__); return 1
    finally:
        if client: client.close()
        if db: db.close()


if __name__ == "__main__":
    sys.exit(main())

"""Comando manual de los pasos 2–3; no sustituye al futuro orquestador/cron."""
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone, timedelta
from .config import Settings
from .db import Database
from .models import SourceName, SourceConfig, FetchResult
from .sources.rss_media import RSSSource
from .sources.google_alerts import GoogleAlertsSource
from .sources.youtube import YouTubeSource

def log(**values): print(json.dumps(values,ensure_ascii=False,default=str),flush=True)

def run_exit_code(results):
    """0 si todo OK o falla parcial (cada fuente con al menos un feed OK); 1 si alguna fuente falla entera.
    Una falla blanda (YouTube) no cambia el código de salida."""
    failed = [r for r in results if r.errors and r.feeds_ok == 0 and not r.soft_failure]
    return 1 if failed else 0

def due_for_run(config: SourceConfig, now, refresh=False):
    """YouTube respeta interval_seconds / next_run_at aunque el cron sea más frecuente.
    RSS y Google News no se filtran acá: next_run_at se calcula al cerrar la corrida
    y un cron cada 20 minutos podría quedar unos segundos corto."""
    if refresh or config.source != SourceName.YOUTUBE:
        return True
    return config.next_run_at is None or now >= config.next_run_at

def adapter_for(source, settings):
    if source == SourceName.ALERTS:
        return GoogleAlertsSource(settings)
    if source == SourceName.YOUTUBE:
        return YouTubeSource(settings)
    return RSSSource(source, settings)

async def collect(args):
    settings = Settings.from_env()
    db = Database(settings.database_url)
    candidate = None
    locked = False
    results = []
    try:
        candidate = db.candidate(args.candidate)
        locked = db.lock(candidate.id)
        if not locked:
            log(status='skipped',reason='candidate_locked'); return 0
        configs = db.sources(candidate.id)
        for config in configs:
            if config.source not in {s.value for s in SourceName}: continue
            if args.source and config.source not in args.source: continue
            if not config.enabled:
                log(source=config.source,status='skipped',reason='disabled'); continue
            started = datetime.now(timezone.utc)
            if not due_for_run(config, started, args.refresh):
                log(source=config.source,status='skipped',reason='interval'); continue
            since = started - timedelta(days=args.days)
            # Siempre se relee la ventana: no avanzar por la última fecha publicada,
            # ya que feeds pueden agregar noticias antiguas fuera de orden.
            effective = config.model_copy(update={'cursor':{}}) if args.refresh else config
            adapter = adapter_for(SourceName(config.source),settings)
            try:
                result = await adapter.fetch(candidate,since,effective)
            except Exception as exc:
                result = FetchResult(errors=[type(exc).__name__],cursor=config.cursor)
            results.append(result)
            if args.dry_run:
                log(source=config.source,status='dry_run',items_found=len(result.mentions),
                    feeds_ok=result.feeds_ok,errors=result.errors,skipped_entries=result.skipped_entries)
            else:
                summary = db.save_result(candidate.id,config,result,started,since)
                log(source=config.source,**summary)
        code = run_exit_code(results)
        partial = [r for r in results if r.errors]
        if code == 0 and partial:
            log(level='warning',status='partial_failure',
                sources_with_errors=len(partial),errors=[e for r in partial for e in r.errors])
        return code
    finally:
        if locked: db.unlock(candidate.id)
        db.close()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',default=os.getenv('PULSO_CANDIDATE'))
    parser.add_argument('--days',type=int,default=7,choices=range(1,31),metavar='1..30')
    parser.add_argument('--source',action='append',choices=[s.value for s in SourceName])
    parser.add_argument('--dry-run',action='store_true',help='Consulta fuentes sin escribir en la base')
    parser.add_argument('--refresh',action='store_true',help='Ignora ETag/Last-Modified para releer feeds')
    args = parser.parse_args()
    if not args.candidate: parser.error("Indicar --candidate o PULSO_CANDIDATE")
    try: return asyncio.run(collect(args))
    except Exception as exc:
        # No imprimir mensajes de librerías que puedan contener DSN/URLs privadas.
        log(status='error',error_type=type(exc).__name__,hint='Revisar configuración, conectividad y esquema'); return 1

if __name__ == '__main__': sys.exit(main())

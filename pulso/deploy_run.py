"""Supervisor del cron: timeout global, señales y logs sin secretos."""
import json
import os
import signal
import subprocess
import sys
import time

from pulso.region import merge_collectable_slugs, parse_candidate_slugs, profile_for

def log(**values):
    print(json.dumps(values), flush=True)

def stop(child):
    if child.poll() is not None:
        return
    try:
        os.killpg(child.pid, signal.SIGTERM)
        child.wait(timeout=10)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid, signal.SIGKILL)
        child.wait()
    except ProcessLookupError:
        child.wait()

COLLECTOR_ONLY = ('DATABASE_URL', 'PGPASSWORD', 'YOUTUBE_API_KEY', 'X_BEARER_TOKEN', 'META_ADS_ACCESS_TOKEN')
CLASSIFIER_ONLY = ('LLM_API_KEY', 'OPENAI_API_KEY', 'CLASSIFIER_DATABASE_URL', 'CLASSIFIER_PGPASSWORD')
META_ADS_ONLY = ('META_ADS_ACCESS_TOKEN',)

def child_env(*groups):
    """Cada proceso ve solo sus credenciales: el recolector no ve la clave del LLM
    y el clasificador no ve la conexión del rol pulso_collector. El token de Meta
    queda solo en el job de la Biblioteca de anuncios."""
    drop = set()
    for group in groups:
        drop.update(group)
    return {k: v for k, v in os.environ.items() if k not in drop}

def run_command(command, timeout, env=None, prefix='cron'):
    started = time.monotonic()
    child = subprocess.Popen(command, start_new_session=True, env=env)
    cancelled = False
    def on_signal(signum, frame):
        nonlocal cancelled
        cancelled = True
        stop(child)
    previous = {s: signal.signal(s, on_signal) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        log(event=f'{prefix}_started')
        try:
            code = child.wait(timeout=timeout)
            code = 143 if cancelled else (code if code >= 0 else 128-code)
        except subprocess.TimeoutExpired:
            stop(child)
            code = 124
            log(event=f'{prefix}_timeout', timeout_seconds=timeout)
        log(event=f'{prefix}_finished', exit_code=code,
            elapsed_seconds=round(time.monotonic()-started, 3))
        return code
    finally:
        stop(child)
        for s, handler in previous.items():
            signal.signal(s, handler)

def args_for_slug(base_args, slug):
    """Deja un único --candidate <slug> en los argumentos del cron."""
    args = list(base_args)
    if "--candidate" in args:
        index = args.index("--candidate")
        if index + 1 < len(args) and not args[index + 1].startswith("-"):
            args[index + 1] = slug
        else:
            args.insert(index + 1, slug)
    else:
        args = ["--candidate", slug, *args]
    return args


MEDIA_COLLECT_SOURCES = ('rss_media', 'google_news', 'google_alerts')

def list_media_enabled_slugs(database_url):
    """Slugs con al menos una fuente de medios/RSS encendida. Sin secretos en logs."""
    if not database_url or '://' not in str(database_url):
        return []
    try:
        import psycopg
        with psycopg.connect(database_url, connect_timeout=8) as conn:
            rows = conn.execute(
                """select c.slug
                     from public.candidates c
                    where exists (
                      select 1 from public.candidate_sources s
                       where s.candidate_id = c.id
                         and s.enabled
                         and s.source = any(%s)
                    )
                    order by c.slug""",
                (list(MEDIA_COLLECT_SOURCES),),
            ).fetchall()
        return [row[0] for row in rows if row and row[0]]
    except Exception:
        return None

def discover_collectable_slugs(env_slugs, database_url=None):
    """Lista del entorno más candidatos con medios/RSS en la DB. Si la consulta falla, queda la lista del env."""
    import os
    url = database_url if database_url is not None else os.getenv('DATABASE_URL')
    db_slugs = list_media_enabled_slugs(url)
    if db_slugs is None:
        log(event='cron_db_candidates_error', error_type='query_failed')
        return list(env_slugs or [])
    return merge_collectable_slugs(env_slugs, db_slugs)



def main():
    try:
        timeout = int(os.getenv('PULSO_RUN_TIMEOUT_SECONDS', '900'))
        if not 1 <= timeout <= 1100:
            raise ValueError('Invalid timeout')
        dry = os.getenv('PULSO_DRY_RUN', 'false').lower()
        if dry not in {'true', 'false'}:
            raise ValueError('Invalid dry-run')
        args = sys.argv[1:]
        if dry == 'true' and '--dry-run' not in args:
            args = [*args, '--dry-run']
        env_slugs = parse_candidate_slugs(argv=args)
        slugs = discover_collectable_slugs(env_slugs) if env_slugs else []
        extras = [slug for slug in slugs if slug not in set(env_slugs)]
        if extras:
            log(event='cron_db_candidates', candidates=extras)
        # Sin lista ni --candidate, una sola corrida con los args originales
        # (collect_rss exigirá PULSO_CANDIDATE). Así se mantiene el contrato
        # anterior de los tests y de un cron que solo tiene PULSO_CANDIDATE.
        # Si el entorno no trae slugs, no se consultan rivales de la DB acá:
        # se conserva el camino histórico.
        started = time.monotonic()
        if not env_slugs:
            code = run_command(
                [sys.executable, '-m', 'pulso.collect_rss', *args],
                timeout,
                env=child_env(CLASSIFIER_ONLY, META_ADS_ONLY),
            )
            if code not in (124, 143):
                run_classifier(args)
                run_suspicious(args)
                run_ai_visibility(args)
                run_meta_ads(args)
                run_meta_ads_classify(args)
                run_google_ads(args, remaining=timeout - (time.monotonic() - started))
                run_crisis_agent(args)
            return code
        finished = []
        timed_out = False
        cancelled = False
        for slug in slugs:
            remaining = timeout - (time.monotonic() - started)
            if remaining < 30:
                timed_out = True
                log(event='cron_timeout', timeout_seconds=timeout, pending_candidate=slug)
                break
            child_args = args_for_slug(args, slug)
            log(event='cron_candidate_started', candidate=slug)
            code = run_command(
                [sys.executable, '-m', 'pulso.collect_rss', *child_args],
                remaining,
                env=child_env(CLASSIFIER_ONLY, META_ADS_ONLY),
            )
            if code == 124:
                timed_out = True
                log(event='cron_candidate_timeout', candidate=slug)
                break
            if code == 143:
                cancelled = True
                break
            finished.append((slug, code, child_args))
    except Exception as exc:
        log(event='cron_error', error_type=type(exc).__name__)
        return 2
    if not timed_out and not cancelled:
        for slug, _collect_code, child_args in finished:
            run_classifier(child_args)
            # Rivales descubiertos en la DB (no listados en el entorno) solo
            # media/RSS y clasificador: sin IA, X extra, Meta ni crisis.
            if env_slugs and slug not in env_slugs:
                log(event='cron_post_steps_skipped', reason='db_rival_media_only', candidate=slug)
                continue
            run_suspicious(child_args)
            run_ai_visibility(child_args)
            if profile_for(slug).show_meta_ads:
                run_meta_ads(child_args)
                run_meta_ads_classify(child_args)
            else:
                log(event='meta_ads_skipped', reason='region_disabled', candidate=slug)
                log(event='meta_ads_classify_skipped', reason='region_disabled', candidate=slug)
            run_google_ads(child_args, remaining=timeout - (time.monotonic() - started))
            run_crisis_agent(child_args)
    # El resultado del clasificador, el detector, la visibilidad en IA, Meta Ads,
    # los anuncios de Google o la clasificación de anuncios nunca cambia el
    # código de salida del cron.
    if cancelled:
        return 143
    if timed_out:
        return 124
    if any(code != 0 for _slug, code, _args in finished):
        return 1
    return 0

def run_classifier(collector_args):
    """Paso opcional posterior a la recolección, con timeout propio y errores aislados."""
    try:
        if os.getenv('PULSO_CLASSIFY_ENABLED', 'false').lower() != 'true':
            log(event='classifier_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_CLASSIFY_TIMEOUT_SECONDS', '240'))
        if not 10 <= timeout <= 600:
            raise ValueError('Invalid classifier timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        return run_command([sys.executable, '-m', 'pulso.ai.classify', *args], timeout,
                           env=child_env(COLLECTOR_ONLY), prefix='classifier')
    except Exception as exc:
        log(event='classifier_error', error_type=type(exc).__name__)
        return None


def run_suspicious(collector_args):
    """Detección posterior a la recolección. Apagada por defecto; no denuncia."""
    try:
        if os.getenv('PULSO_SUSPICIOUS_ENABLED', 'false').lower() != 'true':
            log(event='suspicious_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_SUSPICIOUS_TIMEOUT_SECONDS', '120'))
        if not 10 <= timeout <= 300:
            raise ValueError('Invalid suspicious timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        # Misma conexión del recolector; no usa el LLM ni el rol del clasificador.
        return run_command([sys.executable, '-m', 'pulso.suspicious', *args], timeout,
                           env=child_env(CLASSIFIER_ONLY, META_ADS_ONLY), prefix='suspicious')
    except Exception as exc:
        log(event='suspicious_error', error_type=type(exc).__name__)
        return None



def run_ai_visibility(collector_args):
    """Preguntas diarias a OpenAI sobre el candidato. Apagado por defecto."""
    try:
        if os.getenv('PULSO_AI_VISIBILITY_ENABLED', 'false').lower() != 'true':
            log(event='ai_visibility_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_AI_VISIBILITY_TIMEOUT_SECONDS', '600'))
        if not 60 <= timeout <= 900:
            raise ValueError('Invalid ai-visibility timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        if os.getenv('PULSO_AI_VISIBILITY_DRY_RUN', 'false').lower() == 'true':
            args.append('--dry-run')
        # Misma clave LLM y rol del clasificador; no ve la conexión del recolector.
        # Una vez por día a partir de las 09:00 (hora de Argentina); el módulo se saltea si ya corrió.
        return run_command([sys.executable, '-m', 'pulso.ai_visibility', *args], timeout,
                           env=child_env(COLLECTOR_ONLY), prefix='ai_visibility')
    except Exception as exc:
        log(event='ai_visibility_error', error_type=type(exc).__name__)
        return None




def run_meta_ads(collector_args):
    """Biblioteca de anuncios de Meta, una vez por día. Apagada por defecto."""
    try:
        if os.getenv('PULSO_META_ADS_ENABLED', 'false').lower() != 'true':
            log(event='meta_ads_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_META_ADS_TIMEOUT_SECONDS', '180'))
        if not 30 <= timeout <= 600:
            raise ValueError('Invalid meta-ads timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        if os.getenv('PULSO_META_ADS_DRY_RUN', 'false').lower() == 'true':
            args.append('--dry-run')
        # Conexión del recolector y token de Meta; no ve el LLM ni el rol del clasificador.
        return run_command([sys.executable, '-m', 'pulso.meta_ads', *args], timeout,
                           env=child_env(CLASSIFIER_ONLY), prefix='meta_ads')
    except Exception as exc:
        log(event='meta_ads_error', error_type=type(exc).__name__)
        return None


def run_meta_ads_classify(collector_args):
    """Clasifica anuncios nuevos de Meta. Apagada por defecto; no pisa etiquetas."""
    try:
        if os.getenv('PULSO_META_ADS_CLASSIFY_ENABLED', 'false').lower() != 'true':
            log(event='meta_ads_classify_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_META_ADS_CLASSIFY_TIMEOUT_SECONDS', '300'))
        if not 30 <= timeout <= 900:
            raise ValueError('Invalid meta-ads classify timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        if os.getenv('PULSO_META_ADS_CLASSIFY_DRY_RUN', 'false').lower() == 'true':
            args.append('--dry-run')
        # Misma clave LLM y rol del clasificador; no ve el token de Meta ni al recolector.
        return run_command([sys.executable, '-m', 'pulso.meta_ads.classify', *args], timeout,
                           env=child_env(COLLECTOR_ONLY, META_ADS_ONLY), prefix='meta_ads_classify')
    except Exception as exc:
        log(event='meta_ads_classify_error', error_type=type(exc).__name__)
        return None



def run_google_ads(collector_args, remaining=None):
    """Anuncios de Google (ZIP político, como máximo una vez al día). No pide env nuevo.
    El job se salta solo si no hay settings habilitados, si ya corrió hoy o si es ATC."""
    try:
        if remaining is not None and remaining < 90:
            log(event='google_ads_skipped', reason='insufficient_time',
                remaining_seconds=round(remaining, 1))
            return None
        timeout = int(os.getenv('PULSO_GOOGLE_ADS_TIMEOUT_SECONDS', '480'))
        if not 30 <= timeout <= 900:
            raise ValueError('Invalid google-ads timeout')
        if remaining is not None:
            timeout = min(timeout, max(30, int(remaining)))
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        if os.getenv('PULSO_GOOGLE_ADS_DRY_RUN', 'false').lower() == 'true':
            args.append('--dry-run')
        elif '--dry-run' in collector_args:
            args.append('--dry-run')
        # Misma conexión del recolector; no ve la clave del LLM ni el token de Meta.
        return run_command([sys.executable, '-m', 'pulso.google_ads', *args], timeout,
                           env=child_env(CLASSIFIER_ONLY, META_ADS_ONLY), prefix='google_ads')
    except Exception as exc:
        log(event='google_ads_error', error_type=type(exc).__name__)
        return None


def run_crisis_agent(collector_args):
    """Equipo de agentes de crisis. Apagado por defecto; no publica ni cambia estados."""
    try:
        if os.getenv('PULSO_CRISIS_AGENT_ENABLED', 'false').lower() != 'true':
            log(event='crisis_agent_skipped', reason='disabled')
            return None
        timeout = int(os.getenv('PULSO_CRISIS_AGENT_TIMEOUT_SECONDS', '300'))
        if not 30 <= timeout <= 900:
            raise ValueError('Invalid crisis-agent timeout')
        args = []
        if '--candidate' in collector_args:
            i = collector_args.index('--candidate')
            args = ['--candidate', collector_args[i + 1]]
        if os.getenv('PULSO_CRISIS_AGENT_DRY_RUN', 'false').lower() == 'true':
            args.append('--dry-run')
        # Misma clave LLM y rol del clasificador; no ve al recolector ni el token de Meta.
        return run_command([sys.executable, '-m', 'pulso.crisis', *args], timeout,
                           env=child_env(COLLECTOR_ONLY, META_ADS_ONLY), prefix='crisis_agent')
    except Exception as exc:
        log(event='crisis_agent_error', error_type=type(exc).__name__)
        return None


if __name__ == '__main__':
    sys.exit(main())

"""Supervisor del cron: timeout global, señales y logs sin secretos."""
import json
import os
import signal
import subprocess
import sys
import time

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
        code = run_command([sys.executable, '-m', 'pulso.collect_rss', *args], timeout,
                           env=child_env(CLASSIFIER_ONLY, META_ADS_ONLY))
    except Exception as exc:
        log(event='cron_error', error_type=type(exc).__name__)
        return 2
    if code not in (124, 143):
        run_classifier(args)
        run_suspicious(args)
        run_ai_visibility(args)
        run_meta_ads(args)
        run_meta_ads_classify(args)
    # El resultado del clasificador, el detector, la visibilidad en IA, Meta Ads
    # o la clasificación de anuncios nunca cambia el código de salida del cron.
    return code

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


if __name__ == '__main__':
    sys.exit(main())

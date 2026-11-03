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

COLLECTOR_ONLY = ('DATABASE_URL', 'PGPASSWORD')
CLASSIFIER_ONLY = ('LLM_API_KEY', 'CLASSIFIER_DATABASE_URL', 'CLASSIFIER_PGPASSWORD')

def child_env(drop):
    """Cada proceso ve solo sus credenciales: el recolector no ve la clave del LLM
    y el clasificador no ve la conexión del rol pulso_collector."""
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
                           env=child_env(CLASSIFIER_ONLY))
    except Exception as exc:
        log(event='cron_error', error_type=type(exc).__name__)
        return 2
    if code not in (124, 143):
        run_classifier(args)
    # El resultado del clasificador nunca cambia el código de salida del cron.
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

if __name__ == '__main__':
    sys.exit(main())

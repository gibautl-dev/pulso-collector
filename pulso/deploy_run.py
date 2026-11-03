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

def run_command(command, timeout):
    started = time.monotonic()
    child = subprocess.Popen(command, start_new_session=True)
    cancelled = False
    def on_signal(signum, frame):
        nonlocal cancelled
        cancelled = True
        stop(child)
    previous = {s: signal.signal(s, on_signal) for s in (signal.SIGTERM, signal.SIGINT)}
    try:
        log(event='cron_started')
        try:
            code = child.wait(timeout=timeout)
            code = 143 if cancelled else (code if code >= 0 else 128-code)
        except subprocess.TimeoutExpired:
            stop(child)
            code = 124
            log(event='cron_timeout', timeout_seconds=timeout)
        log(event='cron_finished', exit_code=code,
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
        return run_command([sys.executable, '-m', 'pulso.collect_rss', *args], timeout)
    except Exception as exc:
        log(event='cron_error', error_type=type(exc).__name__)
        return 2

if __name__ == '__main__':
    sys.exit(main())

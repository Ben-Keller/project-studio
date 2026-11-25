"""Native startup, instance lock and service recovery; disposable workspace only."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request

root=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='studio-native-') as directory:
    with socket.socket() as probe:
        probe.bind(('127.0.0.1',0)); port=probe.getsockname()[1]
    env={**os.environ,'PROJECT_STUDIO_DATA_DIR':directory,'PROJECT_STUDIO_PORT':str(port)}
    command=[str(root/'release/build/Project Studio.app/Contents/MacOS/ProjectStudio')]
    app=subprocess.Popen(command,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    pids=set()
    second=None
    def wait_ready(previous=None):
        for _ in range(150):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz',timeout=.3) as response: value=json.load(response)
                auth=json.loads((Path(directory)/f'auth/{port}.json').read_text())
                if value['pid']==auth['pid'] and value['pid']!=previous:
                    pids.add(value['pid']);return value['pid']
            except (OSError,ValueError,KeyError):pass
            time.sleep(.2)
        raise AssertionError('Native service did not become ready: '+(Path(directory)/'desktop.log').read_text())
    try:
        first=wait_ready()
        second=subprocess.Popen(command,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        assert second.wait(timeout=15)==0,'Second native instance did not exit'
        assert app.poll() is None
        os.kill(first,signal.SIGTERM)
        recovered=wait_ready(first)
        assert recovered!=first and app.poll() is None
        print('Native startup, duplicate-instance lock, service PID check and crash recovery passed.')
    finally:
        if second is not None and second.poll() is None:second.terminate();second.wait(timeout=10)
        app.terminate();app.wait(timeout=10)
        for pid in pids:
            try:os.kill(pid,signal.SIGTERM)
            except ProcessLookupError:pass

#!/usr/bin/env python3
"""Shared, value-free entry points for Codex, Claude and human development."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import webbrowser
import time
from app.paths import cli_command, service_command, default_port
import studio_auth
import studio_dev_access
from urllib.parse import urlencode
import studio_credentials as vault


def find_manifest(start=None):
    here = Path(start or Path.cwd()).resolve()
    for root in (here, *here.parents):
        path = root / '.studio-secrets.json'
        if path.exists():
            m = vault.read_json(path, {})
            if m.get('version') != 1 or not vault.IDENT.fullmatch(m.get('project', '')):
                raise vault.CredentialError('The Studio project reference is invalid.')
            return root, m
    raise vault.CredentialError('Connect this folder in Studio → Keys → Connect project, or run studio link --project SLUG --command "your dev command".')


def project_binding(manifest):
    existing = vault.state()['bindings'].get(manifest['project'])
    b = existing or manifest.get('vault')
    if not isinstance(b, dict) or b.get('domain') not in vault.DOMAINS or not vault.IDENT.fullmatch(b.get('project_id', '')):
        raise vault.CredentialError('Connect this project to Infisical in Studio first.')
    if not isinstance(b.get('folder'), str) or not b['folder'].startswith('/') or '..' in b['folder'].split('/'):
        raise vault.CredentialError('The vault folder is invalid.')
    for name in b.get('required', []):
        vault.validate_name(name)
    return b


def child_environment(values):
    env = {k: v for k, v in os.environ.items() if k in ('PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM', 'COLORTERM')}
    env.update(values)
    return env


class Redactor:
    """Retain enough input to mask exact values split across output chunks."""
    def __init__(self, values):
        vals = sorted({v.encode() for v in values if v}, key=len, reverse=True)
        self.pattern = re.compile(b'|'.join(re.escape(v) for v in vals)) if vals else None
        self.keep = max((len(v) for v in vals), default=1) - 1
        self.buffer = b''

    def feed(self, chunk=b'', final=False):
        self.buffer += chunk
        end = len(self.buffer) if final else max(0, len(self.buffer) - self.keep)
        if self.pattern:
            for match in self.pattern.finditer(self.buffer):
                if match.start() < end < match.end():
                    end = match.end()
        ready, self.buffer = self.buffer[:end], self.buffer[end:]
        return self.pattern.sub(b'[REDACTED]', ready) if self.pattern else ready


def run_commands(commands, root, values):
    if not isinstance(commands, list) or not commands or any(not isinstance(c, list) or not c or any(not isinstance(x, str) for x in c) for c in commands):
        raise vault.CredentialError('This profile needs a list of command argument lists in .studio-secrets.json.')
    processes, workers = [], []
    stopped = threading.Event()
    output_lock = threading.Lock()
    def forward(proc):
        redactor = Redactor(values.values())
        while True:
            chunk = proc.stdout.read1(4096)
            if not chunk:
                break
            with output_lock:
                sys.stdout.buffer.write(redactor.feed(chunk))
                sys.stdout.buffer.flush()
        with output_lock:
            sys.stdout.buffer.write(redactor.feed(final=True))
            sys.stdout.buffer.flush()
    def stop(*_):
        stopped.set()
        for p in processes:
            try:
                os.killpg(p.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    old = {}
    for sig in (signal.SIGTERM, signal.SIGINT):
        old[sig] = signal.signal(sig, stop)
    try:
        for command in commands:
            p = subprocess.Popen(command, cwd=root, env=child_environment(values),
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
            processes.append(p)
            worker = threading.Thread(target=forward, args=(p,), daemon=True)
            worker.start()
            workers.append(worker)
        # A failing component should stop its coupled siblings, not hang forever.
        import time
        result = 0
        while any(p.poll() is None for p in processes):
            if stopped.is_set():
                result = 130
                break
            failure = next((p.returncode for p in processes if p.poll() not in (None, 0)), None)
            if failure is not None:
                result = failure
                stop()
                break
            time.sleep(.1)
        for p in processes:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
        for worker in workers:
            worker.join(timeout=5)
        return result or next((p.returncode for p in processes if p.returncode), 0)
    finally:
        stop()
        for p in processes:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid, signal.SIGKILL)
                p.wait()
        for worker in workers:
            worker.join(timeout=5)
        for p in processes:
            p.stdout.close()
        for sig, handler in old.items():
            signal.signal(sig, handler)


def run_profile(profile, command=None):
    root, m = find_manifest()
    commands = [command] if command else m.get('profiles', {}).get(profile)
    if not commands:
        raise vault.CredentialError('That profile is not configured. Add its command to .studio-secrets.json; profile names never select a production environment.')
    # Explicit offline profiles receive a clean environment and never consult the vault.
    local_profiles = m.get('local_profiles', [])
    if not isinstance(local_profiles, list) or any(not isinstance(name, str) for name in local_profiles):
        raise vault.CredentialError('local_profiles must be a list of explicitly local profile names.')
    if profile in local_profiles:
        print('Studio: local profile; no vault keys loaded.', flush=True)
        return run_commands(commands, Path.cwd() if command else root, {})
    b = vault.consumer_scope(project_binding(m), m.get('profile_consumers', {}).get(profile, 'default'))
    # Runtime helpers deliberately have no environment override. Always dev.
    values = studio_dev_access.fetch_values(b, 'dev')
    required = b.get('required', [])
    missing = [n for n in required if not values.get(n)]
    if missing:
        raise vault.CredentialError('Missing development keys: ' + ', '.join(missing) + '. Use studio secrets add NAME.')
    selected = {n: values[n] for n in required}
    print('Studio: development keys loaded for ' + m['project'] + '; values hidden.', flush=True)
    return run_commands(commands, Path.cwd() if command else root, selected)


def open_entry(project, name='', consumer='default'):
    url = f'http://127.0.0.1:{default_port()}/credentials?' + urlencode({'project': project, 'name': name, 'consumer': consumer}) + '#add'
    open_studio(url)
    print('Enter the value in Studio’s Add key form. Do not paste it in the agent chat.')


def open_studio(url=None):
    port=default_port()
    requested_url=url
    url=url or f'http://127.0.0.1:{port}/'
    if getattr(sys, 'frozen', False):
        # The native window owns the packaged service, including recovery and updates.
        bundle=Path(sys.executable).resolve().parents[3]
        subprocess.run(['open',str(bundle)],check=True)
    else:
        subprocess.Popen(service_command()+['--port',str(port),'--no-open'],
                         stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
    import urllib.request
    time.sleep(.5)
    for _ in range(100):
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/healthz', timeout=.3) as response:
                if response.status == 200:
                    target = studio_auth.owner_url(url)
                    if requested_url is not None or not getattr(sys, 'frozen', False):webbrowser.open(target)
                    return
        except (OSError, ValueError):
            pass
        time.sleep(.1)
    raise vault.CredentialError('Studio could not start. Open its desktop app and try again.')


def main(argv=None):
    from app.cli import COMMANDS, main as portable_main
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments)>1 and arguments[0]=='helper':
        import spa_static_server, static_site_server
        helper={'spa':spa_static_server,'static':static_site_server}.get(arguments[1])
        if helper is None: raise ValueError('Unknown bundled helper')
        sys.argv=[arguments[1],*arguments[2:]]
        return helper.main()
    if arguments and arguments[0] in COMMANDS:
        return portable_main(arguments)
    parser = argparse.ArgumentParser(description='Project Studio shared credential workflow for Codex and Claude')
    sub = parser.add_subparsers(dest='action', required=True)
    access = sub.add_parser('access', help='Manage this computer’s restricted development access')
    access.add_argument('access_action', choices=['renew', 'lock'])
    sub.add_parser('open', help='Open and unlock Studio on this computer')
    sub.add_parser('dev', help='Run the declared dev profile with development keys')
    check = sub.add_parser('check', help='Run an explicitly configured test profile with development keys')
    check.add_argument('--profile', default='integration')
    named = sub.add_parser('run', help='Run a named profile from .studio-secrets.json with development keys')
    named.add_argument('profile_name')
    run = sub.add_parser('_run', help=argparse.SUPPRESS)
    run.add_argument('command', nargs=argparse.REMAINDER)
    link = sub.add_parser('link', help='Write a portable project reference in the current directory')
    link.add_argument('--project', required=True)
    link.add_argument('--command', required=True)
    secrets_parser = sub.add_parser('secrets')
    ss = secrets_parser.add_subparsers(dest='secret_action', required=True)
    status = ss.add_parser('status')
    status.add_argument('--consumer', default='default')
    add = ss.add_parser('add')
    add.add_argument('name')
    add.add_argument('--consumer', default='default')
    imp = ss.add_parser('import', help='Copy chosen names from a local .env file into the development vault')
    imp.add_argument('file')
    imp.add_argument('--names', required=True, help='Comma-separated variable names')
    imp.add_argument('--consumer', default='default')
    imp.add_argument('--project', help='Studio project slug, when the folder has no .studio-secrets.json')
    plan = ss.add_parser('plan')
    plan.add_argument('--target', choices=('staging', 'prod'), default='staging')
    keys = sub.add_parser('keys', help='Keys that expire or are due for rotation soon')
    ks = keys.add_subparsers(dest='keys_action', required=True)
    due = ks.add_parser('due', help='List keys expiring or due within --days (overdue included)')
    due.add_argument('--days', type=int, default=30)
    due.add_argument('--notify', action='store_true', help='Also show a macOS notification when anything is listed')
    reminders = ks.add_parser('reminders', help='Daily 09:41 notification about keys due within 14 days')
    reminders.add_argument('state', choices=('on', 'off', 'status'))
    args = parser.parse_args(argv)
    try:
        if args.action == 'access':
            if args.access_action == 'lock':
                vault.cli(['logout'], vault.DOMAINS[0])
                print('Administrator CLI session ended. Restricted development access is unchanged.')
                return 0
            print(json.dumps(studio_dev_access.renew(), indent=2))
            return 0
        if args.action == 'open':
            open_studio()
            return 0
        if args.action == 'link':
            b = vault.binding(args.project)
            target = Path.cwd() / '.studio-secrets.json'
            if target.exists():
                raise vault.CredentialError('A reference already exists. Edit it in place to preserve its profiles.')
            vault.save_json(target, {'version': 1, 'project': args.project, 'vault': b,
                                    'profiles': {'dev': [['/bin/bash', '-c', args.command]]}})
            install_instructions(Path.cwd())
            print('Project linked. Commit .studio-secrets.json and the shared agent instructions; they contain no keys.')
            return 0
        if args.action == 'keys':
            return keys_command(args)
        if args.action == 'run':
            return run_profile(args.profile_name)
        if args.action == 'secrets' and args.secret_action == 'import':
            try:
                root, m = find_manifest()
            except vault.CredentialError:
                root, m = None, None
            project = args.project or (m or {}).get('project')
            if not project:
                raise vault.CredentialError('Run this inside a linked project folder or pass --project SLUG.')
            names = [n.strip() for n in args.names.split(',') if n.strip()]
            results = vault.import_env(project, args.file, names, args.consumer)
            if m is not None and m.get('project') == project:
                m['vault'] = vault.binding(project)
                vault.save_json(root / '.studio-secrets.json', m)
            print(json.dumps({'project': project, 'environment': 'dev', 'consumer': args.consumer, 'results': results}, indent=2))
            print('The values are still in the file as well. Remove those lines once the app runs from the vault.', file=sys.stderr)
            return 0
        if args.action in ('dev', 'check', '_run'):
            command = args.command if args.action == '_run' else None
            if command and command[0] == '--':
                command = command[1:]
            return run_profile(getattr(args, 'profile', 'dev'), command)
        root, m = find_manifest()
        b = vault.consumer_scope(project_binding(m), getattr(args, 'consumer', 'default'))
        if args.secret_action == 'add':
            open_entry(m['project'], vault.validate_name(args.name), args.consumer)
        elif args.secret_action == 'status':
            values = studio_dev_access.fetch_values(b, 'dev')
            print(json.dumps({'project': m['project'], 'environment': 'dev',
                              'configured': sorted(n for n in b['required'] if values.get(n)),
                              'missing': sorted(n for n in b['required'] if not values.get(n))}, indent=2))
        else:
            records = [r for r in vault.inventory()['credentials'] if r.get('studio_project') == m['project'] or r.get('root') == str(root)]
            print(json.dumps({'project': m['project'], 'target': args.target, 'writes': False,
                              'required_names': b['required'], 'known_consumers': [{'name': r['name'], 'store': r['store'], 'environment': r['environment']} for r in records],
                              'steps': ['Create separate target credentials at each issuer.', 'Save in the matching vault environment.', 'Update every listed deployment and GitHub secret.', 'Restart, test, then revoke old keys at the issuer.'],
                              'coverage': 'Inventory evidence only; verify deployed destinations after service login.'}, indent=2))
        return 0
    except vault.CredentialError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except Exception:
        print('Studio could not complete this operation. No secret values are included in this error.', file=sys.stderr)
        return 2


REMINDER_LABEL = 'org.projectstudio.key-reminders'
REMINDER_PLIST = Path.home() / 'Library' / 'LaunchAgents' / f'{REMINDER_LABEL}.plist'


def notify(headline, body):
    script = ['-e', 'on run argv', '-e', 'display notification (item 2 of argv) with title "Project Studio" subtitle (item 1 of argv) sound name "default"', '-e', 'end run']
    result = subprocess.run(['/usr/bin/osascript', *script, headline, body], check=False, capture_output=True)
    if result.returncode:
        raise vault.CredentialError('The key reminder could not be delivered. Check macOS notification permissions; studio keys due still lists the dates.')


def keys_command(args):
    if args.keys_action == 'due':
        items = vault.upcoming(args.days)
        if not items:
            print(f'Nothing expires or is due in the next {args.days} days.')
            return 0
        for i in items:
            d = i['days_left']
            left = f'{-d}d overdue' if d < 0 else 'today' if d == 0 else f'in {d}d'
            hint = f"  ({i['hint']})" if i['hint'] else ''
            print(f"{i['date']}  {left:>12}  {i['kind']:<22} {i['name']} · {i['project']}{hint}")
        if args.notify:
            notify(*vault.reminder_text(items))
        return 0
    import plistlib
    uid = str(os.getuid())
    if args.state == 'status':
        loaded = subprocess.run(['launchctl', 'print', f'gui/{uid}/{REMINDER_LABEL}'], capture_output=True).returncode == 0
        print('Daily key reminders are on (09:41).' if loaded else 'Reminder file exists but the job is not loaded.' if REMINDER_PLIST.exists() else 'Daily key reminders are off.')
        return 0
    subprocess.run(['launchctl', 'bootout', f'gui/{uid}', str(REMINDER_PLIST)], capture_output=True)
    if args.state == 'off':
        REMINDER_PLIST.unlink(missing_ok=True)
        print('Daily key reminders turned off.')
        return 0
    log = Path.home() / '.local' / 'state' / 'project-studio' / 'key-reminders.log'
    log.parent.mkdir(parents=True, exist_ok=True)
    REMINDER_PLIST.parent.mkdir(parents=True, exist_ok=True)
    REMINDER_PLIST.write_bytes(plistlib.dumps({
        'Label': REMINDER_LABEL,
        'ProgramArguments': cli_command()+['keys', 'due', '--days', '14', '--notify'],
        'WorkingDirectory': str(vault.ROOT),
        'StartCalendarInterval': {'Hour': 9, 'Minute': 41},
        'StandardOutPath': str(log), 'StandardErrorPath': str(log)}))
    r = subprocess.run(['launchctl', 'bootstrap', f'gui/{uid}', str(REMINDER_PLIST)], capture_output=True, text=True)
    if r.returncode:
        raise vault.CredentialError('launchctl could not load the reminder: ' + (r.stderr.strip() or 'unknown error'))
    items = vault.upcoming(14)
    if items:
        notify(*vault.reminder_text(items))
    print('Daily key reminders are on: a notification at 09:41 when anything expires or is due within 14 days.')
    return 0


def install_instructions(root):
    text = (vault.ROOT / 'assets' / 'docs' / 'shared-credentials.md').read_text()

    folder = root / '.studio'
    folder.mkdir(exist_ok=True)
    guide = folder / 'credentials.md'
    # Generated from Studio's copy; refreshed so every linked project carries the current guide.
    if not guide.exists() or guide.read_text() != text:
        guide.write_text(text)
    marker = '\n\n<!-- studio-credentials -->\nFor keys and development startup, follow [.studio/credentials.md](.studio/credentials.md). The same workflow applies to Codex and Claude.\n'
    for name in ('AGENTS.md', 'CLAUDE.md'):
        path = root / name
        old = path.read_text() if path.exists() else ''
        if '<!-- studio-credentials -->' not in old:
            path.write_text(old + marker)


if __name__ == '__main__':
    raise SystemExit(main())

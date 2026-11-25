"""Studio credential metadata and Infisical boundary. Never persist secret values."""
from __future__ import annotations

import datetime as dt
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import threading
import studio_auth
from credential_triage import CLASSES, enrich_inventory
from urllib.parse import urlparse

from app.paths import state_root, inventory_root
ROOT = Path(__file__).resolve().parent
DATA = state_root() / 'credentials'
SEED = inventory_root() / 'credential-register.json'
DEPLOYMENTS = state_root() / 'deployment-credential-inventory.json'
LOCK = threading.RLock()
CSRF = secrets.token_urlsafe(32)
NAME = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,127}$')
IDENT = re.compile(r'^[A-Za-z0-9_-]{1,100}$')
DOMAINS = ('https://app.infisical.com', 'https://eu.infisical.com')


class CredentialError(Exception):
    """Only fixed, value-free user messages may cross the HTTP/CLI boundary."""


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except FileNotFoundError:
        return default
    except (ValueError, OSError):
        raise CredentialError('Could not read Studio metadata. Restore the metadata backup before continuing.')


def save_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = path.with_name(path.name + '.' + secrets.token_hex(6) + '.tmp')
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(data, f, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


def state():
    return read_json(DATA / 'state.json', {'bindings': {}, 'overrides': {}, 'entries': [], 'events': []})


def persist(s, action, project, name=None):
    s['events'].append({'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'action': action,
                        'project': project, 'name': name})
    s['events'] = s['events'][-500:]
    save_json(DATA / 'state.json', s)


def inventory():
    base = read_json(SEED, {})
    from app.registry import catalog
    base.setdefault('studio_cards', [{'slug': item['slug'], 'name': item['name'], 'roots': sorted({p['repo'] for p in item.get('processes', [])})} for item in catalog()['apps']])
    s = state()
    deployment = read_json(DEPLOYMENTS, {})
    discovered = deployment_records(deployment, base.get('studio_cards', []))
    base['credentials'] = [dict(c, **s['overrides'].get(c['id'], {})) for c in [*base.get('credentials', []), *discovered]] + s['entries']
    base['bindings'] = s['bindings']
    base['events'] = s['events']
    base['google_coverage'] = s.get('google_coverage', {})
    base['deployment_coverage'] = deployment_summary(deployment)
    import studio_dev_access
    access = read_json(studio_dev_access.CONFIG, {})
    base['access_protection'] = {'development_projects': sum(e.get('status') == 'verified' for e in access.get('projects', {}).values()), 'development_expires_at': access.get('shared_development_identity', {}).get('expires_at'), 'staging': 'Migration pending', 'production': 'Migration pending'}
    base['phase'] = 'Implementation active. Vault copies and issuer rotations are tracked separately.'
    base.setdefault('counts', {})['total_register_records'] = len(base['credentials'])
    base['counts']['vault_records'] = sum(c.get('store') == 'Infisical' for c in base['credentials'])
    inv = enrich_inventory(base, read_json(inventory_root() / 'credential-review.json', {}))
    inv['upcoming'] = upcoming(30, inv=inv)
    return inv


def deployment_records(snapshot, cards):
    """Project allowlist plus field allowlist: never forward raw provider objects."""
    names = {c['slug']: c['name'] for c in cards}
    records = snapshot.get('records', [])
    result = []
    for r in records:
        project = r.get('studio_project')
        if r.get('store') != 'Azure App Service' or not r.get('value_group') or project not in names:
            continue
        name = r.get('name', '')
        if not NAME.fullmatch(name):
            continue
        location = r.get('resource_id', '')
        record_id = 'azure-' + hashlib.sha256(f'{location}:{r.get("setting_type")}:{name}'.encode()).hexdigest()[:16]
        consumers = []
        for other in records:
            if other.get('value_group') != r['value_group']:
                continue
            if other.get('store') == 'Local environment':
                consumers.append(f'Local {other.get("path", "")}: {other.get("name", "")}')
            elif other.get('store') in ('Azure App Service', 'Railway'):
                consumers.append(f'{other["store"]} {other.get("service", "")} / {other.get("environment", "")}: {other.get("name", "")}')
        instructions = 'Issue a replacement at the provider; update every mapped consumer and matching GitHub deployment secret, redeploy, verify the integration, then revoke the old credential. Record actual expiry and rotation date.'
        note = 'Deployed value presence verified; no value saved to Studio. Expiry and issuer validity remain unverified. Equality comparison covers complete values; embedded credentials in connection strings may have additional consumers.'
        if any(part in name for part in ('JWT', 'APP_KEYS', 'SALT', 'SESSION_SECRET')):
            instructions = 'Application signing or token material. Inspect framework key-ring support and session/token migration before replacing. Verify both staging and production consumers; changing a signing secret may invalidate sessions, API tokens or transfers. Record the migration and retirement evidence.'
        elif any(part in name for part in ('DATABASE', 'CONNECTION_STRING')):
            instructions = 'Identify the underlying database, storage, messaging or email credential inside the connection string. Rotate at its issuer with an overlap/migration plan, update all connection consumers, restart and verify, then retire the old credential. Do not replace the connection string with a random value.'
        elif name == 'STORAGE_ACCOUNT_KEY':
            instructions = 'Identify the Azure storage account and active key slot. Inventory raw-key and connection-string consumers. Move consumers to an alternate valid slot, verify storage operations, regenerate the retired slot, then update the vault and record evidence.'
        if r.get('service') == 'sea-backend':
            note += ' Academy staging and production currently share this value; separate environments before independent rotation.'
        if name == 'EDIM_AZURITE_CONNECTION_STRING':
            note += ' Verify whether this is a standard emulator connection or a real service credential before treating it as a live issuer key.'
        result.append({'id': record_id, 'studio_project': project, 'project': names[project], 'name': name,
                       'provider': 'Azure / application', 'store': 'Azure App Service', 'kind': 'Deployed credential candidate',
                       'environment': r.get('environment'), 'consumer': r.get('service'), 'priority': 'Planned',
                       'rotation_status': 'not started', 'expiry_status': 'unknown', 'expires_at': None,
                       'last_inventory_at': snapshot.get('checked_at', '')[:10],
                       'consumers': '\n'.join(consumers), 'update_instructions': instructions, 'note': note,
                       'evidence': [{'location': location + ' / ' + r.get('setting_type', '') + ' / ' + name}]})
    return result


def deployment_summary(snapshot):
    if not snapshot:
        return {}
    scopes = []
    for r in snapshot.get('coverage', []):
        if r.get('store') not in ('Railway', 'Azure App Service') or 'service' not in r:
            continue
        matches = [x for x in snapshot.get('records', []) if x.get('store') == r['store'] and x.get('service') == r['service'] and x.get('environment') == r.get('environment') and x.get('setting_type') == r.get('setting_type')]
        count = sum(bool(x.get('value_group')) for x in matches)
        result = f'{count} credential entries mapped; issuer rotation pending' if r.get('status') == 'ok' else 'Access or discovery incomplete'
        scopes.append({'provider': r['store'], 'scope': ' / '.join(str(r[k]) for k in ('project', 'service', 'environment', 'setting_type') if r.get(k)), 'result': result})
    return {'checked_at': snapshot.get('checked_at'),
            'summary': 'Deployment settings checked ' + str(snapshot.get('checked_at', 'unknown')) + '. Matching values link known consumers; discovery does not prove there are no other copies.',
            'scopes': scopes}


def cli_path():
    for path in [shutil.which('infisical'), '/opt/homebrew/bin/infisical', '/usr/local/bin/infisical']:
        if path and Path(path).is_file():
            return path
    raise CredentialError('Install Infisical, then log in from your own terminal. See Getting started.')


def cli(args, domain, input_text=None, *, machine_token=None):
    if domain not in DOMAINS:
        raise CredentialError('Choose the US or EU Infisical Cloud instance.')
    # Do not inherit a machine token, debug setting, or unrelated provider key.
    env = {k: v for k, v in os.environ.items() if k in ('HOME', 'PATH', 'USER', 'TMPDIR', 'LANG', 'LC_ALL')}
    env.update(INFISICAL_DISABLE_UPDATE_CHECK='true', NO_COLOR='1')
    if machine_token:
        env['INFISICAL_TOKEN'] = machine_token
    try:
        result = subprocess.run([cli_path(), *args, '--domain', domain, '--silent'],
                                input=input_text or '', text=True, capture_output=True,
                                env=env, cwd=ROOT, timeout=45)
    except (subprocess.TimeoutExpired, OSError):
        raise CredentialError('Infisical did not respond. Check your connection and log in again.')
    if result.returncode:
        # Provider errors can echo a supplied value. Never forward stdout/stderr.
        raise CredentialError('Infisical could not complete the request. Check login, project ID, environment, folder and access in the vault.')
    return result.stdout


def binding(project):
    b = state()['bindings'].get(project)
    if not b:
        raise CredentialError('Connect this project to Infisical in Studio first.')
    return b


def consumer_scope(b, consumer='default'):
    consumer = consumer or 'default'
    if consumer == 'default':
        return dict(b, consumer='default')
    scope = b.get('consumers', {}).get(consumer)
    if not isinstance(scope, dict):
        raise CredentialError('Choose a configured consumer for this project.')
    folder = scope.get('folder', '')
    if not re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]*', folder) or '..' in folder.split('/'):
        raise CredentialError('The consumer vault folder is invalid.')
    required = [validate_name(n) for n in scope.get('required', [])]
    return dict(b, folder=folder, required=required, consumer=consumer)


def scope_args(b, environment='dev'):
    if environment not in ('dev', 'staging', 'prod'):
        raise CredentialError('Choose Development, Staging or Production.')
    project_id = b.get('development_project_id', b['project_id']) if environment == 'dev' else b['project_id']
    return ['--projectId', project_id, '--env', environment, '--path', b['folder']]


def fetch_values(b, environment='dev'):
    raw = cli(['export', '--format=json', '--include-imports=false', '--expand=false', '--secret-overriding=false',
               *scope_args(b, environment)], b['domain'])
    try:
        entries = json.loads(raw)
        if not isinstance(entries, list):
            raise ValueError()
        return {x['key']: x['value'] for x in entries
                if isinstance(x, dict) and NAME.fullmatch(x.get('key', '')) and isinstance(x.get('value'), str)}
    except (ValueError, KeyError, TypeError):
        raise CredentialError('Infisical returned an unsupported response. No values were displayed or saved.')


def vault_status(project, environment='dev', consumer='default'):
    b = consumer_scope(binding(project), consumer)
    values = fetch_values(b, environment)
    # Allowlist response: no provider response objects, values, or raw error details.
    return {'project': project, 'environment': environment, 'consumer': b['consumer'], 'folder': b['folder'], 'names': sorted(values),
            'missing': sorted(set(b['required']) - values.keys()), 'connected': True}


def validate_name(name):
    if not isinstance(name, str) or not NAME.fullmatch(name):
        raise CredentialError('Use a variable name containing letters, numbers and underscores.')
    return name


def dates(data):
    out = {}
    for key in ('expires_at', 'rotation_due_at', 'last_rotated_at'):
        value = data.get(key) or None
        if value:
            try:
                dt.date.fromisoformat(value)
            except (ValueError, TypeError):
                raise CredentialError('Enter dates as YYYY-MM-DD.')
        out[key] = value
    return out


def configure(data):
    project = data.get('project', '')
    base = read_json(SEED, {})
    cards = {c['slug']: c for c in base.get('studio_cards', [])}
    if project not in cards:
        raise CredentialError('Choose a registered Studio project.')
    project_id = data.get('project_id', '')
    if not IDENT.fullmatch(project_id):
        raise CredentialError('Enter the project ID from Infisical project settings.')
    domain = data.get('domain', DOMAINS[0])
    folder = data.get('folder', '/')
    if domain not in DOMAINS or not re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/)*[A-Za-z0-9_.-]*', folder) or '..' in folder.split('/'):
        raise CredentialError('Choose a Cloud instance and a valid vault folder path.')
    required = sorted(set(validate_name(n) for n in data.get('required', [])))
    s = state()
    consumers = data.get('consumers', s['bindings'].get(project, {}).get('consumers', {}))
    if not isinstance(consumers, dict):
        raise CredentialError('Consumer definitions must be a named mapping.')
    for key, scope in consumers.items():
        if not IDENT.fullmatch(key) or key == 'default':
            raise CredentialError('Use a unique consumer name containing letters, numbers, hyphens or underscores.')
        consumer_scope({'consumers': consumers}, key)
    previous_binding = s['bindings'].get(project, {})
    development_project_id = previous_binding.get('development_project_id') if previous_binding.get('project_id') == project_id and previous_binding.get('domain') == domain else None
    s['bindings'][project] = {'project_id': project_id, 'domain': domain, 'folder': folder,
                              'required': required, 'name': cards[project]['name'], 'consumers': consumers}
    if development_project_id:
        s['bindings'][project]['development_project_id'] = development_project_id
    persist(s, 'Project connected (reference only)', project)
    return {'ok': True}


def add_secret(data):
    project = data.get('project')
    b = consumer_scope(binding(project), data.get('consumer', 'default'))
    name = validate_name(data.get('name'))
    environment = data.get('environment', 'dev')
    value = data.get('value')
    if not isinstance(value, str) or not value or len(value.encode()) > 65536 or '\0' in value:
        raise CredentialError('Enter a non-empty key up to 64 KB, without null characters.')
    metadata = dates(data)
    previous = fetch_values(b, environment)
    if name in previous and not data.get('replace'):
        raise CredentialError('This name already exists. Select Replace existing key to update it.')
    # The value travels over a private pipe; never an argument, temporary file or log.
    cli(['secrets', 'set', name + '=@/dev/stdin', *scope_args(b, environment)], b['domain'], value)
    verified = fetch_values(b, environment).get(name) == value
    if not verified:
        raise CredentialError('The write may have succeeded, but verification did not match. Check the vault before retrying.')
    s = state()
    entry_id = 'vault-' + hashlib.sha256(f'{project}:{environment}:{b["folder"]}:{name}'.encode()).hexdigest()[:16]
    existing = next((e for e in s['entries'] if e.get('studio_project') == project and e.get('environment') == environment and e.get('name') == name and e.get('vault_reference', {}).get('folder') == b['folder'] and e.get('store') == 'Infisical'), None)
    if existing:
        entry_id = existing['id']
    entry = {'id': entry_id, 'project': b['name'], 'studio_project': project, 'name': name,
             'provider': str(data.get('provider', 'Unspecified'))[:100], 'store': 'Infisical',
             'kind': 'Managed credential', 'environment': environment, 'consumer': b['consumer'], 'priority': 'Managed',
             'owner': str(data.get('owner', ''))[:120], 'note': str(data.get('note', ''))[:2000],
             'vault_reference': {'project_id': b.get('development_project_id', b['project_id']) if environment == 'dev' else b['project_id'], 'folder': b['folder'], 'domain': b['domain']},
             'rotation_status': 'stored; consumers need verification',
             'expiry_status': 'verified' if metadata['expires_at'] else 'unknown',
             'last_inventory_at': dt.date.today().isoformat(),
             'last_value_saved_at': dt.datetime.now(dt.timezone.utc).isoformat(), **metadata}
    if existing:
        s['entries'].remove(existing)
    s['entries'].append(entry)
    if environment == 'dev' and name not in b['required']:
        target = s['bindings'][project] if b['consumer'] == 'default' else s['bindings'][project]['consumers'][b['consumer']]
        target.setdefault('required', []).append(name)
    persist(s, 'Vault value saved and verified; restart consumers', project, name)
    return {'ok': True, 'message': 'Saved and verified in Infisical. Restart affected consumers. Provider rotation and old-key revocation are still separate steps.'}



def parse_env_file(path):
    """Read KEY=VALUE pairs from a dotenv file in memory. Multi-line values come back as None."""
    values = {}
    for line in Path(path).read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        m = re.match(r'^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$', stripped)
        if not m:
            continue
        name, raw = m.groups()
        if raw[:1] in ('"', "'"):
            quote, end = raw[0], raw.find(raw[0], 1)
            while quote == '"' and end > 0 and raw[end - 1] == '\\':
                end = raw.find(quote, end + 1)
            if end < 0:
                values[name] = None
                continue
            value = raw[1:end]
            if quote == '"':
                value = value.replace('\\n', '\n').replace('\\"', '"').replace('\\\\', '\\')
        else:
            value = re.split(r'\s+#', raw, maxsplit=1)[0].strip()
        values[name] = value
    return values


def import_env(project, path, names, consumer='default'):
    """Copy chosen names from a local dotenv file into the development vault, one verified write each."""
    path = Path(path).expanduser()
    if not path.is_file():
        raise CredentialError('That file does not exist.')
    found = parse_env_file(path)
    results = []
    for name in names:
        validate_name(name)
        value = found.get(name)
        if name not in found:
            results.append({'name': name, 'result': 'not in file'})
        elif not value:
            results.append({'name': name, 'result': 'empty or multi-line; use studio secrets add'})
        else:
            add_secret({'project': project, 'consumer': consumer, 'name': name, 'value': value,
                        'environment': 'dev', 'replace': True, 'note': 'Imported from ' + path.name})
            results.append({'name': name, 'result': 'saved and verified in development'})
    return results

def update_record(data):
    record_id = data.get('id')
    current = next((e for e in inventory()['credentials'] if e['id'] == record_id), None)
    if not current:
        raise CredentialError('Credential record not found.')
    allowed = ('owner', 'note', 'rotation_status', 'expiry_status', 'consumers', 'update_instructions', 'tracking_class', 'tracking_reason')
    fields = {k: str(data[k])[:4000] for k in allowed if k in data}
    fields.update(dates(data))
    if 'tracking_class' in fields:
        if fields['tracking_class'] not in {'auto', *CLASSES}:
            raise CredentialError('Choose a valid tracking category.')
        if fields['tracking_class'] != 'auto' and not fields.get('tracking_reason', '').strip():
            raise CredentialError('Record why this category applies. No secret values.')
    if fields.get('expiry_status') == 'verified' and not fields['expires_at']:
        raise CredentialError('Enter the verified expiry date or choose Unknown.')
    if fields.get('expiry_status') == 'no expiry':
        fields['expires_at'] = None
    if fields.get('rotation_status') == 'complete' and not fields.get('last_rotated_at'):
        raise CredentialError('Record the actual rotation date before marking this complete.')
    s = state()
    local = next((e for e in s['entries'] if e['id'] == record_id), None)
    if local:
        local.update(fields)
    else:
        s['overrides'].setdefault(record_id, {}).update(fields)
    persist(s, 'Credential metadata updated', current['project'], current['name'])
    return {'ok': True}


def write_manifest(data):
    project = data.get('project')
    binding(project)
    root = Path(data.get('root', '')).expanduser().resolve()
    card = next(c for c in read_json(SEED, {}).get('studio_cards', []) if c['slug'] == project)
    permitted = {str(Path(p).resolve()) for p in card['paths']}
    if str(root) not in permitted or not root.is_dir():
        raise CredentialError('Choose an existing folder listed for this project.')
    from install_related_desktop_apps import default_apps
    commands = []
    for app in default_apps():
        if app.slug == project:
            for proc in app.processes:
                if proc.repo.resolve() == root:
                    commands.append(['/bin/bash', '-c', proc.command])
    if not commands:
        raise CredentialError('No launch command is registered for that folder. Add a profile using studio link in its terminal.')
    target = root / '.studio-secrets.json'
    if target.exists():
        old = read_json(target, {})
        if old.get('project') != project:
            raise CredentialError('This folder is already linked to another project. Keep its existing reference or choose another folder.')
        old['vault'] = binding(project)
        save_json(target, old)
        from studio_cli import install_instructions
        install_instructions(root)
        return {'ok': True, 'message': 'Vault reference refreshed; existing command profiles preserved. Commit the reference for other computers.', 'path': str(target)}
    manifest = {'version': 1, 'project': project, 'vault': binding(project), 'profiles': {'dev': commands}}
    save_json(target, manifest)
    from studio_cli import install_instructions
    install_instructions(root)
    return {'ok': True, 'message': 'Project reference installed. Commit .studio-secrets.json so clones and worktrees retain the connection.', 'path': str(target)}


def authorized(handler, mutation=False):
    if not studio_auth.authenticated(handler):
        return False
    port = handler.server.server_port
    expected = {f'127.0.0.1:{port}', f'localhost:{port}'}
    try:
        local = ipaddress.ip_address(handler.client_address[0]).is_loopback
    except ValueError:
        local = False
    if not local or handler.headers.get('Host') not in expected:
        return False
    if handler.headers.get('Sec-Fetch-Site') not in (None, 'same-origin', 'none'):
        return False
    origin = handler.headers.get('Origin')
    if origin and origin != 'http://' + handler.headers.get('Host', ''):
        return False
    if mutation:
        return origin == 'http://' + handler.headers.get('Host', '') and secrets.compare_digest(handler.headers.get('X-Studio-CSRF', ''), CSRF)
    return True


def respond(handler, payload, status=200, kind='application/json'):
    if kind == 'text/html':
        payload = studio_auth.inject(payload)
    body = (json.dumps(payload) if kind == 'application/json' else payload).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', kind + '; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    handler.send_header('X-Content-Type-Options', 'nosniff')
    handler.send_header('Referrer-Policy', 'no-referrer')
    handler.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    handler.end_headers()
    handler.wfile.write(body)


def handle(handler, mutation=False):
    path = urlparse(handler.path).path
    if path not in ('/credentials', '/credentials/report') and not path.startswith('/api/credentials/'):
        return False
    if not authorized(handler, mutation):
        respond(handler, {'error': 'This page is available only from Studio on this computer.'}, 403)
        return True
    try:
        if not mutation:
            if path == '/credentials':
                respond(handler, (ROOT / 'assets' / 'credentials.html').read_text(), kind='text/html')
            elif path == '/credentials/report':
                # Snapshot has inline scripts/styles and contains metadata only.
                body = (inventory_root() / 'credential-report.html').read_bytes() if (inventory_root() / 'credential-report.html').exists() else b'<h1>No report yet</h1><p>Connect a provider or add credential references to get started.</p>'
                handler.send_response(200)
                handler.send_header('Content-Type', 'text/html; charset=utf-8')
                handler.send_header('Cache-Control', 'no-store')
                handler.send_header('Content-Length', str(len(body)))
                handler.send_header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'")
                handler.end_headers()
                handler.wfile.write(body)
            elif path == '/api/credentials/state':
                try:
                    installed = bool(cli_path())
                except CredentialError:
                    installed = False
                respond(handler, {'csrf': CSRF, 'inventory': inventory(), 'cli_installed': installed})
            else:
                respond(handler, {'error': 'Not found'}, 404)
        else:
            if handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise CredentialError('Send a JSON request from Studio.')
            size = int(handler.headers.get('Content-Length', '0'))
            if not 0 < size <= 150000:
                raise CredentialError('The request is empty or too large.')
            data = json.loads(handler.rfile.read(size))
            if not isinstance(data, dict):
                raise CredentialError('Invalid request.')
            actions = {'connect': configure, 'save': add_secret, 'metadata': update_record,
                       'link': write_manifest, 'status': lambda d: vault_status(d['project'], d.get('environment', 'dev'), d.get('consumer', 'default'))}
            fn = actions.get(path.removeprefix('/api/credentials/'))
            if not fn:
                respond(handler, {'error': 'Not found'}, 404)
            else:
                with LOCK:
                    respond(handler, fn(data))
    except CredentialError as exc:
        respond(handler, {'error': str(exc)}, 400)
    except Exception:
        # Never include request bodies or provider output in a traceback/log/response.
        respond(handler, {'error': 'The request could not be completed. No secret values were written to Studio metadata. Check the vault before retrying a save.'}, 400)
    return True


def upcoming(days=30, today=None, inv=None):
    """Tracked keys that expire or are due for rotation within `days`, overdue ones included,
    plus this computer's development vault access. Dates and names only."""
    from zoneinfo import ZoneInfo
    today = today or dt.datetime.now(ZoneInfo('Europe/Istanbul')).date()
    inv = inv if inv is not None else inventory()
    horizon = today + dt.timedelta(days=days)
    seen, out = set(), []

    def add(name, project, kind, when, hint=''):
        try:
            day = dt.date.fromisoformat(str(when)[:10])
        except ValueError:
            return
        key = (name, project, kind, day)
        if day > horizon or key in seen:
            return
        seen.add(key)
        out.append({'name': name, 'project': project, 'kind': kind, 'date': day.isoformat(),
                    'days_left': (day - today).days, 'hint': hint})

    for r in inv.get('credentials', []):
        if not r.get('tracking_required') or r.get('rotation_status') in ('retired', 'accepted exception'):
            continue
        if r.get('expires_at'):
            add(r.get('name', ''), r.get('project', ''), 'expires', r['expires_at'])
        deadline = r.get('rotation_due_at')
        completed = r.get('last_rotated_at') if r.get('rotation_status') == 'complete' else None
        # Completion retires a past deadline, never a later review/rotation date.
        if deadline and (not completed or deadline > completed):
            kind = 'replace before expiry' if r.get('expires_at') and deadline < r['expires_at'] else 'review / rotate by'
            add(r.get('name', ''), r.get('project', ''), kind, deadline)
    access = (inv.get('access_protection') or {}).get('development_expires_at')
    if access:
        add('Development vault access', 'Project Studio', 'expires', access, 'studio access renew')
    return sorted(out, key=lambda x: (x['date'], x['project'], x['name']))


def reminder_text(items):
    """(headline, body) for a notification, or None when nothing is due."""
    if not items:
        return None
    def when(i):
        d = i['days_left']
        return f'{-d} days overdue' if d < 0 else 'today' if d == 0 else 'tomorrow' if d == 1 else f'in {d} days'
    overdue = sum(i['days_left'] < 0 for i in items)
    headline = f"{len(items)} key{'s' if len(items) != 1 else ''} to deal with" + (f', {overdue} overdue' if overdue else '')
    body = '; '.join(f"{i['name']} ({i['project']}) {i['kind']} {when(i)}" for i in items[:3])
    if len(items) > 3:
        body += f'; and {len(items) - 3} more. Studio → Keys lists them all.'
    return headline, body

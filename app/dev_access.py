"""Development-only Infisical identities. No fallback to a human login."""
import json
import os
from pathlib import Path
import shlex
import stat
import subprocess
import urllib.request
import urllib.error

from app.paths import packaged, state_root
CONFIG = state_root() / 'dev-access.json' if packaged() or os.environ.get('PROJECT_STUDIO_DATA_DIR') else Path.home() / '.local/state/project-studio/dev-access.json'
SERVICE = 'Project Studio Infisical development'


def keychain_store(identity, value):
    command = shlex.join(['add-generic-password', '-U', '-a', identity, '-s', SERVICE, '-w', value])
    result = subprocess.run(['/usr/bin/security', '-i'], input=command + '\n', text=True, capture_output=True, timeout=30)
    if result.returncode or 'SecKeychain' in result.stderr:
        raise RuntimeError('Could not save development access in macOS Keychain.')


def keychain_read(identity):
    result = subprocess.run(['/usr/bin/security', 'find-generic-password', '-a', identity, '-s', SERVICE, '-w'], capture_output=True, text=True, timeout=30)
    if result.returncode or not result.stdout.strip():
        raise RuntimeError('Development access is missing from macOS Keychain. Ask to set up this computer in Studio.')
    return result.stdout.strip()


def request(domain, path, token=None, body=None):
    if domain not in ('https://app.infisical.com', 'https://eu.infisical.com'):
        raise RuntimeError('Unsupported vault domain.')
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(domain + path, data=json.dumps(body).encode() if body is not None else None, headers=headers)
    # Authentication must never follow a server redirect to another host.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            return None
    with urllib.request.build_opener(NoRedirect).open(req, timeout=30) as response:
        return json.load(response)


def configuration(binding):
    fd = os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise RuntimeError('Development access configuration must be private.')
        data = json.load(f)
    entry = data.get('projects', {}).get(binding['project_id'])
    if not entry or entry.get('domain') != binding['domain'] or entry.get('status') != 'verified':
        raise RuntimeError('Restricted development access is not configured for this project. Ask to connect this computer; the human login will not be used.')
    if binding['folder'] not in entry.get('folders', []):
        raise RuntimeError('This development folder is not permitted. Update its restricted access in Studio.')
    return entry


def access_token(binding):
    entry = configuration(binding)
    secret = keychain_read(entry['identity_id'])
    result = request(binding['domain'], '/api/v1/auth/universal-auth/login', body={'clientId': entry['client_id'], 'clientSecret': secret})
    return result['accessToken']


def fetch_values(binding, environment='dev'):
    from app import credentials as vault
    if environment != 'dev':
        raise vault.CredentialError('Development identities cannot select staging or production.')
    try:
        entry = configuration(binding)
        token = access_token(binding)
        target = dict(binding, project_id=entry['development_project_id'], development_project_id=entry['development_project_id'])
        raw = vault.cli(['export', '--format=json', '--include-imports=false', '--expand=false', '--secret-overriding=false',
                         *vault.scope_args(target, 'dev')], binding['domain'], machine_token=token)
        entries = json.loads(raw)
        if not isinstance(entries, list):
            raise ValueError()
        return {item['key']: item['value'] for item in entries
                if isinstance(item, dict) and vault.NAME.fullmatch(item.get('key', '')) and isinstance(item.get('value'), str)}
    except vault.CredentialError:
        raise
    except Exception:
        raise vault.CredentialError('Restricted development access is unavailable or expired. Ask to renew this computer’s Studio access. No human-login fallback was attempted.') from None


def record_metadata(config):
    import datetime
    from zoneinfo import ZoneInfo
    from app import credentials as vault
    shared = config['shared_development_identity']
    expiry = datetime.datetime.fromisoformat(shared['expires_at']).astimezone(ZoneInfo('Europe/Istanbul')).date()
    state = vault.state()
    state['entries'] = [x for x in state['entries'] if x.get('id') != 'studio-development-access']
    state['entries'].append({
        'id': 'studio-development-access', 'name': 'STUDIO_DEVELOPMENT_ACCESS',
        'project': 'Studio shared development', 'provider': 'Infisical', 'store': 'macOS Keychain',
        'environment': 'dev', 'kind': 'Machine identity credential', 'priority': 'Managed',
        'owner': 'Ben', 'expires_at': expiry.isoformat(), 'expiry_status': 'verified',
        'rotation_due_at': (expiry - datetime.timedelta(days=7)).isoformat(),
        'rotation_status': 'complete', 'last_rotated_at': datetime.datetime.now(ZoneInfo('Europe/Istanbul')).date().isoformat(),
        'consumers': ['studio dev', 'studio check', 'studio secrets status', 'linked Studio launches'],
        'update_instructions': 'Run studio access renew. If requested, sign in with infisical login in your own terminal. The helper verifies the replacement, updates Keychain, and revokes the previous client credential.',
        'note': 'Read-only access to separate development-only vault projects. No membership in staging/production vaults. Runtime tokens last 15 minutes. Client credential lasts one year. Values are stored only in macOS Keychain.'})
    vault.persist(state, 'Development access metadata updated', 'Studio shared development')


def renew():
    """Serialize administration; an interrupted attempt requires deliberate recovery."""
    import fcntl
    from app import credentials as vault
    CONFIG.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(CONFIG.with_suffix('.lock'), os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as lock:
        info = os.fstat(lock.fileno())
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise vault.CredentialError('Development access lock must be private.')
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise vault.CredentialError('Development access is already being renewed. Wait for that operation.') from None
        return _renew_locked()


def _renew_locked():
    import datetime
    import uuid
    from app import credentials as vault
    config = vault.read_json(CONFIG, {})
    shared = config.get('shared_development_identity')
    if not shared:
        raise vault.CredentialError('This computer is not configured. Restore the metadata backup and follow the recovery instructions; renew does not set up a new computer.')
    if config.get('renewal_in_progress'):
        raise vault.CredentialError('A previous renewal was interrupted. Do not issue another credential. Follow the recovery instructions in Studio; its value-free record identifies the attempt.')
    domain = next(iter(config.get('projects', {}).values()), {}).get('domain', 'https://app.infisical.com')
    owner = vault.cli(['user', 'get', 'token', '--plain'], domain).strip()
    iid = shared['identity_id']
    path = '/api/v1/auth/universal-auth/identities/' + iid + '/client-secrets'
    if config.get('pending_revocation'):
        request(domain, path + '/' + config['pending_revocation'] + '/revoke', owner, {})
        config.pop('pending_revocation')
        vault.save_json(CONFIG, config)
        record_metadata(config)
        return {'renewed': True, 'completed_pending_revocation': True, 'expires_at': shared['expires_at']}
    # A missing Keychain item must be recovered deliberately, never silently replaced.
    keychain_read(iid)
    attempt = {'description': 'Studio renewal ' + str(uuid.uuid4()),
               'old_client_secret_id': shared['client_secret_id'],
               'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    config['renewal_in_progress'] = attempt
    vault.save_json(CONFIG, config)  # Persist before the remote issuance can take place.
    result = request(domain, path, owner, {'description':attempt['description'], 'ttl':31536000, 'numUsesLimit':0})
    value, new_id = result['clientSecret'], result['clientSecretData']['id']
    expiry = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=365)).isoformat()
    attempt.update(new_client_secret_id=new_id, expires_at=expiry)
    vault.save_json(CONFIG, config)  # Record both IDs before changing Keychain.
    request(domain, '/api/v1/auth/universal-auth/login', body={'clientId':shared['client_id'], 'clientSecret':value})
    keychain_store(iid, value)
    if keychain_read(iid) != value:
        raise vault.CredentialError('Keychain verification failed. Follow the recovery instructions; neither credential was automatically revoked.')
    shared.update(client_secret_id=new_id, expires_at=expiry)
    for entry in config['projects'].values():
        entry.update(client_secret_id=new_id, expires_at=expiry)
    config['pending_revocation'] = attempt['old_client_secret_id']
    config.pop('renewal_in_progress')
    vault.save_json(CONFIG, config)
    request(domain, path + '/' + config['pending_revocation'] + '/revoke', owner, {})
    config.pop('pending_revocation')
    vault.save_json(CONFIG, config)
    record_metadata(config)
    return {'renewed': True, 'expires_at': expiry}

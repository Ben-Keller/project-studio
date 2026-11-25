"""Owner-only bootstrap and port-bound browser sessions for local Studio.

No authentication cookies: cookies are shared across localhost ports. A session
is sent only in a custom header to this exact origin, never to launched apps.
"""
import html
import ipaddress
import json
import os
from pathlib import Path
import secrets
import stat
import threading
import time
from urllib.parse import urlparse, urlencode

from app.paths import auth_root
AUTH_DIR = auth_root()
SESSIONS = {}
LOCK = threading.Lock()
BOOTSTRAP = None
SESSION_TTL = 8 * 60 * 60


def private_directory(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.lstat()
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid():
        raise RuntimeError('Studio authentication directory must be owned by this user.')
    os.chmod(path, 0o700)


def initialize(port):
    global BOOTSTRAP
    private_directory(AUTH_DIR)
    BOOTSTRAP = secrets.token_urlsafe(48)
    with LOCK:
        SESSIONS.clear()
    target = AUTH_DIR / f'{port}.json'
    temporary = AUTH_DIR / (secrets.token_hex(12) + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as f:
        json.dump({'bootstrap': BOOTSTRAP, 'pid': os.getpid(), 'port': port}, f)
    os.replace(temporary, target)


def owner_url(url):
    parsed = urlparse(url)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1':
        raise RuntimeError('Studio must use its local address.')
    target = AUTH_DIR / f'{parsed.port or 80}.json'
    fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise RuntimeError('Studio authentication file is not private.')
        data = json.load(f)
    return parsed._replace(fragment=urlencode({'studio_bootstrap': data['bootstrap'], 'anchor': parsed.fragment})).geturl()


def local_request(handler, mutation=False):
    expected = {f'127.0.0.1:{handler.server.server_port}', f'localhost:{handler.server.server_port}'}
    try:
        local = ipaddress.ip_address(handler.client_address[0]).is_loopback
    except ValueError:
        local = False
    host = handler.headers.get('Host', '')
    origin = handler.headers.get('Origin')
    return (local and host in expected
            and handler.headers.get('Sec-Fetch-Site') in (None, 'same-origin', 'none')
            and (not origin or origin == 'http://' + host)
            and (not mutation or origin == 'http://' + host))


def authenticated(handler):
    token = handler.headers.get('X-Studio-Session', '')
    with LOCK:
        session = SESSIONS.get(token)
        return bool(session and session['expires'] > time.time()
                    and session['host'] == handler.headers.get('Host'))


def send(handler, data, status=200, kind='application/json'):
    body = (json.dumps(data) if kind == 'application/json' else data).encode()
    handler.send_response(status)
    handler.send_header('Content-Type', kind + '; charset=utf-8')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store')
    if kind == 'text/html' and urlparse(handler.path).path == '/credentials':
        handler.send_header('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
    handler.end_headers()
    handler.wfile.write(body)


def handle_session(handler):
    if urlparse(handler.path).path != '/api/studio/session':
        return False
    if handler.command != 'POST' or not local_request(handler, True):
        send(handler, {'error': 'Open Studio from its desktop app or run studio open.'}, 403)
        return True
    try:
        size = int(handler.headers.get('Content-Length', 0))
        if not 0 < size < 1024 or handler.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            raise ValueError()
        value = json.loads(handler.rfile.read(size)).get('bootstrap', '')
        if not isinstance(value, str) or not BOOTSTRAP or not secrets.compare_digest(value, BOOTSTRAP):
            raise ValueError()
        token = secrets.token_urlsafe(48)
        with LOCK:
            for key in list(SESSIONS):
                if SESSIONS[key]['expires'] <= time.time():
                    del SESSIONS[key]
            if len(SESSIONS) >= 64:
                del SESSIONS[next(iter(SESSIONS))]
            SESSIONS[token] = {'expires': time.time() + SESSION_TTL, 'host': handler.headers['Host']}
        send(handler, {'session': token})
    except (ValueError, TypeError, AttributeError):
        send(handler, {'error': 'Open Studio from its desktop app or run studio open.'}, 403)
    return True


def loader(handler):
    send(handler, '<!doctype html><html><head><meta charset="utf-8"><title>Open Studio</title>'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<meta name="color-scheme" content="dark">'
         '<link rel="stylesheet" href="/project-studio-assets/studio-loading.css">'
         '<script src="/project-studio-assets/studio-auth.js" defer></script></head>'
         '<body data-studio-load><p id="studio-unlock">Opening Studio…</p></body></html>', kind='text/html')


def action_path(path):
    parts = path.strip('/').split('/')
    return path == '/stop-all' or (len(parts) == 3 and (
        (parts[0] in ('apps', 'services') and parts[2] in ('open', 'stop')) or
        (parts[0] == 'apps' and parts[2] == 'folder') or
        (parts[0] == 'links' and parts[2] == 'open')))


def confirmation(handler):
    path = html.escape(handler.path, quote=True)
    send(handler, '<!doctype html><html><head><meta charset="utf-8"><title>Studio action</title>'
         '<meta name="viewport" content="width=device-width, initial-scale=1">'
         '<meta name="color-scheme" content="dark">'
         '<link rel="stylesheet" href="/project-studio-assets/studio-loading.css">'
         '<script src="/project-studio-assets/studio-auth.js" defer></script></head>'
         '<body><p>This action needs a click in Studio.</p>'
         f'<button data-studio-action="{path}">Continue</button><p><a href="/">Back to Studio</a></p></body></html>', kind='text/html')


def protect(handler):
    """Return True when the request has been fully handled or rejected."""
    path = urlparse(handler.path).path
    mutation = handler.command != 'GET'
    if not local_request(handler, mutation):
        send(handler, {'error': 'Use Studio on this computer.'}, 403)
        return True
    if handle_session(handler):
        return True
    if path == '/studio-window' and not mutation:
        send(handler, '<!doctype html><html><head><title>Studio</title></head><body>Opening app…</body></html>', kind='text/html')
        return True
    if path == '/healthz' and not mutation:
        send(handler, {'ok': True, 'application': 'project-studio'})
        return True
    if not mutation and path.startswith('/project-studio-assets/') and Path(path).suffix.lower() in ('.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.svg', '.woff', '.woff2'):
        return False
    parts = path.strip('/').split('/')
    native_suffix = path.endswith(('/open', '/stop', '/folder')) and path.startswith(('/apps/', '/services/', '/links/'))
    if native_suffix and len(parts) != 3:
        send(handler, {'error': 'Not found'}, 404)
        return True
    if not authenticated(handler):
        if not mutation and not path.startswith('/api/') and not handler.headers.get('X-Studio-Session'):
            loader(handler)
        else:
            send(handler, {'error': 'Unlock Studio by opening its desktop app or running studio open.'}, 401)
        return True
    if mutation and handler.headers.get('X-Studio-Action') != '1':
        send(handler, {'error': 'Use the action in Studio.'}, 403)
        return True
    if not mutation and action_path(path):
        confirmation(handler)
        return True
    return False


def inject(body):
    script = '<script src="/project-studio-assets/studio-auth.js"></script>'
    return body.replace('<head>', '<head>' + script, 1) if '<head>' in body else script + body

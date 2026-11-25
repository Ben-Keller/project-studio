"""Local project definitions are data, never executable Python imports."""
import json
import os
import re
import tempfile
from urllib.parse import urlparse
from .paths import catalog_path

EMPTY = {'schema_version': 1, 'apps': [], 'links': [], 'planned': [], 'metadata': {}}

def validate(value):
    if not isinstance(value, dict) or value.get('schema_version') != 1:
        raise ValueError('Unsupported catalog schema_version; expected 1')
    seen = set()
    for kind in ('apps', 'links', 'planned'):
        items = value.get(kind, [])
        if not isinstance(items, list):
            raise ValueError(f'{kind} must be a list')
        for item in items:
            slug = item.get('slug', '')
            if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', slug) or slug in seen:
                raise ValueError('Project IDs must be unique lowercase slugs')
            seen.add(slug)
            if not isinstance(item.get('name'), str) or not item['name'].strip():
                raise ValueError(f'{slug}: name is required')
            if 'category' in item and (not isinstance(item['category'], str) or len(item['category']) > 60):
                raise ValueError(f'{slug}: category must be text of at most 60 characters')
            if kind != 'planned':
                url = urlparse(item.get('url', ''))
                if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password:
                    raise ValueError(f'{slug}: expected an HTTP URL without credentials')
            for process in item.get('processes', []):
                if not isinstance(process.get('command'), str) or not process['command'].strip() or not process.get('repo') or not process.get('name'):
                    raise ValueError(f'{slug}: each process requires name, repo and command')
                if any(type(port) is not int or not 1 <= port <= 65535 for port in process.get('ports', [])):
                    raise ValueError(f'{slug}: invalid port')
    return {**EMPTY, **value}

def catalog():
    try:
        return validate(json.loads(catalog_path().read_text()))
    except FileNotFoundError:
        return json.loads(json.dumps(EMPTY))

def save_catalog(value):
    value = validate(value)
    target = catalog_path()
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=target.parent, prefix='.catalog-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def assign_categories(current, assignments):
    """Update only category fields; preserve launch definitions and legacy metadata."""
    if not isinstance(assignments, dict):
        raise ValueError('Expected project category assignments')
    projects = {item['slug']: item for kind in ('apps', 'links', 'planned') for item in current[kind]}
    for slug, label in assignments.items():
        if slug not in projects or not isinstance(label, str) or len(label) > 60:
            raise ValueError('Unknown project or invalid category (maximum 60 characters)')
    for slug, label in assignments.items():
        projects[slug]['category'] = label.strip()
    return current

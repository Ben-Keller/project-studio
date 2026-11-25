"""Portable workspace copies: no sessions, live processes, secrets or executable UI."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import shlex
import tempfile
from .registry import validate

MEDIA = ('icons', 'photos', 'screenshots', 'portfolio-screenshots', 'docs', 'videos')
PREFERENCE_KEYS = frozenset(('projectStudioPinnedTools', 'projectStudioActivityGroups',
    'projectStudioManualOrder', 'projectStudioCompletionScores', 'projectStudioRenamedTools',
    'projectStudioSelectedVersions', 'projectStudioLastOpened', 'projectStudioPortfolioSettings', 'projectStudioMode'))


def atomic_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.writing-')
    try:
        with os.fdopen(fd, 'w') as stream:
            json.dump(value, stream, indent=2); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def preferences(root):
    path = root / 'preferences.json'
    return json.loads(path.read_text()) if path.exists() else {}


def save_preferences(root, values):
    if not isinstance(values, dict) or any(k not in PREFERENCE_KEYS or not isinstance(v, str) for k, v in values.items()):
        raise ValueError('Expected supported preference keys with string values')
    if len(json.dumps(values).encode()) > 2_000_000:
        raise ValueError('Preferences exceed 2 MB')
    atomic_json(root / 'preferences.json', values)


def workspace_sources(source, checkout=False):
    state = source / 'outputs' if checkout else source
    pairs = [(state/'private/catalog.json', Path('private/catalog.json')),
             (state/'preferences.json', Path('preferences.json')),
             (state/'credentials', Path('credentials'))]
    if checkout:
        pairs.append((source/'data', Path('credentials/inventory')))
        pairs.extend((source/'assets'/name, Path('media')/name) for name in MEDIA)
    else:
        pairs.append((state/'media', Path('media')))
    return [(a,b) for a,b in pairs if a.exists()]


def fingerprint(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob('*')) if p.is_file() and p.name != 'workspace-receipt.json'}


def copy_workspace(source, destination, *, checkout=False, apply=False):
    source, destination = source.resolve(), destination.resolve()
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('Source and destination must be separate, non-nested folders')
    pairs = workspace_sources(source, checkout)
    catalog_file = next((a for a,b in pairs if str(b)=='private/catalog.json'), None)
    if catalog_file is None:
        raise ValueError('No portable project catalog found')
    validate(json.loads(catalog_file.read_text()))
    plan = [{'from':str(a),'to':str(destination/b)} for a,b in pairs]
    if not apply: return plan
    if destination.exists():
        raise ValueError('Destination must not exist; choose a new folder to preserve existing work')
    receipt = source/'workspace-receipt.json'
    if receipt.exists() and json.loads(receipt.read_text())['sha256'] != fingerprint(source):
        raise ValueError('Backup checksum verification failed; nothing imported')
    destination.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix='.studio-import-', dir=destination.parent))
    try:
        for origin, relative in pairs:
            paths = [origin] + (list(origin.rglob('*')) if origin.is_dir() else [])
            if any(p.is_symlink() for p in paths):
                raise ValueError(f'Symbolic links are not portable: {origin}')
            target = stage/relative; target.parent.mkdir(parents=True, exist_ok=True)
            if origin.is_dir(): shutil.copytree(origin,target,dirs_exist_ok=True)
            else: shutil.copy2(origin,target)
            for p in paths:
                if p.is_file():
                    copied = target/p.relative_to(origin) if origin.is_dir() else target
                    if hashlib.sha256(p.read_bytes()).digest()!=hashlib.sha256(copied.read_bytes()).digest():
                        raise ValueError('Source changed during migration; retry with Studio closed')
        value=json.loads((stage/'private/catalog.json').read_text());value.pop('recording_profiles',None)
        if checkout:
            for item in value.get('apps',[]):
                for process in item.get('processes',[]):
                    command=shlex.split(process['command'])
                    if len(command)>1 and Path(command[1]).parent.resolve()==source and not any(token in command for token in ('&&','||','|',';','>','>>')):
                        helper={'spa_static_server.py':'spa','static_site_server.py':'static'}.get(Path(command[1]).name)
                        if helper:process['command']='@studio:'+helper+' '+shlex.join(command[2:])
        atomic_json(stage/'private/catalog.json',value)
        atomic_json(stage/'workspace-receipt.json', {'sha256':fingerprint(stage), 'source':str(source),
            'excluded':['authentication sessions','running processes','Keychain secrets','browser profiles']})
        os.rename(stage,destination)
    finally:
        if stage.exists():shutil.rmtree(stage)
    return plan

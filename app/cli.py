"""Portable catalog, migration and integration commands. Never runs imported commands."""
import argparse
import json
from pathlib import Path
import shutil
import sys
from .paths import ROOT, state_root, catalog_path
from .registry import catalog, validate, save_catalog

COMMANDS = {'projects', 'integrations', 'doctor', 'import-workspace', 'backup', 'restore', 'launch', 'stop', 'status'}

def main(argv):
    parser = argparse.ArgumentParser(prog='studio')
    sub = parser.add_subparsers(dest='command', required=True)
    projects = sub.add_parser('projects').add_subparsers(dest='operation', required=True)
    projects.add_parser('list')
    for action in ('validate', 'add'):
        p = projects.add_parser(action)
        p.add_argument('manifest', type=Path)
        p.add_argument('--trust-commands', action='store_true', help='Approve the displayed local launch commands')
    integrations = sub.add_parser('integrations')
    integrations.add_argument('operation', choices=['install', 'status'])
    integrations.add_argument('--agent', choices=['codex', 'claude'], required=True)
    sub.add_parser('doctor')
    migrate = sub.add_parser('import-workspace')
    migrate.add_argument('source', type=Path)
    migrate.add_argument('--apply', action='store_true', help='Copy into an empty workspace; source is never modified')
    backup = sub.add_parser('backup'); backup.add_argument('destination', type=Path)
    restore = sub.add_parser('restore'); restore.add_argument('source', type=Path); restore.add_argument('--apply', action='store_true')
    for action in ('launch', 'stop', 'status'):
        sub.add_parser(action).add_argument('slug')
    args = parser.parse_args(argv)
    if args.command in ('launch', 'stop', 'status'):
        print(json.dumps(runtime_action(args.command, args.slug), indent=2)); return 0
    if args.command in ('backup', 'restore'):
        from .workspace import copy_workspace
        if args.command == 'backup':
            source_checkout=state_root()==ROOT/'outputs'
            result = copy_workspace(ROOT if source_checkout else state_root(), args.destination, checkout=source_checkout, apply=True)
        else: result = copy_workspace(args.source, state_root(), apply=args.apply)
        print(json.dumps(result,indent=2)); return 0
    if args.command == 'projects':
        if args.operation == 'list':
            print(json.dumps(catalog(), indent=2)); return 0
        value = json.loads(args.manifest.read_text())
        validate({'schema_version': 1, 'apps': [value]})
        if args.operation == 'validate':
            print('Project manifest is valid. No commands executed.'); return 0
        if value.get('processes') and not args.trust_commands:
            print(json.dumps(value['processes'], indent=2))
            parser.error('Review these commands, then repeat with --trust-commands to register (not execute) them.')
        current = catalog()
        if any(item['slug'] == value['slug'] for group in ('apps','links','planned') for item in current[group]):
            parser.error('Project already exists; refusing to overwrite it')
        current['apps'].append(value)
        save_catalog(current)
        print('Registered. Reload Studio to refresh its catalog. No commands executed.')
    elif args.command == 'doctor':
        result = {'platform': sys.platform, 'state': str(state_root()), 'catalog': str(catalog_path()),
                  'projects': len(catalog()['apps']),
                  'views': ['Studio','Portfolio','Keys']}
        print(json.dumps(result, indent=2))
    elif args.command == 'integrations':
        target = Path.home() / ('.codex' if args.agent == 'codex' else '.claude') / 'skills/project-studio'
        source = ROOT / 'integrations/skills/project-studio'
        if args.operation == 'status':
            print(json.dumps({'agent': args.agent, 'installed': (target/'SKILL.md').is_file(), 'path': str(target)})); return 0
        if target.exists():
            parser.error('Skill already exists. Review/back up your changes before replacing it; nothing overwritten.')
        shutil.copytree(source, target)
        print(f'Installed {args.agent} skill: {target}')
    elif args.command == 'import-workspace':
        from .workspace import copy_workspace
        print(json.dumps(copy_workspace(args.source, state_root(), checkout=True, apply=args.apply), indent=2))
    return 0


def runtime_action(action, slug):
    """Use the same authenticated service as the UI; never create a second worker."""
    import urllib.request
    from urllib.parse import urlparse, quote
    from .paths import auth_root
    url = (state_root()/'launcher-ui/server.url').read_text().strip().rstrip('/')
    parsed=urlparse(url)
    if parsed.scheme!='http' or parsed.hostname!='127.0.0.1' or not parsed.port:
        raise ValueError('Expected the local Project Studio service')
    bootstrap=json.loads((auth_root()/f'{parsed.port}.json').read_text())['bootstrap']
    def request(path, body=None, session=None):
        headers={'Origin':url,'Content-Type':'application/json','X-Studio-Action':'1'}
        if session: headers['X-Studio-Session']=session
        req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,headers=headers)
        with urllib.request.urlopen(req,timeout=120) as response:return json.load(response)
    session=request('/api/studio/session',{'bootstrap':bootstrap})['session']
    return request(f'/api/apps/{quote(slug,safe="")}/{action}',None if action=='status' else {},session)

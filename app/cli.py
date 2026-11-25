"""Portable catalog, migration and integration commands. Never runs imported commands."""
import argparse
import json
from pathlib import Path
import shutil
import sys
from .paths import ROOT, state_root, catalog_path
from .registry import catalog, validate, save_catalog

COMMANDS = {'projects', 'integrations', 'doctor', 'import-workspace'}

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
    args = parser.parse_args(argv)
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
        print('Registered. Restart Studio to refresh its catalog. No commands executed.')
    elif args.command == 'doctor':
        result = {'platform': sys.platform, 'state': str(state_root()), 'catalog': str(catalog_path()),
                  'projects': len(catalog()['apps']), 'recording_dependencies': {name: bool(shutil.which(name)) for name in ('node','ffmpeg')},
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
        source = args.source.expanduser().resolve()
        destination = state_root().resolve()
        if source == ROOT.resolve() and destination == (ROOT/'outputs').resolve():
            parser.error('Choose a separate PROJECT_STUDIO_DATA_DIR for migration')
        pairs = [(source/'outputs/private', destination/'private'),
                 (source/'outputs/launcher-ui', destination/'launcher-ui'),
                 (source/'outputs/credentials', destination/'credentials'),
                 (source/'data', destination/'credentials/inventory'),
                 (source/'recording-studio/outputs/recordings', destination/'recording-studio/recordings'),
                 (source/'recording-studio/outputs/exports', destination/'recording-studio/exports')]
        pairs = [(a,b) for a,b in pairs if a.exists()]
        if not (source/'outputs/private/catalog.json').is_file():
            parser.error('Source needs an extracted catalog; update the source installation first')
        print(json.dumps([{'from':str(a),'to':str(b)} for a,b in pairs],indent=2))
        if args.apply:
            if destination.exists() and any(destination.iterdir()):
                parser.error('Destination must be empty; nothing overwritten')
            try:
                for a,b in pairs: shutil.copytree(a,b,dirs_exist_ok=True)
                print('Copied successfully. Original installation preserved. Browser-local preferences and Keychain access are not migrated.')
            except Exception:
                print('Import incomplete. Source preserved; inspect the new destination before retrying.',file=sys.stderr)
                raise
    return 0

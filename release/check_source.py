#!/usr/bin/env python3
"""Publication hygiene check; reports paths/rule names, never candidate secret values."""
import argparse
from pathlib import Path
import re

RULES = {
    'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'github-token': r'\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}',
    'service-key': r'\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{30,}',
    'credential-url': r'(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis)://[^\s/:]+:[^\s@]{4,}@',
    'azure-storage-key': r'AccountKey=[A-Za-z0-9+/=]{40,}',
}

def check(root):
    problems=[]
    for file in root.rglob('*'):
        relative=file.relative_to(root)
        if '.git' in relative.parts:continue
        if not file.is_file():continue
        if any(part in ('outputs','node_modules','.venv','data','profiles') for part in relative.parts) or file.name.startswith('.env'):
            problems.append((str(relative),'private/generated path'));continue
        text=file.read_text(errors='replace')
        for name,pattern in RULES.items():
            if re.search(pattern,text):problems.append((str(relative),name))
    return problems

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);args=parser.parse_args()
    problems=check(args.directory)
    for path,rule in problems:print(f'{path}: {rule}')
    if problems:raise SystemExit(1)
    print('Publication hygiene checks passed. This is not an exhaustive security or licensing audit.')

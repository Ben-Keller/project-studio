#!/usr/bin/env python3
"""Create the public source tree from an explicit allowlist, without local history."""
from pathlib import Path
import argparse
import shutil

ROOT = Path(__file__).resolve().parents[1]
FILES = '''README.md LICENSE .gitignore studio_cli.py local_tools_launcher.py install_related_desktop_apps.py install_tools_launcher_app.py spa_static_server.py static_site_server.py'''.split()
DIRECTORIES = ('app','desktop','integrations','examples','site','.github')

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--output',type=Path,default=ROOT/'release/public-source');args=parser.parse_args()
    destination=args.output.resolve()
    if destination.exists(): raise SystemExit('Destination already exists; refusing to overwrite a publication tree')
    destination.mkdir(parents=True)
    for name in FILES: shutil.copy2(ROOT/name,destination/name)
    for name in DIRECTORIES:
        shutil.copytree(ROOT/name,destination/name,ignore=shutil.ignore_patterns('__pycache__','*.pyc'))
    for folder,patterns in [('assets',['*.css','*.js','*.html']),('release',['*.py','requirements.txt','update-public-key.txt']),('tests',['test_*.py', 'release_browser.cjs', 'native_smoke.py']),('scripts',['capture_portfolio.py','extract_video_screenshots.py','capture_readme.cjs']),('docs/images',['*.png']),('docs/release',['*.md'])]:
        target=destination/folder;target.mkdir(parents=True,exist_ok=True)
        for pattern in patterns:
            for file in (ROOT/folder).glob(pattern):shutil.copy2(file,target/file.name)
    shutil.copytree(ROOT/'release/licenses', destination/'release/licenses')
    guides = destination/'assets/docs'
    guides.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT/'assets/docs/shared-credentials.md', guides/'shared-credentials.md')
    prohibited=[]
    for file in destination.rglob('*'):
        if file.is_file() and file.suffix in ('.py','.js','.ts','.tsx','.json','.md','.html','.swift','.yml'):
            text=file.read_text(errors='replace')
            if ('/Users/' + 'ben/') in text: prohibited.append(str(file.relative_to(destination)))
    if prohibited: raise SystemExit('Personal filesystem references need review before publishing: '+', '.join(prohibited))
    print(destination)

if __name__ == '__main__':main()

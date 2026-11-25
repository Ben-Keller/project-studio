"""Pinned build dependencies and bundled redistribution notices."""
import hashlib
import importlib.metadata
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT=Path(__file__).resolve().parents[1]
SPARKLE_VERSION='2.10.1'
SPARKLE_SHA256='1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27'

def sparkle():
    cache=ROOT/'release/vendor';cache.mkdir(exist_ok=True)
    archive=cache/'sparkle.tar.xz'
    if not archive.exists():
        subprocess.run(['curl','--fail','--location','--retry','3',f'https://github.com/sparkle-project/Sparkle/releases/download/{SPARKLE_VERSION}/Sparkle-{SPARKLE_VERSION}.tar.xz','-o',str(archive)],check=True)
    if hashlib.sha256(archive.read_bytes()).hexdigest()!=SPARKLE_SHA256:
        raise RuntimeError('Sparkle checksum mismatch; refusing to build')
    destination=cache/'sparkle'
    if destination.exists():shutil.rmtree(destination)
    destination.mkdir()
    with tarfile.open(archive) as source:source.extractall(destination,filter='data')
    return destination


def notices(destination, framework):
    destination.mkdir(parents=True,exist_ok=True)
    for p in framework.glob('*LICENSE*'):shutil.copy2(p,destination/p.name)
    for p in (ROOT/'release/licenses').iterdir():shutil.copy2(p,destination/p.name)
    inventory=[]
    for distribution in importlib.metadata.distributions():
        inventory.append({'name':distribution.metadata['Name'],'version':distribution.version})
        for file in distribution.files or []:
            if Path(file).name.lower().startswith(('license','copying')) and Path(file).suffix not in ('.py','.pyc'):
                source=Path(distribution.locate_file(file))
                if source.is_file():shutil.copy2(source,destination/(distribution.metadata['Name']+'-'+source.name))
    import json,sys
    (destination/'build-dependencies.json').write_text(json.dumps(inventory,indent=2))
    import builtins
    builtins.license._Printer__setup()
    (destination/'Python-LICENSE.txt').write_text('\n'.join(builtins.license._Printer__lines))
    (destination/'README.txt').write_text('Project Studio is MIT licensed. Python retains PSF and bundled-library notices. Sparkle uses its included license. PyInstaller is GPL with an explicit exception permitting distribution of bundled applications. Build tooling listed in build-dependencies.json is not all shipped at runtime.\nPython: https://www.python.org/\nSparkle: https://sparkle-project.org/\nPyInstaller: https://pyinstaller.org/en/stable/license.html\n')

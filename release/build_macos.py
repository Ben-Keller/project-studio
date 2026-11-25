#!/usr/bin/env python3
"""Build an Apple Silicon preview. Never modifies the installed desktop app."""
import argparse
import platform
import plistlib
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
VERSION = '0.2.0'
sys.path.insert(0, str(ROOT))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dmg', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        parser.error('Build on Apple Silicon macOS; Intel builds are not supported')
    from dependencies import sparkle, notices
    framework = sparkle()
    build = ROOT / 'release/build'
    build.mkdir(parents=True, exist_ok=True)
    app = build / 'Project Studio.app'
    if app.exists(): shutil.rmtree(app)
    resources = app/'Contents/Resources'; macos = app/'Contents/MacOS'
    resources.mkdir(parents=True); macos.mkdir()
    command = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--name', 'studio', '--onedir',
               '--target-architecture', 'arm64', '--paths', str(ROOT), '--distpath', str(build/'frozen'),
               '--workpath', str(build/'work'), '--specpath', str(build)]
    for name in ('assets','integrations'):
        # Only public text UI files enter the bundle, never the personal photo library.
        stage = build/'resources'/name
        if stage.exists(): shutil.rmtree(stage)
        stage.mkdir(parents=True)
        if name == 'assets':
            for file in (ROOT/name).iterdir():
                if file.suffix in ('.js','.css','.html'): shutil.copy2(file,stage/file.name)
        else: shutil.copytree(ROOT/name,stage,dirs_exist_ok=True)
        command += ['--add-data', f'{stage}:{name}']
    command += [str(ROOT/'release/entry.py')]
    subprocess.run(command,check=True,cwd=ROOT)
    shutil.copytree(build/'frozen/studio',resources/'runtime')
    frameworks = app/'Contents/Frameworks'; frameworks.mkdir()
    shutil.copytree(framework/'Sparkle.framework',frameworks/'Sparkle.framework',symlinks=True)
    notices(resources/'Licenses',framework)
    subprocess.run(['swiftc','-F',str(framework),'-framework','Sparkle','-Xlinker','-rpath','-Xlinker','@executable_path/../Frameworks','-O','-target','arm64-apple-macosx13.0','-framework','Cocoa','-framework','WebKit',str(ROOT/'desktop/macos/main.swift'),'-o',str(macos/'ProjectStudio')],check=True)
    subprocess.run(['clang','-O2','-target','arm64-apple-macosx13.0',str(ROOT/'desktop/macos/cli.c'),'-o',str(macos/'studio')],check=True)
    from install_related_desktop_apps import write_app_icon, IconTheme
    write_app_icon(resources, IconTheme('PS','#2f8ff0','#101c35','#74f4c7','network'))
    with (app/'Contents/Info.plist').open('wb') as file:
        plistlib.dump({'CFBundleName':'Project Studio','CFBundleDisplayName':'Project Studio',
            'CFBundleIdentifier':'io.github.ben-keller.project-studio','CFBundleExecutable':'ProjectStudio',
            'CFBundlePackageType':'APPL','CFBundleIconFile':'AppIcon','CFBundleVersion':'2',
            'SUFeedURL':'https://ben-keller.github.io/project-studio/appcast.xml',
            'SUPublicEDKey':(ROOT/'release/update-public-key.txt').read_text().strip(),
            'SUEnableAutomaticChecks':False, 'SUAutomaticallyUpdate':False,
            'CFBundleShortVersionString':VERSION,'LSMinimumSystemVersion':'13.0',
            'NSDocumentsFolderUsageDescription':'Open project folders you register with Project Studio.'},file)
    subprocess.run(['codesign','--force','--deep','--sign','-',str(app)],check=True)
    subprocess.run(['codesign','--verify','--deep','--strict',str(app)],check=True)
    if args.dmg:
        dmg = build/f'Project-Studio-{VERSION}-macOS-arm64-preview.dmg'
        dmg.unlink(missing_ok=True)
        stage=build/'dmg'; shutil.rmtree(stage,ignore_errors=True);stage.mkdir()
        shutil.copytree(app,stage/app.name,symlinks=True)
        (stage/'Applications').symlink_to('/Applications')
        subprocess.run(['hdiutil','create','-volname','Project Studio Preview','-srcfolder',str(stage),'-ov','-format','UDZO',str(dmg)],check=True)
    print(f'Built {app}. Local preview only: ad-hoc signed, not notarized.')

if __name__ == '__main__': main()

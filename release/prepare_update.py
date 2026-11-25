"""Create a signed update feed using the publisher's macOS Keychain key."""
from pathlib import Path
import hashlib
import shutil
import subprocess
from build_macos import VERSION
from dependencies import ROOT

def main():
    archive=ROOT/'release/build'/f'Project-Studio-{VERSION}-macOS-arm64-preview.dmg'
    if not archive.is_file():raise SystemExit('Build the DMG first')
    # Isolate each release so older archives cannot inherit the new download URL.
    staging=ROOT/'release/build/update-feed'/VERSION;staging.mkdir(parents=True,exist_ok=True)
    shutil.copy2(archive,staging/archive.name)
    tool=ROOT/'release/vendor/sparkle/bin/generate_appcast'
    subprocess.run([str(tool),'--account','project-studio-updates','--download-url-prefix',
        f'https://github.com/Ben-Keller/project-studio/releases/download/v{VERSION}-preview.1/',str(staging)],check=True)
    shutil.copy2(staging/'appcast.xml',ROOT/'site/appcast.xml')
    (archive.parent/'SHA256SUMS.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
    print('Signed appcast and checksums prepared; publish the matching archive before the feed.')

if __name__=='__main__':main()

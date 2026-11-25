"""Code is immutable; installed application state never lives inside the bundle."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def packaged():
    return bool(getattr(sys, 'frozen', False)) or os.environ.get('PROJECT_STUDIO_PACKAGED') == '1'

def state_root():
    override = os.environ.get('PROJECT_STUDIO_DATA_DIR')
    if override:
        return Path(override).expanduser().resolve()
    if packaged():
        return Path.home() / 'Library' / 'Application Support' / 'Project Studio'
    return ROOT / 'outputs'

def catalog_path():
    return state_root() / 'private' / 'catalog.json'

def inventory_root():
    return state_root() / 'credentials' / 'inventory' if packaged() or os.environ.get('PROJECT_STUDIO_DATA_DIR') else ROOT / 'data'

def auth_root():
    return state_root() / 'auth' if packaged() or os.environ.get('PROJECT_STUDIO_DATA_DIR') else Path.home() / '.local/state/project-studio/auth'

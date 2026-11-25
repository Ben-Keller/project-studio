"""Single packaged executable: native service or supported CLI commands."""
import os
import sys
from pathlib import Path
if getattr(sys, 'frozen', False):
    os.environ['PROJECT_STUDIO_PACKAGED'] = '1'
    os.environ.setdefault('PROJECT_STUDIO_DATA_DIR', str(Path.home() / 'Library/Application Support/Project Studio'))
if len(sys.argv) > 1 and sys.argv[1] == 'serve':
    del sys.argv[1]
    import local_tools_launcher
    raise SystemExit(local_tools_launcher.main())
import studio_cli
raise SystemExit(studio_cli.main())

"""Build-and-serve adapter for static sites launched from Project Studio.

The port answers straight away: while the build runs, every request gets a short
page that refreshes itself, so Project Studio sees the app as up and the browser
moves on to the site once the build finishes. Missing addresses get the site's own
404 page, as GitHub Pages serves it. With --watch, a change under any watched path
rebuilds the site; pages requested during a rebuild show the building page again.
"""
from __future__ import annotations

import argparse
import html
import os
import subprocess
import sys
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SKIP_DIRS = {".git", ".venv", "venv", "node_modules", "__pycache__"}

PAGE = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="{refresh}"><title>{title}</title>
<style>body{{margin:14vh auto;max-width:760px;padding:0 24px;background:#f5f6f8;color:#1d2733;
font:16px/1.6 -apple-system,BlinkMacSystemFont,system-ui,sans-serif}}h1{{margin:0 0 8px;font-size:26px}}
pre{{max-height:56vh;overflow:auto;padding:14px;border:1px solid #d8dde4;border-radius:8px;background:#fff;
white-space:pre-wrap;font:12px/1.5 ui-monospace,Menlo,monospace}}</style>
</head><body><h1>{heading}</h1><p>{message}</p>{detail}</body></html>"""


class Site:
    def __init__(self, name: str, build: str, directory: Path, watch: list[Path], not_found: str) -> None:
        self.name = name
        self.build_command = build
        self.directory = directory
        self.watch = watch
        self.not_found = not_found
        self.state = "building"  # building, ready or failed
        self.failure = ""
        self.lock = threading.Lock()

    def fingerprint(self) -> float:
        """Newest mtime under the watched paths; folder mtimes catch deletions and renames."""
        newest = 0.0
        for path in self.watch:
            if path.is_file():
                newest = max(newest, path.stat().st_mtime)
                continue
            for folder, subfolders, files in os.walk(path):
                subfolders[:] = [name for name in subfolders if name not in SKIP_DIRS]
                for item in (folder, *(os.path.join(folder, name) for name in files)):
                    try:
                        newest = max(newest, os.stat(item).st_mtime)
                    except OSError:
                        pass
        return newest

    def build(self) -> None:
        with self.lock:
            self.state = "building"
        print(f"[{time.strftime('%H:%M:%S')}] Building: {self.build_command}", flush=True)
        started = time.monotonic()
        result = subprocess.run(
            self.build_command, shell=True, executable="/bin/bash",
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        )
        sys.stdout.write(result.stdout)
        ok = result.returncode == 0 and self.directory.is_dir()
        with self.lock:
            self.state = "ready" if ok else "failed"
            self.failure = "" if ok else "\n".join(result.stdout.splitlines()[-60:])
        outcome = "Built" if ok else f"Build failed (exit {result.returncode})"
        print(f"[{time.strftime('%H:%M:%S')}] {outcome} in {time.monotonic() - started:.1f}s", flush=True)

    def run(self, interval: float) -> None:
        seen = self.fingerprint()
        self.build()
        while self.watch:
            time.sleep(interval)
            if self.fingerprint() == seen:
                continue
            time.sleep(0.5)  # let a burst of saves settle, then build once
            seen = self.fingerprint()
            print(f"[{time.strftime('%H:%M:%S')}] Change detected", flush=True)
            self.build()


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address) -> None:
        # Health checks often hang up before the reply is written; that isn't an error worth a traceback.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class Handler(SimpleHTTPRequestHandler):
    server_version = "ProjectStudioStaticSite/1.0"
    site: Site

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _page(self, status: int, heading: str, message: str, detail: str = "", refresh: int = 1) -> None:
        body = PAGE.format(
            refresh=refresh, title=html.escape(heading), heading=html.escape(heading),
            message=html.escape(message), detail=detail,
        ).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _held(self) -> bool:
        with self.site.lock:
            state, failure = self.site.state, self.site.failure
        if state == "building":
            self._page(200, f"Building {self.site.name}…", "This page opens the site as soon as the build finishes.")
            return True
        if state == "failed":
            if self.site.watch:
                hint, refresh = "Fix the error below and save; the site rebuilds and this page refreshes.", 3
            else:
                hint, refresh = "Fix the error below, then stop and relaunch the app.", 30
            self._page(500, "The build failed", hint, "<pre>" + html.escape(failure) + "</pre>", refresh)
            return True
        return False

    def do_GET(self) -> None:
        if not self._held():
            super().do_GET()

    def do_HEAD(self) -> None:
        if not self._held():
            super().do_HEAD()

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        page = Path(self.directory) / self.site.not_found if self.site.not_found else None
        if code == 404 and page is not None and page.is_file():
            body = page.read_bytes()
            self.send_response(404)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, format: str, *args: object) -> None:
        if os.environ.get("STATIC_SITE_SERVER_VERBOSE"):
            super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build a static site, serve it, and rebuild it when its sources change.")
    parser.add_argument("--name", default="the site", help="Shown on the building page.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--directory", required=True, help="Build output folder to serve, relative to the working folder.")
    parser.add_argument("--build", required=True, help="Shell command that writes the output folder.")
    parser.add_argument("--watch", action="append", default=[], help="File or folder whose changes trigger a rebuild. Repeatable.")
    parser.add_argument("--not-found", default="404.html", help="Page in the output folder served for missing addresses.")
    parser.add_argument("--interval", type=float, default=1.0, help="Seconds between checks for changes.")
    args = parser.parse_args()

    site = Site(args.name, args.build, Path(args.directory).resolve(), [Path(p).resolve() for p in args.watch], args.not_found)
    Handler.site = site
    # Bind before building, so a taken port fails at once instead of after the build.
    server = Server((args.host, args.port), partial(Handler, directory=str(site.directory)))
    print(f"Serving {site.directory} at http://{args.host}:{args.port}/"
          + (f", rebuilding on changes to {', '.join(args.watch)}" if args.watch else ""), flush=True)
    threading.Thread(target=site.run, args=(args.interval,), daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

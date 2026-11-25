from __future__ import annotations

import argparse
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


class SpaStaticHandler(SimpleHTTPRequestHandler):
    """Static file handler with index.html fallback for client-side routes."""

    server_version = "ProjectStudioSpaStatic/1.0"
    root: Path
    entrypoint: str

    def _requested_path(self) -> Path | None:
        parsed = urlparse(self.path)
        relative = unquote(parsed.path).lstrip("/")
        target = (self.root / relative).resolve()
        if target == self.root or self.root in target.parents:
            return target
        return None

    def _should_fallback_to_entrypoint(self, target: Path | None) -> bool:
        if target is None:
            return False
        if target.exists():
            return False
        parsed_path = urlparse(self.path).path
        if Path(parsed_path).suffix:
            return False
        return (self.root / self.entrypoint).is_file()

    def do_GET(self) -> None:
        if self._should_fallback_to_entrypoint(self._requested_path()):
            self.path = f"/{self.entrypoint}"
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._should_fallback_to_entrypoint(self._requested_path()):
            self.path = f"/{self.entrypoint}"
        super().do_HEAD()

    def log_message(self, format: str, *args: object) -> None:
        if os.environ.get("SPA_STATIC_SERVER_VERBOSE"):
            super().log_message(format, *args)


def main() -> int:
    parser = argparse.ArgumentParser(description="Serve static assets with SPA route fallback.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--directory", default=".")
    parser.add_argument("--entrypoint", default="index.html")
    args = parser.parse_args()

    root = Path(args.directory).resolve()
    if not root.is_dir():
        parser.error(f"Static directory does not exist: {root}")
    entrypoint = root / args.entrypoint
    if not entrypoint.is_file():
        parser.error(f"SPA entrypoint does not exist: {entrypoint}")

    handler = lambda *handler_args, **handler_kwargs: SpaStaticHandler(  # noqa: E731
        *handler_args,
        directory=str(root),
        **handler_kwargs,
    )
    SpaStaticHandler.root = root
    SpaStaticHandler.entrypoint = args.entrypoint

    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Serving {root} at http://{args.host}:{args.port}/ with SPA fallback to {args.entrypoint}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

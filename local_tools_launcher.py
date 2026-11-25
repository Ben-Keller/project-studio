from __future__ import annotations

import argparse
import html
import json
import mimetypes
import os
import re
import signal
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_STUDIO_ROOT = SCRIPT_DIR
REPO_ROOT = PROJECT_STUDIO_ROOT
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from install_related_desktop_apps import AppLauncher, LaunchProcess, default_apps  # noqa: E402
from app import credentials as studio_credentials  # noqa: E402
from app import auth as studio_auth
from app.paths import state_root, cli_command
from app.registry import catalog
from app.workspace import preferences, save_preferences, MEDIA
_user_catalog = catalog()

STATE_ROOT = state_root() / "launchers"
UI_STATE_DIR = state_root() / "launcher-ui"
PROJECT_STUDIO_ASSETS = SCRIPT_DIR / "assets"
STATUS_CACHE_TTL_SECONDS = 10.0
ITEM_EVENT_LIMIT = 40
PORT_SEARCH_LIMIT = 60
_STATUS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_STATUS_CACHE_LOCK = threading.Lock()
_STATUS_REFRESHING: set[str] = set()
_ITEM_STATE_LOCK = threading.Lock()
LOCAL_PATH = ":".join(
    [
        "/opt/homebrew/opt/node@22/bin",
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/Library/Frameworks/Python.framework/Versions/3.13/bin",
        "/Library/Frameworks/Python.framework/Versions/3.11/bin",
        "/usr/bin",
        "/bin",
        "/usr/sbin",
        "/sbin",
    ]
)

CARD_ASSETS = _user_catalog["metadata"].get("CARD_ASSETS", {})

CARD_GROUPS = _user_catalog["metadata"].get("CARD_GROUPS", {})

TAG_FILTERS = _user_catalog["metadata"].get("TAG_FILTERS", [])

CARD_TAGS = _user_catalog["metadata"].get("CARD_TAGS", {})

APP_VERSION_OPTIONS = _user_catalog["metadata"].get("APP_VERSION_OPTIONS", {})

APP_DEFAULT_VERSIONS = _user_catalog["metadata"].get("APP_DEFAULT_VERSIONS", {})


def _app_version_options(slug: str) -> tuple[dict[str, str], ...]:
    return APP_VERSION_OPTIONS.get(slug, ())


def _app_version_option(slug: str, requested: str = "") -> dict[str, str] | None:
    options = _app_version_options(slug)
    if not options:
        return None
    selected = requested or APP_DEFAULT_VERSIONS.get(slug, "")
    return next((item for item in options if item["id"] == selected), options[0])


def _card_tags(slug: str) -> tuple[str, ...]:
    tags = set(CARD_TAGS.get(slug, ()))
    group = CARD_GROUPS.get(slug, {})
    if group.get("agency") == "undp-seh":
        tags.add("seh")
    if group.get("agency") == "gef" or "sgp" in slug:
        tags.add("sgp")
    if "matchgrant" in slug or slug == "foundation":
        tags.add("matchgrant")
    if "chaski" in slug:
        tags.add("chaski")
    return tuple(sorted(tags))


def _card_tag_labels(slug: str) -> list[str]:
    labels = {item["id"]: item["label"] for item in TAG_FILTERS}
    return [labels[tag] for tag in _card_tags(slug) if tag in labels]


DEFAULT_RESOURCE_POLICY: dict[str, Any] = {"mode": "monitor", "label": "Local app"}

RESOURCE_POLICIES = _user_catalog["metadata"].get("RESOURCE_POLICIES", {})


def _resource_policy(slug: str) -> dict[str, Any]:
    policy = dict(DEFAULT_RESOURCE_POLICY)
    policy.update(RESOURCE_POLICIES.get(slug, {}))
    return policy


@dataclass(frozen=True)
class StaticLink:
    name: str
    slug: str
    url: str
    note: str
    icon_glyph: str
    icon_primary: str
    icon_secondary: str
    icon_accent: str
    icon_motif: str


@dataclass(frozen=True)
class PlaceholderTool:
    name: str
    slug: str
    note: str
    icon_glyph: str
    icon_primary: str
    icon_secondary: str
    icon_accent: str
    icon_motif: str


def _placeholder_tools() -> tuple[PlaceholderTool, ...]:
    return tuple(PlaceholderTool(**item) for item in _user_catalog['planned'])


def _static_links() -> tuple[StaticLink, ...]:
    return tuple(StaticLink(**item) for item in _user_catalog['links'])


def _status_url(url: str, timeout: float = 0.14) -> bool:
    try:
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except Exception:
        return False


def _url_failure_diagnostic(url: str, timeout: float = 0.18) -> str:
    try:
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
        with urllib.request.urlopen(request, timeout=timeout):
            return ""
    except urllib.error.HTTPError as exc:
        try:
            body = exc.read(2400).decode("utf-8", errors="replace").lower()
        except Exception:
            body = ""
        if "operation not permitted" in body or "eperm" in body or "no permission" in body:
            return (
                "macOS is blocking this launched app from reading files in its project folder. "
                "Grant Project Studio access to Documents or Full Disk Access, then stop and reopen the app."
            )
        return f"Server is listening but returned HTTP {exc.code}. Stop and reopen this app after checking its logs."
    except Exception:
        return ""


def _url_host_port(url: str) -> tuple[str, int] | None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    return parsed.hostname, port


def _port_listening_host_port(host: str, port: int, timeout: float = 0.08) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _port_listening(url: str, timeout: float = 0.08) -> bool:
    endpoint = _url_host_port(url)
    if endpoint is None:
        return False
    host, port = endpoint
    return _port_listening_host_port(host, port, timeout=timeout)


def _url_with_port(url: str, port: int) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return url
    host = parsed.hostname
    netloc = f"{host}:{port}"
    if parsed.username:
        auth = parsed.username
        if parsed.password:
            auth += f":{parsed.password}"
        netloc = f"{auth}@{netloc}"
    return parsed._replace(netloc=netloc).geturl()


def _url_origin(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return url
    port = parsed.port
    default_port = 443 if parsed.scheme == "https" else 80
    host = parsed.hostname
    netloc = host if not port or port == default_port else f"{host}:{port}"
    return parsed._replace(netloc=netloc, path="/", params="", query="", fragment="").geturl()


def _mac_process_running(process_name: str) -> bool:
    pgrep = "/usr/bin/pgrep"
    if not Path(pgrep).exists():
        return False
    try:
        result = subprocess.run(
            [pgrep, "-x", process_name],
            capture_output=True,
            text=True,
            timeout=0.35,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0


def _browser_tab_match_settings(url: str) -> tuple[str, str, str, str]:
    parsed = urlparse(url)
    exact_url = url
    exact_url_without_slash = url[:-1] if url.endswith("/") else url
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"
    is_local = host in {"127.0.0.1", "localhost"}
    # Local apps are normally identified by port, so any path on that origin is
    # the same running app. Hosted links can share a domain, so root hosted URLs
    # must not match every sibling path on that host.
    allow_prefix = is_local or path not in {"", "/"}
    return exact_url, exact_url_without_slash, _url_origin(url), "1" if allow_prefix else "0"


def _focus_existing_browser_tab(url: str) -> dict[str, Any]:
    # Browsers do not expose tab focusing to ordinary web pages. Project Studio
    # can attempt it from the local macOS process through AppleScript, then fall
    # back cleanly when Automation permissions or browser support are unavailable.
    if os.environ.get("PROJECT_STUDIO_REUSE_BROWSER_TABS", "1").strip().lower() in {"0", "false", "no", "off"}:
        return {"attempted": False, "focused": False, "reason": "disabled"}
    if sys.platform != "darwin" or not url.startswith(("http://", "https://")):
        return {"attempted": False, "focused": False, "reason": "unsupported_platform"}
    osascript = "/usr/bin/osascript"
    if not Path(osascript).exists():
        return {"attempted": False, "focused": False, "reason": "osascript_missing"}

    exact_url, exact_url_without_slash, target_origin, allow_prefix = _browser_tab_match_settings(url)
    chromium_script = r'''
on run argv
  set exactUrl to item 1 of argv
  set exactUrlWithoutSlash to item 2 of argv
  set targetOrigin to item 3 of argv
  set allowPrefix to item 4 of argv
  set browserName to item 5 of argv
  tell application browserName
    repeat with w in windows
      set tabIndex to 0
      repeat with t in tabs of w
        set tabIndex to tabIndex + 1
        try
          set tabUrl to URL of t as text
          if tabUrl is exactUrl or tabUrl is exactUrlWithoutSlash or (allowPrefix is "1" and (tabUrl starts with exactUrl or tabUrl starts with targetOrigin)) then
            set active tab index of w to tabIndex
            set index of w to 1
            activate
            return "focused"
          end if
        end try
      end repeat
    end repeat
  end tell
  return "not_found"
end run
'''
    safari_script = r'''
on run argv
  set exactUrl to item 1 of argv
  set exactUrlWithoutSlash to item 2 of argv
  set targetOrigin to item 3 of argv
  set allowPrefix to item 4 of argv
  set browserName to item 5 of argv
  tell application browserName
    repeat with w in windows
      repeat with t in tabs of w
        try
          set tabUrl to URL of t as text
          if tabUrl is exactUrl or tabUrl is exactUrlWithoutSlash or (allowPrefix is "1" and (tabUrl starts with exactUrl or tabUrl starts with targetOrigin)) then
            set current tab of w to t
            set index of w to 1
            activate
            return "focused"
          end if
        end try
      end repeat
    end repeat
  end tell
  return "not_found"
end run
'''
    browsers = (
        ("Google Chrome", chromium_script),
        ("Safari", safari_script),
        ("Arc", chromium_script),
        ("Microsoft Edge", chromium_script),
    )
    attempted: list[dict[str, str]] = []
    for browser_name, script in browsers:
        if not _mac_process_running(browser_name):
            attempted.append({"browser": browser_name, "result": "not_running"})
            continue
        try:
            result = subprocess.run(
                [osascript, "-e", script, exact_url, exact_url_without_slash, target_origin, allow_prefix, browser_name],
                capture_output=True,
                text=True,
                timeout=1.6,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            attempted.append({"browser": browser_name, "result": type(exc).__name__})
            continue
        output = (result.stdout or result.stderr or "").strip()
        attempted.append({"browser": browser_name, "result": output or f"exit_{result.returncode}"})
        if result.returncode == 0 and output == "focused":
            return {"attempted": True, "focused": True, "browser": browser_name, "url": exact_url, "origin": target_origin}
    return {"attempted": True, "focused": False, "url": exact_url, "origin": target_origin, "allow_prefix": allow_prefix == "1", "attempts": attempted}


def _focused_tab_html(name: str, url: str, tab_focus: dict[str, Any]) -> str:
    browser = html.escape(str(tab_focus.get("browser") or "browser"))
    escaped_name = html.escape(name)
    escaped_url = html.escape(url)
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Opened {escaped_name}</title>
  <style>
    :root {{ color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }}
    * {{ box-sizing: border-box; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; color: #ecf7ff; background: radial-gradient(circle at 18% 16%, rgba(67,184,242,.22), transparent 28rem), linear-gradient(145deg, #05111c, #0a1a28 58%, #08121b); }}
    main {{ width: min(560px, calc(100vw - 32px)); padding: 28px; border: 1px solid rgba(158,214,237,.18); border-radius: 24px; background: rgba(10,28,43,.78); box-shadow: 0 26px 90px rgba(0,0,0,.36); }}
    p.eyebrow {{ margin: 0 0 10px; color: #9ddcf0; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; }}
    h1 {{ margin: 0; font-size: clamp(30px, 6vw, 48px); line-height: .98; letter-spacing: -.05em; }}
    p {{ color: rgba(236,247,255,.68); line-height: 1.55; }}
    a {{ color: #9ddcf0; font-weight: 850; }}
  </style>
</head>
<body>
  <main>
    <p class="eyebrow">Existing tab focused</p>
    <h1>{escaped_name}</h1>
    <p>Project Studio found an existing {browser} tab for this app and brought it forward.</p>
    <p><a href="{escaped_url}" target="_blank" rel="noopener">Open a new tab instead</a> · <a href="/">Back to Project Studio</a></p>
  </main>
  <script>setTimeout(() => window.location.replace('/'), 1200);</script>
</body>
</html>'''


def _pid_command(pid: int) -> str:
    try:
        result = subprocess.run(
            ["/bin/ps", "-p", str(pid), "-o", "command="],
            capture_output=True,
            text=True,
            timeout=0.35,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return result.stdout.strip()


def _describe_port_owners(port: int) -> str:
    pids = _pids_for_port(port)
    if not pids:
        return ""
    parts = []
    for pid in pids[:4]:
        command = _pid_command(pid)
        label = command.split(" ", 1)[0] if command else "process"
        parts.append(f"pid {pid} ({Path(label).name})")
    extra = f" and {len(pids) - 4} more" if len(pids) > 4 else ""
    return ", ".join(parts) + extra


def _runtime_url_from_state(slug: str) -> str:
    state = _read_item_state(slug)
    value = state.get("runtime_url")
    return value if isinstance(value, str) and value else ""


def _effective_app_url(app: AppLauncher) -> str:
    runtime_url = _runtime_url_from_state(app.slug)
    configured_endpoint = _url_host_port(app.url)
    runtime_endpoint = _url_host_port(runtime_url) if runtime_url else None
    if configured_endpoint and runtime_endpoint and configured_endpoint[1] != runtime_endpoint[1]:
        state = _read_item_state(app.slug)
        dynamic_ports = state.get("dynamic_ports") if isinstance(state.get("dynamic_ports"), list) else []
        allowed_dynamic_port = any(
            isinstance(item, dict)
            and item.get("from") == configured_endpoint[1]
            and item.get("to") == runtime_endpoint[1]
            for item in dynamic_ports
        )
        if not allowed_dynamic_port:
            runtime_url = ""
    if runtime_url and (
        _status_url(_app_health_url(app, runtime_url), timeout=0.08)
        or _port_listening(runtime_url, timeout=0.04)
    ):
        return runtime_url
    return app.url


def _app_health_url(app: AppLauncher, runtime_url: str | None = None) -> str:
    """Keep readiness probes cheap while preserving the user-facing app URL."""
    runtime_url = runtime_url or app.url
    health_url = str(getattr(app, "health_url", "") or "").strip()
    if not health_url:
        return runtime_url
    configured_endpoint = _url_host_port(app.url)
    runtime_endpoint = _url_host_port(runtime_url)
    if configured_endpoint and runtime_endpoint and configured_endpoint[1] != runtime_endpoint[1]:
        return _url_with_port(health_url, runtime_endpoint[1])
    return health_url


def _can_bind_port(host: str, port: int) -> bool:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            # A stopped server may leave connections in TIME_WAIT, not an active listener.
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            probe.bind((host, port))
            return True
    except OSError:
        return False


def _available_port(host: str, preferred: int) -> int | None:
    if _can_bind_port(host, preferred):
        return preferred
    for port in range(preferred + 1, preferred + PORT_SEARCH_LIMIT + 1):
        if port > 65535:
            break
        if _can_bind_port(host, port):
            return port
    return None


def _rewrite_command_port(command: str, old_port: int, new_port: int) -> tuple[str, bool]:
    if old_port == new_port:
        return command, False
    original = command
    replacements = (
        (rf"(--port\s+){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(--port=){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(--bind-port\s+){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(PORT=){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(RBAP_PORT=){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(127\.0\.0\.1:){old_port}\b", rf"\g<1>{new_port}"),
        (rf"(localhost:){old_port}\b", rf"\g<1>{new_port}"),
    )
    for pattern, replacement in replacements:
        command = re.sub(pattern, replacement, command)
    # python -m http.server uses a positional port. Keep this intentionally narrow.
    command = re.sub(
        rf"(python3?\s+-m\s+http\.server\s+){old_port}\b",
        rf"\g<1>{new_port}",
        command,
    )
    return command, command != original


def _prepare_launch_process(app: AppLauncher, process: LaunchProcess) -> tuple[LaunchProcess | None, dict[str, Any]]:
    endpoint = _url_host_port(app.url)
    host = endpoint[0] if endpoint else "127.0.0.1"
    app_port = endpoint[1] if endpoint else None
    runtime_url = app.url
    ports = tuple(getattr(process, "ports", ()))
    details: dict[str, Any] = {
        "name": process.name,
        "repo": str(process.repo),
        "configured_command": process.command,
        "configured_ports": list(ports),
        "runtime_url": runtime_url,
        "dynamic_port": False,
        "diagnostic": "",
        "suggestions": [],
    }

    if _pid_file_running(app, process):
        details["already_running"] = True
        return None, details

    access_error = _repo_access_error(process.repo)
    if access_error:
        details["diagnostic"] = f"{process.name}: {access_error}"
        details["suggestions"] = ["Grant Project Studio access to the project folder, then relaunch the app."]
        return None, details

    blocked_ports = [port for port in ports if _pids_for_port(port)]
    if not blocked_ports:
        details["command"] = process.command
        details["ports"] = list(ports)
        return process, details

    # If the configured URL is already healthy, reuse it rather than starting a duplicate server.
    if _status_url(_app_health_url(app), timeout=0.12):
        details["already_running"] = True
        details["reused_existing_url"] = True
        return None, details

    # Otherwise try a dynamic port only when the app URL maps to one of the process ports.
    if app_port in ports:
        replacement_port = _available_port(host, app_port)
        if replacement_port and replacement_port != app_port:
            command, rewritten = _rewrite_command_port(process.command, app_port, replacement_port)
            if rewritten:
                new_ports = tuple(replacement_port if port == app_port else port for port in ports)
                runtime_url = _url_with_port(app.url, replacement_port)
                details.update(
                    {
                        "command": command,
                        "ports": list(new_ports),
                        "runtime_url": runtime_url,
                        "dynamic_port": True,
                        "dynamic_port_from": app_port,
                        "dynamic_port_to": replacement_port,
                        "port_conflict": _describe_port_owners(app_port),
                    }
                )
                return LaunchProcess(
                    name=process.name,
                    repo=process.repo,
                    command=command,
                    delay_seconds=process.delay_seconds,
                    ports=new_ports,
                ), details

    owners = "; ".join(f"{port}: {_describe_port_owners(port) or 'unknown process'}" for port in blocked_ports)
    details["diagnostic"] = f"Cannot start {app.name}: configured port(s) already in use by another process ({owners})."
    details["suggestions"] = [
        "Use Stop All in Project Studio, then launch again.",
        "Open the app logs to see whether a previous server failed to exit cleanly.",
        "If the port is used by another tool outside Project Studio, stop that process or update this app's configured port.",
    ]
    return None, details


def _repo_probe_file(repo: Path) -> Path | None:
    for name in ("index.html", "package.json", "pyproject.toml", "README.md"):
        candidate = repo / name
        if candidate.is_file():
            return candidate
    try:
        return next((item for item in repo.iterdir() if item.is_file()), None)
    except OSError:
        return None


def _repo_access_error(repo: Path) -> str | None:
    if not repo.exists():
        return f"Missing repo: {repo}"
    probe = _repo_probe_file(repo)
    if probe is None:
        return None
    try:
        with probe.open("rb") as fh:
            fh.read(1)
    except PermissionError:
        return (
            "macOS denied file access to this project folder. Grant Project Studio access to Documents "
            "or Full Disk Access, then retry."
        )
    except OSError as exc:
        return f"Cannot read project folder: {exc}"
    return None


def _permission_diagnostic(app: AppLauncher) -> str:
    text = _logs(app).lower()
    if "operation not permitted" in text or "eperm" in text or "no permission to list directory" in text:
        return (
            "macOS is blocking this launched app from reading files in its project folder. "
            "Grant Project Studio access to Documents or Full Disk Access, then stop and reopen the app."
        )
    return ""


def _pid_alive(pid: int) -> bool:
    # Project Studio is the direct parent for managed shell processes. Reap an
    # exited child before probing it: a zombie still answers kill(pid, 0), which
    # otherwise makes a failed launch look permanently alive.
    try:
        reaped_pid, _ = os.waitpid(pid, os.WNOHANG)
    except (ChildProcessError, OSError):
        pass
    else:
        if reaped_pid == pid:
            return False
    try:
        os.kill(pid, 0)
        return True
    except OSError:
        return False


def _pid_group_id(pid: int) -> int | None:
    try:
        return os.getpgid(pid)
    except OSError:
        return None


def _pid_group_alive(pid: int) -> bool:
    try:
        os.killpg(pid, 0)
        return True
    except OSError:
        return False


def _read_pid(path: Path) -> int | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
        return int(value) if value else None
    except Exception:
        return None


def _pids_for_port(port: int) -> list[int]:
    lsof = "/usr/sbin/lsof"
    if not Path(lsof).exists():
        return []
    try:
        result = subprocess.run(
            [lsof, "-nP", f"-tiTCP:{port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=0.5,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if result.returncode not in {0, 1}:
        return []
    pids: list[int] = []
    for line in result.stdout.splitlines():
        try:
            pids.append(int(line.strip()))
        except ValueError:
            continue
    return pids


def _process_port_pids(process: LaunchProcess) -> list[int]:
    pids: list[int] = []
    for port in getattr(process, "ports", ()):
        pids.extend(_pids_for_port(port))
    return sorted(set(pid for pid in pids if _pid_alive(pid)))


def _parse_etime_seconds(value: str) -> int:
    value = value.strip()
    if not value:
        return 0
    days = 0
    if "-" in value:
        day_text, value = value.split("-", 1)
        try:
            days = int(day_text)
        except ValueError:
            days = 0
    parts = [int(part) for part in value.split(":") if part.isdigit()]
    if len(parts) == 3:
        hours, minutes, seconds = parts
    elif len(parts) == 2:
        hours, minutes, seconds = 0, parts[0], parts[1]
    elif len(parts) == 1:
        hours, minutes, seconds = 0, 0, parts[0]
    else:
        hours, minutes, seconds = 0, 0, 0
    return days * 86400 + hours * 3600 + minutes * 60 + seconds


def _process_resource_snapshot() -> dict[int, dict[str, Any]]:
    try:
        result = subprocess.run(
            ["/bin/ps", "-axo", "pid=,ppid=,%cpu=,rss=,etime=,command="],
            capture_output=True,
            text=True,
            timeout=1.0,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return {}
    if result.returncode not in {0, 1}:
        return {}
    rows: dict[int, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        parts = line.strip().split(None, 5)
        if len(parts) < 5:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
            cpu = float(parts[2])
            rss_kb = int(float(parts[3]))
        except ValueError:
            continue
        rows[pid] = {
            "pid": pid,
            "ppid": ppid,
            "cpu_percent": cpu,
            "rss_kb": rss_kb,
            "runtime_seconds": _parse_etime_seconds(parts[4]),
            "command": parts[5] if len(parts) > 5 else "",
        }
    return rows


def _descendant_pids(root_pids: set[int], process_rows: dict[int, dict[str, Any]]) -> set[int]:
    selected = {pid for pid in root_pids if pid in process_rows}
    changed = True
    while changed:
        changed = False
        for pid, row in process_rows.items():
            if pid in selected:
                continue
            if row.get("ppid") in selected:
                selected.add(pid)
                changed = True
    return selected


def _format_duration(seconds: int) -> str:
    seconds = max(0, int(seconds or 0))
    if seconds < 60:
        return f"{seconds}s"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h"
    days = hours // 24
    return f"{days}d"


def _resource_pressure_level(cpu_percent: float, memory_mb: float, runtime_seconds: int) -> str:
    if cpu_percent >= 50.0 or memory_mb >= 1500.0:
        return "high"
    if cpu_percent >= 15.0 or memory_mb >= 700.0 or runtime_seconds >= 4 * 3600:
        return "medium"
    return "low"


def _app_resource_item(app: AppLauncher, process_rows: dict[int, dict[str, Any]]) -> dict[str, Any]:
    root_pids: set[int] = set()
    for process in app.processes:
        pid = _read_pid(_pid_file(app, process))
        if pid:
            root_pids.add(pid)
        root_pids.update(_process_port_pids(process))
    pids = _descendant_pids(root_pids, process_rows)
    rows = [process_rows[pid] for pid in sorted(pids) if pid in process_rows]
    cpu_percent = round(sum(float(row.get("cpu_percent", 0.0)) for row in rows), 1)
    memory_mb = round(sum(int(row.get("rss_kb", 0)) for row in rows) / 1024, 1)
    runtime_seconds = max((int(row.get("runtime_seconds", 0)) for row in rows), default=0)
    policy = _resource_policy(app.slug)
    mode = str(policy.get("mode", "monitor"))
    return {
        "name": app.name,
        "slug": app.slug,
        "running": bool(rows),
        "pids": sorted(pids),
        "process_count": len(rows),
        "cpu_percent": cpu_percent,
        "memory_mb": memory_mb,
        "runtime_seconds": runtime_seconds,
        "runtime_label": _format_duration(runtime_seconds),
        "pressure_level": _resource_pressure_level(cpu_percent, memory_mb, runtime_seconds),
        "policy": {
            "mode": mode,
            "label": policy.get("label", "Protected workload" if mode == "protected" else "Local app"),
        },
        "protected": bool(rows and mode == "protected"),
        "stop_api": f"/api/apps/{app.slug}/stop",
    }


def _resource_advisor_payload() -> dict[str, Any]:
    process_rows = _process_resource_snapshot()
    items = [_app_resource_item(app, process_rows) for app in _catalog()]
    running = [item for item in items if item["running"]]
    protected = [item for item in running if item["protected"]]
    items.sort(key=lambda item: (not item["running"], -item["cpu_percent"], -item["memory_mb"], item["name"]))
    return {
        "summary": {
            "running": len(running),
            "protected": len(protected),
            "cpu_percent": round(sum(item["cpu_percent"] for item in running), 1),
            "memory_mb": round(sum(item["memory_mb"] for item in running), 1),
        },
        "items": items,
    }


def _stop_target_pids(process: LaunchProcess, pid: int | None) -> list[int]:
    pids = set(_process_port_pids(process))
    if pid:
        pids.add(pid)
    # Kill the group leader too; npm/Vite often exposes a child as the port owner.
    for item in list(pids):
        pgid = _pid_group_id(item)
        if pgid:
            pids.add(pgid)
    return sorted(item for item in pids if _pid_alive(item))


def _item_state_dir(slug: str) -> Path:
    safe_slug = "".join(char for char in slug if char.isalnum() or char in {"-", "_"}).strip("-_") or "unknown"
    target = UI_STATE_DIR / "items" / safe_slug
    target.mkdir(parents=True, exist_ok=True)
    return target


def _item_state_file(slug: str) -> Path:
    return _item_state_dir(slug) / "state.json"


def _read_item_state(slug: str) -> dict[str, Any]:
    path = _item_state_file(slug)
    if not path.is_file():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_item_state(slug: str, state: dict[str, Any]) -> None:
    path = _item_state_file(slug)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


def _utc_stamp(epoch: int | None = None) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(epoch or int(time.time())))


def _record_item_event(slug: str, action: str, *, ok: bool = True, message: str = "", details: dict[str, Any] | None = None) -> dict[str, Any]:
    now = int(time.time())
    details = details or {}
    with _ITEM_STATE_LOCK:
        state = _read_item_state(slug)
        state["slug"] = slug
        state["updated_at"] = now
        state["updated_at_iso"] = _utc_stamp(now)
        if action in {"launch", "open"}:
            state["launch_count"] = int(state.get("launch_count") or 0) + 1
            state["last_opened_at"] = now
            state["last_opened_at_iso"] = _utc_stamp(now)
            state["last_launch_at"] = now
            state["last_launch_at_iso"] = _utc_stamp(now)
            state["last_launch_ok"] = bool(ok)
            state["last_launch_message"] = message
            runtime_url = details.get("runtime_url")
            if isinstance(runtime_url, str) and runtime_url:
                state["runtime_url"] = runtime_url
            runtime_health_url = details.get("runtime_health_url")
            if isinstance(runtime_health_url, str) and runtime_health_url:
                state["runtime_health_url"] = runtime_health_url
            runtime_ports = details.get("runtime_ports")
            if isinstance(runtime_ports, list):
                state["runtime_ports"] = runtime_ports
            dynamic_ports = details.get("dynamic_ports")
            if isinstance(dynamic_ports, list):
                state["dynamic_ports"] = dynamic_ports
            state["last_launch_diagnostic"] = details.get("diagnostic", "")
            state["last_launch_suggestions"] = details.get("suggestions", []) if isinstance(details.get("suggestions"), list) else []
        elif action == "stop":
            state["stop_count"] = int(state.get("stop_count") or 0) + 1
            state["last_stop_at"] = now
            state["last_stop_at_iso"] = _utc_stamp(now)
            state["last_stop_ok"] = bool(ok)
            state["last_stop_message"] = message
            state.pop("runtime_url", None)
            state.pop("runtime_health_url", None)
            state.pop("runtime_ports", None)
            state.pop("dynamic_ports", None)
        elif action == "start_process":
            state["last_process_start_at"] = now
            state["last_process_start_at_iso"] = _utc_stamp(now)
        if not ok and (details.get("diagnostic") or message):
            state["last_error"] = details.get("diagnostic") or message
        elif ok and action in {"launch", "open"}:
            state["last_error"] = ""
        event = {
            "at": now,
            "at_iso": _utc_stamp(now),
            "action": action,
            "ok": bool(ok),
            "message": message,
            "details": details,
        }
        events = state.get("events") if isinstance(state.get("events"), list) else []
        state["events"] = [event] + events[: ITEM_EVENT_LIMIT - 1]
        _write_item_state(slug, state)
        return state


def _runtime_state(slug: str) -> dict[str, Any]:
    state = _read_item_state(slug)
    events = state.get("events") if isinstance(state.get("events"), list) else []
    return {
        "last_opened_at": int(state.get("last_opened_at") or 0),
        "last_opened_at_iso": state.get("last_opened_at_iso", ""),
        "last_launch_at": int(state.get("last_launch_at") or 0),
        "last_launch_at_iso": state.get("last_launch_at_iso", ""),
        "last_launch_ok": bool(state.get("last_launch_ok", True)),
        "last_launch_message": state.get("last_launch_message", ""),
        "last_stop_at": int(state.get("last_stop_at") or 0),
        "last_stop_at_iso": state.get("last_stop_at_iso", ""),
        "last_stop_message": state.get("last_stop_message", ""),
        "launch_count": int(state.get("launch_count") or 0),
        "stop_count": int(state.get("stop_count") or 0),
        "last_error": state.get("last_error", ""),
        "runtime_url": state.get("runtime_url", ""),
        "runtime_health_url": state.get("runtime_health_url", ""),
        "runtime_ports": state.get("runtime_ports", []),
        "dynamic_ports": state.get("dynamic_ports", []),
        "last_launch_diagnostic": state.get("last_launch_diagnostic", ""),
        "last_launch_suggestions": state.get("last_launch_suggestions", []),
        "recent_events": events[:8],
    }


def _process_setup_health(process: LaunchProcess) -> dict[str, Any]:
    repo_exists = process.repo.exists()
    repo_access_error = _repo_access_error(process.repo) if repo_exists else f"Missing repo: {process.repo}"
    command_configured = bool(str(process.command or "").strip())
    issues = []
    if not repo_exists:
        issues.append("repo_missing")
    if repo_access_error:
        issues.append("repo_inaccessible")
    if not command_configured:
        issues.append("command_missing")
    return {
        "name": process.name,
        "repo": str(process.repo),
        "repo_exists": repo_exists,
        "repo_accessible": repo_exists and not repo_access_error,
        "repo_access_error": repo_access_error,
        "command_configured": command_configured,
        "ports": list(process.ports),
        "issues": issues,
        "ready": not issues,
    }


def _app_setup_health(app: AppLauncher) -> dict[str, Any]:
    processes = [_process_setup_health(process) for process in app.processes]
    asset_summary = _card_asset_summary(app.slug)
    issues = []
    for process in processes:
        issues.extend(f"{process['name']}:{issue}" for issue in process["issues"])
    issues.extend(f"asset_missing:{item}" for item in asset_summary.get("configured_missing", []))
    if not _card_reference_url(app.slug, "doc"):
        issues.append("doc_missing")
    return {
        "ready": not issues,
        "issues": issues,
        "processes": processes,
        "assets": asset_summary,
    }


def _static_setup_health(slug: str) -> dict[str, Any]:
    asset_summary = _card_asset_summary(slug)
    issues = [f"asset_missing:{item}" for item in asset_summary.get("configured_missing", [])]
    if not _card_reference_url(slug, "doc"):
        issues.append("doc_missing")
    return {"ready": not issues, "issues": issues, "assets": asset_summary}


def _app_state_dir(app: AppLauncher) -> Path:
    target = STATE_ROOT / app.slug
    target.mkdir(parents=True, exist_ok=True)
    return target


def _pid_file(app: AppLauncher, process: LaunchProcess) -> Path:
    return _app_state_dir(app) / f"{process.name}.pid"


def _log_file(app: AppLauncher, process: LaunchProcess) -> Path:
    return _app_state_dir(app) / f"{process.name}.log"


def _launcher_log(app: AppLauncher) -> Path:
    return _app_state_dir(app) / "launcher.log"


def _process_running(app: AppLauncher, process: LaunchProcess) -> bool:
    pid = _read_pid(_pid_file(app, process))
    if pid is None:
        # A bare port owner is only treated as this app when the app URL is healthy.
        # Otherwise it is a port conflict, not a successful launch.
        runtime_url = _effective_app_url(app)
        return bool(_process_port_pids(process)) and _status_url(
            _app_health_url(app, runtime_url),
            timeout=0.08,
        )
    if _pid_alive(pid):
        return True
    try:
        _pid_file(app, process).unlink()
    except OSError:
        pass
    runtime_url = _effective_app_url(app)
    return bool(_process_port_pids(process)) and _status_url(
        _app_health_url(app, runtime_url),
        timeout=0.08,
    )


def _pid_file_running(app: AppLauncher, process: LaunchProcess) -> bool:
    pid = _read_pid(_pid_file(app, process))
    if pid is None:
        return False
    if _pid_alive(pid):
        return True
    try:
        _pid_file(app, process).unlink()
    except OSError:
        pass
    return False


def _app_status(app: AppLauncher) -> dict[str, Any]:
    runtime_url = _effective_app_url(app)
    history = _runtime_state(app.slug)
    dynamic_port_map = {
        int(item["from"]): int(item["to"])
        for item in history.get("dynamic_ports", [])
        if isinstance(item, dict) and isinstance(item.get("from"), int) and isinstance(item.get("to"), int)
    }
    processes = []
    for process in app.processes:
        running = _process_running(app, process)
        pid = _read_pid(_pid_file(app, process)) if running else None
        port_pids = _process_port_pids(process) if running else []
        if pid is None and port_pids:
            pid = port_pids[0]
        display_ports = [dynamic_port_map.get(port, port) for port in getattr(process, "ports", ())]
        processes.append(
            {
                "name": process.name,
                "repo": str(process.repo),
                "command": process.command,
                "running": running,
                "pid": pid,
                "pids": sorted(set(([pid] if pid else []) + port_pids)),
                "ports": display_ports,
                "configured_ports": list(getattr(process, "ports", ())),
            }
        )
    runtime_health_url = _app_health_url(app, runtime_url)
    ready = _status_url(runtime_health_url)
    listening = _port_listening(runtime_url)
    configured_listening = _port_listening(app.url)
    any_process_running = any(item["running"] for item in processes)
    diagnostic = ""
    suggestions: list[str] = []
    if listening and not ready:
        diagnostic = _permission_diagnostic(app) or _url_failure_diagnostic(runtime_health_url)
    elif any_process_running and not ready:
        diagnostic = "Some processes are running, but the app URL is not ready. Stop and reopen this app after checking its logs."
        suggestions = ["Open logs for this app and look for dependency, build, or permission errors."]
    elif configured_listening and not ready and runtime_url == app.url:
        owners = _describe_port_owners(_url_host_port(app.url)[1]) if _url_host_port(app.url) else "another process"
        diagnostic = f"Configured app port is occupied but did not return a healthy app response ({owners})."
        suggestions = ["Stop the conflicting process or relaunch this app so Project Studio can choose a fallback port."]
    elif (
        not ready
        and history.get("last_launch_at", 0) > history.get("last_stop_at", 0)
        and not history.get("last_launch_ok", True)
    ):
        diagnostic = str(
            history.get("last_launch_diagnostic")
            or "The app process exited during startup. Open its logs for the startup error."
        )
        suggestions = list(history.get("last_launch_suggestions", []))
    return {
        "name": app.name,
        "slug": app.slug,
        "url": runtime_url,
        "configured_url": app.url,
        "runtime_url": runtime_url,
        "health_url": runtime_health_url,
        "configured_health_url": _app_health_url(app, app.url),
        "note": app.note,
        "ready": ready,
        "running": any_process_running or listening,
        "listening": listening,
        "diagnostic": diagnostic,
        "suggestions": [] if ready else (suggestions or history.get("last_launch_suggestions", [])),
        "processes": processes,
        "history": history,
        "setup": _app_setup_health(app),
    }


def _start_process(app: AppLauncher, process: LaunchProcess) -> bool:
    if _pid_file_running(app, process):
        return False
    if not process.repo.exists():
        _launcher_log(app).write_text(f"Missing repo for {process.name}: {process.repo}\n", encoding="utf-8")
        return False
    access_error = _repo_access_error(process.repo)
    if access_error:
        with _launcher_log(app).open("a", encoding="utf-8") as fh:
            fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Cannot start {process.name}: {access_error}\n")
        return False
    state_dir = _app_state_dir(app)
    log_path = _log_file(app, process)
    env = os.environ.copy()
    env["PATH"] = f"{LOCAL_PATH}:{env.get('PATH', '')}"
    launch_args = ["/bin/bash", "-c", process.command]
    # A linked project uses the same development-only runner as Codex and Claude.
    from studio_cli import find_manifest
    try:
        find_manifest(process.repo)
    except studio_credentials.CredentialError as exc:
        if any((folder / '.studio-secrets.json').exists() for folder in (process.repo, *process.repo.parents)):
            with log_path.open('a', encoding='utf-8') as log:
                log.write(str(exc) + '\n')
            return False
    else:
        launch_args = cli_command() + ["_run", "--", *launch_args]
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n[{time.strftime('%Y-%m-%d %H:%M:%S')}] Starting {process.name}: {process.command}\n")
        log.flush()
        proc = subprocess.Popen(
            launch_args,
            cwd=str(process.repo),
            env=env,
            stdout=log,
            stderr=subprocess.STDOUT,
            start_new_session=True,
        )
    _pid_file(app, process).write_text(f"{proc.pid}\n", encoding="utf-8")
    with _launcher_log(app).open("a", encoding="utf-8") as fh:
        fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Started {process.name} pid={proc.pid}\n")
    return True


def _start_app(app: AppLauncher) -> dict[str, Any]:
    started: list[str] = []
    immediate_starts: list[LaunchProcess] = []
    blockers: list[str] = []
    suggestions: list[str] = []
    plans: list[dict[str, Any]] = []
    dynamic_ports: list[dict[str, int]] = []
    runtime_url = _effective_app_url(app)

    if _status_url(_app_health_url(app, runtime_url), timeout=0.12):
        started.append("existing healthy server")
    else:
        for process in app.processes:
            prepared_process, plan = _prepare_launch_process(app, process)
            plans.append(plan)
            runtime_url = str(plan.get("runtime_url") or runtime_url)
            if plan.get("dynamic_port"):
                dynamic_ports.append({"from": int(plan["dynamic_port_from"]), "to": int(plan["dynamic_port_to"])})
                with _launcher_log(app).open("a", encoding="utf-8") as fh:
                    fh.write(
                        f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Port {plan['dynamic_port_from']} occupied; "
                        f"launching {process.name} on {plan['dynamic_port_to']} for {runtime_url}. "
                        f"Owner: {plan.get('port_conflict', 'unknown')}\n"
                    )
            if plan.get("diagnostic"):
                blockers.append(str(plan["diagnostic"]))
                suggestions.extend(str(item) for item in plan.get("suggestions", []))
                with _launcher_log(app).open("a", encoding="utf-8") as fh:
                    fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Launch blocked: {plan['diagnostic']}\n")
                continue
            if plan.get("already_running"):
                started.append(f"{process.name} already running")
                continue
            if prepared_process is None:
                continue
            if prepared_process.delay_seconds:
                threading.Timer(prepared_process.delay_seconds, _start_process, args=(app, prepared_process)).start()
                started.append(f"{prepared_process.name} scheduled")
                continue
            if _start_process(app, prepared_process):
                started.append(prepared_process.name)
                immediate_starts.append(prepared_process)
            elif not _process_running(app, prepared_process):
                blockers.append(
                    f"{prepared_process.name}: the process could not be started. "
                    "Open the app log for the startup error."
                )
                suggestions.append(
                    "Open logs for this app and check the most recent startup error."
                )

    # Give newly started processes a short, bounded survival window. This catches
    # commands that spawn successfully but immediately exit after an import,
    # configuration, lock, or bind error.
    if immediate_starts:
        settle_deadline = time.monotonic() + 3.0
        while time.monotonic() < settle_deadline:
            if _status_url(_app_health_url(app, runtime_url), timeout=0.12):
                break
            if not any(_pid_file_running(app, process) for process in immediate_starts):
                break
            time.sleep(0.1)

    # The loading page continues polling if a surviving server is still warming up.
    status = _default_status(app)
    status["url"] = runtime_url
    status["runtime_url"] = runtime_url
    status["configured_url"] = app.url
    status["health_url"] = _app_health_url(app, runtime_url)
    status["configured_health_url"] = _app_health_url(app, app.url)
    status["ready"] = _status_url(status["health_url"], timeout=0.12)
    status["listening"] = _port_listening(runtime_url, timeout=0.08)
    status["running"] = status["listening"] or any(
        _process_running(app, process) for process in app.processes
    )
    if immediate_starts and not (status["ready"] or status["running"]):
        blockers.append(
            "The app process exited during startup. Open its logs for the startup error."
        )
        suggestions.extend(
            [
                "Open logs for this app and check the most recent startup error.",
                "Resolve the reported configuration, dependency, lock, or port issue, then relaunch.",
            ]
        )
    runtime_diagnostic = ""
    if status["listening"] and not status["ready"]:
        still_warming = bool(immediate_starts) and any(
            _pid_file_running(app, process) for process in immediate_starts
        )
        if not still_warming:
            runtime_diagnostic = _permission_diagnostic(app) or _url_failure_diagnostic(status["health_url"])
    status["diagnostic"] = "; ".join(blockers) or runtime_diagnostic
    if status["diagnostic"] and not suggestions:
        suggestions = [
            "Open logs for this app and check the most recent startup error.",
            "Stop the app and relaunch after resolving the reported issue.",
        ]
    status["suggestions"] = list(dict.fromkeys(suggestions))
    status["started"] = started
    status["launch_plan"] = plans
    runtime_ports = []
    endpoint = _url_host_port(runtime_url)
    if endpoint:
        runtime_ports.append(endpoint[1])
    launch_ok = bool(status["ready"] or status["running"]) and not bool(status["diagnostic"])
    launch_message = ", ".join(started) or status["diagnostic"] or ("ready" if status["ready"] else "launch requested")
    _record_item_event(
        app.slug,
        "launch",
        ok=launch_ok,
        message=launch_message,
        details={
            "started": started,
            "ready": status["ready"],
            "running": status["running"],
            "listening": status["listening"],
            "diagnostic": status["diagnostic"],
            "suggestions": status["suggestions"],
            "runtime_url": runtime_url,
            "runtime_health_url": status.get("health_url", ""),
            "runtime_ports": runtime_ports,
            "dynamic_ports": dynamic_ports,
            "launch_plan": plans,
        },
    )
    status["history"] = _runtime_state(app.slug)
    status["setup"] = _app_setup_health(app)
    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE[app.slug] = (time.monotonic(), status)
    return status

def _stop_process(app: AppLauncher, process: LaunchProcess) -> dict[str, Any]:
    pid_path = _pid_file(app, process)
    pid = _read_pid(pid_path)
    pids = _stop_target_pids(process, pid)
    result: dict[str, Any] = {"name": process.name, "pid": pid, "pids": pids, "stopped": False, "message": "Not running"}
    if not pids:
        return result

    def send(target_pid: int, sig: int) -> None:
        pgid = _pid_group_id(target_pid)
        try:
            if pgid:
                os.killpg(pgid, sig)
            else:
                os.kill(target_pid, sig)
        except ProcessLookupError:
            if _pid_alive(target_pid):
                os.kill(target_pid, sig)
                return
            raise
        except OSError:
            os.kill(target_pid, sig)

    try:
        for target_pid in pids:
            if _pid_alive(target_pid):
                send(target_pid, signal.SIGTERM)
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            if not _process_port_pids(process) and all(not _pid_alive(target_pid) for target_pid in pids):
                break
            time.sleep(0.08)
        for target_pid in pids:
            if _pid_alive(target_pid):
                send(target_pid, signal.SIGKILL)
        for target_pid in _process_port_pids(process):
            send(target_pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except OSError as exc:
        result["message"] = f"Stop failed: {exc}"
    else:
        result["stopped"] = True
        result["message"] = "Stopped"

    try:
        pid_path.unlink()
    except OSError:
        pass
    with _launcher_log(app).open("a", encoding="utf-8") as fh:
        fh.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Stop {process.name} pids={pids}: {result['message']}\n")
    return result


def _stop_app(app: AppLauncher) -> dict[str, Any]:
    processes = [_stop_process(app, process) for process in app.processes]
    deadline = time.monotonic() + 1.2
    while time.monotonic() < deadline and _port_listening(app.url, timeout=0.04):
        time.sleep(0.08)
    status = _default_status(app)
    configured_url = app.url
    status["url"] = configured_url
    status["runtime_url"] = configured_url
    status["processes"] = [
        {
            "name": process.name,
            "repo": str(process.repo),
            "command": process.command,
            "running": False,
            "pid": None,
            "pids": [],
            "ports": list(getattr(process, "ports", ())),
        }
        for process in app.processes
    ]
    status["ready"] = _status_url(_app_health_url(app, configured_url), timeout=0.08)
    status["listening"] = _port_listening(configured_url, timeout=0.04)
    status["running"] = status["listening"] or any(_process_running(app, process) for process in app.processes)
    status["stopped"] = processes
    stopped_count = sum(1 for process in processes if process.get("stopped"))
    _record_item_event(
        app.slug,
        "stop",
        ok=True,
        message=f"{stopped_count} process(es) stopped" if stopped_count else "Not running",
        details={"stopped": processes, "ready": status["ready"], "running": status["running"], "listening": status["listening"]},
    )
    status["history"] = _runtime_state(app.slug)
    status["setup"] = _app_setup_health(app)
    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE[app.slug] = (time.monotonic(), status)
    return status


def _stop_all_local_apps() -> dict[str, Any]:
    results = []
    for app in _catalog():
        results.append(_stop_app(app))
    with _STATUS_CACHE_LOCK:
        _STATUS_CACHE.clear()
    return {"stopped": results}


def _tail(path: Path, max_lines: int = 120) -> str:
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-max_lines:])


def _logs(app: AppLauncher) -> str:
    parts = []
    launcher = _tail(_launcher_log(app))
    if launcher:
        parts.append(f"### launcher.log\n{launcher}")
    for process in app.processes:
        text = _tail(_log_file(app, process))
        if text:
            parts.append(f"### {process.name}.log\n{text}")
    return "\n\n".join(parts) or "No logs yet."


def _catalog() -> tuple[AppLauncher, ...]:
    return default_apps()


def _default_status(app: AppLauncher) -> dict[str, Any]:
    runtime_url = _effective_app_url(app)
    runtime_health_url = _app_health_url(app, runtime_url)
    listening = _port_listening(runtime_url)
    return {
        "name": app.name,
        "slug": app.slug,
        "url": runtime_url,
        "configured_url": app.url,
        "runtime_url": runtime_url,
        "health_url": runtime_health_url,
        "configured_health_url": _app_health_url(app, app.url),
        "note": app.note,
        "ready": False,
        "running": any(_pid_file_running(app, process) for process in app.processes) or listening,
        "listening": listening,
        "diagnostic": "",
        "suggestions": [],
        "processes": [],
        "history": _runtime_state(app.slug),
        "setup": _app_setup_health(app),
    }


def _cached_status(app: AppLauncher) -> dict[str, Any]:
    now = time.monotonic()
    with _STATUS_CACHE_LOCK:
        cached = _STATUS_CACHE.get(app.slug)
        if cached and now - cached[0] < STATUS_CACHE_TTL_SECONDS:
            return cached[1]
    _refresh_status_background(app)
    with _STATUS_CACHE_LOCK:
        cached = _STATUS_CACHE.get(app.slug)
        if cached:
            return cached[1]
    return _default_status(app)


def _refresh_status_background(app: AppLauncher) -> None:
    now = time.monotonic()
    with _STATUS_CACHE_LOCK:
        cached = _STATUS_CACHE.get(app.slug)
        if cached and now - cached[0] < STATUS_CACHE_TTL_SECONDS:
            return
        if app.slug in _STATUS_REFRESHING:
            return
        _STATUS_REFRESHING.add(app.slug)

    def worker() -> None:
        try:
            status = _app_status(app)
            with _STATUS_CACHE_LOCK:
                _STATUS_CACHE[app.slug] = (time.monotonic(), status)
        finally:
            with _STATUS_CACHE_LOCK:
                _STATUS_REFRESHING.discard(app.slug)

    threading.Thread(target=worker, name=f"launcher-status-{app.slug}", daemon=True).start()


def _refresh_all_status_background() -> None:
    for app in _catalog():
        _refresh_status_background(app)


def _cached_catalog_statuses_fast() -> list[dict[str, Any]]:
    _refresh_all_status_background()
    return [_cached_status(app) for app in _catalog()]


def _cached_catalog_statuses() -> list[dict[str, Any]]:
    return _cached_catalog_statuses_fast()


def _static_link_status(link: StaticLink) -> dict[str, Any]:
    return {
        "name": link.name,
        "slug": link.slug,
        "url": link.url,
        "note": link.note,
        "ready": True,
        "running": False,
        "static": True,
        "processes": [],
        "history": _runtime_state(link.slug),
        "setup": _static_setup_health(link.slug),
    }


def _launcher_items_statuses() -> list[dict[str, Any]]:
    return _cached_catalog_statuses() + [_static_link_status(link) for link in _static_links()]


def _launcher_registry_items() -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for app in _catalog():
        items.append(
            {
                "kind": "local_app",
                "name": app.name,
                "slug": app.slug,
                "url": app.url,
                "note": app.note,
                "group": _card_group(app.slug),
                "tags": list(_card_tags(app.slug)),
                "history": _runtime_state(app.slug),
                "setup": _app_setup_health(app),
                "versions": [dict(item) for item in _app_version_options(app.slug)],
                "default_version": APP_DEFAULT_VERSIONS.get(app.slug, ""),
                "processes": [
                    {
                        "name": process.name,
                        "repo": str(process.repo),
                        "repo_exists": process.repo.exists(),
                        "command": process.command,
                        "delay_seconds": process.delay_seconds,
                        "ports": list(process.ports),
                    }
                    for process in app.processes
                ],
                "assets": _card_asset_summary(app.slug),
            }
        )
    for link in _static_links():
        items.append(
            {
                "kind": "static_link",
                "name": link.name,
                "slug": link.slug,
                "url": link.url,
                "note": link.note,
                "group": _card_group(link.slug),
                "tags": list(_card_tags(link.slug)),
                "history": _runtime_state(link.slug),
                "setup": _static_setup_health(link.slug),
                "processes": [],
                "assets": _card_asset_summary(link.slug),
            }
        )
    for tool in _placeholder_tools():
        items.append(
            {
                "kind": "planned",
                "name": tool.name,
                "slug": tool.slug,
                "url": "",
                "note": tool.note,
                "group": _card_group(tool.slug),
                "tags": list(_card_tags(tool.slug)),
                "history": _runtime_state(tool.slug),
                "setup": _static_setup_health(tool.slug),
                "processes": [],
                "assets": _card_asset_summary(tool.slug),
            }
        )
    return items


def _configured_asset_paths(slug: str) -> dict[str, str]:
    return {
        key: value
        for key, value in CARD_ASSETS.get(slug, {}).items()
        if value and not value.startswith(("http://", "https://"))
    }


def _card_asset_summary(slug: str) -> dict[str, Any]:
    configured = _configured_asset_paths(slug)
    missing = sorted(path for path in configured.values() if not _asset_exists(path))
    return {
        "photo": _asset_url(_card_asset(slug, "photo")),
        "icon": _asset_url(_card_asset(slug, "icon")),
        "doc": _card_reference_url(slug, "doc"),
        "pdf": _card_reference_url(slug, "pdf"),
        "preview_images": [_asset_url(path) for path in _card_photo_assets(slug)],
        "configured_missing": missing,
    }


def _project_studio_validation(items: list[dict[str, Any]]) -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    seen: dict[str, str] = {}
    for item in items:
        slug = str(item.get("slug", ""))
        if not slug:
            errors.append(f"{item.get('name', 'Unnamed item')}: missing slug")
            continue
        if slug in seen:
            errors.append(f"{slug}: duplicate slug used by {seen[slug]} and {item.get('kind', 'unknown')}")
        seen[slug] = str(item.get("kind", "unknown"))
        if not _card_reference_url(slug, "doc"):
            warnings.append(f"{slug}: no Project Studio card README found in assets/docs")
        for missing in item.get("assets", {}).get("configured_missing", []):
            warnings.append(f"{slug}: configured asset missing: {missing}")
        if item.get("kind") in {"local_app", "static_link", "planned"}:
            preview_count = len(item.get("assets", {}).get("preview_images", []))
            if preview_count < 3:
                warnings.append(f"{slug}: only {preview_count} card/detail preview image(s) configured")
            if slug not in PORTFOLIO_COPY:
                warnings.append(f"{slug}: no portfolio presentation copy configured")
        for process in item.get("processes", []):
            # Missing app repos should not prevent Project Studio itself from opening.
            # They are surfaced as per-app setup issues and launcher warnings instead.
            if not process.get("repo_exists"):
                warnings.append(f"{slug}/{process.get('name', 'process')}: missing repo {process.get('repo')}")
            if not process.get("command"):
                warnings.append(f"{slug}/{process.get('name', 'process')}: missing launch command")
            command = str(process.get("command") or "")
            for port in process.get("ports", []):
                if str(port) not in command:
                    warnings.append(f"{slug}/{process.get('name', 'process')}: port {port} is declared but not explicit in launch command")
    template_ids: set[str] = set()
    for template in PORTFOLIO_TEMPLATES:
        template_id = str(template.get("id", ""))
        if not template_id:
            errors.append("Portfolio template with missing id")
        elif template_id in template_ids:
            errors.append(f"{template_id}: duplicate portfolio template id")
        template_ids.add(template_id)
    ui_validation = _static_ui_asset_validation()
    errors.extend(ui_validation["errors"])
    warnings.extend(ui_validation["warnings"])
    return {"errors": sorted(errors), "warnings": sorted(warnings)}


def _static_ui_asset_validation() -> dict[str, list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    required = {
        "studio.css": "css",
        "studio.js": "js",
        "portfolio.css": "css",
        "portfolio.js": "js",
    }
    for relative_path, kind in required.items():
        path = PROJECT_STUDIO_ASSETS / relative_path
        if not path.is_file():
            errors.append(f"Project Studio UI asset missing: {relative_path}")
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except OSError as exc:
            errors.append(f"Project Studio UI asset unreadable: {relative_path}: {exc}")
            continue
        if not text.strip():
            errors.append(f"Project Studio UI asset empty: {relative_path}")
            continue
        if relative_path.endswith(".css") and ("{{" in text or "}}" in text):
            errors.append(f"Project Studio UI asset still contains Python f-string braces: {relative_path}")
        if kind == "css":
            if text.count("{") != text.count("}"):
                errors.append(f"Project Studio CSS has unbalanced braces: {relative_path}")
        elif kind == "js":
            node = shutil.which("node")
            if not node:
                warnings.append(f"Cannot parse-check {relative_path}: node is not on PATH")
                continue
            result = subprocess.run(
                [node, "--check", str(path)],
                capture_output=True,
                text=True,
                timeout=5,
                check=False,
            )
            if result.returncode != 0:
                errors.append(
                    f"Project Studio JavaScript parse failed for {relative_path}: "
                    f"{(result.stderr or result.stdout).strip()}"
                )
    return {"errors": errors, "warnings": warnings}


def _project_studio_manifest() -> dict[str, Any]:
    items = _launcher_registry_items()
    validation = _project_studio_validation(items)
    return {
        "name": "Project Studio",
        "server": {
            "default_host": "127.0.0.1",
            "default_port": 8765,
            "state_dir": str(UI_STATE_DIR),
            "asset_dir": str(PROJECT_STUDIO_ASSETS),
        },
        "counts": {
            "local_apps": sum(1 for item in items if item["kind"] == "local_app"),
            "static_links": sum(1 for item in items if item["kind"] == "static_link"),
            "planned": sum(1 for item in items if item["kind"] == "planned"),
            "portfolio_templates": len(PORTFOLIO_TEMPLATES),
            "errors": len(validation["errors"]),
            "warnings": len(validation["warnings"]),
        },
        "items": items,
        "portfolio": {
            "templates": list(PORTFOLIO_TEMPLATES),
            "defaults": PORTFOLIO_DEFAULT_SETTINGS,
        },
        "resource_policies": {
            "default": DEFAULT_RESOURCE_POLICY,
            "apps": RESOURCE_POLICIES,
        },
        "validation": validation,
    }


def _project_studio_setup_payload() -> dict[str, Any]:
    items = _launcher_registry_items()
    validation = _project_studio_validation(items)
    return {
        "ok": not validation["errors"],
        "counts": {
            "ready": sum(1 for item in items if item.get("setup", {}).get("ready")),
            "attention": sum(1 for item in items if not item.get("setup", {}).get("ready")),
            "errors": len(validation["errors"]),
            "warnings": len(validation["warnings"]),
        },
        "items": [
            {
                "kind": item.get("kind"),
                "slug": item.get("slug"),
                "name": item.get("name"),
                "setup": item.get("setup", {}),
                "history": item.get("history", {}),
            }
            for item in items
        ],
        "validation": validation,
    }


def _find_app(slug: str) -> AppLauncher | None:
    return next((app for app in _catalog() if app.slug == slug), None)


def _find_static_link(slug: str) -> StaticLink | None:
    return next((link for link in _static_links() if link.slug == slug), None)


def _query_flag(path: str, name: str) -> bool:
    value = parse_qs(urlparse(path).query).get(name, ["0"])[0].strip().lower()
    return value in {"1", "true", "yes", "on"}


def _query_value(path: str, name: str, default: str = "") -> str:
    return parse_qs(urlparse(path).query).get(name, [default])[0].strip()


def _json_response(handler: BaseHTTPRequestHandler, payload: Any, status: int = 200) -> None:
    body = json.dumps(payload, indent=2).encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", "application/json; charset=utf-8")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)



def _reload_catalog():
    current = catalog()
    if current == _user_catalog:
        return
    with _ITEM_STATE_LOCK:
        _user_catalog.clear(); _user_catalog.update(current)
        for name in ('CARD_ASSETS', 'CARD_GROUPS', 'CARD_TAGS', 'APP_VERSION_OPTIONS',
                     'APP_DEFAULT_VERSIONS', 'RESOURCE_POLICIES', 'PORTFOLIO_COPY', 'TAG_FILTERS'):
            globals()[name] = current['metadata'].get(name, [] if name == 'TAG_FILTERS' else {})


def _asset_path(relative):
    # User media may override images/docs, never application JavaScript or CSS.
    roots = [PROJECT_STUDIO_ASSETS]
    if Path(relative).parts and Path(relative).parts[0] in MEDIA:
        roots.insert(0, state_root() / 'media')
    for root in roots:
        path = (root / relative).resolve()
        if root.resolve() in path.parents and path.is_file():
            return path
    return None

def _asset_url(relative_path: str | None) -> str:
    if not relative_path:
        return ""
    return f"/project-studio-assets/{relative_path}"


def _asset_or_external_url(value: str | None) -> str:
    if not value:
        return ""
    if value.startswith(("http://", "https://")):
        return value
    return _asset_url(value) if _asset_exists(value) else ""


def _asset_exists(relative_path: str | None) -> bool:
    if not relative_path:
        return False
    try:
        return _asset_path(relative_path) is not None
    except OSError:
        return False


def _card_asset(slug: str, key: str) -> str:
    if key == "photo":
        extracted = f"screenshots/{slug}.jpg"
        if _asset_exists(extracted):
            return extracted
    value = CARD_ASSETS.get(slug, {}).get(key, "")
    return value if _asset_exists(value) else ""


def _card_reference_url(slug: str, key: str) -> str:
    configured = CARD_ASSETS.get(slug, {}).get(key, "")
    if configured:
        url = _asset_or_external_url(configured)
        if url:
            return url
    if key == "doc":
        default_doc = f"docs/{slug}.md"
        return _asset_url(default_doc) if _asset_exists(default_doc) else ""
    if key == "pdf":
        default_pdf = f"docs/{slug}.pdf"
        return _asset_url(default_pdf) if _asset_exists(default_pdf) else ""
    return ""


def _card_photo_assets(slug: str) -> list[str]:
    selected: list[str] = []

    def add(relative_path: str | None) -> None:
        if relative_path and _asset_exists(relative_path) and relative_path not in selected:
            selected.append(relative_path)

    def add_matches(folder: str, pattern: str) -> None:
        for root in (state_root() / 'media', PROJECT_STUDIO_ASSETS):
            for path in sorted((root / folder).glob(pattern)):
                if path.is_file():
                    add(str(path.relative_to(root)))

    # Keep visual previews tied to the app slug. Do not backfill with unrelated
    # app photos, because that makes cards and detail modals look misassigned.
    for extension in ("jpg", "jpeg", "png", "webp", "svg"):
        add(f"screenshots/{slug}.{extension}")
        add_matches("screenshots", f"{slug}-*.{extension}")
        add_matches("photos", f"{slug}-*.{extension}")

    for viewport in ("desktop", "tablet", "mobile"):
        add(f"portfolio-screenshots/{slug}/{viewport}.png")

    add(CARD_ASSETS.get(slug, {}).get("photo", ""))
    return selected[:4]


def _card_group(slug: str) -> dict[str, str]:
    return CARD_GROUPS.get(slug, {"category": "other", "agency": "none", "label": "Other"})


def _asset_url_versioned(relative_path: str) -> str:
    path = _asset_path(relative_path)
    try:
        version = path.stat().st_mtime_ns
    except (OSError, AttributeError):
        version = int(time.time())
    return f"/project-studio-assets/{relative_path}?v={version}"


def _index_preload_links() -> str:
    assets: list[str] = []

    def add(relative_path: str | None) -> None:
        if relative_path and _asset_exists(relative_path) and relative_path not in assets:
            assets.append(relative_path)

    slugs = [app.slug for app in _catalog()]
    slugs.extend(link.slug for link in _static_links())
    slugs.extend(tool.slug for tool in _placeholder_tools())
    # Only prioritize the first visible icons; off-screen previews must not
    # compete with the styles and scripts needed to display the launcher.
    for slug in slugs[:6]:
        add(_card_asset(slug, "icon"))

    return "\n".join(
        f'  <link rel="preload" as="image" href="{html.escape(_asset_url(asset))}" />'
        for asset in assets
    )


PORTFOLIO_TEMPLATES: tuple[dict[str, str], ...] = (
    {
        "id": "cinematic",
        "name": "Cinematic Hero Wall",
        "description": "Dramatic hero composition with oversized product imagery and film-title pacing.",
        "icon": "◐",
    },
    {
        "id": "editorial",
        "name": "Editorial Case Study",
        "description": "Magazine-like case studies with story rhythm, pull quotes, and warm spacing.",
        "icon": "¶",
    },
    {
        "id": "device-grid",
        "name": "Device Showcase Grid",
        "description": "Launch-page cards pairing desktop, tablet, and mobile previews.",
        "icon": "▦",
    },
    {
        "id": "glass-system",
        "name": "Floating Glass System",
        "description": "Layered translucent cards for a premium command-center feel.",
        "icon": "◇",
    },
    {
        "id": "brutalist",
        "name": "Brutalist Product Index",
        "description": "Sharp borders, dense metadata, strong numbering, and archive confidence.",
        "icon": "▣",
    },
    {
        "id": "investor",
        "name": "Investor Deck Mode",
        "description": "Slide-style product opportunity pages with problem, solution, and traction.",
        "icon": "↗",
    },
    {
        "id": "mobile-first",
        "name": "Mobile-First Showcase",
        "description": "Vertical phone-first rhythm with compact app-store style panels.",
        "icon": "▥",
    },
    {
        "id": "command-center",
        "name": "Desktop Command Center",
        "description": "Wide operational dashboards focused on desktop surfaces and capability panels.",
        "icon": "▤",
    },
    {
        "id": "gallery",
        "name": "Gallery / Museum Mode",
        "description": "Quiet exhibit pacing, large imagery, plaques, captions, and cinematic spacing.",
        "icon": "□",
    },
    {
        "id": "agency",
        "name": "Agency Portfolio Homepage",
        "description": "Polished studio homepage with selected work, capabilities, and contact footer.",
        "icon": "✦",
    },
)


PORTFOLIO_DEFAULT_SETTINGS: dict[str, Any] = {
    "title": "Project Studio Portfolio",
    "subtitle": "Working interfaces, operational systems, and decision tools.",
    "studioName": "Project Studio",
    "intro": (
        "A local-first command surface for tools, prototypes, and operational systems. "
        "Each project is presented as a working interface, not a static presentation."
    ),
    "footerText": "Available for structured product, data, and decision-support work.",
    "template": "cinematic",
    "featuredSlug": "",
    "ordering": "priority",
    "showMetadata": True,
    "showMetrics": True,
    "showTechStack": True,
    "showDescriptions": True,
    "showTags": True,
    "density": "standard",
    "themeMode": "dark",
    "accentPalette": "cyan-emerald",
    "backgroundStyle": "cinematic-dark",
    "typographyScale": "standard",
    "radiusScale": "soft",
    "screenshotFrameStyle": "browser",
    "animationLevel": "subtle",
    "imageShadowIntensity": "strong",
    "pageWidth": "wide",
    "hiddenProjects": [],
    "projectTemplates": {},
    "projectOverrides": {},
}


PORTFOLIO_COPY = _user_catalog["metadata"].get("PORTFOLIO_COPY", {})


def _portfolio_screenshot(slug: str, kind: str) -> str:
    explicit = f"portfolio-screenshots/{slug}/{kind}.png"
    if _asset_exists(explicit):
        return _asset_url(explicit)
    if kind == "desktop":
        extracted = f"screenshots/{slug}.jpg"
        if _asset_exists(extracted):
            return _asset_url(extracted)
    return ""


def _portfolio_project(
    *,
    slug: str,
    name: str,
    note: str,
    kind: str,
    order: int,
    live_url: str = "",
    repository_path: str = "",
    planned: bool = False,
) -> dict[str, Any]:
    group = _card_group(slug)
    copy = PORTFOLIO_COPY.get(slug, {})
    accent = copy.get("accent") or "#6ee7d8"
    screenshots = {
        "desktop": _portfolio_screenshot(slug, "desktop"),
        "mobile": _portfolio_screenshot(slug, "mobile"),
        "tablet": _portfolio_screenshot(slug, "tablet"),
    }
    preview_images = [_asset_url(path) for path in _card_photo_assets(slug)]
    status = "Planned" if planned else ("Hosted" if kind == "External link" else "Local app")
    default_features = [
        "Structured local launch workflow",
        "Polished project surface",
        "Portfolio-ready documentation",
    ]
    default_metrics = [
        {"value": "1 surface", "label": "Working interface"},
        {"value": "5/5", "label": "Portfolio readiness target"},
    ]
    return {
        "id": slug,
        "slug": slug,
        "name": name,
        "headline": copy.get("headline") or "A focused working interface for structured digital operations.",
        "summary": copy.get("summary") or note or "Built for fast decisions, clean operations, and focused execution.",
        "description": copy.get("description")
        or (
            "From raw workflow to usable interface, this project is organized as a compact operating layer. "
            "The portfolio entry uses placeholder narrative where final product notes are still being written."
        ),
        "category": group["label"],
        "status": copy.get("status") or status,
        "role": copy.get("role") or "Product design, implementation, and local workflow packaging",
        "techStack": copy.get("techStack") or ["Local app", "Frontend UI", "Project Studio"],
        "year": str(copy.get("year") or "2026"),
        "keyFeatures": copy.get("features") or default_features,
        "impactMetrics": copy.get("metrics") or default_metrics,
        "screenshots": screenshots,
        "previewImages": preview_images,
        "accentColor": accent,
        "themeMode": copy.get("themeMode") or "dark",
        "client": copy.get("client") or group["label"],
        "tags": copy.get("tags") or [group["label"], kind, "Project Studio"],
        "featured": bool(copy.get("featured", False)),
        "displayPriority": int(copy.get("priority") or (order + 20)),
        "liveUrl": live_url,
        "repositoryPath": repository_path,
        "kind": kind,
        "disabled": planned,
    }


def _portfolio_payload() -> dict[str, Any]:
    projects: list[dict[str, Any]] = []
    for index, app in enumerate(_catalog()):
        repository_path = str(app.processes[0].repo) if app.processes else ""
        projects.append(
            _portfolio_project(
                slug=app.slug,
                name=app.name,
                note=_default_app_note(app),
                kind="Local app",
                order=index,
                live_url=app.url,
                repository_path=repository_path,
            )
        )
    static_offset = len(projects)
    for index, link in enumerate(_static_links()):
        projects.append(
            _portfolio_project(
                slug=link.slug,
                name=link.name,
                note=link.note,
                kind="External link",
                order=static_offset + index,
                live_url=link.url,
            )
        )
    placeholder_offset = len(projects)
    for index, tool in enumerate(_placeholder_tools()):
        projects.append(
            _portfolio_project(
                slug=tool.slug,
                name=tool.name,
                note=tool.note,
                kind="Planned",
                order=placeholder_offset + index,
                planned=True,
            )
        )
    return {
        "templates": list(PORTFOLIO_TEMPLATES),
        "defaults": PORTFOLIO_DEFAULT_SETTINGS,
        "projects": projects,
    }


def _detail_attrs(
    *,
    slug: str,
    name: str,
    note: str,
    kind: str,
    endpoint: str,
    launch_url: str,
    logs_url: str = "",
    folder_url: str = "",
    stop_api: str = "",
    disabled: bool = False,
    static: bool = False,
) -> str:
    group = _card_group(slug)
    copy = PORTFOLIO_COPY.get(slug, {})
    photos = [_asset_url(path) for path in _card_photo_assets(slug)]
    icon_url = _asset_url(_card_asset(slug, "icon"))
    description = copy.get("description") or (
        "This project is organized as a working interface inside Project Studio, with local launch controls, "
        "documentation, status monitoring, and portfolio presentation metadata available from one place."
    )
    detail_tags = list(copy.get("tags") or [group["label"], kind, "Project Studio"])
    seen_tags = {str(item).casefold() for item in detail_tags}
    for tag_label in _card_tag_labels(slug):
        if tag_label.casefold() not in seen_tags:
            detail_tags.append(tag_label)
            seen_tags.add(tag_label.casefold())
    attrs = {
        "data-detail-name": name,
        "data-detail-note": note,
        "data-detail-description": description,
        "data-detail-headline": copy.get("headline") or note,
        "data-detail-role": copy.get("role") or "Project design, implementation, and local workflow packaging",
        "data-detail-tags": json.dumps(detail_tags),
        "data-detail-tech": json.dumps(copy.get("techStack") or ["Local app", "Project Studio"]),
        "data-detail-photos": json.dumps(photos),
        "data-detail-icon-url": icon_url,
        "data-detail-kind": kind,
        "data-detail-group": group["label"],
        "data-detail-endpoint": endpoint,
        "data-detail-launch-url": launch_url,
        "data-detail-logs-url": logs_url,
        "data-detail-folder-url": folder_url,
        "data-detail-stop-api": stop_api,
        "data-detail-doc-url": _card_reference_url(slug, "doc"),
        "data-detail-pdf-url": _card_reference_url(slug, "pdf"),
        "data-detail-static": str(static).lower(),
        "data-detail-disabled": str(disabled).lower(),
        "data-detail-versions": json.dumps(_app_version_options(slug)),
        "data-detail-default-version": APP_DEFAULT_VERSIONS.get(slug, ""),
    }
    return " ".join(f'{key}="{html.escape(value)}"' for key, value in attrs.items())


def _default_app_note(app: AppLauncher) -> str:
    return app.note or "Local development tool launched from its live project folder."


def _card_photos_html(slug: str, label: str) -> str:
    photos = [_asset_url(photo) for photo in _card_photo_assets(slug)]
    if not photos:
        return '<div class="tool-card__photos tool-card__photos--empty"><span>Preview pending</span></div>'
    while len(photos) < 3:
        photos.append(photos[-1])
    escaped = [html.escape(photo) for photo in photos[:3]]
    escaped_label = html.escape(label)
    return f"""
            <div class="tool-card__photos" aria-label="{escaped_label} preview images">
              <span class="tool-card__shot tool-card__shot--wide" style="background-image:url('{escaped[0]}')"></span>
              <span class="tool-card__shot tool-card__shot--detail" style="background-image:url('{escaped[1]}')"></span>
              <span class="tool-card__shot tool-card__shot--soft" style="background-image:url('{escaped[2]}')"></span>
            </div>
    """


def _card_body_html(
    *,
    slug: str,
    name: str,
    note: str,
    group_label: str,
    kind: str,
    endpoint: str,
    planned: bool = False,
) -> str:
    planned_html = '<span class="planned-chip">Planned</span>' if planned else ""
    return f"""
            <div class="tool-card__body">
              <span class="category-chip">{html.escape(group_label)}</span>
              <h2>{html.escape(name)}</h2>
              {planned_html}
              <div class="completion-meter" data-completion-meter data-score="0" aria-label="{html.escape(name)} completion">
                <button type="button" data-completion-value="1" title="Set completion to 1 of 5"></button>
                <button type="button" data-completion-value="2" title="Set completion to 2 of 5"></button>
                <button type="button" data-completion-value="3" title="Set completion to 3 of 5"></button>
                <button type="button" data-completion-value="4" title="Set completion to 4 of 5"></button>
                <button type="button" data-completion-value="5" title="Set completion to 5 of 5"></button>
              </div>
              <p class="tool-card__note">{html.escape(note)}</p>
              <dl class="tool-card__meta">
                <div><dt>Type</dt><dd>{html.escape(kind)}</dd></div>
                <div><dt>Group</dt><dd>{html.escape(group_label)}</dd></div>
                <div><dt>Status</dt><dd data-role="status-label">Checking</dd></div>
                <div><dt>Updated</dt><dd data-role="modified-label">-</dd></div>
                <div class="tool-card__meta-endpoint"><dt>Endpoint</dt><dd>{html.escape(endpoint)}</dd></div>
              </dl>
              {_card_photos_html(slug, name)}
            </div>
    """


def _repo_times(paths: list[Path]) -> tuple[int, int]:
    created_values: list[float] = []
    modified_values: list[float] = []
    for path in paths:
        try:
            stat = path.stat()
        except OSError:
            continue
        created_values.append(getattr(stat, "st_birthtime", stat.st_ctime))
        modified_values.append(stat.st_mtime)
    now = int(time.time())
    created = int(min(created_values)) if created_values else now
    modified = int(max(modified_values)) if modified_values else now
    return created, modified


def _app_card_attrs(app: AppLauncher, order: int) -> str:
    group = _card_group(app.slug)
    created, modified = _repo_times([process.repo for process in app.processes])
    return (
        f'data-slug="{html.escape(app.slug)}" '
        f'data-category="{html.escape(group["category"])}" '
        f'data-agency="{html.escape(group["agency"])}" '
        f'data-group-label="{html.escape(group["label"])}" '
        f'data-tags="{html.escape(" ".join(_card_tags(app.slug)))}" '
        f'data-created="{created}" '
        f'data-modified="{modified}" '
        f'data-name="{html.escape(app.name.lower())}" '
        f'data-order="{order}"'
    )


def _static_card_attrs(link: StaticLink, order: int) -> str:
    group = _card_group(link.slug)
    created, modified = _repo_times([PROJECT_STUDIO_ASSETS / _card_asset(link.slug, "photo")])
    return (
        f'data-slug="{html.escape(link.slug)}" '
        f'data-category="{html.escape(group["category"])}" '
        f'data-agency="{html.escape(group["agency"])}" '
        f'data-group-label="{html.escape(group["label"])}" '
        f'data-tags="{html.escape(" ".join(_card_tags(link.slug)))}" '
        f'data-created="{created}" '
        f'data-modified="{modified}" '
        f'data-name="{html.escape(link.name.lower())}" '
        f'data-order="{order}"'
    )


def _placeholder_card_attrs(tool: PlaceholderTool, order: int) -> str:
    group = _card_group(tool.slug)
    created, modified = _repo_times([PROJECT_STUDIO_ASSETS / _card_asset(tool.slug, "photo")])
    return (
        f'data-slug="{html.escape(tool.slug)}" '
        f'data-category="{html.escape(group["category"])}" '
        f'data-agency="{html.escape(group["agency"])}" '
        f'data-group-label="{html.escape(group["label"])}" '
        f'data-tags="{html.escape(" ".join(_card_tags(tool.slug)))}" '
        f'data-created="{created}" '
        f'data-modified="{modified}" '
        f'data-name="{html.escape(tool.name.lower())}" '
        f'data-disabled="true" '
        f'data-order="{order}"'
    )


def _app_mark_html(
    *,
    slug: str,
    motif: str,
    primary: str,
    secondary: str,
    accent: str,
    glyph: str,
) -> str:
    photo = _asset_url(_card_asset(slug, "photo"))
    icon = _asset_url(_card_asset(slug, "icon"))
    photo_style = f"--card-photo:url('{html.escape(photo)}');" if photo else ""
    brand = (
        f'<img class="app-mark__brand" src="{html.escape(icon)}" alt="" loading="eager" decoding="sync" fetchpriority="high" />'
        if icon
        else ""
    )
    return f"""
            <div
              class="app-mark app-mark--{html.escape(motif)}"
              data-brand="{str(bool(icon)).lower()}"
              style="--icon-primary:{html.escape(primary)};--icon-secondary:{html.escape(secondary)};--icon-accent:{html.escape(accent)};{photo_style}"
              aria-hidden="true"
            >
              <span class="app-mark__photo"></span>
              {brand}
              <span class="app-mark__glyph">{html.escape(glyph)}</span>
            </div>
    """


def _text_response(handler: BaseHTTPRequestHandler, text: str, status: int = 200, content_type: str = "text/plain") -> None:
    if content_type == "text/html":
        text = studio_auth.inject(text)
    body = text.encode("utf-8")
    handler.send_response(status)
    handler.send_header("content-type", f"{content_type}; charset=utf-8")
    handler.send_header("cache-control", "no-store")
    handler.send_header("content-length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _asset_response(handler: BaseHTTPRequestHandler, relative_path: str) -> None:
    try:
        asset_root = PROJECT_STUDIO_ASSETS.resolve()
        path = _asset_path(relative_path)
        if path is None or path == asset_root / "credentials.html":
            _text_response(handler, "Not found", status=404)
            return
        info = path.stat()
        etag = f'"{info.st_mtime_ns:x}-{info.st_size:x}"'
        # Only already-public visual/code assets may be cached. Documents and
        # metadata retain no-store and still pass through owner authentication.
        cacheable = path.suffix.lower() in ('.js', '.css', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.svg', '.woff', '.woff2')
        if cacheable and handler.headers.get('If-None-Match') == etag:
            handler.send_response(304)
            handler.send_header("cache-control", "private, no-cache")
            handler.send_header("etag", etag)
            handler.end_headers()
            return
        data = path.read_bytes()
    except OSError:
        _text_response(handler, "Not found", status=404)
        return
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    handler.send_response(200)
    handler.send_header("content-type", content_type)
    handler.send_header("cache-control", "private, no-cache" if cacheable else "no-store")
    if cacheable:
        handler.send_header("etag", etag)
    handler.send_header("content-length", str(len(data)))
    handler.end_headers()
    handler.wfile.write(data)


def _app_loading_html(
    app: AppLauncher,
    status: dict[str, Any],
) -> str:
    if status.get("focused_existing_tab"):
        return _focused_tab_html(app.name, str(status.get("runtime_url") or app.url), status.get("tab_focus", {}))
    payload = json.dumps({
        "appId": app.slug,
        "url": status.get("runtime_url") or status.get("url") or app.url,
        "ready": bool(status.get("ready")) or not app.processes,
        "statusUrl": f"/api/apps/{app.slug}/status",
        "launchUrl": f"/api/apps/{app.slug}/launch",
        "diagnostic": str(status.get("diagnostic") or ""),
        "suggestions": [str(item) for item in (status.get("suggestions") or [])],
    }).replace("<", "\\u003c")
    return """<!doctype html><html><head><meta charset="utf-8">
    <title>Project Studio</title><style>
    body{margin:0;background:#f4f5f7;color:#202b3a;font:16px -apple-system,sans-serif;padding:8vh 8vw}
    main{max-width:620px}h1{font-size:30px}p{line-height:1.6}a{color:#1456a0}
    button{padding:10px 20px;border:0;border-radius:8px;background:#203d63;color:white;cursor:pointer}
    </style></head><body><main><a href="/">Back to Project Studio</a>
    <h1 id="heading">Opening app</h1><p id="message">Waiting for the app to be ready...</p>
    <button id="retry" hidden>Retry</button></main><script>
    const app = """ + payload + """;
    const message = document.getElementById('message');
    const retry = document.getElementById('retry');
    let running = false;
    function blocked() {
      return !app.ready && app.diagnostic
        ? app.diagnostic + (app.suggestions && app.suggestions.length ? ' \u2014 ' + app.suggestions.join(' ') : '')
        : '';
    }
    function absorb(state) {
      app.ready = state.ready;
      app.url = state.runtime_url || state.url || app.url;
      app.diagnostic = state.diagnostic || '';
      app.suggestions = state.suggestions || [];
    }
    async function open() {
      if (running) return;
      running = true;
      retry.hidden = true;
      try {
        // A launch that already failed reports a diagnostic. Surface it now rather
        // than polling a server that was never started.
        if (blocked()) throw new Error(blocked());
        const deadline = Date.now() + 90000;
        while (true) {
          if (!app.ready) {
            const response = await fetch(app.statusUrl);
            if (response.ok) {
              absorb(await response.json());
              if (blocked()) throw new Error(blocked());
            }
          }
          if (app.ready) break;
          if (Date.now() > deadline) throw new Error('App did not start. Check the launch logs, then retry.');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        location.replace(app.url);
      } catch(error) {
        message.textContent = error.message;
        retry.hidden = false;
      } finally { running = false; }
    }
    retry.onclick = async () => {
      retry.hidden = true;
      message.textContent = 'Retrying launch...';
      try {
        const response = await fetch(app.launchUrl, {method: 'POST'});
        if (response.ok) absorb(await response.json());
      } catch {}
      open();
    };
    open();
    </script></body></html>"""


def _logs_html(app: AppLauncher) -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(app.name)} logs</title>
  <style>
    :root {{ color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }}
    body {{ margin: 0; color: #ecf7ff; background: #07111c; }}
    header {{ position: sticky; top: 0; padding: 18px 22px; background: rgba(7,17,28,.9); border-bottom: 1px solid rgba(158,214,237,.18); backdrop-filter: blur(14px); }}
    h1 {{ margin: 0; font-size: 26px; letter-spacing: -.04em; }}
    a {{ color: #9ddcf0; }}
    pre {{ margin: 0; padding: 22px; white-space: pre-wrap; line-height: 1.45; color: #cceeff; font-family: SFMono-Regular, Menlo, Consolas, monospace; }}
  </style>
</head>
<body>
  <header><h1>{html.escape(app.name)} logs</h1><a href="/">Back to launcher</a></header>
  <pre>{html.escape(_logs(app))}</pre>
</body>
</html>"""


def _folder_html(app: AppLauncher) -> str:
    folder = app.processes[0].repo if app.processes else REPO_ROOT
    try:
        subprocess.Popen(["open", str(folder)])
        message = f"Opened {folder} in Finder."
    except Exception as exc:
        message = f"Could not open {folder}: {exc}"
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Open folder</title>
  <style>
    :root {{ color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; color: #ecf7ff; background: #07111c; }}
    main {{ width: min(560px, calc(100vw - 32px)); padding: 28px; border: 1px solid rgba(158,214,237,.18); border-radius: 24px; background: rgba(10,28,43,.78); }}
    a {{ color: #9ddcf0; }}
  </style>
</head>
<body><main><h1>{html.escape(app.name)}</h1><p>{html.escape(message)}</p><p><a href="/">Back to launcher</a></p></main></body>
</html>"""


def _action_result_html(title: str, message: str, rows: list[str] | None = None) -> str:
    rows_html = "".join(f"<li>{html.escape(row)}</li>" for row in (rows or []))
    details = f"<ul>{rows_html}</ul>" if rows_html else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{html.escape(title)}</title>
  <style>
    :root {{ color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; color: #ecf7ff; background: radial-gradient(circle at 18% 12%, rgba(255, 122, 122, .18), transparent 30rem), linear-gradient(145deg, #05111c, #0a1a28 55%, #08121b); }}
    main {{ width: min(620px, calc(100vw - 32px)); padding: 28px; border: 1px solid rgba(158,214,237,.18); border-radius: 24px; background: rgba(10,28,43,.82); box-shadow: 0 24px 80px rgba(0,0,0,.34); }}
    h1 {{ margin: 0 0 12px; font-size: clamp(32px, 5vw, 52px); line-height: .98; letter-spacing: -.055em; }}
    p, li {{ color: rgba(236,247,255,.72); line-height: 1.5; }}
    ul {{ margin: 18px 0; padding-left: 20px; }}
    a {{ color: #9ddcf0; font-weight: 800; }}
  </style>
</head>
<body><main><h1>{html.escape(title)}</h1><p>{html.escape(message)}</p>{details}<p><a href="/">Back to launcher</a></p></main></body>
</html>"""


def _index_html() -> str:
    initial_payload = json.dumps(
        {"apps": [_default_status(app) for app in _catalog()] + [_static_link_status(link) for link in _static_links()]}
    ).replace("</", "<\\/")
    portfolio_payload = json.dumps(_portfolio_payload()).replace("</", "<\\/")
    app_cards = "".join(
        f"""
        <article class="tool-card" draggable="false" {_app_card_attrs(app, index)} {_detail_attrs(slug=app.slug, name=app.name, note=_default_app_note(app), kind="Local app", endpoint=app.url, launch_url=f"/apps/{app.slug}/open", logs_url=f"/apps/{app.slug}/logs", folder_url=f"/apps/{app.slug}/folder", stop_api=f"/api/apps/{app.slug}/stop")}>
          <div class="tool-card__main" draggable="false" role="button" tabindex="0" data-open-detail aria-label="View {html.escape(app.name)}">
            {_app_mark_html(slug=app.slug, motif=app.icon.motif, primary=app.icon.primary, secondary=app.icon.secondary, accent=app.icon.accent, glyph=app.icon.glyph)}
            {_card_body_html(slug=app.slug, name=app.name, note=_default_app_note(app), group_label=_card_group(app.slug)["label"], kind="Local app", endpoint=app.url)}
          </div>
          <span class="status-dot" data-role="dot" title="Checking"></span>
          <span class="tool-card__recent" data-role="recent-label" hidden></span>
          <button class="pin-button" type="button" data-pin aria-label="Pin {html.escape(app.name)}">☆</button>
          <details class="card-menu">
            <summary aria-label="{html.escape(app.name)} menu">...</summary>
            <div class="card-menu__panel">
              <button type="button" data-open-detail-menu>View details</button>
              <a href="/apps/{html.escape(app.slug)}/open" data-launch-control data-launch-kind="menu">Launch app</a>
              <a href="/apps/{html.escape(app.slug)}/logs" target="_blank" rel="noopener">Open logs</a>
              <a href="/apps/{html.escape(app.slug)}/folder" target="_blank" rel="noopener">Open repo folder</a>
              <button type="button" data-activity-toggle>Move to inactive</button>
              <a class="danger" href="/apps/{html.escape(app.slug)}/stop">Stop app</a>
            </div>
          </details>
        </article>
        """
        for index, app in enumerate(_catalog())
    )
    local_count = len(_catalog())
    static_cards = "".join(
        f"""
        <article class="tool-card tool-card--static" draggable="false" {_static_card_attrs(link, local_count + index)} {_detail_attrs(slug=link.slug, name=link.name, note=link.note, kind="External link", endpoint=link.url, launch_url=f"/links/{link.slug}/open", static=True)}>
          <div class="tool-card__main" draggable="false" role="button" tabindex="0" data-open-detail aria-label="View {html.escape(link.name)}">
            {_app_mark_html(slug=link.slug, motif=link.icon_motif, primary=link.icon_primary, secondary=link.icon_secondary, accent=link.icon_accent, glyph=link.icon_glyph)}
            {_card_body_html(slug=link.slug, name=link.name, note=link.note, group_label=_card_group(link.slug)["label"], kind="External link", endpoint=link.url)}
          </div>
          <span class="status-dot external status-dot--external" data-role="dot" title="External link"></span>
          <span class="tool-card__recent" data-role="recent-label" hidden></span>
          <button class="pin-button" type="button" data-pin aria-label="Pin {html.escape(link.name)}">☆</button>
          <details class="card-menu">
            <summary aria-label="{html.escape(link.name)} menu">...</summary>
            <div class="card-menu__panel">
              <button type="button" data-open-detail-menu>View details</button>
              <a href="/links/{html.escape(link.slug)}/open" data-launch-control data-launch-kind="menu">Open website</a>
              <button type="button" data-activity-toggle>Move to inactive</button>
            </div>
          </details>
        </article>
        """
        for index, link in enumerate(_static_links())
    )
    placeholder_start = local_count + len(_static_links())
    tag_filter_buttons = "".join(
        f'<button type="button" data-tag="{html.escape(item["id"])}" aria-pressed="false">{html.escape(item["label"])}</button>'
        for item in TAG_FILTERS
    )
    placeholder_cards = "".join(
        f"""
        <article class="tool-card tool-card--placeholder" draggable="false" {_placeholder_card_attrs(tool, placeholder_start + index)} {_detail_attrs(slug=tool.slug, name=tool.name, note=tool.note, kind="Planned", endpoint="Not configured", launch_url="", disabled=True)}>
          <div class="tool-card__main tool-card__main--disabled" draggable="false" role="button" tabindex="0" data-open-detail aria-label="View {html.escape(tool.name)} placeholder">
            {_app_mark_html(slug=tool.slug, motif=tool.icon_motif, primary=tool.icon_primary, secondary=tool.icon_secondary, accent=tool.icon_accent, glyph=tool.icon_glyph)}
            {_card_body_html(slug=tool.slug, name=tool.name, note=tool.note, group_label=_card_group(tool.slug)["label"], kind="Planned", endpoint="Not configured", planned=True)}
          </div>
          <span class="status-dot status-dot--planned" title="Planned"></span>
          <span class="tool-card__recent" data-role="recent-label" hidden></span>
          <button class="pin-button" type="button" data-pin aria-label="Pin {html.escape(tool.name)}">☆</button>
          <details class="card-menu">
            <summary aria-label="{html.escape(tool.name)} menu">...</summary>
            <div class="card-menu__panel">
              <button type="button" data-open-detail-menu>View details</button>
              <button type="button" data-activity-toggle>Move to active</button>
            </div>
          </details>
        </article>
        """
        for index, tool in enumerate(_placeholder_tools())
    )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Project Studio</title>
  <meta name="color-scheme" content="dark" />
  <style>html,body {{ background: #07111c; color: #ecf7ff; }}</style>
  <link rel="stylesheet" href="{html.escape(_asset_url_versioned("portfolio.css"))}" />
  <link rel="stylesheet" href="{html.escape(_asset_url_versioned("studio.css"))}" />
{_index_preload_links()}
</head>
<body>
  <header>
    <div class="brand"><p>Local development</p><h1>Project Studio</h1></div>
    <nav class="mode-nav" aria-label="Project Studio mode">
      <button class="active" type="button" data-app-mode="studio" aria-pressed="true">Studio</button>
      <button type="button" data-app-mode="portfolio" aria-pressed="false">Portfolio</button>
      <a href="/credentials" class="credentials-nav-link">Keys</a>
    </nav>
    <button type="button" id="addProjectButton">Add project</button>
    <div class="header-status" aria-label="Studio status">
      <section class="resource-advisor" id="resourceAdvisor" aria-label="Resource monitor">
        <button class="resource-advisor__toggle" id="resourceAdvisorToggle" type="button" aria-expanded="false" title="Show running app resources">
          <strong id="resourceAdvisorSummary">Loading...</strong>
        </button>
        <div class="resource-advisor__panel" id="resourceAdvisorPanel" hidden>
          <table class="resource-table" aria-label="Running app resource usage">
            <thead>
              <tr>
                <th><button type="button" data-resource-sort="name" aria-pressed="false">App</button></th>
                <th><button class="active" type="button" data-resource-sort="cpu" aria-pressed="true">CPU</button></th>
                <th><button type="button" data-resource-sort="memory" aria-pressed="false">RAM</button></th>
                <th><button type="button" data-resource-sort="runtime" aria-pressed="false">Run</button></th>
                <th><span>Stop</span></th>
              </tr>
            </thead>
            <tbody id="resourceAdvisorList"><tr><td colspan="5"><p class="resource-advisor__empty">Loading resource usage...</p></td></tr></tbody>
          </table>
          <p class="resource-advisor__note">Measured from Project Studio-managed server processes and child processes.</p>
        </div>
      </section>
    </div>
  </header>
  <main>
    <section class="mode-view mode-view--active" id="studioMode" data-mode-view="studio">
      <section class="control-panel" aria-label="Project Studio filters">
        <div class="control-row">
        <div class="segmented" role="tablist" aria-label="View mode">
          <button class="active" type="button" data-mode="all" role="tab" aria-selected="true">All</button>
          <button type="button" data-mode="un" role="tab" aria-selected="false">UN</button>
          <button type="button" data-mode="documentary" role="tab" aria-selected="false">Documentary</button>
          <button type="button" data-mode="other" role="tab" aria-selected="false">Other</button>
        </div>
        <div class="control-tools">
          <label class="studio-search" for="studioSearch">
            <span>Search</span>
            <input id="studioSearch" type="search" autocomplete="off" placeholder="Search" />
          </label>
          <div class="sort-controls visible" id="sortControls">
            <div class="sort-buttons" role="group" aria-label="Sort apps">
              <button class="sort-button active" type="button" data-sort="modified" aria-label="Sort by last opened" title="Sort by last opened" aria-pressed="true">Recent</button>
              <button class="sort-button" type="button" data-sort="name" aria-label="Sort A to Z" aria-pressed="false">A→Z</button>
              <button class="sort-button" type="button" data-sort="created" aria-label="Sort by created date" aria-pressed="false">Newest</button>
              <button class="sort-button sort-button--manual" type="button" data-sort="manual" title="Use manual order" aria-label="Use manual order" aria-pressed="false">Manual</button>
            </div>
          </div>
        </div>
      </div>
      <div class="agency-row" id="agencyControls">
        <span>Agency</span>
        <div class="segmented" role="tablist" aria-label="UN agency">
          <button class="active" type="button" data-agency="all">All UN</button>
          <button type="button" data-agency="undp-sids">UNDP SIDS</button>
          <button type="button" data-agency="undp-seh">UNDP SEH</button>
          <button type="button" data-agency="gef">GEF</button>
          <button type="button" data-agency="unfccc">UNFCCC</button>
          <button type="button" data-agency="gates">Gates</button>
        </div>
      </div>
      <div class="tag-row" id="tagControls">
        <span>Tags</span>
        <div class="segmented segmented--tags" role="tablist" aria-label="Project tags">
          <button class="active" type="button" data-tag="all" aria-pressed="true">All tags</button>
          {tag_filter_buttons}
        </div>
      </div>
      </section>
      <section class="grid" id="grid">
          <div class="section-divider" id="activeDivider" data-activity-drop="active">
            <span>Active</span>
            <div class="section-divider__actions">
              <a class="section-divider__button section-divider__button--danger" href="/stop-all" title="Stop all local apps" aria-label="Stop all local apps">⏹ All</a>
              <button class="section-divider__button" type="button" id="refresh" title="Reset status" aria-label="Reset status">Reset</button>
            </div>
          </div>
          {app_cards}{static_cards}{placeholder_cards}
          <div class="section-divider section-divider--inactive" id="inactiveDivider" data-activity-drop="inactive" aria-label="Inactive projects"></div>
      </section>
    </section>
    <section class="mode-view portfolio-mode" id="portfolioMode" data-mode-view="portfolio" hidden>
      <script type="application/json" id="portfolioData">{portfolio_payload}</script>
      <section class="portfolio-stage" aria-label="Portfolio preview">
        <div class="portfolio-stage__bar">
          <div>
            <p class="portfolio-eyebrow">Portfolio Mode</p>
            <h2 id="portfolioStageTitle">Project Studio Portfolio</h2>
          </div>
          <div class="portfolio-stage__meta" id="portfolioStageMeta"></div>
          <details class="portfolio-settings" aria-label="Portfolio settings">
            <summary>Customize</summary>
            <div class="portfolio-settings__head">
              <div>
                <p class="portfolio-eyebrow">Presentation controls</p>
                <h2>Customize portfolio</h2>
              </div>
              <button class="portfolio-reset" type="button" id="portfolioReset">Reset</button>
            </div>
            <div class="portfolio-settings__content" id="portfolioSettings"></div>
          </details>
        </div>
        <div class="portfolio-template-rail" id="portfolioTemplateRail" aria-label="Portfolio templates" hidden></div>
        <div class="portfolio-preview" id="portfolioPreview" aria-live="polite"></div>
      </section>
    </section>
  </main>
  <section class="detail-modal" id="detailModal" hidden role="dialog" aria-modal="true" aria-labelledby="detailTitle" tabindex="-1">
    <div class="detail-modal__backdrop" data-close-detail></div>
    <article class="detail-modal__panel">
      <div class="detail-modal__visual" id="detailVisual">
        <div class="detail-logo" id="detailLogo"></div>
        <div class="detail-photo-grid" id="detailPhotos"></div>
        <div class="detail-photo-viewer" id="detailPhotoViewer" hidden>
          <button class="detail-photo-viewer__close" type="button" id="detailPhotoViewerClose" aria-label="Close preview">×</button>
          <img id="detailPhotoViewerImage" alt="" />
          <span id="detailPhotoViewerLabel">Preview</span>
        </div>
      </div>
      <div class="detail-modal__content">
        <div class="detail-modal__top">
          <div class="detail-modal__eyebrow"><span id="detailKind">Tool</span><span id="detailStatus">Status</span></div>
          <div class="detail-modal__title-row">
            <div class="detail-title-stack">
              <div class="detail-title-inline">
                <h2 id="detailTitle"><span id="detailTitleText">Project Studio app</span></h2>
                <button class="detail-name-edit" type="button" id="detailRenameToggle" aria-label="Edit app name">✎</button>
              </div>
              <div class="detail-title-edit" id="detailRenameRow" hidden>
                <input id="detailRename" type="text" aria-label="Display name" />
                <button class="detail-action" id="detailRenameSave" type="button">Save</button>
                <button class="detail-action" id="detailRenameCancel" type="button">Cancel</button>
              </div>
            </div>
            <button class="detail-close" type="button" data-close-detail aria-label="Close app details">×</button>
          </div>
          <p class="detail-modal__note" id="detailNote"></p>
          <p class="detail-modal__description" id="detailDescription"></p>
          <div class="detail-diagnostic" id="detailDiagnostic" hidden></div>
        </div>
        <div class="detail-modal__body">
          <section class="detail-action-zone detail-action-zone--primary" aria-label="Primary action">
            <label class="detail-version-control" id="detailVersionWrap" hidden>
              <span>Version</span>
              <select id="detailVersion" aria-label="Version to view"></select>
            </label>
            <a class="detail-launch" id="detailLaunch" href="#">↗ Launch App</a>
          </section>
          <section class="detail-meta-board" aria-label="Project metadata">
            <div><dt>Group</dt><dd id="detailGroup">-</dd></div>
            <div><dt>Endpoint</dt><dd id="detailEndpoint">-</dd></div>
            <div><dt>Completion</dt><dd id="detailCompletion">0 of 5</dd></div>
            <div><dt>Updated</dt><dd id="detailUpdated">-</dd></div>
            <div><dt>Role</dt><dd id="detailRole">-</dd></div>
          </section>
          <section class="detail-chip-cloud" id="detailChipCloud" aria-label="Tags and technology"></section>
          <section class="detail-action-zone" aria-label="Links and documentation">
            <div class="detail-zone-head"><span>Links</span><small>Documentation, folders, logs, and project files</small></div>
            <div class="detail-link-grid">
              <button class="detail-action" id="detailDocs" type="button">Readme</button>
              <a class="detail-action" id="detailDocDownload" href="#" download>Download readme</a>
              <a class="detail-action" id="detailPdf" href="#" target="_blank" rel="noopener">PDF documentation</a>
              <a class="detail-action" id="detailFolder" href="#" target="_blank" rel="noopener">Folder / repo</a>
              <a class="detail-action" id="detailLogs" href="#" target="_blank" rel="noopener">Logs</a>
            </div>
          </section>
          <section class="detail-action-zone detail-action-zone--manage" aria-label="Management actions">
            <div class="detail-zone-head"><span>Manage</span><small>Layout, status, and local process controls</small></div>
            <div class="detail-manage-grid">
              <button class="detail-action" id="detailStar" type="button">☆ Star</button>
              <button class="detail-action" id="detailActivity" type="button">↕ Move</button>
              <button class="detail-action detail-action--danger" id="detailStop" type="button">■ Stop</button>
            </div>
          </section>
          <section class="doc-viewer" id="docViewer" aria-live="polite">
            <div class="doc-viewer__bar"><span>Project Studio readme</span><button class="detail-action" type="button" id="docClose">Hide</button></div>
            <pre id="docContent"></pre>
          </section>
        </div>
      </div>
    </article>
  </section>
  <dialog id="addProjectDialog" class="project-onboarding">
    <form id="addProjectForm">
      <h2>Add a project</h2><p>Register an existing project. This does not install dependencies or execute commands.</p>
      <label>Name<input name="name" required maxlength="100"></label>
      <label>ID<input name="slug" required pattern="[a-z0-9][a-z0-9_-]*" maxlength="100" placeholder="my-web-app"></label>
      <label>URL<input name="url" type="url" required placeholder="http://127.0.0.1:5173/"></label>
      <label>Project folder (optional for hosted links)<input name="repo" placeholder="/path/to/project"></label>
      <label>Launch command (optional)<input name="command" placeholder="npm run dev"></label>
      <label>Server port (optional)<input name="port" type="number" min="1" max="65535"></label>
      <label><input name="trust" type="checkbox"> I approve running this command when I launch the project.</label>
      <p role="status" id="addProjectMessage"></p>
      <button type="button" id="cancelAddProject">Cancel</button><button type="submit">Add project</button>
    </form>
  </dialog>
  <script type="application/json" id="studioPreferences">{json.dumps(preferences(state_root())).replace('<', chr(92)+'u003c')}</script>
  <script type="application/json" id="studioData">{initial_payload}</script>
  <script src="{html.escape(_asset_url_versioned("studio.js"))}"></script>
  <script src="{html.escape(_asset_url_versioned("portfolio.js"))}"></script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    server_version = "ProjectStudio/1.0"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def end_headers(self):
        headers = b''.join(getattr(self, '_headers_buffer', [])).lower()
        if b'content-security-policy:' not in headers:
            self.send_header('Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'")
        self.send_header('X-Frame-Options', 'DENY')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def do_GET(self) -> None:
        if studio_auth.protect(self):
            return
        _reload_catalog()
        self._dispatch_get()

    def _dispatch_get(self) -> None:
        if studio_credentials.handle(self):
            return
        path = urlparse(self.path).path
        if path == "/" or path == "/index.html":
            _text_response(self, _index_html(), content_type="text/html")
            return
        if path == "/healthz":
            _json_response(self, {"ok": True, "asset_dir": str(PROJECT_STUDIO_ASSETS)})
            return
        if path == "/favicon.ico":
            _text_response(self, "", status=204, content_type="image/x-icon")
            return
        if path.startswith("/project-studio-assets/"):
            _asset_response(self, path.removeprefix("/project-studio-assets/"))
            return
        if path == "/api/apps":
            _json_response(self, {"apps": _launcher_items_statuses()})
            return
        if path == "/api/resources":
            _json_response(self, _resource_advisor_payload())
            return
        if path.startswith("/api/apps/") and path.endswith("/status"):
            slug = path.split("/")[3]
            app = _find_app(slug)
            if app is None:
                _json_response(self, {"error": "Unknown app"}, status=404)
                return
            _json_response(self, _app_status(app))
            return
        if path == "/api/project-studio/manifest":
            _json_response(self, _project_studio_manifest())
            return
        if path == "/api/project-studio/setup":
            _json_response(self, _project_studio_setup_payload())
            return
        if path == "/stop-all":
            result = _stop_all_local_apps()
            rows = [
                f"{item.get('name', item.get('slug', 'Tool'))}: "
                f"{sum(1 for process in item.get('stopped', []) if process.get('stopped'))} process(es) stopped"
                for item in result["stopped"]
            ]
            _text_response(
                self,
                _action_result_html("Stopped local apps", "All tracked local app processes were asked to stop.", rows),
                content_type="text/html",
            )
            return
        if path.startswith("/links/") and path.endswith("/open"):
            slug = path.split("/")[2]
            link = _find_static_link(slug)
            if link is None:
                _text_response(self, "Unknown link", status=404)
                return
            _record_item_event(
                link.slug,
                "open",
                ok=True,
                message="opened hosted/static link",
            )
            tab_focus = _focus_existing_browser_tab(link.url)
            if tab_focus.get("focused"):
                _text_response(
                    self,
                    _focused_tab_html(link.name, link.url, tab_focus),
                    content_type="text/html",
                )
                return
            _text_response(self, "<!doctype html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" + html.escape(link.url, quote=True) + "\"></head><body>Opening website</body></html>", content_type="text/html")
            return
        if path.startswith("/apps/") and path.endswith("/open"):
            slug = path.split("/")[2]
            app = _find_app(slug)
            if app is None:
                _text_response(self, "Unknown app", status=404)
                return
            selected_version = _app_version_option(slug, _query_value(self.path, "version"))
            if selected_version and selected_version.get("mode") == "external":
                target_url = selected_version["endpoint"]
                _record_item_event(
                    slug,
                    "open",
                    ok=True,
                    message=f"opened {selected_version['label']}",
                    details={"url": target_url, "version": selected_version["id"]},
                )
                tab_focus = _focus_existing_browser_tab(target_url)
                if tab_focus.get("focused"):
                    _text_response(
                        self,
                        _focused_tab_html(f"{app.name} {selected_version['id'].upper()}", target_url, tab_focus),
                        content_type="text/html",
                    )
                    return
                _text_response(self, "<!doctype html><html><head><meta http-equiv=\"refresh\" content=\"0;url=" + html.escape(target_url, quote=True) + "\"></head><body>Opening app</body></html>", content_type="text/html")
                return
            status = _start_app(app)
            if status.get("ready"):
                target_url = str(status.get("runtime_url") or status.get("url") or app.url)
                tab_focus = _focus_existing_browser_tab(target_url)
                if tab_focus.get("focused"):
                    status["focused_existing_tab"] = True
                    status["tab_focus"] = tab_focus
                    with _launcher_log(app).open("a", encoding="utf-8") as fh:
                        fh.write(
                            f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] Focused existing browser tab "
                            f"for {target_url} in {tab_focus.get('browser', 'browser')}\n"
                        )
            _text_response(
                self,
                _app_loading_html(
                    app,
                    status,
                ),
                content_type="text/html",
            )
            return
        if path.startswith("/apps/") and path.endswith("/logs"):
            slug = path.split("/")[2]
            app = _find_app(slug)
            if app is None:
                _text_response(self, "Unknown app", status=404)
                return
            _text_response(self, _logs_html(app), content_type="text/html")
            return
        if path.startswith("/apps/") and path.endswith("/folder"):
            slug = path.split("/")[2]
            app = _find_app(slug)
            if app is None:
                _text_response(self, "Unknown app", status=404)
                return
            _text_response(self, _folder_html(app), content_type="text/html")
            return
        if path.startswith("/apps/") and path.endswith("/stop"):
            slug = path.split("/")[2]
            app = _find_app(slug)
            if app is None:
                _text_response(self, "Unknown app", status=404)
                return
            status = _stop_app(app)
            rows = [f"{process['name']}: {process['message']}" for process in status.get("stopped", [])]
            _text_response(
                self,
                _action_result_html(f"Stopped {app.name}", "The local app was asked to stop.", rows),
                content_type="text/html",
            )
            return
        if path.startswith("/api/apps/") and path.endswith("/logs"):
            slug = path.split("/")[3]
            app = _find_app(slug)
            if app is None:
                _text_response(self, "Unknown app", status=404)
                return
            _text_response(self, _logs(app))
            return
        _text_response(self, "Not found", status=404)

    def do_POST(self) -> None:
        if studio_auth.protect(self):
            return
        if studio_auth.action_path(urlparse(self.path).path):
            self._dispatch_get()
            return
        if studio_credentials.handle(self, mutation=True):
            return
        path = urlparse(self.path).path
        _reload_catalog()
        if path == "/api/preferences":
            try:
                size=int(self.headers.get('Content-Length','0'))
                if not 0 < size <= 2_000_000: raise ValueError('Preferences exceed limit')
                values=json.loads(self.rfile.read(size))
                with _ITEM_STATE_LOCK: save_preferences(state_root(), values)
                _json_response(self, {'ok':True})
            except (ValueError, TypeError) as error:
                _json_response(self, {'error':str(error)},status=400)
            return
        if path == "/api/projects/register":
            try:
                from app.registry import save_catalog, validate
                size = int(self.headers.get('Content-Length', '0'))
                if not 0 < size <= 65536:
                    raise ValueError('Expected a project definition smaller than 64 KB')
                payload = json.loads(self.rfile.read(size))
                item = payload['project']
                validate({'schema_version': 1, 'apps': [item]})
                if item.get('processes') and payload.get('trust_commands') is not True:
                    raise ValueError('Approve the displayed launch commands before registration')
                with _ITEM_STATE_LOCK:
                    current = catalog()
                    if any(p['slug'] == item['slug'] for kind in ('apps','links','planned') for p in current[kind]):
                        raise ValueError('A project with this ID already exists')
                    current['apps'].append(item)
                    save_catalog(current)
                    _user_catalog.update(current)
                _json_response(self, {'ok': True}, status=201)
            except (ValueError, KeyError, TypeError) as error:
                _json_response(self, {'error': str(error)}, status=400)
            return
        if path.startswith("/api/apps/") and path.endswith("/launch"):
            slug = path.split("/")[3]
            app = _find_app(slug)
            if app is None:
                _json_response(self, {"error": "Unknown app"}, status=404)
                return
            _json_response(self, _start_app(app))
            return
        if path.startswith("/api/apps/") and path.endswith("/stop"):
            slug = path.split("/")[3]
            app = _find_app(slug)
            if app is None:
                _json_response(self, {"error": "Unknown app"}, status=404)
                return
            _json_response(self, _stop_app(app))
            return
        _json_response(self, {"error": "Not found"}, status=404)


def _port_ready(host: str, port: int) -> bool:
    # The index assembles live status and portfolio data, so it can exceed the
    # startup probe timeout. Health is intentionally cheap and avoids spawning
    # a duplicate server while the existing one is still rendering the page.
    return _status_url(f"http://{host}:{port}/healthz", timeout=0.5)


SERVER_META_FILE = "server.json"
_CODE_FILES = ("local_tools_launcher.py", "install_related_desktop_apps.py", "app/credentials.py", "studio_cli.py", "app/credential_triage.py", "app/auth.py", "app/dev_access.py")


def _code_mtime() -> float:
    """Newest mtime across the modules whose contents a running server has cached."""
    newest = 0.0
    for name in _CODE_FILES:
        try:
            newest = max(newest, (PROJECT_STUDIO_ROOT / name).stat().st_mtime)
        except OSError:
            continue
    return newest


def _read_server_meta() -> dict[str, Any]:
    try:
        meta = json.loads((UI_STATE_DIR / SERVER_META_FILE).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        meta = {}
    if not isinstance(meta, dict):
        meta = {}
    if not isinstance(meta.get("pid"), int):
        # Servers started before this file existed only left a bare pid behind.
        meta["pid"] = _read_pid(UI_STATE_DIR / "server.pid")
    return meta


def _write_server_meta(url: str) -> None:
    payload = {
        "pid": os.getpid(),
        "url": url,
        "code_mtime": _code_mtime(),
        "started_at": time.time(),
    }
    try:
        (UI_STATE_DIR / SERVER_META_FILE).write_text(json.dumps(payload, indent=2), encoding="utf-8")
    except OSError:
        pass


def _server_is_stale(meta: dict[str, Any]) -> bool:
    recorded = meta.get("code_mtime")
    if not isinstance(recorded, (int, float)):
        # No recorded signature means the server predates this check; assume stale
        # so edited registry entries cannot be served indefinitely from memory.
        return True
    return float(recorded) + 0.001 < _code_mtime()


def _replace_running_server(host: str, port: int, meta: dict[str, Any]) -> bool:
    """Stop a server still serving code older than the files on disk.

    Python caches modules at import, so an edited card registry is invisible until
    the process restarts. Quitting the app is not enough: the server is detached and
    a relaunch previously short-circuited on the healthy port.
    """
    pid = meta.get("pid")
    if not isinstance(pid, int) or pid == os.getpid() or not _pid_alive(pid):
        return False
    listeners = _pids_for_port(port)
    if listeners and pid not in listeners:
        # Something other than the recorded server owns the port. Never kill it.
        return False
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        return False
    deadline = time.monotonic() + 8.0
    while time.monotonic() < deadline:
        if not _pid_alive(pid):
            break
        time.sleep(0.2)
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        if _can_bind_port(host, port):
            return True
        time.sleep(0.2)
    return _can_bind_port(host, port)


def _open_when_ready(url: str) -> None:
    def worker() -> None:
        deadline = time.time() + 15
        while time.time() < deadline:
            if _status_url(url, timeout=0.25):
                webbrowser.open(studio_auth.owner_url(url))
                return
            time.sleep(0.15)
        webbrowser.open(studio_auth.owner_url(url))

    threading.Thread(target=worker, daemon=True).start()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run the local multi-tool launcher UI.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--open", dest="open_browser", action="store_true", default=True)
    parser.add_argument("--no-open", dest="open_browser", action="store_false")
    parser.add_argument("--check", action="store_true", help="Validate app registry and exit.")
    parser.add_argument(
        "--restart",
        action="store_true",
        help="Stop an already-running Project Studio server and take over its port.",
    )
    args = parser.parse_args()

    manifest = _project_studio_manifest()
    if args.check:
        print(json.dumps(manifest, indent=2))
        return 1 if manifest["validation"]["errors"] else 0
    if manifest["validation"]["errors"]:
        print("Project Studio registry errors:", file=sys.stderr)
        for item in manifest["validation"]["errors"]:
            print(f"  - {item}", file=sys.stderr)
        return 1

    UI_STATE_DIR.mkdir(parents=True, exist_ok=True)
    url = f"http://{args.host}:{args.port}/"
    if _port_ready(args.host, args.port):
        meta = _read_server_meta()
        if not (args.restart or _server_is_stale(meta)):
            if args.open_browser:
                webbrowser.open(studio_auth.owner_url(url))
            return 0
        if _replace_running_server(args.host, args.port, meta):
            print("Project Studio: replaced a server running older code.", flush=True)
        else:
            print(
                "Project Studio: a server is already running on "
                f"{args.host}:{args.port} and could not be replaced automatically. "
                "Stop it manually, then relaunch.",
                file=sys.stderr,
            )
            if args.open_browser:
                webbrowser.open(studio_auth.owner_url(url))
            return 0

    (UI_STATE_DIR / "server.pid").write_text(f"{os.getpid()}\n", encoding="utf-8")
    (UI_STATE_DIR / "server.url").write_text(f"{url}\n", encoding="utf-8")
    _write_server_meta(url)
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    studio_auth.initialize(server.server_port)
    if args.open_browser:
        _open_when_ready(url)
    print(f"Project Studio running at {url}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        pid_file = UI_STATE_DIR / "server.pid"
        try:
            if pid_file.exists() and pid_file.read_text(encoding="utf-8").strip() == str(os.getpid()):
                pid_file.unlink()
        except OSError:
            pass
        try:
            meta_file = UI_STATE_DIR / SERVER_META_FILE
            if meta_file.exists() and _read_server_meta().get("pid") == os.getpid():
                meta_file.unlink()
        except OSError:
            pass


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import argparse
import json
import math
import plistlib
import shutil
import shlex
import stat
import struct
import subprocess
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path
from textwrap import dedent


@dataclass(frozen=True)
class LaunchProcess:
    name: str
    repo: Path
    command: str
    delay_seconds: float = 0.0
    ports: tuple[int, ...] = ()


@dataclass(frozen=True)
class IconTheme:
    glyph: str
    primary: str
    secondary: str
    accent: str
    motif: str


DEFAULT_ICON = IconTheme("APP", "#1f7fe5", "#10243a", "#7ce7ff", "network")
LEGACY_APP_BUNDLE_NAMES: dict[str, tuple[str, ...]] = {
    "quechua-transcription": ("Quechua Transcription Pipeline.app", "Translator.app"),
    "unfccc-viz-engine": ("UNFCCC Viz Engine.app",),
}


@dataclass(frozen=True)
class AppLauncher:
    name: str
    slug: str
    url: str
    processes: tuple[LaunchProcess, ...]
    health_url: str = ""
    note: str = ""
    icon: IconTheme = DEFAULT_ICON


def repo_root() -> Path:
    return Path(__file__).resolve().parent


def _hex_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip().lstrip("#")
    if len(text) != 6:
        return (70, 184, 242)
    return (int(text[0:2], 16), int(text[2:4], 16), int(text[4:6], 16))


def _mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def _blend(buf: bytearray, size: int, x: int, y: int, rgb: tuple[int, int, int], alpha: float) -> None:
    if x < 0 or y < 0 or x >= size or y >= size or alpha <= 0:
        return
    a = max(0, min(255, int(alpha * 255)))
    idx = (y * size + x) * 4
    inv = 255 - a
    buf[idx] = (rgb[0] * a + buf[idx] * inv) // 255
    buf[idx + 1] = (rgb[1] * a + buf[idx + 1] * inv) // 255
    buf[idx + 2] = (rgb[2] * a + buf[idx + 2] * inv) // 255
    buf[idx + 3] = min(255, a + (buf[idx + 3] * inv) // 255)


def _circle(buf: bytearray, size: int, cx: float, cy: float, radius: float, rgb: tuple[int, int, int], alpha: float) -> None:
    min_x = max(0, int(cx - radius - 1))
    max_x = min(size - 1, int(cx + radius + 1))
    min_y = max(0, int(cy - radius - 1))
    max_y = min(size - 1, int(cy + radius + 1))
    r2 = radius * radius
    edge = max(1.0, radius * 0.08)
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            dist2 = (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2
            if dist2 > (radius + edge) ** 2:
                continue
            if dist2 <= r2:
                coverage = 1.0
            else:
                coverage = max(0.0, 1.0 - (math.sqrt(dist2) - radius) / edge)
            _blend(buf, size, x, y, rgb, alpha * coverage)


def _line(
    buf: bytearray,
    size: int,
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: float,
    rgb: tuple[int, int, int],
    alpha: float,
) -> None:
    length = max(1.0, math.hypot(x2 - x1, y2 - y1))
    steps = max(1, int(length / max(1.0, width * 0.45)))
    for i in range(steps + 1):
        t = i / steps
        _circle(buf, size, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, rgb, alpha)


def _polygon(
    buf: bytearray,
    size: int,
    points: tuple[tuple[float, float], ...],
    rgb: tuple[int, int, int],
    alpha: float,
) -> None:
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    min_x, max_x = max(0, int(min(xs))), min(size - 1, int(max(xs)))
    min_y, max_y = max(0, int(min(ys))), min(size - 1, int(max(ys)))
    for y in range(min_y, max_y + 1):
        for x in range(min_x, max_x + 1):
            inside = False
            j = len(points) - 1
            for i, point in enumerate(points):
                xi, yi = point
                xj, yj = points[j]
                if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-6) + xi):
                    inside = not inside
                j = i
            if inside:
                _blend(buf, size, x, y, rgb, alpha)


def _ring(buf: bytearray, size: int, cx: float, cy: float, radius: float, width: float, rgb: tuple[int, int, int], alpha: float) -> None:
    segments = 92
    previous = None
    for i in range(segments + 1):
        angle = math.tau * i / segments
        point = (cx + math.cos(angle) * radius, cy + math.sin(angle) * radius)
        if previous:
            _line(buf, size, previous[0], previous[1], point[0], point[1], width, rgb, alpha)
        previous = point


def _render_icon(size: int, theme: IconTheme) -> bytearray:
    primary = _hex_rgb(theme.primary)
    secondary = _hex_rgb(theme.secondary)
    accent = _hex_rgb(theme.accent)
    white = (245, 252, 255)
    dark = _mix(secondary, (0, 0, 0), 0.34)
    buf = bytearray(size * size * 4)
    radius = size * 0.22
    center = (size / 2, size / 2)

    for y in range(size):
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            corner_x = min(px, size - px)
            corner_y = min(py, size - py)
            if corner_x < radius and corner_y < radius:
                dist = math.hypot(radius - corner_x, radius - corner_y)
                if dist > radius:
                    continue
                coverage = max(0.0, min(1.0, radius - dist + 1.0))
            else:
                coverage = 1.0
            diagonal = (x + y) / (2 * max(1, size - 1))
            radial = math.hypot((x - center[0]) / size, (y - center[1]) / size)
            color = _mix(primary, secondary, diagonal * 0.72)
            color = _mix(color, dark, max(0.0, radial - 0.15) * 0.58)
            idx = (y * size + x) * 4
            buf[idx : idx + 4] = bytes((*color, int(255 * coverage)))

    _circle(buf, size, size * 0.22, size * 0.16, size * 0.18, white, 0.16)
    _circle(buf, size, size * 0.78, size * 0.82, size * 0.26, accent, 0.18)
    _ring(buf, size, center[0], center[1], size * 0.35, size * 0.018, white, 0.10)

    motif = theme.motif
    if motif in {"network", "constellation"}:
        pts = (
            (size * 0.26, size * 0.34),
            (size * 0.48, size * 0.22),
            (size * 0.74, size * 0.42),
            (size * 0.58, size * 0.70),
            (size * 0.30, size * 0.66),
        )
        for a, b in ((0, 1), (1, 2), (2, 3), (3, 4), (4, 0), (1, 3)):
            _line(buf, size, pts[a][0], pts[a][1], pts[b][0], pts[b][1], size * 0.025, accent, 0.74)
        for i, pt in enumerate(pts):
            _circle(buf, size, pt[0], pt[1], size * (0.055 if i in {1, 3} else 0.045), white if i in {1, 3} else accent, 0.96)
    elif motif == "waves":
        for row in range(3):
            y = size * (0.36 + row * 0.13)
            previous = None
            for i in range(50):
                x = size * (0.18 + i * 0.013)
                point = (x, y + math.sin(i * 0.45 + row * 0.7) * size * 0.035)
                if previous:
                    _line(buf, size, previous[0], previous[1], point[0], point[1], size * 0.03, accent if row != 1 else white, 0.80)
                previous = point
    elif motif == "palette":
        _ring(buf, size, center[0], center[1], size * 0.28, size * 0.045, white, 0.70)
        for angle, color in ((-0.7, accent), (1.2, white), (2.9, primary)):
            _circle(buf, size, center[0] + math.cos(angle) * size * 0.18, center[1] + math.sin(angle) * size * 0.18, size * 0.078, color, 0.92)
    elif motif == "bridge":
        _line(buf, size, size * 0.20, size * 0.62, size * 0.80, size * 0.62, size * 0.035, white, 0.68)
        for x in (0.30, 0.50, 0.70):
            _line(buf, size, size * x, size * 0.62, size * x, size * 0.42, size * 0.024, accent, 0.78)
        _ring(buf, size, size * 0.34, size * 0.43, size * 0.11, size * 0.025, accent, 0.86)
        _ring(buf, size, size * 0.66, size * 0.43, size * 0.11, size * 0.025, white, 0.72)
    elif motif == "koala":
        _circle(buf, size, size * 0.32, size * 0.36, size * 0.15, accent, 0.76)
        _circle(buf, size, size * 0.68, size * 0.36, size * 0.15, accent, 0.76)
        _circle(buf, size, size * 0.50, size * 0.50, size * 0.25, white, 0.74)
        _circle(buf, size, size * 0.42, size * 0.48, size * 0.035, dark, 0.92)
        _circle(buf, size, size * 0.58, size * 0.48, size * 0.035, dark, 0.92)
        _circle(buf, size, size * 0.50, size * 0.58, size * 0.06, dark, 0.82)
    elif motif in {"globe", "radar"}:
        _ring(buf, size, center[0], center[1], size * 0.28, size * 0.032, white, 0.72)
        _line(buf, size, size * 0.22, center[1], size * 0.78, center[1], size * 0.019, accent, 0.62)
        _line(buf, size, center[0], size * 0.22, center[0], size * 0.78, size * 0.019, accent, 0.62)
        _ring(buf, size, center[0], center[1], size * 0.17, size * 0.018, accent, 0.48)
        if motif == "radar":
            _line(buf, size, center[0], center[1], size * 0.73, size * 0.32, size * 0.026, accent, 0.84)
            _circle(buf, size, size * 0.73, size * 0.32, size * 0.052, accent, 0.95)
    elif motif == "bars":
        for i, height in enumerate((0.26, 0.38, 0.22, 0.48)):
            x1 = size * (0.25 + i * 0.13)
            _line(buf, size, x1, size * 0.68, x1, size * (0.68 - height), size * 0.07, accent if i % 2 else white, 0.78)
        _line(buf, size, size * 0.20, size * 0.72, size * 0.80, size * 0.72, size * 0.025, white, 0.46)
    elif motif == "moonshot":
        _circle(buf, size, size * 0.68, size * 0.30, size * 0.14, white, 0.50)
        _line(buf, size, size * 0.30, size * 0.76, size * 0.62, size * 0.42, size * 0.035, accent, 0.72)
        _polygon(
            buf,
            size,
            ((size * 0.50, size * 0.48), (size * 0.70, size * 0.38), (size * 0.61, size * 0.59)),
            white,
            0.86,
        )
        _circle(buf, size, size * 0.36, size * 0.70, size * 0.050, accent, 0.90)
    else:
        _circle(buf, size, center[0], center[1], size * 0.24, white, 0.58)
        _circle(buf, size, center[0], center[1], size * 0.12, accent, 0.90)

    return buf


def _png_bytes(size: int, rgba: bytearray) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    raw = bytearray()
    stride = size * 4
    for y in range(size):
        raw.append(0)
        raw.extend(rgba[y * stride : (y + 1) * stride])
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    return png


def _write_png(path: Path, size: int, rgba: bytearray) -> None:
    path.write_bytes(_png_bytes(size, rgba))


def _write_icns(path: Path, theme: IconTheme) -> None:
    # Modern .icns files can embed PNG payloads directly. Writing the small
    # container ourselves avoids macOS iconutil variability across SDK versions.
    entries = (
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
    )
    payloads = [(code, _png_bytes(size, _render_icon(size, theme))) for code, size in entries]
    total_size = 8 + sum(8 + len(payload) for _, payload in payloads)
    body = bytearray(b"icns" + struct.pack(">I", total_size))
    for code, payload in payloads:
        body.extend(code)
        body.extend(struct.pack(">I", 8 + len(payload)))
        body.extend(payload)
    path.write_bytes(body)


def write_app_icon(resources_dir: Path, theme: IconTheme, icon_name: str = "AppIcon") -> bool:
    iconset = resources_dir / f"{icon_name}.iconset"
    if iconset.exists():
        shutil.rmtree(iconset)
    resources_dir.mkdir(parents=True, exist_ok=True)
    _write_icns(resources_dir / f"{icon_name}.icns", theme)
    return True


def default_apps() -> tuple[AppLauncher, ...]:
    from app.registry import catalog
    from app.paths import resolved_command
    return tuple(AppLauncher(
        name=item['name'], slug=item['slug'], url=item['url'],
        health_url=item.get('health_url', ''), note=item.get('note', ''),
        icon=IconTheme(**item['icon']) if item.get('icon') else DEFAULT_ICON,
        processes=tuple(LaunchProcess(**{**p, 'repo': Path(p['repo']).expanduser(), 'command': resolved_command(p['command']),
            'ports': tuple(p.get('ports', ()))}) for p in item.get('processes', ()))
    ) for item in catalog()['apps'])


def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#39;")
    )


def loading_page(app: AppLauncher, state_dir: Path) -> str:
    process_lines = "".join(
        f"<li><span>{_html_escape(proc.name)}</span><code>{_html_escape(str(proc.repo))}</code></li>" for proc in app.processes
    )
    payload = json.dumps({"url": app.url, "name": app.name})
    return dedent(
        f"""
        <!doctype html>
        <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Starting {_html_escape(app.name)}</title>
          <style>
            :root {{ color-scheme: dark; font-family: Avenir Next, Helvetica Neue, Helvetica, Arial, sans-serif; }}
            * {{ box-sizing: border-box; }}
            body {{
              min-height: 100vh;
              margin: 0;
              display: grid;
              place-items: center;
              color: #ecf7ff;
              background:
                radial-gradient(circle at 22% 18%, rgba(40, 156, 220, 0.28), transparent 30rem),
                radial-gradient(circle at 78% 72%, rgba(255, 172, 91, 0.18), transparent 34rem),
                linear-gradient(135deg, #051321 0%, #081d2b 58%, #0c1822 100%);
            }}
            .card {{
              width: min(680px, calc(100vw - 32px));
              padding: 32px;
              border: 1px solid rgba(151, 205, 230, 0.22);
              border-radius: 28px;
              background: rgba(7, 24, 37, 0.74);
              box-shadow: 0 24px 90px rgba(0, 0, 0, 0.38);
              backdrop-filter: blur(18px);
            }}
            .eyebrow {{ margin: 0 0 12px; color: #8fd6eb; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; }}
            h1 {{ margin: 0; font-size: clamp(32px, 6vw, 56px); line-height: 0.96; letter-spacing: -0.055em; }}
            p {{ color: rgba(236, 247, 255, 0.72); line-height: 1.6; }}
            .bar {{ height: 8px; overflow: hidden; margin: 24px 0 18px; border-radius: 999px; background: rgba(255, 255, 255, 0.08); }}
            .bar::before {{
              content: "";
              display: block;
              width: 44%;
              height: 100%;
              border-radius: inherit;
              background: linear-gradient(90deg, #3dd4ef, #ffb56b, #69e8b4);
              animation: load 1.15s ease-in-out infinite alternate;
            }}
            @keyframes load {{ from {{ transform: translateX(-30%); }} to {{ transform: translateX(160%); }} }}
            ul {{ margin: 18px 0 0; padding: 0; list-style: none; display: grid; gap: 10px; }}
            li {{ display: flex; gap: 12px; align-items: baseline; justify-content: space-between; padding: 10px 12px; border-radius: 14px; background: rgba(255, 255, 255, 0.055); }}
            li span {{ color: rgba(255, 255, 255, 0.86); font-weight: 700; }}
            code {{ color: rgba(203, 227, 238, 0.7); font-size: 12px; overflow-wrap: anywhere; }}
            .status {{ margin-top: 18px; color: #c6f4ff; font-weight: 700; }}
            .hint {{ font-size: 13px; color: rgba(236, 247, 255, 0.55); }}
          </style>
        </head>
        <body>
          <main class="card">
            <p class="eyebrow">Local launcher</p>
            <h1>Starting {_html_escape(app.name)}</h1>
            <p>{_html_escape(app.note or 'The app is starting from its live local project folder. This page will open the app automatically once the server is ready.')}</p>
            <div class="bar" aria-hidden="true"></div>
            <div class="status" id="status">Checking local server...</div>
            <p class="hint">Logs: <code>{_html_escape(str(state_dir))}</code></p>
            <ul>{process_lines}</ul>
          </main>
          <script>
            const app = {payload};
            const statusEl = document.getElementById('status');
            let checks = 0;
            async function check() {{
              checks += 1;
              statusEl.textContent = `Waiting for ${{app.name}} (${{checks}})...`;
              try {{
                await fetch(app.url, {{ mode: 'no-cors', cache: 'no-store' }});
                window.location.replace(app.url);
              }} catch (error) {{
                setTimeout(check, checks < 80 ? 900 : 1800);
              }}
            }}
            check();
          </script>
        </body>
        </html>
        """
    ).strip() + "\n"


def app_script(app: AppLauncher, state_dir: Path) -> str:
    lines = [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/Library/Frameworks/Python.framework/Versions/3.13/bin:/Library/Frameworks/Python.framework/Versions/3.11/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"',
        'SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"',
        'RESOURCES_DIR="$(cd "${SCRIPT_DIR}/../Resources" && pwd)"',
        f"STATE_DIR={shlex.quote(str(state_dir))}",
        f"APP_URL={shlex.quote(app.url)}",
        'mkdir -p "${STATE_DIR}"',
        'touch "${STATE_DIR}/launcher.log"',
        'if /usr/bin/curl -fsS --max-time 1 "${APP_URL}" >/dev/null 2>&1; then',
        '  open "${APP_URL}"',
        '  exit 0',
        'fi',
        'RUNNING=0',
        'for PID_FILE in "${STATE_DIR}"/*.pid; do',
        '  [[ -e "${PID_FILE}" ]] || continue',
        '  PID="$(cat "${PID_FILE}" 2>/dev/null || true)"',
        '  if [[ "${PID}" =~ ^[0-9]+$ ]] && kill -0 "${PID}" 2>/dev/null; then',
        '    RUNNING=1',
        '  else',
        '    rm -f "${PID_FILE}"',
        '  fi',
        'done',
        'open "${RESOURCES_DIR}/loading.html"',
        'if [[ "${RUNNING}" == "1" ]]; then',
        '  exit 0',
        'fi',
        'echo "[$(date)] Starting local launcher processes" >> "${STATE_DIR}/launcher.log"',
    ]
    for proc in app.processes:
        repo = shlex.quote(str(proc.repo))
        command = shlex.quote(proc.command)
        proc_name = shlex.quote(proc.name)
        if proc.delay_seconds:
            lines.append(f"sleep {proc.delay_seconds:g}")
        lines.extend(
            [
                f"if [[ ! -d {repo} ]]; then",
                f"  echo \"Missing repo for {proc.name}: {proc.repo}\" >> \"${{STATE_DIR}}/launcher.log\"",
                "else",
                "  (",
                f"    cd {repo}",
                f"    echo \"[$(date)] Starting {proc.name}: {proc.command}\" >> \"${{STATE_DIR}}/{proc.name}.log\"",
                f"    nohup /bin/bash -c {command} >> \"${{STATE_DIR}}/{proc.name}.log\" 2>&1 &",
                f"    echo $! > \"${{STATE_DIR}}/{proc.name}.pid\"",
                "  )",
                "fi",
            ]
        )
    lines.extend(["exit 0", ""])
    return "\n".join(lines)


def validate(apps: tuple[AppLauncher, ...]) -> list[str]:
    messages: list[str] = []
    for app in apps:
        for proc in app.processes:
            if not proc.repo.exists():
                messages.append(f"Missing repo for {app.name}/{proc.name}: {proc.repo}")
    return messages


def create_app(app: AppLauncher, desktop: Path, root: Path) -> Path:
    for legacy_name in LEGACY_APP_BUNDLE_NAMES.get(app.slug, ()):
        legacy_path = desktop / legacy_name
        if legacy_path.exists():
            shutil.rmtree(legacy_path)
    app_path = desktop / f"{app.name}.app"
    if app_path.exists():
        shutil.rmtree(app_path)
    macos_dir = app_path / "Contents" / "MacOS"
    resources_dir = app_path / "Contents" / "Resources"
    macos_dir.mkdir(parents=True)
    resources_dir.mkdir(parents=True)

    state_dir = root / "outputs" / "launchers" / app.slug
    state_dir.mkdir(parents=True, exist_ok=True)
    executable_name = "launcher"
    executable = macos_dir / executable_name
    executable.write_text(app_script(app, state_dir), encoding="utf-8")
    executable.chmod(executable.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    write_app_icon(resources_dir, app.icon)
    (resources_dir / "loading.html").write_text(loading_page(app, state_dir), encoding="utf-8")

    plist = {
        "CFBundleDisplayName": app.name,
        "CFBundleExecutable": executable_name,
        "CFBundleIconFile": "AppIcon",
        "CFBundleIdentifier": f"org.undp.local-launcher.{app.slug}",
        "CFBundleName": app.name,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": "1.0",
        "CFBundleVersion": "1",
        "LSBackgroundOnly": True,
        "LSMinimumSystemVersion": "10.15",
        "NSDesktopFolderUsageDescription": f"{app.name} opens local development files from your project folders.",
        "NSDocumentsFolderUsageDescription": f"{app.name} starts a local development tool stored in your Documents folder.",
        "NSDownloadsFolderUsageDescription": f"{app.name} may open downloaded local project assets when launching.",
    }
    with (app_path / "Contents" / "Info.plist").open("wb") as fh:
        plistlib.dump(plist, fh)
    return app_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create macOS desktop launchers for Project Studio related tools.")
    parser.add_argument("--desktop", type=Path, default=Path.home() / "Desktop", help="Folder where .app bundles should be written.")
    parser.add_argument("--check", action="store_true", help="Validate configured app repositories and print the catalog without writing .app bundles.")
    parser.add_argument("--only", action="append", default=[], help="Only validate or create the launcher with this slug. Repeat for multiple launchers.")
    args = parser.parse_args()

    root = repo_root()
    desktop = args.desktop.expanduser()

    apps = default_apps()
    if args.only:
        wanted = set(args.only)
        apps = tuple(app for app in apps if app.slug in wanted)
        missing_slugs = sorted(wanted - {app.slug for app in apps})
        if missing_slugs:
            print(f"Unknown launcher slug(s): {', '.join(missing_slugs)}", file=sys.stderr)
            return 2
    missing = validate(apps)
    if args.check:
        print(f"Configured launchers: {len(apps)}")
        for app in apps:
            ports = sorted({port for process in app.processes for port in process.ports})
            print(f"- {app.name} ({app.slug}) -> {app.url}" + (f" ports={','.join(map(str, ports))}" if ports else ""))
        if missing:
            print("\nMissing repo folders:", file=sys.stderr)
            for message in missing:
                print(f"  - {message}", file=sys.stderr)
            return 1
        print("\nAll configured launcher repositories exist.")
        return 0

    if not desktop.exists():
        print(f"Desktop folder not found: {desktop}", file=sys.stderr)
        return 1

    if missing:
        print("Cannot create all launchers because these repo folders are missing:", file=sys.stderr)
        for message in missing:
            print(f"  - {message}", file=sys.stderr)
        return 1

    created = [create_app(app, desktop, root) for app in apps]
    print("Created desktop app launchers:")
    for path in created:
        print(f"  - {path}")
    print(f"Logs and PID files are written under: {root / 'outputs' / 'launchers'}")
    print("Each launcher points at the live local repo folder, so code updates are picked up on the next launch/reload.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

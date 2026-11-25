from __future__ import annotations

import argparse
import asyncio
import sys
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from local_tools_launcher import _catalog, _start_app, _static_links  # noqa: E402

ASSET_ROOT = SCRIPT_DIR / "assets"
DEFAULT_OUT_DIR = ASSET_ROOT / "portfolio-screenshots"
SYSTEM_CHROME = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")


@dataclass(frozen=True)
class CaptureTarget:
    slug: str
    name: str
    url: str
    kind: str
    can_start: bool = False
    app: Any = None


VIEWPORTS = {
    "desktop": {"width": 1440, "height": 1000, "is_mobile": False, "device_scale_factor": 1},
    "mobile": {"width": 390, "height": 844, "is_mobile": True, "device_scale_factor": 2},
    "tablet": {"width": 834, "height": 1112, "is_mobile": True, "device_scale_factor": 2},
}


def url_ready(url: str, timeout: float = 0.7) -> bool:
    try:
        request = urllib.request.Request(url, headers={"Cache-Control": "no-cache", "User-Agent": "ProjectStudioPortfolioCapture/1.0"})
        with urllib.request.urlopen(request, timeout=timeout):
            return True
    except Exception:
        return False


def targets(include_static: bool) -> list[CaptureTarget]:
    result = [CaptureTarget(app.slug, app.name, app.url, "local", can_start=True, app=app) for app in _catalog()]
    if include_static:
        result.extend(CaptureTarget(link.slug, link.name, link.url, "static", can_start=False) for link in _static_links())
    return result


def selected_targets(slugs: set[str] | None, include_static: bool) -> list[CaptureTarget]:
    all_targets = targets(include_static)
    if not slugs:
        return all_targets
    return [target for target in all_targets if target.slug in slugs]


def wait_ready(url: str, timeout_seconds: float) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if url_ready(url):
            return True
        time.sleep(0.4)
    return False


async def goto_stable(page: Any, url: str) -> None:
    try:
        await page.goto(url, wait_until="networkidle", timeout=45_000)
    except Exception:
        await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
    await page.wait_for_timeout(1500)


async def capture_target(browser: Any, target: CaptureTarget, out_dir: Path, include_tablet: bool) -> dict[str, Any]:
    viewports = ["desktop", "mobile"] + (["tablet"] if include_tablet else [])
    captured: list[str] = []
    target_dir = out_dir / target.slug
    target_dir.mkdir(parents=True, exist_ok=True)
    for name in viewports:
        viewport = VIEWPORTS[name]
        context = await browser.new_context(
            viewport={"width": viewport["width"], "height": viewport["height"]},
            device_scale_factor=viewport["device_scale_factor"],
            is_mobile=viewport["is_mobile"],
            reduced_motion="reduce",
        )
        page = await context.new_page()
        try:
            await goto_stable(page, target.url)
            await page.screenshot(path=str(target_dir / f"{name}.png"), full_page=False)
            captured.append(name)
        finally:
            await context.close()
    return {"slug": target.slug, "name": target.name, "captured": captured}


async def run_capture(args: argparse.Namespace) -> int:
    wanted = set(args.slugs.split(",")) if args.slugs else None
    capture_targets = selected_targets(wanted, include_static=args.include_static)
    if args.dry_run:
        print("Project Studio portfolio capture dry run")
        for target in capture_targets:
            print(f"- {target.slug}: {target.url} ({target.kind}, startable={target.can_start})")
        return 0

    out_dir = Path(args.out_dir).expanduser().resolve() if args.out_dir else DEFAULT_OUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    captured: list[dict[str, Any]] = []
    skipped: list[dict[str, str]] = []
    failed: list[dict[str, str]] = []
    ready_targets: list[CaptureTarget] = []

    for target in capture_targets:
        if not url_ready(target.url):
            if args.start and target.can_start and target.app is not None:
                print(f"Starting {target.name}...")
                try:
                    _start_app(target.app)
                except Exception as exc:
                    failed.append({"slug": target.slug, "reason": f"launch failed: {exc}"})
                    continue
                if not wait_ready(target.url, args.start_timeout):
                    skipped.append({"slug": target.slug, "reason": "not ready after launch timeout"})
                    continue
            else:
                skipped.append({"slug": target.slug, "reason": "URL not reachable; use --start for local apps"})
                continue
        ready_targets.append(target)

    if ready_targets:
        try:
            from playwright.async_api import async_playwright
        except Exception as exc:
            print(f"Playwright is required for screenshot capture: {exc}", file=sys.stderr)
            print("Install it with: pip3 install playwright", file=sys.stderr)
            return 2

        async with async_playwright() as playwright:
            launch_kwargs: dict[str, Any] = {"headless": True}
            if SYSTEM_CHROME.exists():
                launch_kwargs["executable_path"] = str(SYSTEM_CHROME)
            browser = await playwright.chromium.launch(**launch_kwargs)
            try:
                for target in ready_targets:
                    print(f"Capturing {target.name} at {target.url}")
                    try:
                        captured.append(await capture_target(browser, target, out_dir, include_tablet=args.tablet))
                    except Exception as exc:
                        failed.append({"slug": target.slug, "reason": str(exc)})
            finally:
                await browser.close()

    print("\nPortfolio screenshot capture summary")
    print(f"Captured: {len(captured)}")
    for item in captured:
        print(f"  - {item['slug']}: {', '.join(item['captured'])}")
    print(f"Skipped: {len(skipped)}")
    for item in skipped:
        print(f"  - {item['slug']}: {item['reason']}")
    print(f"Failed: {len(failed)}")
    for item in failed:
        print(f"  - {item['slug']}: {item['reason']}")
    print(f"Output folder: {out_dir}")
    return 1 if failed and args.fail_on_error else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Capture Project Studio portfolio screenshots.")
    parser.add_argument("--start", action="store_true", help="Start known local apps before capture when their URL is not already reachable.")
    parser.add_argument("--start-timeout", type=float, default=45.0, help="Seconds to wait for a started local app to become ready.")
    parser.add_argument("--include-static", action="store_true", help="Also capture hosted/static URL cards. Requires network access.")
    parser.add_argument("--tablet", action="store_true", help="Also capture tablet screenshots.")
    parser.add_argument("--slugs", help="Comma-separated slug allowlist.")
    parser.add_argument("--out-dir", help=f"Output directory. Defaults to {DEFAULT_OUT_DIR}.")
    parser.add_argument("--dry-run", action="store_true", help="List targets without opening a browser.")
    parser.add_argument("--fail-on-error", action="store_true", help="Return non-zero if any target fails.")
    return parser


def main() -> int:
    return asyncio.run(run_capture(build_parser().parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())

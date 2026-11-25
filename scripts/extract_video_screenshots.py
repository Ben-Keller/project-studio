from __future__ import annotations

import argparse
import json
import math
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image


PROJECT_STUDIO_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = PROJECT_STUDIO_ROOT
ASSETS_ROOT = PROJECT_STUDIO_ROOT / "assets"
DEFAULT_CONFIG = ASSETS_ROOT / "video-screenshots.json"


@dataclass(frozen=True)
class ExtractConfig:
    slug: str
    video: Path
    output_dir: Path
    sample_fps: float
    scene_threshold: float
    min_clip_seconds: float
    max_clips: int
    width: int
    height: int
    clear_existing: bool


def _load_config(path: Path) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(f"Missing config: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _resolve_asset_path(path_text: str) -> Path:
    path = Path(path_text)
    return path if path.is_absolute() else ASSETS_ROOT / path


def _extract_config(raw: dict[str, Any], defaults: dict[str, Any]) -> ExtractConfig:
    slug = str(raw["slug"]).strip()
    if not slug:
        raise ValueError("Video screenshot item has an empty slug.")
    output_dir = _resolve_asset_path(str(raw.get("output_dir") or defaults.get("output_dir") or "screenshots"))
    return ExtractConfig(
        slug=slug,
        video=_resolve_asset_path(str(raw["video"])),
        output_dir=output_dir,
        sample_fps=float(raw.get("sample_fps", defaults.get("sample_fps", 1.5))),
        scene_threshold=float(raw.get("scene_threshold", defaults.get("scene_threshold", 0.22))),
        min_clip_seconds=float(raw.get("min_clip_seconds", defaults.get("min_clip_seconds", 2.0))),
        max_clips=int(raw.get("max_clips", defaults.get("max_clips", 6))),
        width=int(raw.get("width", defaults.get("width", 1440))),
        height=int(raw.get("height", defaults.get("height", 900))),
        clear_existing=bool(raw.get("clear_existing", defaults.get("clear_existing", True))),
    )


def _video_metadata(capture: cv2.VideoCapture) -> tuple[float, int, float]:
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if fps <= 0 or frame_count <= 0:
        raise ValueError("Could not read video fps/frame count.")
    return fps, frame_count, frame_count / fps


def _sample_frame(capture: cv2.VideoCapture, frame_index: int) -> np.ndarray | None:
    capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
    ok, frame = capture.read()
    if not ok or frame is None:
        return None
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    return cv2.resize(rgb, (96, 54), interpolation=cv2.INTER_AREA)


def _detect_clips(config: ExtractConfig) -> list[tuple[float, float]]:
    capture = cv2.VideoCapture(str(config.video))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {config.video}")
    try:
        fps, frame_count, duration = _video_metadata(capture)
        step = max(1, int(round(fps / max(config.sample_fps, 0.1))))
        boundaries = [0.0]
        previous: np.ndarray | None = None
        last_boundary = 0.0

        for frame_index in range(0, frame_count, step):
            sampled = _sample_frame(capture, frame_index)
            if sampled is None:
                continue
            timestamp = frame_index / fps
            if previous is not None:
                diff = float(np.mean(cv2.absdiff(sampled, previous)) / 255.0)
                if diff >= config.scene_threshold and timestamp - last_boundary >= config.min_clip_seconds:
                    boundaries.append(timestamp)
                    last_boundary = timestamp
            previous = sampled

        boundaries.append(duration)
        clips: list[tuple[float, float]] = []
        for start, end in zip(boundaries, boundaries[1:]):
            if end - start >= max(0.25, config.min_clip_seconds * 0.35):
                clips.append((start, end))
        return clips or [(0.0, duration)]
    finally:
        capture.release()


def _selected_clip_centers(clips: list[tuple[float, float]], max_clips: int) -> list[float]:
    if max_clips <= 0 or len(clips) <= max_clips:
        selected = clips
    elif max_clips == 1:
        selected = [clips[len(clips) // 2]]
    else:
        indexes = sorted({round(i * (len(clips) - 1) / (max_clips - 1)) for i in range(max_clips)})
        selected = [clips[index] for index in indexes]
    return [(start + end) / 2.0 for start, end in selected]


def _cover_resize(frame_bgr: np.ndarray, width: int, height: int) -> Image.Image:
    image = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
    source_ratio = image.width / image.height
    target_ratio = width / height
    if source_ratio > target_ratio:
        new_width = int(image.height * target_ratio)
        left = (image.width - new_width) // 2
        image = image.crop((left, 0, left + new_width, image.height))
    else:
        new_height = int(image.width / target_ratio)
        top = (image.height - new_height) // 2
        image = image.crop((0, top, image.width, top + new_height))
    return image.resize((width, height), Image.Resampling.LANCZOS)


def _frame_at(capture: cv2.VideoCapture, timestamp: float) -> np.ndarray:
    capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, timestamp) * 1000)
    ok, frame = capture.read()
    if not ok or frame is None:
        raise ValueError(f"Could not read frame at {timestamp:.2f}s")
    return frame


def _clear_outputs(config: ExtractConfig) -> None:
    for pattern in (f"{config.slug}.jpg", f"{config.slug}-*.jpg"):
        for path in config.output_dir.glob(pattern):
            path.unlink()


def extract_item(config: ExtractConfig, dry_run: bool = False) -> list[Path]:
    if not config.video.is_file():
        raise FileNotFoundError(f"Missing video for {config.slug}: {config.video}")
    clips = _detect_clips(config)
    centers = _selected_clip_centers(clips, config.max_clips)
    if dry_run:
        print(f"{config.slug}: {len(clips)} clip(s), extracting {len(centers)} center frame(s)")
        for index, timestamp in enumerate(centers, start=1):
            print(f"  {index:02d}: {timestamp:.2f}s")
        return []

    config.output_dir.mkdir(parents=True, exist_ok=True)
    if config.clear_existing:
        _clear_outputs(config)

    capture = cv2.VideoCapture(str(config.video))
    if not capture.isOpened():
        raise ValueError(f"Could not open video: {config.video}")
    outputs: list[Path] = []
    try:
        for index, timestamp in enumerate(centers, start=1):
            frame = _frame_at(capture, timestamp)
            image = _cover_resize(frame, config.width, config.height)
            output = config.output_dir / f"{config.slug}-{index:02d}.jpg"
            image.save(output, quality=86, optimize=True)
            outputs.append(output)
        if outputs:
            shutil.copyfile(outputs[0], config.output_dir / f"{config.slug}.jpg")
    finally:
        capture.release()
    return outputs


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract Project Studio card screenshots from input videos.")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--slug", help="Only extract one configured tool slug.")
    parser.add_argument("--dry-run", action="store_true", help="Detect clips and print center frames without writing images.")
    parser.add_argument("--strict", action="store_true", help="Exit non-zero when a configured video is missing or invalid.")
    args = parser.parse_args()

    config_payload = _load_config(args.config)
    defaults = dict(config_payload.get("defaults") or {})
    items = [item for item in config_payload.get("items", []) if item.get("enabled", True)]
    if args.slug:
        items = [item for item in items if item.get("slug") == args.slug]
    if not items:
        print("No enabled video screenshot items matched.")
        return 0

    failures = 0
    for item in items:
        try:
            config = _extract_config(item, defaults)
            outputs = extract_item(config, dry_run=args.dry_run)
            if not args.dry_run:
                rel_outputs = []
                for path in outputs:
                    try:
                        rel_outputs.append(str(path.relative_to(REPO_ROOT)))
                    except ValueError:
                        rel_outputs.append(str(path))
                print(f"{config.slug}: wrote {len(outputs)} clip screenshot(s): {', '.join(rel_outputs)}")
        except Exception as exc:
            failures += 1
            print(f"{item.get('slug', '<unknown>')}: {exc}")
    return 1 if failures and args.strict else 0


if __name__ == "__main__":
    raise SystemExit(main())

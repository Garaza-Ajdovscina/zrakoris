"""output/ session data -> a static, searchable HTML gallery.

Builds a self-contained site under ``gallery/`` (by default) that can be
hosted as-is, e.g. as a GitHub Pages root: a search bar filters cards by
name, clicking a card opens an interactive replay of that drawing's stroke
timeline (step move by move, scrub, or play at recorded speed), plus
download links for the GIF and the final PNG. Everything is fetched via
relative paths, so there are no cross-origin requests and nothing to
configure beyond serving the folder over http(s).

    python tools/build_gallery.py                      # every day in output/
    python tools/build_gallery.py --date 2026-09-17     # just one day

Must not import PyQt or open a camera — same as render_gif.py, this runs
standalone, any time after sessions have been saved.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_REPO_ROOT))

from tools.render_gif import render as render_session_gif  # noqa: E402

_TEMPLATE_DIR = Path(__file__).resolve().parent / "gallery_template"
_TEMPLATE_FILES = ("index.html", "style.css", "app.js")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _day_dirs(output_root: Path, date: str | None) -> list[Path]:
    if date:
        d = output_root / date
        if not d.is_dir():
            raise SystemExit(f"no such day directory: {d}")
        return [d]
    if not output_root.is_dir():
        raise SystemExit(f"no such output directory: {output_root}")
    return sorted(p for p in output_root.iterdir() if p.is_dir() and _DATE_RE.match(p.name))


def _stats(strokes: list[dict]) -> tuple[int, int]:
    return len(strokes), sum(len(s["points"]) for s in strokes)


def build(output_root: Path, site_dir: Path, date: str | None, *,
          width: int, fps: int, speed: float, hold: float,
          include_empty: bool, force: bool) -> dict:
    data_dir = site_dir / "data"
    sessions: list[dict] = []

    for day_dir in _day_dirs(output_root, date):
        day = day_dir.name
        for session_json in sorted(day_dir.glob("*/session.json")):
            sid = session_json.parent.name
            payload = json.loads(session_json.read_text())
            stroke_count, point_count = _stats(payload.get("strokes", []))
            if stroke_count == 0 and not include_empty:
                continue

            dest_dir = data_dir / day / sid
            dest_dir.mkdir(parents=True, exist_ok=True)

            shutil.copyfile(session_json, dest_dir / "session.json")

            png_src = session_json.with_name("drawing.png")
            has_png = png_src.exists()
            if has_png:
                shutil.copyfile(png_src, dest_dir / "drawing.png")

            dest_gif = dest_dir / "drawing.gif"
            if force or not dest_gif.exists():
                render_session_gif(session_json, width, fps, speed, hold, dest_gif)

            sessions.append({
                "id": f"{day}_{sid}",
                "date": day,
                "session_id": sid,
                "name": payload.get("name", ""),
                "started_at": payload.get("started_at", ""),
                "ended_at": payload.get("ended_at", ""),
                "stroke_count": stroke_count,
                "point_count": point_count,
                "canvas": payload["canvas"],
                "gif": f"data/{day}/{sid}/drawing.gif",
                "png": f"data/{day}/{sid}/drawing.png" if has_png else None,
                "session": f"data/{day}/{sid}/session.json",
            })

    sessions.sort(key=lambda s: s["started_at"], reverse=True)
    manifest = {
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "sessions": sessions,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")

    for name in _TEMPLATE_FILES:
        shutil.copyfile(_TEMPLATE_DIR / name, site_dir / name)

    return manifest


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--output", default="output", help="output/ root to read from (default: output)")
    p.add_argument("--date", default=None, help="only this day (YYYY-MM-DD); default: every day")
    p.add_argument("--site", default="gallery", help="where to write the static site (default: gallery)")
    p.add_argument("--width", type=int, default=480, help="rendered GIF width in px (default: 480)")
    p.add_argument("--fps", type=int, default=20)
    p.add_argument("--speed", type=float, default=1.5, help="GIF playback speed multiplier")
    p.add_argument("--hold", type=float, default=1.2, help="seconds to hold the final frame")
    p.add_argument("--include-empty", action="store_true", help="include sessions with zero strokes")
    p.add_argument("--force", action="store_true", help="re-render GIFs that already exist")
    args = p.parse_args(argv)

    manifest = build(
        Path(args.output), Path(args.site), args.date,
        width=args.width, fps=args.fps, speed=args.speed, hold=args.hold,
        include_empty=args.include_empty, force=args.force,
    )

    n = len(manifest["sessions"])
    print(f"wrote {n} session(s) to {args.site}/")
    print(f"preview locally with:  cd {args.site} && python3 -m http.server 8000")
    print("(opening index.html via file:// won't load data/manifest.json — browsers block that fetch)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

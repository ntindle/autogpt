"""Turn backend/poetry.lock into a pinned requirements file for uv.

The desktop bundle installs exactly what the lock pins, the same versions the
appliance image gets from `poetry install`, without needing Poetry (or a
virtualenv, which is not relocatable) inside the bundle.
"""

from __future__ import annotations

import sys
import tomllib
from pathlib import Path

# A package for which one platform gets another version than the lock's.
# There is none, and each one would have the desktop run code the Docker image
# does not. Before adding one, see whether the locked version installs from
# its source distribution: claude_cli.py does that for the one case so far.
PLATFORM_OVERRIDES: dict[str, dict[str, str]] = {}


def export(lock_path: Path, platform: str = sys.platform) -> list[str]:
    lock = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    overrides = PLATFORM_OVERRIDES.get(platform, {})
    lines = []
    for package in lock["package"]:
        if "main" not in package.get("groups", ["main"]):
            continue
        if package.get("source", {}).get("type") in ("directory", "file", "git", "url"):
            continue
        version = overrides.get(package["name"], package["version"])
        marker = _main_marker(package.get("markers"))
        line = f"{package['name']}=={version}"
        lines.append(f"{line} ; {marker}" if marker else line)
    return lines


def _main_marker(markers: str | dict[str, str] | None) -> str | None:
    if isinstance(markers, dict):
        return markers.get("main")
    return markers


def main() -> int:
    lock_path, output = Path(sys.argv[1]), Path(sys.argv[2])
    platform = sys.argv[3] if len(sys.argv) > 3 else sys.platform
    lines = export(lock_path, platform)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"exported {len(lines)} pinned packages for {platform} to {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

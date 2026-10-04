"""Turn backend/poetry.lock into a pinned requirements file for uv.

The desktop bundle installs exactly what the lock pins, the same versions the
appliance image gets from `poetry install`, without needing Poetry (or a
virtualenv, which is not relocatable) inside the bundle.

Two of the backend's main dependencies are tools for working on the backend,
not parts of it: Poetry (which the Docker image uses to install itself) and
flake8. Nothing in the backend imports either. They and what only they need
are left out: 34 distributions, among them a second copy of pip's machinery
(virtualenv's embedded wheels) and a Git implementation.
"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path

# A package for which one platform gets another version than the lock's.
# There is none, and each one would have the desktop run code the Docker image
# does not. Before adding one, see whether the locked version installs from
# its source distribution: claude_cli.py does that for the one case so far.
PLATFORM_OVERRIDES: dict[str, dict[str, str]] = {}

# Main dependencies of the backend that the bundle does not install, with
# everything only they depend on. Each must be one that no backend module
# imports (tests/test_bundle_size.py reads the backend for that). Not here,
# though they look like tooling: setuptools (aioclamd imports pkg_resources
# as it loads, and the backend imports aioclamd) and pytest, pytest-asyncio
# and pytest-snapshot (backend modules that are not tests import them, and
# the block loader imports every module under blocks/).
EXCLUDED_ROOTS = frozenset({"poetry", "flake8"})


def export(lock_path: Path, platform: str = sys.platform) -> list[str]:
    lock = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    project = tomllib.loads(lock_path.with_name("pyproject.toml").read_text(encoding="utf-8"))
    wanted = reachable(lock, roots(project))
    overrides = PLATFORM_OVERRIDES.get(platform, {})
    lines = []
    for package in lock["package"]:
        if "main" not in package.get("groups", ["main"]):
            continue
        if package.get("source", {}).get("type") in ("directory", "file", "git", "url"):
            continue
        if normalized(package["name"]) not in wanted:
            continue
        version = overrides.get(package["name"], package["version"])
        marker = _main_marker(package.get("markers"))
        line = f"{package['name']}=={version}"
        lines.append(f"{line} ; {marker}" if marker else line)
    return lines


def roots(project: dict) -> set[str]:
    """The backend's main dependencies, as pyproject.toml lists them, without
    the excluded ones."""
    listed = {normalized(name) for name in project["tool"]["poetry"]["dependencies"]}
    missing = EXCLUDED_ROOTS - listed
    if missing:
        raise RuntimeError(
            f"{', '.join(sorted(missing))} is no longer a main dependency of the backend: "
            "take it out of EXCLUDED_ROOTS in desktop/build/lock_export.py"
        )
    return listed - EXCLUDED_ROOTS - {"python"}


def reachable(lock: dict, start: set[str]) -> set[str]:
    """Every package the lock says `start` depends on, however indirectly.
    More than is installed, never less: an optional dependency and one for
    another platform count as dependencies, and a package the lock has more
    than one entry for (one for each Python version or platform, as numpy)
    depends on what any of them does."""
    depends: dict[str, set[str]] = {}
    for package in lock["package"]:
        needs = depends.setdefault(normalized(package["name"]), set())
        needs.update(normalized(name) for name in package.get("dependencies", {}))
    found: set[str] = set()
    pending = list(start)
    while pending:
        name = pending.pop()
        if name in found:
            continue
        found.add(name)
        pending.extend(depends.get(name, ()))
    return found


def excluded(lock_path: Path) -> list[str]:
    """Main-group packages of the lock that `export` leaves out."""
    lock = tomllib.loads(lock_path.read_text(encoding="utf-8"))
    kept = {normalized(line.split("==")[0]) for line in export(lock_path)}
    return sorted(
        package["name"]
        for package in lock["package"]
        if "main" in package.get("groups", ["main"])
        and package.get("source", {}).get("type") not in ("directory", "file", "git", "url")
        and normalized(package["name"]) not in kept
    )


def normalized(name: str) -> str:
    """A distribution's name as packaging tools compare it (PEP 503)."""
    return re.sub(r"[-_.]+", "-", name).lower()


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

#!/usr/bin/env python3
"""Verify pinned submodules and CI toolchain inputs against the Phase 7 lock."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = REPO_ROOT / "security/dependency-lock.json"


def _run(*args: str) -> str:
    result = subprocess.run(args, cwd=REPO_ROOT, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise SystemExit(result.stdout + result.stderr)
    return result.stdout.rstrip()


def main() -> None:
    lock = json.loads(LOCK_PATH.read_text(encoding="utf-8"))
    expected_submodules = lock["submodules"]
    configured_paths = _gitmodule_values("path")
    configured_urls = _gitmodule_values("url")
    if set(configured_paths.values()) != set(expected_submodules):
        raise SystemExit("top-level .gitmodules paths differ from security/dependency-lock.json")

    status_lines = _run("git", "submodule", "status", "--recursive").splitlines()
    dirty_or_missing = [line for line in status_lines if not line.startswith(" ")]
    if dirty_or_missing:
        raise SystemExit("submodule checkout is missing, conflicted, or differs from its pin:\n" + "\n".join(dirty_or_missing))

    for name, path in configured_paths.items():
        expected = expected_submodules[path]
        actual_commit = _run("git", "-C", path, "rev-parse", "HEAD")
        if actual_commit != expected["commit"]:
            raise SystemExit(f"{path} is at {actual_commit}, expected {expected['commit']}")
        if configured_urls[name] != expected["url"]:
            raise SystemExit(f"{path} URL differs from the dependency lock")

    foundry_config = (REPO_ROOT / "foundry.toml").read_text(encoding="utf-8")
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    solc = lock["toolchains"]["solc"]
    if f'solc_version = "{solc}"' not in foundry_config:
        raise SystemExit(f"foundry.toml does not pin solc {solc}")
    if f'version: {lock["toolchains"]["foundry_ci"]}' not in workflow:
        raise SystemExit("CI Foundry version differs from the dependency lock")
    if f'python-version: "{lock["toolchains"]["python_ci"]}"' not in workflow:
        raise SystemExit("CI Python version differs from the dependency lock")
    for action, commit in lock["github_actions"].items():
        if f"uses: {action}@{commit}" not in workflow:
            raise SystemExit(f"CI action {action} differs from the dependency lock")

    print(f"Dependency lock verified: {len(expected_submodules)} top-level submodules and pinned CI toolchains.")


def _gitmodule_values(key: str) -> dict[str, str]:
    output = _run("git", "config", "--file", ".gitmodules", "--get-regexp", rf"^submodule\..*\.{key}$")
    values: dict[str, str] = {}
    for line in output.splitlines():
        full_key, value = line.split(maxsplit=1)
        name = full_key.removeprefix("submodule.").removesuffix(f".{key}")
        values[name] = value
    return values


if __name__ == "__main__":
    main()

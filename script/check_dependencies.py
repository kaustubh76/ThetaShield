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

    _check_local_foundry(lock["toolchains"]["foundry_ci"])

    print(f"Dependency lock verified: {len(expected_submodules)} top-level submodules and pinned CI toolchains.")


def _check_local_foundry(expected: str) -> None:
    """Fail closed when the local Foundry differs from the pinned CI toolchain.

    The Phase 5/6/6.1/G1 artifacts are byte-reproducible only against one Foundry
    build: `research/experiments/phase5_baselines.py` measures hook gas by running
    `forge test --match-contract ThetaShieldHookGasTest`, and that measurement
    calibrates every downstream fee budget. A different Foundry reports different
    gas, so the committed artifacts read as stale and `snapshots/*.json` is
    rewritten as a side effect. Reporting that once, here, is clearer than four
    unexplained "artifacts are stale" failures later in `make verify`.
    """
    version_output = _run("forge", "--version")
    reported = version_output.splitlines()[0] if version_output else ""
    normalized = expected.lstrip("v")
    # Match only the version line so a build timestamp or commit hash cannot alias it.
    if normalized in reported:
        return
    raise SystemExit(
        f"local Foundry does not match the pinned toolchain {expected}\n"
        f"  reported: {reported}\n"
        "  The research artifacts are calibrated against a hook-gas measurement taken\n"
        f"  with Foundry {expected}; another build changes the measured gas, so\n"
        "  phase5/phase6/phase61/gap-g1 checks fail and snapshots/ is rewritten.\n"
        f"  Install the pinned build with: foundryup --install {expected}"
    )


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

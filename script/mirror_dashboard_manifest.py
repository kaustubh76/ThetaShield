#!/usr/bin/env python3
"""Mirror the live deployment manifest and gas snapshots into dashboard/data.

The dashboard is built with its own project root (Vercel/vinext isolation), so
build-time imports cannot reach ../deployments or ../snapshots. This script
keeps byte-deterministic mirrors inside dashboard/data, following the same
fail-closed pattern as research.experiments.export_dashboard_bundle:

    python3 script/mirror_dashboard_manifest.py          # write mirrors
    python3 script/mirror_dashboard_manifest.py --check  # fail if stale
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEPLOYMENTS = ROOT / "deployments"
SNAPSHOTS = ROOT / "snapshots"
MANIFEST_TARGET = ROOT / "dashboard/data/deployment_manifest.json"
GAS_TARGET = ROOT / "dashboard/data/gas_snapshots.json"
REMEDIATION = "run: python3 script/mirror_dashboard_manifest.py"


def find_live_manifest() -> Path:
    candidates = [
        path
        for path in sorted(DEPLOYMENTS.glob("*.json"))
        if path.name != "manifest.schema.json"
        and json.loads(path.read_text(encoding="utf-8")).get("mode") == "live"
    ]
    if len(candidates) != 1:
        names = ", ".join(path.name for path in candidates) or "none"
        raise SystemExit(f"expected exactly one live deployment manifest, found: {names}")
    return candidates[0]


def validate_manifest(payload: bytes) -> None:
    manifest = json.loads(payload)
    if manifest.get("schema_version") != 3:
        raise SystemExit("live deployment manifest is not schema_version 3")
    if manifest.get("acceptance", {}).get("passed") is not True:
        raise SystemExit("live deployment manifest acceptance did not pass")
    if not manifest.get("components"):
        raise SystemExit("live deployment manifest lists no components")
    if len(manifest.get("circle_messages", [])) < 2:
        raise SystemExit("live deployment manifest is missing Circle message evidence")


def build_gas_snapshots() -> bytes:
    merged: dict[str, dict[str, int]] = {}
    for path in sorted(SNAPSHOTS.glob("*.json")):
        entries = json.loads(path.read_text(encoding="utf-8"))
        merged[path.stem] = {key: int(value) for key, value in sorted(entries.items())}
    if not merged:
        raise SystemExit("snapshots/ contains no gas snapshot JSON files")
    return (json.dumps(merged, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> None:
    check_only = "--check" in sys.argv[1:]
    source = find_live_manifest()
    manifest_payload = source.read_bytes()
    validate_manifest(manifest_payload)
    expected = {MANIFEST_TARGET: manifest_payload, GAS_TARGET: build_gas_snapshots()}

    stale = [
        target
        for target, payload in expected.items()
        if not target.is_file() or target.read_bytes() != payload
    ]
    if check_only:
        if stale:
            names = ", ".join(str(path.relative_to(ROOT)) for path in stale)
            raise SystemExit(f"stale dashboard deployment mirror ({names}); {REMEDIATION}")
        print("dashboard deployment mirrors are current")
        return

    for target, payload in expected.items():
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(payload)
        print(f"wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Fail closed when the Phase 9 dashboard or handoff package is incomplete."""

from __future__ import annotations

import json
import re
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IDENTIFIER_PATTERN = re.compile(r"0x[0-9a-fA-F]{40,}")
IDENTIFIER_ALLOWLIST = {"dashboard/app/live-config.ts"}


def check_no_hardcoded_identifiers() -> None:
    app_dir = ROOT / "dashboard/app"
    for path in sorted([*app_dir.rglob("*.ts"), *app_dir.rglob("*.tsx")]):
        relative = str(path.relative_to(ROOT))
        if relative in IDENTIFIER_ALLOWLIST:
            continue
        text = path.read_text(encoding="utf-8")
        for match in IDENTIFIER_PATTERN.findall(text):
            if set(match[3:]) <= {"0"}:
                continue  # numeric masks such as the ABI sign bit
            raise SystemExit(
                f"{relative} hardcodes a deployment identifier ({match[:14]}…); "
                "source it from data/deployment_manifest.json"
            )


def check_deployment_mirror() -> None:
    live_manifests = [
        path
        for path in sorted((ROOT / "deployments").glob("*.json"))
        if path.name != "manifest.schema.json"
        and json.loads(path.read_text(encoding="utf-8")).get("mode") == "live"
    ]
    if len(live_manifests) != 1:
        raise SystemExit("expected exactly one live deployment manifest under deployments/")
    mirror = ROOT / "dashboard/data/deployment_manifest.json"
    if not mirror.is_file() or mirror.read_bytes() != live_manifests[0].read_bytes():
        raise SystemExit(
            "dashboard deployment mirror is stale; run: python3 script/mirror_dashboard_manifest.py"
        )

    merged = {
        path.stem: {key: int(value) for key, value in sorted(
            json.loads(path.read_text(encoding="utf-8")).items()
        )}
        for path in sorted((ROOT / "snapshots").glob("*.json"))
    }
    expected_gas = (json.dumps(merged, indent=2, sort_keys=True) + "\n").encode("utf-8")
    gas_mirror = ROOT / "dashboard/data/gas_snapshots.json"
    if not gas_mirror.is_file() or gas_mirror.read_bytes() != expected_gas:
        raise SystemExit(
            "dashboard gas snapshot mirror is stale; run: python3 script/mirror_dashboard_manifest.py"
        )


def read_required(relative: str) -> str:
    path = ROOT / relative
    if not path.is_file():
        raise SystemExit(f"missing Phase 9 artifact: {relative}")
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        raise SystemExit(f"empty Phase 9 artifact: {relative}")
    return text


def require(text: str, phrase: str, source: str) -> None:
    if phrase not in text:
        raise SystemExit(f"{source} is missing required evidence: {phrase}")


def check_png() -> None:
    path = ROOT / "dashboard/public/og.png"
    payload = path.read_bytes() if path.is_file() else b""
    if len(payload) < 24 or payload[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit("dashboard/public/og.png is missing or not a PNG")
    width, height = struct.unpack(">II", payload[16:24])
    if width < 1200 or height < 630:
        raise SystemExit(f"social preview is too small: {width}x{height}")


def main() -> None:
    page_shell = read_required("dashboard/app/page.tsx")
    page_client = read_required("dashboard/app/dashboard-client.tsx")
    g9_experience = read_required("dashboard/app/g9-experience.tsx")
    components_dir = ROOT / "dashboard/app/components"
    component_sources = [
        path.read_text(encoding="utf-8")
        for path in sorted(components_dir.rglob("*.tsx"))
    ] if components_dir.is_dir() else []
    page = "\n".join([page_shell, page_client, g9_experience, *component_sources])
    research_data = read_required("dashboard/app/research-data.ts")
    deployment_data = read_required("dashboard/app/deployment-data.ts")
    layout = read_required("dashboard/app/layout.tsx")
    report = read_required("docs/FINAL_REPORT.md")
    handoff = read_required("docs/PHASE9_HANDOFF.md")
    submission = read_required("docs/SUBMISSION.md")
    read_required("docs/DEMO_SCRIPT.md")

    package = json.loads(read_required("dashboard/package.json"))
    if package.get("name") != "thetashield-research-dashboard":
        raise SystemExit("dashboard package identity is not ThetaShield")

    for phrase in (
        "Protect LPs from",
        "These cards are simulated—not live chain state.",
        "The failures stayed in the record",
        "Risk proxy—not exact LVR",
        "CIRCLE CCTP",
        "Trust surface",
        "See the delayed fee travel.",
        "REACTIVE NETWORK",
        "LP-benefit replay console",
        "ObservationTransportFailed",
        "DropReason.EpochCapacity",
        'from "./research-data"',
    ):
        require(page, phrase, "dashboard app")

    for phrase in (
        "dashboard_bundle.json",
        "representative_traces",
        "policy_metrics",
        "holdout_table",
        "compact_scenario_replays",
        "phase6_sensitivity",
        "trustBands",
    ):
        require(research_data, phrase, "dashboard/app/research-data.ts")

    for phrase in (
        "deployment_manifest.json",
        "components",
        "circle_messages",
        "acceptance",
        "reference_sampler",
    ):
        require(deployment_data, phrase, "dashboard/app/deployment-data.ts")
    require(page, 'from "./deployment-data"', "dashboard app")

    for stale_literal in (
        "const scenarios = [",
        "const hypotheses = [",
        "const policyRows = [",
        "buyFee:",
        "const liveReceipts = [",
        "const liveAddresses = [",
    ):
        if stale_literal in page:
            raise SystemExit(f"dashboard app retains hardcoded research data: {stale_literal}")

    check_no_hardcoded_identifiers()
    check_deployment_mirror()

    bundle = json.loads(read_required("research/reports/dashboard_bundle.json"))
    if {entry.get("id") for entry in bundle.get("hypotheses", [])} != {
        "H1", "H2", "H3", "H4", "H5", "H6"
    }:
        raise SystemExit("dashboard bundle does not contain exactly H1-H6")
    if len(bundle.get("policy_metrics", {})) != 5 or len(bundle.get("scenario_lp_outcomes", {})) != 15:
        raise SystemExit("dashboard bundle policy/scenario coverage is incomplete")
    if bundle.get("schema_version") != 2 or len(bundle.get("compact_scenario_replays", {})) != 15:
        raise SystemExit("G9 compact scenario replays are incomplete")
    sensitivity_dimensions = {
        entry.get("dimension") for entry in bundle.get("phase6_sensitivity", {}).values()
    }
    if not {"dead_band_k", "persistence_n_of_k", "ewma_alpha", "maximum_fee"} <= sensitivity_dimensions:
        raise SystemExit("G9 exact sensitivity controls are incomplete")

    for phrase in ("generateMetadata", "/og.png", "ThetaShield"):
        require(layout, phrase, "dashboard/app/layout.tsx")

    for phrase in ("Circle CCTP", "Python", "complete live testnet deployment"):
        require(report, phrase, "docs/FINAL_REPORT.md")

    require(handoff, "Phase 9 is complete", "docs/PHASE9_HANDOFF.md")
    require(submission, "has not been submitted", "docs/SUBMISSION.md")

    phase9_surface = "\n".join((page, research_data, layout, report, handoff, submission))
    if "site-creator-vinext-starter" in phase9_surface:
        raise SystemExit("starter identity remains in a Phase 9 artifact")
    # Word-boundary matched so ThetaShield's own vocabulary (markout, Reactive
    # Lasna, "Python ↔ Solidity") cannot trip the gate, while a foreign oracle
    # identity still does.
    foreign_identity = re.compile(r"\bPyth\b|\bChainlink\b|\bRedstone\b", re.IGNORECASE)
    if foreign_identity.search(f"{page}\n{layout}"):
        raise SystemExit("another project's identity leaked into the ThetaShield dashboard")

    check_png()
    print("Phase 9 dashboard and handoff package verified")


if __name__ == "__main__":
    main()

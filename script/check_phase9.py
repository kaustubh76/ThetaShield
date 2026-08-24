#!/usr/bin/env python3
"""Fail closed when the Phase 9 dashboard or handoff package is incomplete."""

from __future__ import annotations

import json
import struct
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


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
    page = read_required("dashboard/app/page.tsx")
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
        "59.70%",
        "Risk proxy—not exact LVR",
        "Circle CCTP",
    ):
        require(page, phrase, "dashboard/app/page.tsx")

    for phrase in ("generateMetadata", "/og.png", "ThetaShield"):
        require(layout, phrase, "dashboard/app/layout.tsx")

    for phrase in ("Circle CCTP", "Python", "No complete live deployment"):
        require(report, phrase, "docs/FINAL_REPORT.md")

    require(handoff, "Phase 9 is complete", "docs/PHASE9_HANDOFF.md")
    require(submission, "has not been submitted", "docs/SUBMISSION.md")

    phase9_surface = "\n".join((page, layout, report, handoff, submission))
    if "site-creator-vinext-starter" in phase9_surface:
        raise SystemExit("starter identity remains in a Phase 9 artifact")
    if any(name in f"{page}\n{layout}" for name in ("MARKOUT", "Pyth", "Reactive Network", "LASNA")):
        raise SystemExit("another project's identity leaked into the ThetaShield dashboard")

    check_png()
    print("Phase 9 dashboard and handoff package verified")


if __name__ == "__main__":
    main()

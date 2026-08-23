#!/usr/bin/env python3
"""Fail when tracked project files contain common credential material."""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
DISALLOWED_FILENAMES = {".env", "id_rsa", "id_ed25519"}
PATTERNS = {
    "populated private-key variable": re.compile(r"(?m)^(?:DEPLOYER_)?PRIVATE_KEY[ \t]*=[ \t]*\S+"),
    "populated explorer API key": re.compile(r"(?m)^EXPLORER_API_KEY[ \t]*=[ \t]*\S+"),
    "private PEM block": re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    "GitHub personal token": re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b"),
    "AWS access key": re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    "URL with embedded credentials": re.compile(r"https?://[^\s/:]+:[^\s/@]+@"),
}


def main() -> None:
    result = subprocess.run(
        ["git", "ls-files", "-z"], cwd=REPO_ROOT, capture_output=True, check=True
    )
    findings: list[str] = []
    tracked = [entry for entry in result.stdout.decode().split("\0") if entry]
    for relative in tracked:
        path = REPO_ROOT / relative
        if path.name in DISALLOWED_FILENAMES or path.suffix.lower() in {".pem", ".key", ".p12"}:
            findings.append(f"tracked credential-like file: {relative}")
        if not path.is_file() or path.is_symlink():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        for label, pattern in PATTERNS.items():
            if pattern.search(text):
                findings.append(f"{label}: {relative}")

    if findings:
        raise SystemExit("Potential tracked secret material found:\n" + "\n".join(sorted(set(findings))))
    print(f"Secret scan passed across {len(tracked)} tracked paths.")


if __name__ == "__main__":
    main()

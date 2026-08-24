#!/usr/bin/env python3
"""Poll Circle's sandbox API for a CCTP V2 message and finalized attestation."""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API_ROOT = "https://iris-api-sandbox.circle.com/v2/messages"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-domain", required=True, type=int)
    parser.add_argument("--tx-hash", required=True)
    parser.add_argument("--timeout", type=int, default=900)
    parser.add_argument("--interval", type=int, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    deadline = time.monotonic() + args.timeout
    url = f"{API_ROOT}/{args.source_domain}?transactionHash={args.tx_hash}"
    while True:
        payload = _request(url)
        messages = payload.get("messages", [])
        for item in messages:
            if item.get("status") == "complete" and item.get("message") and item.get("attestation"):
                result = {
                    "source_domain": args.source_domain,
                    "transaction_hash": args.tx_hash,
                    "nonce": item.get("eventNonce") or item.get("nonce"),
                    "message": item["message"],
                    "attestation": item["attestation"],
                }
                rendered = json.dumps(result, indent=2)
                if args.output:
                    args.output.write_text(rendered + "\n", encoding="utf-8")
                print(rendered)
                return

        if time.monotonic() >= deadline:
            raise SystemExit(f"timed out waiting for a complete Circle attestation: {url}")
        status = messages[0].get("status", "not found") if messages else "not found"
        print(f"Circle message status: {status}; retrying in {args.interval}s", file=sys.stderr)
        time.sleep(args.interval)


def _request(url: str) -> dict[str, object]:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ThetaShield/1"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Circle API request failed: {exc}") from exc


if __name__ == "__main__":
    main()

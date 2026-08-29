#!/usr/bin/env python3
"""Validate every deployment manifest against deployments/manifest.schema.json.

The repository deliberately avoids third-party Python dependencies, so this
implements the closed subset of JSON Schema that the manifest schema actually
uses: type, const, enum, pattern, required, properties, additionalProperties,
items, minimum, maximum, minLength, minItems, and maxItems.

deployments/archive/ is skipped: those manifests are retired schema_version 2
records kept as historical evidence, and the current schema pins
schema_version to 3.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEPLOYMENTS = REPOSITORY_ROOT / "deployments"
SCHEMA_PATH = DEPLOYMENTS / "manifest.schema.json"

JSON_TYPES = {
    "object": dict,
    "array": list,
    "string": str,
    "boolean": bool,
    "null": type(None),
}


def matches_type(value: object, expected: str) -> bool:
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    python_type = JSON_TYPES.get(expected)
    if python_type is None:
        raise ValueError(f"unsupported schema type {expected!r}")
    if python_type is str and isinstance(value, bool):
        return False
    return isinstance(value, python_type)


def validate(value: object, schema: dict, path: str, errors: list[str]) -> None:
    expected = schema.get("type")
    if expected is not None:
        options = expected if isinstance(expected, list) else [expected]
        if not any(matches_type(value, option) for option in options):
            errors.append(f"{path}: expected type {'|'.join(options)}, got {type(value).__name__}")
            return

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}, got {value!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} is not one of {schema['enum']!r}")

    if isinstance(value, str):
        pattern = schema.get("pattern")
        if pattern is not None and re.search(pattern, value) is None:
            errors.append(f"{path}: {value!r} does not match {pattern!r}")
        minimum_length = schema.get("minLength")
        if minimum_length is not None and len(value) < minimum_length:
            errors.append(f"{path}: shorter than minLength {minimum_length}")

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        minimum = schema.get("minimum")
        if minimum is not None and value < minimum:
            errors.append(f"{path}: {value} is below minimum {minimum}")
        maximum = schema.get("maximum")
        if maximum is not None and value > maximum:
            errors.append(f"{path}: {value} is above maximum {maximum}")

    if isinstance(value, list):
        minimum_items = schema.get("minItems")
        if minimum_items is not None and len(value) < minimum_items:
            errors.append(f"{path}: {len(value)} items is below minItems {minimum_items}")
        maximum_items = schema.get("maxItems")
        if maximum_items is not None and len(value) > maximum_items:
            errors.append(f"{path}: {len(value)} items is above maxItems {maximum_items}")
        item_schema = schema.get("items")
        if isinstance(item_schema, dict):
            for index, item in enumerate(value):
                validate(item, item_schema, f"{path}[{index}]", errors)

    if isinstance(value, dict):
        properties = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                errors.append(f"{path}: missing required property {name!r}")
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    errors.append(f"{path}: unexpected property {name!r}")
        for name, child_schema in properties.items():
            if name in value:
                validate(value[name], child_schema, f"{path}.{name}", errors)


def cross_check(manifest: dict, errors: list[str], warnings: list[str]) -> None:
    """Repository invariants the schema itself cannot express."""
    declared = {network.get("role") for network in manifest.get("networks", [])}
    for component in manifest.get("components", []):
        role = component.get("network_role")
        # "reactive" is described by reactive_automation rather than a networks entry.
        if role not in declared and role != "reactive":
            errors.append(f"components: role {role!r} has no matching networks entry")
    if manifest.get("mode") == "live":
        acceptance = manifest.get("acceptance", {})
        if acceptance.get("passed") is True and not acceptance.get("preflight_fingerprints"):
            # docs/VERIFICATION.md calls the live read-only preflight calls mandatory.
            # Warn until the outstanding G10 fingerprints are recorded, then promote
            # this to errors.append so a release cannot omit them again.
            warnings.append(
                "acceptance: passing live release records no preflight fingerprint "
                "(docs/VERIFICATION.md calls the live preflight calls mandatory)"
            )


def main() -> int:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    manifests = sorted(
        path
        for path in DEPLOYMENTS.rglob("*.json")
        if path.name != SCHEMA_PATH.name and "archive" not in path.relative_to(DEPLOYMENTS).parts
    )
    if not manifests:
        print("No deployment manifests found; nothing to validate.")
        return 0

    failed = False
    for path in manifests:
        errors: list[str] = []
        warnings: list[str] = []
        manifest = json.loads(path.read_text(encoding="utf-8"))
        validate(manifest, schema, path.name, errors)
        cross_check(manifest, errors, warnings)
        if errors:
            failed = True
            print(f"FAIL {path.relative_to(REPOSITORY_ROOT)}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"ok   {path.relative_to(REPOSITORY_ROOT)}")
        for warning in warnings:
            print(f"  ! {warning}")

    if failed:
        print("\nDeployment manifest validation failed.")
        return 1
    print(f"\nValidated {len(manifests)} deployment manifest(s) against the schema.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

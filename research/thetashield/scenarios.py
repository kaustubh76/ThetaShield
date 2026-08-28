"""Deterministic synthetic market streams used by the Phase 5 harness."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass

from research.thetashield.model import WAD

EVENT_COUNT = 240
REPEATED_SEEDS = (101, 211, 307, 401, 503)
INITIAL_PRICE_WAD = 2_000 * WAD
BASIS_POINT_WAD = 10**14


@dataclass(frozen=True)
class TradeEvent:
    index: int
    timestamp_seconds: int
    direction: int
    notional_wad: int
    execution_price_wad: int
    reference_price_wad: int
    reference_dispersion_wad: int
    reference_available: bool
    is_toxic: bool
    applied_fee_pips: int | None = None

    def to_dict(self) -> dict[str, int | bool]:
        return {key: value for key, value in asdict(self).items() if value is not None}


@dataclass(frozen=True)
class ScenarioDefinition:
    name: str
    description: str
    operational_mode: str = "normal"


SCENARIOS = (
    ScenarioDefinition("benign_noise", "Zero-mean benign flow with low independent price noise."),
    ScenarioDefinition("persistent_informed_buying", "Persistent toxic base buying with favorable future moves."),
    ScenarioDefinition("persistent_informed_selling", "Persistent toxic base selling with favorable future moves."),
    ScenarioDefinition("alternating_toxicity", "Toxic direction alternates between buying and selling blocks."),
    ScenarioDefinition("high_volatility_uninformed", "Large price moves remain independent of benign trade direction."),
    ScenarioDefinition("toxic_volatility_burst", "A toxic burst attempts to widen its own trailing volatility band."),
    ScenarioDefinition("neutral_inside_attack", "A neutral epoch interrupts but does not erase a sustained attack."),
    ScenarioDefinition("microtrade_spam", "Tiny benign trades surround ordinary-size toxic flow."),
    ScenarioDefinition("oversized_observation", "One oversized toxic trade tests the per-trade notional cap."),
    ScenarioDefinition("conflicting_references", "Toxic flow arrives with high reference-price dispersion."),
    ScenarioDefinition("stale_references", "Selected observations have unavailable or stale references."),
    ScenarioDefinition("missing_callbacks", "Every other generated dynamic recommendation is not delivered.", "missing"),
    ScenarioDefinition("replayed_callbacks", "Delivered recommendations are replayed after acceptance.", "replay"),
    ScenarioDefinition("out_of_order_callbacks", "Older recommendations arrive after newer sequences.", "out_of_order"),
    ScenarioDefinition("fee_oscillation", "Toxic and benign regimes alternate quickly to stress fee rate limits."),
)

SCENARIO_BY_NAME = {scenario.name: scenario for scenario in SCENARIOS}


def _random_direction(rng: random.Random) -> int:
    return 1 if rng.randrange(2) else -1


def _benign_move_wad(rng: random.Random, width_bps: int = 5) -> int:
    return rng.randint(-width_bps, width_bps) * BASIS_POINT_WAD


def _toxic_move_wad(rng: random.Random, direction: int, minimum_bps: int = 40, maximum_bps: int = 65) -> int:
    return direction * rng.randint(minimum_bps, maximum_bps) * BASIS_POINT_WAD


def _standard_notional_wad(rng: random.Random) -> int:
    return rng.randint(5, 25) * WAD


def _event_controls(
    name: str,
    index: int,
    rng: random.Random,
) -> tuple[int, int, int, bool, int, bool]:
    """Return direction, move, notional, toxic, dispersion, and reference availability."""
    direction = _random_direction(rng)
    move_wad = _benign_move_wad(rng)
    notional_wad = _standard_notional_wad(rng)
    is_toxic = False
    dispersion_wad = rng.randint(0, 8) * 10**13
    reference_available = True

    if name == "benign_noise":
        pass
    elif name == "persistent_informed_buying":
        is_toxic = index >= 32 and rng.random() < 0.82
        if is_toxic:
            direction = 1
            move_wad = _toxic_move_wad(rng, direction)
    elif name == "persistent_informed_selling":
        is_toxic = index >= 32 and rng.random() < 0.82
        if is_toxic:
            direction = -1
            move_wad = _toxic_move_wad(rng, direction)
    elif name == "alternating_toxicity":
        is_toxic = index >= 32 and rng.random() < 0.78
        if is_toxic:
            direction = 1 if (index // 32) % 2 == 0 else -1
            move_wad = _toxic_move_wad(rng, direction)
    elif name == "high_volatility_uninformed":
        move_wad = rng.randint(-45, 45) * BASIS_POINT_WAD
    elif name == "toxic_volatility_burst":
        if 72 <= index < 128:
            is_toxic = True
            direction = 1
            minimum = 70 if index < 88 else 42
            move_wad = _toxic_move_wad(rng, direction, minimum, minimum + 25)
        else:
            move_wad = _benign_move_wad(rng, 8)
    elif name == "neutral_inside_attack":
        in_attack = 48 <= index < 208
        in_neutral_epoch = 112 <= index < 120
        is_toxic = in_attack and not in_neutral_epoch and rng.random() < 0.9
        if is_toxic:
            direction = 1
            move_wad = _toxic_move_wad(rng, direction)
        elif in_neutral_epoch:
            direction = _random_direction(rng)
            move_wad = _benign_move_wad(rng, 2)
    elif name == "microtrade_spam":
        if rng.random() < 0.78:
            notional_wad = rng.randint(1, 5) * 10**16
            move_wad = _benign_move_wad(rng, 3)
        else:
            is_toxic = index >= 32
            direction = 1
            move_wad = _toxic_move_wad(rng, direction)
    elif name == "oversized_observation":
        is_toxic = index >= 48 and rng.random() < 0.45
        if is_toxic:
            direction = -1
            move_wad = _toxic_move_wad(rng, direction)
        if index == EVENT_COUNT // 2:
            is_toxic = True
            direction = -1
            move_wad = _toxic_move_wad(rng, direction, 90, 110)
            notional_wad = 2_000 * WAD
    elif name == "conflicting_references":
        is_toxic = index >= 32 and rng.random() < 0.78
        if is_toxic:
            direction = 1
            move_wad = _toxic_move_wad(rng, direction)
        dispersion_wad = rng.randint(250, 450) * BASIS_POINT_WAD
    elif name == "stale_references":
        is_toxic = index >= 32 and rng.random() < 0.78
        if is_toxic:
            direction = -1
            move_wad = _toxic_move_wad(rng, direction)
        reference_available = index % 3 != 0
    elif name in {"missing_callbacks", "replayed_callbacks", "out_of_order_callbacks"}:
        is_toxic = index >= 32 and rng.random() < 0.8
        if is_toxic:
            direction = 1
            move_wad = _toxic_move_wad(rng, direction)
    elif name == "fee_oscillation":
        regime = (index // 24) % 4
        if regime in (0, 2) and index >= 24:
            is_toxic = rng.random() < 0.9
            direction = 1 if regime == 0 else -1
            move_wad = _toxic_move_wad(rng, direction, 45, 70)
        else:
            move_wad = _benign_move_wad(rng, 10)
    else:
        raise KeyError(f"unknown scenario: {name}")

    return direction, move_wad, notional_wad, is_toxic, dispersion_wad, reference_available


def generate_scenario(name: str, seed: int, event_count: int = EVENT_COUNT) -> tuple[TradeEvent, ...]:
    if name not in SCENARIO_BY_NAME:
        raise KeyError(f"unknown scenario: {name}")
    if event_count <= 0:
        raise ValueError("event count must be positive")

    rng = random.Random(f"thetashield-phase5:{name}:{seed}")
    price_wad = INITIAL_PRICE_WAD
    events: list[TradeEvent] = []
    for index in range(event_count):
        direction, move_wad, notional_wad, is_toxic, dispersion_wad, reference_available = _event_controls(
            name, index, rng
        )
        impact_wad = BASIS_POINT_WAD + min(notional_wad // (250 * WAD), 4) * 10**13
        execution_price_wad = price_wad * (WAD + direction * impact_wad) // WAD
        reference_price_wad = price_wad * (WAD + move_wad) // WAD
        if execution_price_wad <= 0 or reference_price_wad <= 0:
            raise AssertionError("scenario generated a non-positive price")
        events.append(
            TradeEvent(
                index=index,
                timestamp_seconds=index * 30,
                direction=direction,
                notional_wad=notional_wad,
                execution_price_wad=execution_price_wad,
                reference_price_wad=reference_price_wad,
                reference_dispersion_wad=dispersion_wad,
                reference_available=reference_available,
                is_toxic=is_toxic,
            )
        )
        price_wad = reference_price_wad
    return tuple(events)


def scenario_manifest() -> dict[str, object]:
    return {
        "schema_version": 1,
        "event_count_per_run": EVENT_COUNT,
        "repeated_seeds": list(REPEATED_SEEDS),
        "initial_price_wad": INITIAL_PRICE_WAD,
        "scenarios": [
            {
                "name": scenario.name,
                "description": scenario.description,
                "operational_mode": scenario.operational_mode,
            }
            for scenario in SCENARIOS
        ],
    }

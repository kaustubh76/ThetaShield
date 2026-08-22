"""Versioned Phase 6.1 challenge streams and remediation candidates."""

from __future__ import annotations

import random
from dataclasses import asdict, dataclass, replace
from itertools import product
from typing import Any

from research.thetashield.model import WAD
from research.thetashield.policies import ResearchConfig
from research.thetashield.scenarios import (
    BASIS_POINT_WAD,
    EVENT_COUNT,
    INITIAL_PRICE_WAD,
    REPEATED_SEEDS,
    TradeEvent,
)

HOLDOUT_SEEDS = (1_103, 1_201, 1_301, 1_409, 1_511)
TRAINING_SEEDS = REPEATED_SEEDS
BENIGN_CHALLENGE_SCENARIOS = (
    "near_threshold_benign",
    "heteroskedastic_benign",
    "reversal_bursts",
)
PERSISTENT_CHALLENGE_SCENARIOS = (
    "persistent_informed_buying",
    "persistent_informed_selling",
)

RAW_COMPARATOR_GAIN_FEE_PIPS = 100_000
REMEDIATION_GAIN_FEE_PIPS = 500_000


@dataclass(frozen=True)
class RemediationCase:
    case_id: str
    config: ResearchConfig
    gain_fee_pips: int = REMEDIATION_GAIN_FEE_PIPS

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "gain_fee_pips": self.gain_fee_pips,
            "research_config": asdict(self.config),
        }


def remediation_base_config() -> ResearchConfig:
    """Return the common fast-response family used only by Phase 6.1."""
    return replace(
        ResearchConfig(),
        trailing_window=16,
        minimum_trailing_observations=16,
        epoch_observation_count=4,
        target_observation_count=4,
        dead_band_k_wad=WAD,
        maximum_increase_pips=500,
        maximum_decrease_pips=100,
        fast_path_enabled=True,
        fast_path_confidence_floor_wad=WAD // 2,
        fast_path_toxic_threshold_wad=75 * 10**13,
        fast_path_hold_epochs=0,
    )


def build_h5_training_cases() -> tuple[RemediationCase, ...]:
    """Return the declared multi-factor training grid; holdout never selects it."""
    default = remediation_base_config()
    cases: list[RemediationCase] = []
    for dead_band_k_wad, persistence, maximum_increase, maximum_decrease in product(
        (WAD // 2, WAD, 15 * WAD // 10),
        ((2, 3), (3, 5)),
        (500, 750, 1_000),
        (50, 100, 150, 200, 250),
    ):
        required, window = persistence
        config = replace(
            default,
            dead_band_k_wad=dead_band_k_wad,
            required_toxic_epochs=required,
            persistence_window=window,
            maximum_increase_pips=maximum_increase,
            maximum_decrease_pips=maximum_decrease,
        )
        cases.append(
            RemediationCase(
                case_id=(
                    f"h5__k_{_wad_label(dead_band_k_wad)}__p_{required}_of_{window}"
                    f"__up_{maximum_increase}__down_{maximum_decrease}"
                ),
                config=config,
            )
        )
    return tuple(cases)


def build_h4_frontier_cases(selected_config: ResearchConfig) -> tuple[RemediationCase, ...]:
    """Build a multi-parameter frontier around the training-selected fee kinetics."""
    cases: list[RemediationCase] = []
    for dead_band_k_wad, persistence, fast_path_enabled in product(
        (0, WAD // 4, WAD // 2, WAD, 15 * WAD // 10),
        ((1, 1), (1, 2), (2, 3), (3, 5)),
        (False, True),
    ):
        required, window = persistence
        config = replace(
            selected_config,
            dead_band_k_wad=dead_band_k_wad,
            required_toxic_epochs=required,
            persistence_window=window,
            fast_path_enabled=fast_path_enabled,
        )
        cases.append(
            RemediationCase(
                case_id=(
                    f"h4__k_{_wad_label(dead_band_k_wad)}__p_{required}_of_{window}"
                    f"__fast_{str(fast_path_enabled).lower()}"
                ),
                config=config,
            )
        )
    return tuple(cases)


def generate_benign_challenge(
    name: str,
    seed: int,
    event_count: int = EVENT_COUNT,
) -> tuple[TradeEvent, ...]:
    """Generate harder, explicitly benign streams for measuring an H4 frontier."""
    if name not in BENIGN_CHALLENGE_SCENARIOS:
        raise KeyError(f"unknown Phase 6.1 benign challenge: {name}")
    if event_count <= 0:
        raise ValueError("event count must be positive")

    rng = random.Random(f"thetashield-phase61:{name}:{seed}")
    price_wad = INITIAL_PRICE_WAD
    events: list[TradeEvent] = []
    for index in range(event_count):
        direction = 1 if rng.randrange(2) else -1
        move_bps = rng.randint(-5, 5)
        notional_wad = rng.randint(5, 25) * WAD

        if name == "near_threshold_benign":
            direction = 1 if (index // 16) % 2 == 0 else -1
            move_bps = (
                direction * rng.randint(7, 18)
                if rng.random() < 0.65
                else rng.randint(-6, 6)
            )
        elif name == "heteroskedastic_benign":
            width_bps = (8, 20, 35)[(index // 40) % 3]
            move_bps = rng.randint(-width_bps, width_bps)
        else:
            position = index % 24
            direction = 1 if (index // 24) % 2 == 0 else -1
            if position < 6:
                move_bps = direction * rng.randint(15, 30)
            elif position < 12:
                move_bps = -direction * rng.randint(10, 25)
            else:
                move_bps = rng.randint(-7, 7)

        impact_wad = BASIS_POINT_WAD + min(notional_wad // (250 * WAD), 4) * 10**13
        execution_price_wad = price_wad * (WAD + direction * impact_wad) // WAD
        reference_price_wad = price_wad * (WAD + move_bps * BASIS_POINT_WAD) // WAD
        events.append(
            TradeEvent(
                index=index,
                timestamp_seconds=index * 30,
                direction=direction,
                notional_wad=notional_wad,
                execution_price_wad=execution_price_wad,
                reference_price_wad=reference_price_wad,
                reference_dispersion_wad=rng.randint(0, 8) * 10**13,
                reference_available=True,
                is_toxic=False,
            )
        )
        price_wad = reference_price_wad
    return tuple(events)


def _wad_label(value: int) -> str:
    whole, remainder = divmod(value, WAD)
    if remainder == 0:
        return str(whole)
    return f"{value / WAD:.2f}".rstrip("0").rstrip(".").replace(".", "p")

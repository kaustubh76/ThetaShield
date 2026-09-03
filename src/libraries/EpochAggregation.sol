// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title EpochAggregation
/// @notice Bounded, capped-notional aggregation of filtered directional markout.
library EpochAggregation {
    uint16 internal constant ABSOLUTE_MAX_OBSERVATIONS = 256;
    uint256 internal constant MAX_ABS_FILTERED_MARKOUT_WAD = 10 * ThetaShieldUnits.WAD;

    struct Observation {
        int256 filteredMarkoutWad;
        uint256 notionalWad;
    }

    struct Config {
        uint256 minimumObservationNotionalWad;
        uint256 maximumTradeNotionalWad;
        uint256 minimumEpochNotionalWad;
        uint16 maximumObservationCount;
    }

    struct Result {
        int256 aggregateMarkoutWad;
        uint256 eligibleNotionalWad;
        uint16 eligibleObservationCount;
        bool meetsMinimumEpochNotional;
    }

    error InvalidConfiguration();
    error TooManyObservations(uint256 supplied, uint256 maximum);
    error FilteredMarkoutOutOfBounds(uint256 index, int256 filteredMarkoutWad);

    /// @notice Aggregates eligible observations using capped notional weights.
    function aggregate(Observation[] memory observations, Config memory config)
        internal
        pure
        returns (Result memory result)
    {
        _validateConfig(config);
        if (observations.length > config.maximumObservationCount) {
            revert TooManyObservations(observations.length, config.maximumObservationCount);
        }

        int256 weightedSumWad;
        for (uint256 index; index < observations.length; ++index) {
            Observation memory observation = observations[index];
            if (observation.notionalWad < config.minimumObservationNotionalWad) continue;
            if (FixedPointMath.abs(observation.filteredMarkoutWad) > MAX_ABS_FILTERED_MARKOUT_WAD) {
                revert FilteredMarkoutOutOfBounds(index, observation.filteredMarkoutWad);
            }

            uint256 cappedNotionalWad = observation.notionalWad > config.maximumTradeNotionalWad
                ? config.maximumTradeNotionalWad
                : observation.notionalWad;
            int256 contributionWad = FixedPointMath.mulDivSigned(
                observation.filteredMarkoutWad, FixedPointMath.toInt256(cappedNotionalWad), ThetaShieldUnits.WAD
            );

            weightedSumWad += contributionWad;
            result.eligibleNotionalWad += cappedNotionalWad;
            ++result.eligibleObservationCount;
        }

        result.meetsMinimumEpochNotional = result.eligibleNotionalWad >= config.minimumEpochNotionalWad;
        if (result.eligibleNotionalWad != 0) {
            result.aggregateMarkoutWad =
                FixedPointMath.mulDivSigned(weightedSumWad, int256(ThetaShieldUnits.WAD), result.eligibleNotionalWad);
        }
    }

    function _validateConfig(Config memory config) private pure {
        if (
            config.maximumObservationCount == 0 || config.maximumObservationCount > ABSOLUTE_MAX_OBSERVATIONS
                || config.minimumObservationNotionalWad == 0 || config.maximumTradeNotionalWad == 0
                || config.minimumEpochNotionalWad == 0
                || config.minimumObservationNotionalWad > config.maximumTradeNotionalWad
        ) revert InvalidConfiguration();

        uint256 markoutMultiple = MAX_ABS_FILTERED_MARKOUT_WAD / ThetaShieldUnits.WAD;
        uint256 maximumSafeNotional =
            uint256(type(int256).max) / uint256(config.maximumObservationCount) / markoutMultiple;
        if (config.maximumTradeNotionalWad > maximumSafeNotional) revert InvalidConfiguration();
    }
}

// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title FeeCurve
/// @notice Converts positive active directional risk into bounded, rate-limited fee pips.
library FeeCurve {
    struct Config {
        uint24 baseFeePips;
        uint24 minimumFeePips;
        uint24 maximumFeePips;
        uint24 gainFeePips;
        uint24 maximumIncreasePips;
        uint24 maximumDecreasePips;
        uint256 confidenceFloorWad;
    }

    struct Result {
        uint24 premiumPips;
        uint24 targetFeePips;
        uint24 nextFeePips;
    }

    error InvalidFeeConfiguration();
    error InvalidConfidence(uint256 confidenceWad);
    error PreviousFeeOutOfBounds(uint24 previousFeePips);

    /// @notice Calculates the target and rate-limited next fee.
    function calculate(
        int256 signedRiskWad,
        uint256 confidenceWad,
        bool persistenceActive,
        uint24 previousFeePips,
        Config memory config
    ) internal pure returns (Result memory result) {
        _validateConfig(config);
        if (confidenceWad > ThetaShieldUnits.WAD) revert InvalidConfidence(confidenceWad);
        if (previousFeePips < config.minimumFeePips || previousFeePips > config.maximumFeePips) {
            revert PreviousFeeOutOfBounds(previousFeePips);
        }

        uint256 target = config.baseFeePips;
        if (persistenceActive && confidenceWad >= config.confidenceFloorWad && signedRiskWad > 0) {
            uint256 premium =
                FixedPointMath.mulDivDown(FixedPointMath.abs(signedRiskWad), config.gainFeePips, ThetaShieldUnits.WAD);
            uint256 maximumPremium = uint256(config.maximumFeePips) - config.baseFeePips;
            if (premium > maximumPremium) premium = maximumPremium;
            // maximumPremium is at most 1e6 fee pips and fits in uint24.
            // forge-lint: disable-next-line(unsafe-typecast)
            result.premiumPips = uint24(premium);
            target += premium;
        }

        target = FixedPointMath.clamp(target, config.minimumFeePips, config.maximumFeePips);
        // The configured maximum is at most 1e6 fee pips and fits in uint24.
        // forge-lint: disable-next-line(unsafe-typecast)
        result.targetFeePips = uint24(target);
        result.nextFeePips = _rateLimit(previousFeePips, result.targetFeePips, config);
    }

    function _rateLimit(uint24 previousFeePips, uint24 targetFeePips, Config memory config)
        private
        pure
        returns (uint24)
    {
        if (targetFeePips > previousFeePips) {
            uint256 increaseCeiling = uint256(previousFeePips) + config.maximumIncreasePips;
            return uint24(targetFeePips > increaseCeiling ? increaseCeiling : targetFeePips);
        }

        uint256 decreaseFloor =
            previousFeePips > config.maximumDecreasePips ? uint256(previousFeePips) - config.maximumDecreasePips : 0;
        uint256 limited = targetFeePips < decreaseFloor ? decreaseFloor : targetFeePips;
        return uint24(FixedPointMath.clamp(limited, config.minimumFeePips, config.maximumFeePips));
    }

    function _validateConfig(Config memory config) private pure {
        if (
            config.minimumFeePips > config.baseFeePips || config.baseFeePips > config.maximumFeePips
                || config.maximumFeePips > ThetaShieldUnits.FEE_PIPS || config.confidenceFloorWad > ThetaShieldUnits.WAD
        ) revert InvalidFeeConfiguration();
    }
}

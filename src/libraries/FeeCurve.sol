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
        uint24 coverageGainFeePips;
        uint24 maximumIncreasePips;
        uint24 maximumDecreasePips;
        uint256 confidenceFloorWad;
        uint256 targetCoverageWad;
        uint256 minimumEstimatedLossWad;
    }

    struct CoverageInput {
        uint256 feeRevenueWad;
        uint256 estimatedLossWad;
        bool meetsMinimumEpochNotional;
    }

    struct Result {
        uint24 premiumPips;
        uint24 toxicPremiumPips;
        uint24 coveragePremiumPips;
        uint24 targetFeePips;
        uint24 nextFeePips;
        uint256 coverageRatioWad;
        uint256 coverageDeficitWad;
        bool coverageEligible;
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
        return calculateClosedLoop(
            signedRiskWad,
            confidenceWad,
            persistenceActive,
            previousFeePips,
            CoverageInput({feeRevenueWad: 0, estimatedLossWad: 0, meetsMinimumEpochNotional: false}),
            config
        );
    }

    /// @notice Calculates a bounded fee from directional risk and realized epoch coverage.
    function calculateClosedLoop(
        int256 signedRiskWad,
        uint256 confidenceWad,
        bool persistenceActive,
        uint24 previousFeePips,
        CoverageInput memory coverage,
        Config memory config
    ) internal pure returns (Result memory result) {
        _validateConfig(config);
        if (confidenceWad > ThetaShieldUnits.WAD) revert InvalidConfidence(confidenceWad);
        if (previousFeePips < config.minimumFeePips || previousFeePips > config.maximumFeePips) {
            revert PreviousFeeOutOfBounds(previousFeePips);
        }

        result.coverageRatioWad = config.targetCoverageWad;
        if (coverage.meetsMinimumEpochNotional && coverage.estimatedLossWad >= config.minimumEstimatedLossWad) {
            result.coverageEligible = true;
            result.coverageRatioWad =
                FixedPointMath.mulDivDown(coverage.feeRevenueWad, ThetaShieldUnits.WAD, coverage.estimatedLossWad);
            if (result.coverageRatioWad < config.targetCoverageWad) {
                result.coverageDeficitWad = config.targetCoverageWad - result.coverageRatioWad;
            }
        }

        uint256 premium;
        if (persistenceActive && confidenceWad >= config.confidenceFloorWad && signedRiskWad > 0) {
            uint256 toxicPremium =
                FixedPointMath.mulDivDown(FixedPointMath.abs(signedRiskWad), config.gainFeePips, ThetaShieldUnits.WAD);
            uint256 coveragePremium = result.coverageEligible
                ? FixedPointMath.mulDivDown(result.coverageDeficitWad, config.coverageGainFeePips, ThetaShieldUnits.WAD)
                : 0;
            uint256 maximumPremium = uint256(config.maximumFeePips) - config.baseFeePips;
            if (toxicPremium > maximumPremium) toxicPremium = maximumPremium;
            if (coveragePremium > maximumPremium) coveragePremium = maximumPremium;
            premium = toxicPremium + coveragePremium;
            if (premium > maximumPremium) premium = maximumPremium;
            // maximumPremium is at most 1e6 fee pips and fits in uint24.
            // forge-lint: disable-next-line(unsafe-typecast)
            result.toxicPremiumPips = uint24(toxicPremium);
            // forge-lint: disable-next-line(unsafe-typecast)
            result.coveragePremiumPips = uint24(coveragePremium);
            // forge-lint: disable-next-line(unsafe-typecast)
            result.premiumPips = uint24(premium);
        }

        uint256 target = uint256(config.baseFeePips) + premium;
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
                || config.maximumFeePips > ThetaShieldUnits.FEE_PIPS
                || config.coverageGainFeePips > ThetaShieldUnits.FEE_PIPS
                || config.confidenceFloorWad > ThetaShieldUnits.WAD || config.targetCoverageWad == 0
                || config.targetCoverageWad > 10 * ThetaShieldUnits.WAD || config.minimumEstimatedLossWad == 0
        ) revert InvalidFeeConfiguration();
    }
}

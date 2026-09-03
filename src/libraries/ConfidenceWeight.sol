// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title ConfidenceWeight
/// @notice Mechanical confidence from count, agreement, and robust dispersion.
library ConfidenceWeight {
    uint256 internal constant DEFAULT_SINGLE_SOURCE_CAP_WAD = 0.6e18;

    struct Components {
        uint256 countScoreWad;
        uint256 agreementScoreWad;
        uint256 dispersionScoreWad;
        uint256 uncappedConfidenceWad;
        uint256 confidenceWad;
    }

    error InvalidConfidenceInputs();

    /// @notice Calculates w = countScore * agreementScore * dispersionScore.
    /// @param confidenceCapWad Configurable maximum, e.g. 0.60e18 for one source.
    function calculate(
        uint256 observationCount,
        uint256 targetObservationCount,
        uint256 agreeingNotionalWad,
        uint256 totalNotionalWad,
        uint256 referenceDispersionWad,
        uint256 maximumDispersionWad,
        uint256 confidenceCapWad
    ) internal pure returns (Components memory components) {
        if (
            targetObservationCount == 0 || totalNotionalWad == 0 || agreeingNotionalWad > totalNotionalWad
                || maximumDispersionWad == 0 || confidenceCapWad > ThetaShieldUnits.WAD
        ) revert InvalidConfidenceInputs();

        uint256 cappedCount = observationCount > targetObservationCount ? targetObservationCount : observationCount;
        components.countScoreWad = FixedPointMath.mulDivDown(cappedCount, ThetaShieldUnits.WAD, targetObservationCount);

        uint256 agreementWad = FixedPointMath.mulDivDown(agreeingNotionalWad, ThetaShieldUnits.WAD, totalNotionalWad);
        uint256 halfWad = ThetaShieldUnits.WAD / 2;
        if (agreementWad > halfWad) {
            components.agreementScoreWad = (agreementWad - halfWad) * 2;
        }

        if (referenceDispersionWad < maximumDispersionWad) {
            components.dispersionScoreWad = FixedPointMath.mulDivDown(
                maximumDispersionWad - referenceDispersionWad, ThetaShieldUnits.WAD, maximumDispersionWad
            );
        }

        uint256 countAgreementWad = FixedPointMath.mulWadDown(components.countScoreWad, components.agreementScoreWad);
        components.uncappedConfidenceWad = FixedPointMath.mulWadDown(countAgreementWad, components.dispersionScoreWad);
        components.confidenceWad =
            components.uncappedConfidenceWad > confidenceCapWad ? confidenceCapWad : components.uncappedConfidenceWad;
    }
}

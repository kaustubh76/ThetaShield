// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title DirectionalRiskSmoother
/// @notice Smooths magnitude while preserving the current aggregate direction.
library DirectionalRiskSmoother {
    struct Result {
        uint256 magnitudeWad;
        int256 signedRiskWad;
    }

    error InvalidWeight(uint256 valueWad);

    /// @notice Applies magnitude_t = alpha*abs(M_t) + (1-alpha)*magnitude_(t-1).
    function update(int256 aggregateMarkoutWad, uint256 previousMagnitudeWad, uint256 alphaWad, uint256 confidenceWad)
        internal
        pure
        returns (Result memory result)
    {
        if (alphaWad > ThetaShieldUnits.WAD) revert InvalidWeight(alphaWad);
        if (confidenceWad > ThetaShieldUnits.WAD) revert InvalidWeight(confidenceWad);

        uint256 currentContribution = FixedPointMath.mulWadDown(FixedPointMath.abs(aggregateMarkoutWad), alphaWad);
        uint256 previousContribution = FixedPointMath.mulWadDown(previousMagnitudeWad, ThetaShieldUnits.WAD - alphaWad);
        result.magnitudeWad = currentContribution + previousContribution;

        uint256 riskMagnitudeWad = FixedPointMath.mulWadDown(result.magnitudeWad, confidenceWad);
        if (aggregateMarkoutWad > 0) result.signedRiskWad = FixedPointMath.toInt256(riskMagnitudeWad);
        if (aggregateMarkoutWad < 0) result.signedRiskWad = -FixedPointMath.toInt256(riskMagnitudeWad);
    }
}

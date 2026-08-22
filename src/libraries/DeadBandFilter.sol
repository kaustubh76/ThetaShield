// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.26;

import {ThetaShieldUnits} from "../base/ThetaShieldUnits.sol";
import {FixedPointMath} from "./FixedPointMath.sol";

/// @title DeadBandFilter
/// @notice Applies a signed soft threshold without clipping favorable evidence.
library DeadBandFilter {
    /// @notice Calculates k * sigma, with k and sigma scaled by 1e18.
    function band(uint256 sigmaWad, uint256 kWad) internal pure returns (uint256) {
        return FixedPointMath.mulDivDown(sigmaWad, kWad, ThetaShieldUnits.WAD);
    }

    /// @notice Applies sign(m) * max(abs(m) - k*sigma, 0).
    function filter(int256 markoutWad, uint256 sigmaWad, uint256 kWad) internal pure returns (int256) {
        return applyBand(markoutWad, band(sigmaWad, kWad));
    }

    /// @notice Applies a precomputed absolute dead-band width.
    function applyBand(int256 markoutWad, uint256 bandWad) internal pure returns (int256) {
        uint256 magnitude = FixedPointMath.abs(markoutWad);
        if (magnitude <= bandWad) return 0;

        int256 excess = FixedPointMath.toInt256(magnitude - bandWad);
        return markoutWad < 0 ? -excess : excess;
    }
}
